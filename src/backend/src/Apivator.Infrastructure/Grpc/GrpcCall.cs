using System.Buffers.Binary;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Threading.Channels;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;

namespace Apivator.Infrastructure.Grpc;

/// <summary>gRPC durum kodları (grpc/status.h).</summary>
internal static class GrpcStatus
{
    public const int Ok = 0;
    public const int Cancelled = 1;
    public const int Unknown = 2;
    public const int DeadlineExceeded = 4;
    public const int Unimplemented = 12;
    public const int Internal = 13;
    public const int Unavailable = 14;

    private static readonly string[] Names =
    [
        "OK", "CANCELLED", "UNKNOWN", "INVALID_ARGUMENT", "DEADLINE_EXCEEDED", "NOT_FOUND", "ALREADY_EXISTS",
        "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "ABORTED", "OUT_OF_RANGE", "UNIMPLEMENTED",
        "INTERNAL", "UNAVAILABLE", "DATA_LOSS", "UNAUTHENTICATED",
    ];

    public static string Name(int code) => code >= 0 && code < Names.Length ? Names[code] : $"CODE_{code}";

    /// <summary>gRPC dışı HTTP yanıtları için eşleme (grpc/doc/http-grpc-status-mapping.md).</summary>
    public static int FromHttp(HttpStatusCode status) => status switch
    {
        HttpStatusCode.BadRequest => Internal,
        HttpStatusCode.Unauthorized => 16,
        HttpStatusCode.Forbidden => 7,
        HttpStatusCode.NotFound => Unimplemented,
        HttpStatusCode.TooManyRequests or HttpStatusCode.BadGateway or HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout => Unavailable,
        _ => Unknown,
    };
}

internal sealed record GrpcCallStatus(int Code, string Message, IReadOnlyList<HttpHeaderDto> Trailers)
{
    public string Name => GrpcStatus.Name(Code);
}

