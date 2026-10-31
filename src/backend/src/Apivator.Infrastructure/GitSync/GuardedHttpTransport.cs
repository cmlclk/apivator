using System.Buffers;
using System.Net;
using Apivator.Application.Common.Localization;
using Apivator.Infrastructure.Execution;
using LibGit2Sharp;

namespace Apivator.Infrastructure.GitSync;

/// <summary>Bir işlemin HTTP kimlik bilgisi; libgit2 geri çağrıları aynı iş parçacığında çalıştığından AsyncLocal ile taşınır.</summary>
internal sealed record GitHttpAuth(string? Username, string? Token)
{
    /// <summary>Geri çağrıda atılan hatanın metni; libgit2 yalnızca "no error" döndürdüğünden burada taşınır.</summary>
    public string? Failure { get; set; }
}

/// <summary>
/// libgit2'nin kendi ağ katmanı yerine git "smart HTTP" isteklerini SSRF korumalı <see cref="HttpClient"/> ile
/// yapar (<see cref="HttpRequestExecutor.HttpClientName"/>): her bağlantıda çözülen IP yeniden denetlenir,
/// yönlendirmeler de aynı korumadan geçer. Böylece DNS rebinding ve yönlendirmeyle iç ağa geçilemez.
/// </summary>
internal static class GuardedGit
{
    private static readonly Lock Gate = new();
    private static bool _registered;

    public static IHttpClientFactory? Clients { get; set; }

    /// <summary>Tek yanıtın en fazla bayt sayısı (geçici dizin şişmesine karşı).</summary>
    public static long MaxResponseBytes { get; set; } = 256L * 1024 * 1024;

    /// <summary>Tek git isteğinin (başlık + gövde okuma) toplam süre sınırı.</summary>
    public static TimeSpan Timeout { get; set; } = TimeSpan.FromMinutes(5);

    public static AsyncLocal<GitHttpAuth?> Auth { get; } = new();

    /// <summary>"http" ve "https" şemalarını bu aktarıma bağlar (süreç genelinde, bir kez).</summary>
    public static void EnsureRegistered()
    {
        lock (Gate)
        {
            if (_registered)
            {
                return;
            }

            GlobalSettings.RegisterSmartSubtransport<GuardedHttpSubtransport>("https");
            GlobalSettings.RegisterSmartSubtransport<GuardedHttpSubtransport>("http");
            _registered = true;
        }
    }
}

internal sealed class GuardedHttpSubtransport : RpcSmartSubtransport
{
    protected override SmartSubtransportStream Action(string url, GitSmartSubtransportAction action) =>
        new GuardedHttpStream(this, url, action);
}