/// <summary>
/// Tek bir gRPC çağrısı (HTTP/2 üzerinde): istek gövdesi bir kanaldan beslenir, her mesaj 5 baytlık önekle
/// (sıkıştırma bayrağı + uzunluk) çerçevelenir; yanıt mesajları geldikçe okunur, durum trailer'lardan alınır.
/// Aynı sınıf unary ve tüm akış türleri için kullanılır.
/// </summary>
internal sealed class GrpcCall : IDisposable
{
    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase)
    {
        "content-type", "te", "host", "connection", "content-length", "transfer-encoding", "grpc-timeout", "grpc-encoding",
        "grpc-accept-encoding", "user-agent", "upgrade", "keep-alive", "proxy-connection",
    };

    private static readonly HashSet<string> TransportHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "date", "server", "content-type", "content-length", "alt-svc", "via",
    };

    private readonly Channel<byte[]> _outgoing = Channel.CreateUnbounded<byte[]>(new UnboundedChannelOptions { SingleReader = true });
    private readonly CancellationTokenSource _lifetime;
    private readonly int _maxMessageBytes;
    private HttpRequestMessage? _request;
    private HttpResponseMessage? _response;
    private Stream? _body;
    private string? _encoding;

    private GrpcCall(CancellationTokenSource lifetime, int maxMessageBytes)
    {
        _lifetime = lifetime;
        _maxMessageBytes = maxMessageBytes;
    }

    public IReadOnlyList<HttpHeaderDto> ResponseHeaders { get; private set; } = [];

    /// <summary>Yanıt gövdesi yokken (trailers-only) ya da HTTP düzeyinde hata olduğunda erken belirlenen durum.</summary>
    public GrpcCallStatus? EarlyStatus { get; private set; }

    /// <summary>
    /// Adres: <c>host:port</c> (TLS'siz), <c>grpc://</c>/<c>http://</c> (TLS'siz) ya da <c>grpcs://</c>/<c>https://</c> (TLS).
    /// 443 portlu çıplak adres TLS kabul edilir. Adresteki yol önek olarak korunur (ağ geçitleri için).
    /// </summary>
    public static bool TryParseAddress(string? raw, out Uri uri, out string error)
    {
        uri = null!;
        error = string.Empty;
        var value = raw?.Trim() ?? string.Empty;
        if (value.Length == 0)
        {
            error = L.T("grpc.address_empty", "Sunucu adresi boş.");
            return false;
        }

        if (!value.Contains("://", StringComparison.Ordinal))
        {
            value = (value.Split('/')[0].EndsWith(":443", StringComparison.Ordinal) ? "https://" : "http://") + value;
        }

        if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed) || parsed.Scheme is not ("grpc" or "grpcs" or "http" or "https"))
        {
            error = L.T("grpc.address_format", "Adres host:port, grpc://, grpcs://, http:// ya da https:// biçiminde olmalı.");
            return false;
        }

        uri = parsed.Scheme switch
        {
            "grpc" => new UriBuilder(parsed) { Scheme = "http", Port = parsed.IsDefaultPort ? 80 : parsed.Port }.Uri,
            "grpcs" => new UriBuilder(parsed) { Scheme = "https", Port = parsed.IsDefaultPort ? 443 : parsed.Port }.Uri,
            _ => parsed,
        };
        return true;
    }

    /// <summary>
    /// Çağrıyı başlatır ve hemen döner: sunucular yanıt header'larını çoğu zaman ilk istek mesajını aldıktan sonra
    /// gönderdiği için mesajlar <see cref="WhenStarted"/> beklenmeden yazılabilmeli.
    /// </summary>
    public static GrpcCall Start(
        HttpClient client,
        Uri address,
        string methodPath,
        IEnumerable<HttpHeaderDto> metadata,
        TimeSpan? deadline,
        int maxMessageBytes,
        CancellationToken cancellationToken)
    {
        var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        if (deadline is { } d)
        {
            // Sunucu süreyi uygulamazsa da çağrı bitsin; küçük pay ağ gecikmesi için.
            lifetime.CancelAfter(d + TimeSpan.FromMilliseconds(500));
        }

        var call = new GrpcCall(lifetime, maxMessageBytes);
        try
        {
            var basePath = address.AbsolutePath.TrimEnd('/');
            var target = new UriBuilder(address) { Path = basePath + methodPath, Query = string.Empty }.Uri;
            // İstek, akış süresince yaşamalı (gövdesi çağrı boyunca yazılır); Dispose'da bırakılır.
            var request = call._request = new HttpRequestMessage(HttpMethod.Post, target)
            {
                Version = HttpVersion.Version20,
                VersionPolicy = HttpVersionPolicy.RequestVersionExact,
                Content = new FramedContent(call._outgoing.Reader),
            };
            request.Headers.TryAddWithoutValidation("te", "trailers");
            request.Headers.TryAddWithoutValidation("grpc-accept-encoding", "identity,gzip");
            request.Headers.UserAgent.ParseAdd("apivator-grpc/1.0");
            if (deadline is { } timeout)
            {
                request.Headers.TryAddWithoutValidation("grpc-timeout", $"{Math.Max(1, (long)timeout.TotalMilliseconds)}m");
            }

            foreach (var header in metadata)
            {
                var key = header.Key.Trim().ToLowerInvariant();
                if (key.Length == 0 || key.StartsWith(':') || Reserved.Contains(key))
                {
                    continue;
                }

                if (!request.Headers.TryAddWithoutValidation(key, header.Value))
                {
                    throw new ProtoException(L.T("grpc.metadata_key", "'{name}' metadata anahtarı gönderilemez.", ("name", header.Key)));
                }
            }

            call.WhenStarted = call.ConnectAsync(client, request);
            return call;
        }
        catch
        {
            call.Dispose();
            throw;
        }
    }

    /// <summary>Yanıt header'ları geldiğinde tamamlanır; bağlantı hatalarını (HttpRequestException) taşır.</summary>
    public Task WhenStarted { get; private set; } = Task.CompletedTask;

    private async Task ConnectAsync(HttpClient client, HttpRequestMessage request)
    {
        var response = _response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, _lifetime.Token);
        var contentType = response.Content.Headers.ContentType?.MediaType ?? string.Empty;
        if (response.Headers.TryGetValues("grpc-status", out _))
        {
            // Trailers-only yanıt (çoğunlukla hata): gövde yok, durum ve trailer'lar header'larda. Ayrı bir yanıt
            // metadata'sı yoktur; HTTP'nin kendi header'ları trailer sayılmaz.
            EarlyStatus = ReadStatus(response.Headers);
            EarlyStatus = EarlyStatus with { Trailers = [.. EarlyStatus.Trailers.Where(h => !TransportHeaders.Contains(h.Key))] };
            return;
        }

        ResponseHeaders = [.. Flatten(response.Headers)];
        if (response.StatusCode != HttpStatusCode.OK)
        {
            EarlyStatus = new GrpcCallStatus(
                GrpcStatus.FromHttp(response.StatusCode),
                L.T("grpc.http_instead", "Sunucu gRPC yerine HTTP {status} döndü.", ("status", $"{(int)response.StatusCode} {response.ReasonPhrase}")),
                []);
        }
        else if (!contentType.StartsWith("application/grpc", StringComparison.OrdinalIgnoreCase))
        {
            EarlyStatus = new GrpcCallStatus(
                GrpcStatus.Unknown,
                L.T("grpc.not_grpc", "Yanıt bir gRPC yanıtı değil (content-type: {type}).", ("type", contentType.Length == 0 ? L.T("grpc.none", "yok") : contentType)),
                []);
        }
        else
        {
            _encoding = response.Headers.TryGetValues("grpc-encoding", out var encodings) ? encodings.FirstOrDefault() : null;
            _body = await response.Content.ReadAsStreamAsync(_lifetime.Token);
        }
    }

    public CancellationToken Token => _lifetime.Token;

    public bool Send(byte[] message) => _outgoing.Writer.TryWrite(message);

    /// <summary>İstemci akışının sonu (unary ve sunucu akışında ilk mesajdan hemen sonra).</summary>
    public void CompleteRequest() => _outgoing.Writer.TryComplete();

    public void Cancel() => _lifetime.Cancel();

    /// <summary>Sıradaki yanıt mesajı; akış bittiyse null.</summary>
    public async Task<byte[]?> ReadAsync()
    {
        await WhenStarted;
        if (_body is null)
        {
            return null;
        }

        var header = new byte[5];
        if (!await FillAsync(_body, header, allowEnd: true))
        {
            return null;
        }

        var compressed = header[0] == 1;
        var length = BinaryPrimitives.ReadUInt32BigEndian(header.AsSpan(1));
        if (length > (uint)_maxMessageBytes)
        {
            throw new ProtoException(L.T("grpc.message_too_large", "Sunucudan gelen mesaj {max} KB sınırını aşıyor ({size} KB).", ("max", _maxMessageBytes / 1024), ("size", length / 1024)));
        }

        var data = new byte[length];
        if (!await FillAsync(_body, data, allowEnd: false))
        {
            throw new ProtoException(L.T("grpc.message_truncated", "Yanıt mesajı yarım kesildi."));
        }

        if (!compressed)
        {
            return data;
        }

        if (!string.Equals(_encoding, "gzip", StringComparison.OrdinalIgnoreCase))
        {
            throw new ProtoException(L.T("grpc.compression", "Sunucu desteklenmeyen sıkıştırma kullandı ({encoding}).", ("encoding", _encoding ?? L.T("grpc.unspecified", "belirtilmemiş"))));
        }

        using var input = new GZipStream(new MemoryStream(data), CompressionMode.Decompress);
        using var output = new MemoryStream();
        var buffer = new byte[16 * 1024];
        int read;
        while ((read = await input.ReadAsync(buffer, _lifetime.Token)) > 0)
        {
            if (output.Length + read > _maxMessageBytes)
            {
                throw new ProtoException(L.T("grpc.message_too_large_decompressed", "Sunucudan gelen mesaj açıldığında {max} KB sınırını aşıyor.", ("max", _maxMessageBytes / 1024)));
            }

            output.Write(buffer, 0, read);
        }

        return output.ToArray();
    }

    /// <summary>Gövde bittikten sonra çağrılır: trailer'lardaki durum.</summary>
    public GrpcCallStatus FinalStatus()
    {
        if (EarlyStatus is not null)
        {
            return EarlyStatus;
        }

        var trailers = _response!.TrailingHeaders;
        return trailers.TryGetValues("grpc-status", out _)
            ? ReadStatus(trailers)
            : new GrpcCallStatus(GrpcStatus.Internal, L.T("grpc.no_status", "Sunucu yanıtı durum (grpc-status) bildirmeden bitirdi."), [.. Flatten(trailers)]);
    }

    private async Task<bool> FillAsync(Stream stream, byte[] buffer, bool allowEnd)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(offset), _lifetime.Token);
            if (read == 0)
            {
                if (offset == 0 && allowEnd)
                {
                    return false;
                }

                throw new ProtoException(L.T("grpc.message_truncated", "Yanıt mesajı yarım kesildi."));
            }

            offset += read;
        }

        return true;
    }

    private static GrpcCallStatus ReadStatus(HttpHeaders headers)
    {
        var code = headers.TryGetValues("grpc-status", out var values) && int.TryParse(values.FirstOrDefault(), out var parsed) ? parsed : GrpcStatus.Unknown;
        var message = headers.TryGetValues("grpc-message", out var messages) ? PercentDecode(messages.FirstOrDefault() ?? string.Empty) : string.Empty;
        var trailers = Flatten(headers).Where(h => h.Key is not ("grpc-status" or "grpc-message")).ToList();
        return new GrpcCallStatus(code, message, trailers);
    }

    private static IEnumerable<HttpHeaderDto> Flatten(HttpHeaders headers) =>
        headers.SelectMany(h => h.Value.Select(v => new HttpHeaderDto(h.Key.ToLowerInvariant(), v)));

    private static string PercentDecode(string value)
    {
        try
        {
            return Uri.UnescapeDataString(value);
        }
        catch (UriFormatException)
        {
            return value;
        }
    }

    public void Dispose()
    {
        _outgoing.Writer.TryComplete();
        _lifetime.Cancel();
        _body?.Dispose();
        _response?.Dispose();
        _request?.Dispose();
        _lifetime.Dispose();
    }

    /// <summary>İstek gövdesi: kanal kapanana kadar mesajları çerçeveleyip yazar (çift yönlü akış için).</summary>
    private sealed class FramedContent : HttpContent
    {
        private readonly ChannelReader<byte[]> _reader;

        public FramedContent(ChannelReader<byte[]> reader)
        {
            _reader = reader;
            Headers.ContentType = new MediaTypeHeaderValue("application/grpc");
        }

        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
            SerializeToStreamAsync(stream, context, CancellationToken.None);

        protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context, CancellationToken cancellationToken)
        {
            await foreach (var message in _reader.ReadAllAsync(cancellationToken))
            {
                var header = new byte[5];
                BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(1), (uint)message.Length);
                await stream.WriteAsync(header, cancellationToken);
                await stream.WriteAsync(message, cancellationToken);
                await stream.FlushAsync(cancellationToken);
            }
        }

        protected override bool TryComputeLength(out long length)
        {
            length = 0;
            return false;
        }
    }
}