/// <summary>Tek bir git isteği: yazılanlar gövdede toplanır, ilk okumada istek yapılır, yanıt okunur.</summary>
// Kaynaklar libgit2 tarafından çağrılan Free() içinde bırakılır.
[System.Diagnostics.CodeAnalysis.SuppressMessage("Design", "CA1001")]
internal sealed class GuardedHttpStream(SmartSubtransport owner, string url, GitSmartSubtransportAction action)
    : SmartSubtransportStream(owner)
{
    private CancellationTokenSource? _deadline;
    private readonly System.Buffers.ArrayBufferWriter<byte> _body = new();
    private HttpResponseMessage? _response;
    private Stream? _content;
    private long _received;

    protected override void Free()
    {
        _content?.Dispose();
        _deadline?.Dispose();
        _response?.Dispose();
        base.Free();
    }

    public override int Write(Stream dataStream, long length)
    {
        var buffer = new byte[Math.Min(length, 81920)];
        var remaining = length;
        while (remaining > 0)
        {
            var read = dataStream.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
            if (read <= 0)
            {
                break;
            }

            _body.Write(buffer.AsSpan(0, read));
            remaining -= read;
        }

        return 0;
    }

    public override int Read(Stream dataStream, long length, out long bytesRead)
    {
        try
        {
            _content ??= Send();
            var buffer = new byte[Math.Min(length, 81920)];
            var read = _content.ReadAsync(buffer.AsMemory(), _deadline!.Token).AsTask().GetAwaiter().GetResult();
            _received += read;
            if (_received > GuardedGit.MaxResponseBytes)
            {
                throw new InvalidOperationException(L.T("git.response_too_large", "Depo yanıtı çok büyük; işlem durduruldu."));
            }

            dataStream.Write(buffer, 0, read);
            bytesRead = read;
            return 0;
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or IOException or OperationCanceledException)
        {
            // Ağ/zaman aşımı hataları ham metniyle yalnızca ayrıntıya (yöneticiye) gider; kullanıcıya genel mesaj döner.
            var message = ex is InvalidOperationException ? ex.Message : "connection failed: " + ex.Message;
            if (GuardedGit.Auth.Value is { } current)
            {
                current.Failure = message;
            }

            throw new InvalidOperationException(message, ex);
        }
    }

    private Stream Send()
    {
        var service = action is GitSmartSubtransportAction.UploadPackList or GitSmartSubtransportAction.UploadPack ? "git-upload-pack" : "git-receive-pack";
        var list = action is GitSmartSubtransportAction.UploadPackList or GitSmartSubtransportAction.ReceivePackList;
        var target = url.TrimEnd('/') + (list ? $"/info/refs?service={service}" : $"/{service}");
        using var request = new HttpRequestMessage(list ? HttpMethod.Get : HttpMethod.Post, target);
        request.Headers.TryAddWithoutValidation("User-Agent", "git/2.45.0 (Apivator)");
        request.Headers.TryAddWithoutValidation("Accept", list ? "*/*" : $"application/x-{service}-result");
        request.Headers.TryAddWithoutValidation("Pragma", "no-cache");
        if (GuardedGit.Auth.Value is { Token: { Length: > 0 } token } auth)
        {
            var credentials = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes($"{(string.IsNullOrEmpty(auth.Username) ? "git" : auth.Username)}:{token}"));
            request.Headers.TryAddWithoutValidation("Authorization", "Basic " + credentials);
        }

        if (!list)
        {
            request.Content = new ByteArrayContent(_body.WrittenSpan.ToArray());
            request.Content.Headers.TryAddWithoutValidation("Content-Type", $"application/x-{service}-request");
        }

        _deadline = new CancellationTokenSource(GuardedGit.Timeout);
        _response = Execute(request, _deadline.Token);
        return _response.Content.ReadAsStream(_deadline.Token);
    }

    private static HttpResponseMessage Execute(HttpRequestMessage request, CancellationToken ct)
    {
        var client = (GuardedGit.Clients ?? throw new InvalidOperationException("Git HTTP istemcisi hazır değil.")).CreateClient(HttpRequestExecutor.HttpClientName);
        HttpResponseMessage response;
        try
        {
            response = client.Send(request, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        catch (HttpRequestException ex) when (Blocked(ex) is { } blocked)
        {
            throw new InvalidOperationException(blocked.Message, ex);
        }

        // Paylaşılan istemci yönlendirmeyi kendisi izler (her atlamada IP yeniden denetlenir) ama POST 301/302 yanıtını
        // GET’e çevirir; git de POST yönlendirmesini izlemez. Yöntem değiştiyse gövde kaybolmuş demektir: reddet.
        if (response.RequestMessage?.Method != request.Method)
        {
            response.Dispose();
            throw new InvalidOperationException("HTTP redirect on POST not supported (not found or failed)");
        }

        if (response.IsSuccessStatusCode)
        {
            return response;
        }

        var status = (int)response.StatusCode;
        response.Dispose();
        // libgit2 hatası olarak yüzeye çıkar; LibGitRemote mesajı Türkçeye çevirir.
        throw new InvalidOperationException(status is 401 or 403 ? $"HTTP {status} authentication failed" : $"HTTP {status} not found or failed");
    }

    private static BlockedDestinationException? Blocked(Exception ex)
    {
        for (var inner = ex; inner is not null; inner = inner.InnerException!)
        {
            if (inner is BlockedDestinationException blocked)
            {
                return blocked;
            }

            if (inner.InnerException is null)
            {
                break;
            }
        }

        return null;
    }
}
