using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Execution;

/// <summary>
/// İstemci (tarayıcı) ↔ hedef WebSocket köprüsü. Tarayıcı WebSocket'te özel header gönderemez ve hedefe kendi ağından
/// çıkar; köprü bağlantıyı sunucudan (ya da masaüstünde yerel ajandan) kurar. Normal isteklerle aynı HTTP
/// istemcisini kullandığı için ağ koruması (SSRF), proxy ve SSL ayarları burada da geçerlidir.
///
/// İstemci → köprü: <c>{"type":"connect","url","headers":[{key,value}],"protocols":[]}</c>, sonra
/// <c>{"type":"send","data","binary"}</c> ve <c>{"type":"close","code","reason"}</c>.
/// Köprü → istemci: <c>open</c>, <c>message</c> (ikili veri base64), <c>closed</c>, <c>error</c>.
/// </summary>
internal sealed class WebSocketRelay(IExecutionHttpClientSource clients, IOptionsMonitor<ProxyOptions> options, TimeProvider clock) : IWebSocketRelay
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly HashSet<string> ReservedHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "connection", "upgrade", "host", "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions",
        "sec-websocket-protocol", "content-length", "transfer-encoding",
    };

    private sealed record Envelope(
        string Type,
        string? Url = null,
        IReadOnlyList<HttpHeaderDto>? Headers = null,
        IReadOnlyList<string>? Protocols = null,
        string? Data = null,
        bool Binary = false,
        int? Code = null,
        string? Reason = null);

    private sealed record Outgoing(
        string Type,
        string? Data = null,
        bool? Binary = null,
        int? Size = null,
        string? Protocol = null,
        int? Code = null,
        string? Reason = null,
        string? Message = null,
        DateTimeOffset? At = null);

    public async Task RunAsync(WebSocket client, CancellationToken cancellationToken = default)
    {
        var settings = options.CurrentValue;
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        lifetime.CancelAfter(TimeSpan.FromMinutes(settings.WebSocketMaxMinutes));
        var ct = lifetime.Token;
        var sendLock = new SemaphoreSlim(1, 1);

        async Task Send(Outgoing message)
        {
            if (client.State != WebSocketState.Open)
            {
                return;
            }

            await sendLock.WaitAsync(CancellationToken.None);
            try
            {
                var bytes = JsonSerializer.SerializeToUtf8Bytes(message, Json);
                await client.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch (WebSocketException)
            {
                // İstemci gitti; okuma döngüsü kapanışı görür.
            }
            finally
            {
                sendLock.Release();
            }
        }

        var first = await ReceiveAsync(client, settings.WebSocketMaxMessageBytes, ct);
        var connect = first is { Type: WebSocketMessageType.Text } ? Parse(first.Value.Bytes) : null;
        if (connect is not { Type: "connect" } || string.IsNullOrWhiteSpace(connect.Url))
        {
            await Send(new Outgoing("error", Message: L.T("websocket.first_message", "İlk mesaj bağlanılacak adresi içermeli.")));
            await CloseQuietly(client, WebSocketCloseStatus.PolicyViolation, L.T("websocket.close_connect_expected", "connect bekleniyordu"));
            return;
        }

        if (!TryBuildUri(connect.Url, out var uri, out var error))
        {
            await Send(new Outgoing("error", Message: error));
            await CloseQuietly(client, WebSocketCloseStatus.NormalClosure, L.T("websocket.close_invalid_address", "geçersiz adres"));
            return;
        }

        using var target = new ClientWebSocket();
        foreach (var header in connect.Headers ?? [])
        {
            if (!string.IsNullOrWhiteSpace(header.Key) && !ReservedHeaders.Contains(header.Key.Trim()))
            {
                try
                {
                    target.Options.SetRequestHeader(header.Key.Trim(), header.Value);
                }
                catch (ArgumentException)
                {
                    await Send(new Outgoing("error", Message: L.T("websocket.header_not_sendable", "'{name}' header'ı gönderilemez.", ("name", header.Key))));
                }
            }
        }

        foreach (var protocol in (connect.Protocols ?? []).Where(p => !string.IsNullOrWhiteSpace(p)))
        {
            target.Options.AddSubProtocol(protocol.Trim());
        }

        target.Options.CollectHttpResponseDetails = true;
        try
        {
            using var connectTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            connectTimeout.CancelAfter(TimeSpan.FromSeconds(settings.TimeoutSeconds));
            await target.ConnectAsync(uri, clients.CreateClient(), connectTimeout.Token);
        }
        catch (Exception ex) when (ex is WebSocketException or HttpRequestException or OperationCanceledException)
        {
            var httpStatus = (int)target.HttpStatusCode > 0 ? $" (HTTP {(int)target.HttpStatusCode})" : string.Empty;
            var reason = ex is OperationCanceledException && !cancellationToken.IsCancellationRequested
                ? L.T("execute.server_timeout", "Sunucu {seconds} saniye içinde yanıt vermedi.", ("seconds", settings.TimeoutSeconds))
                : L.T("websocket.connect_failed", "Bağlanılamadı{status}: {reason}", ("status", httpStatus), ("reason", Innermost(ex)));
            await Send(new Outgoing("error", Message: reason));
            await CloseQuietly(client, WebSocketCloseStatus.NormalClosure, L.T("websocket.close_connect_failed", "bağlantı kurulamadı"));
            return;
        }

        await Send(new Outgoing("open", Protocol: target.SubProtocol, Code: (int)target.HttpStatusCode, At: clock.GetUtcNow()));

        // Hedeften gelenler istemciye.
        var fromTarget = Task.Run(
            async () =>
            {
                while (!ct.IsCancellationRequested && target.State == WebSocketState.Open)
                {
                    var received = await ReceiveAsync(target, settings.WebSocketMaxMessageBytes, ct);
                    if (received is null)
                    {
                        break;
                    }

                    var (type, bytes, tooBig) = received.Value;
                    if (tooBig)
                    {
                        await Send(new Outgoing("error", Message: L.T("websocket.incoming_too_large", "Sunucudan gelen bir mesaj {max} KB sınırını aştığı için atlandı.", ("max", settings.WebSocketMaxMessageBytes / 1024))));
                        continue;
                    }

                    var binary = type == WebSocketMessageType.Binary;
                    await Send(new Outgoing(
                        "message",
                        Data: binary ? Convert.ToBase64String(bytes) : Encoding.UTF8.GetString(bytes),
                        Binary: binary,
                        Size: bytes.Length,
                        At: clock.GetUtcNow()));
                }
            },
            CancellationToken.None);

        // İstemciden gelenler hedefe.
        try
        {
            while (!ct.IsCancellationRequested && client.State == WebSocketState.Open && target.State == WebSocketState.Open)
            {
                var receiveTask = ReceiveAsync(client, settings.WebSocketMaxMessageBytes, ct);
                if (await Task.WhenAny(receiveTask, fromTarget) == fromTarget)
                {
                    break;
                }

                var received = await receiveTask;
                if (received is null)
                {
                    break;
                }

                if (received.Value.TooBig)
                {
                    await Send(new Outgoing("error", Message: L.T("websocket.outgoing_too_large", "Mesaj {max} KB sınırını aşıyor; gönderilmedi.", ("max", settings.WebSocketMaxMessageBytes / 1024))));
                    continue;
                }

                var envelope = Parse(received.Value.Bytes);
                if (envelope?.Type == "close")
                {
                    await target.CloseAsync(
                        envelope.Code is >= 1000 and <= 4999 ? (WebSocketCloseStatus)envelope.Code.Value : WebSocketCloseStatus.NormalClosure,
                        envelope.Reason ?? string.Empty,
                        ct);
                    break;
                }

                if (envelope is { Type: "send" })
                {
                    byte[] payload;
                    try
                    {
                        payload = envelope.Binary ? Convert.FromBase64String(envelope.Data ?? string.Empty) : Encoding.UTF8.GetBytes(envelope.Data ?? string.Empty);
                    }
                    catch (FormatException)
                    {
                        await Send(new Outgoing("error", Message: L.T("websocket.invalid_base64", "İkili mesaj geçerli base64 değil.")));
                        continue;
                    }

                    await target.SendAsync(payload, envelope.Binary ? WebSocketMessageType.Binary : WebSocketMessageType.Text, true, ct);
                }
            }

            await fromTarget;
        }
        catch (Exception ex) when (ex is WebSocketException or OperationCanceledException or IOException)
        {
            if (ex is OperationCanceledException && !cancellationToken.IsCancellationRequested)
            {
                await Send(new Outgoing("error", Message: L.T("websocket.time_limit", "Bağlantı {minutes} dakika sınırına ulaştı.", ("minutes", settings.WebSocketMaxMinutes))));
            }
            else if (ex is not OperationCanceledException)
            {
                await Send(new Outgoing("error", Message: Innermost(ex)));
            }
        }

        await Send(new Outgoing(
            "closed",
            Code: target.CloseStatus is { } status ? (int)status : null,
            Reason: target.CloseStatusDescription,
            At: clock.GetUtcNow()));
        if (target.State == WebSocketState.Open)
        {
            try
            {
                await target.CloseAsync(WebSocketCloseStatus.NormalClosure, string.Empty, CancellationToken.None);
            }
            catch (WebSocketException)
            {
            }
        }

        await CloseQuietly(client, WebSocketCloseStatus.NormalClosure, string.Empty);
    }

    /// <summary>Bir mesajın tamamı; bağlantı kapandıysa null. Sınırı aşan mesaj okunur ama içeriği atılır.</summary>
    private static async Task<(WebSocketMessageType Type, byte[] Bytes, bool TooBig)?> ReceiveAsync(WebSocket socket, int maxBytes, CancellationToken ct)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        var tooBig = false;
        while (true)
        {
            WebSocketReceiveResult result;
            try
            {
                result = await socket.ReceiveAsync(chunk, ct);
            }
            catch (WebSocketException)
            {
                return null;
            }

            if (result.MessageType == WebSocketMessageType.Close)
            {
                return null;
            }

            if (!tooBig)
            {
                if (buffer.Length + result.Count > maxBytes)
                {
                    tooBig = true;
                    buffer.SetLength(0);
                }
                else
                {
                    buffer.Write(chunk, 0, result.Count);
                }
            }

            if (result.EndOfMessage)
            {
                return (result.MessageType, buffer.ToArray(), tooBig);
            }
        }
    }

    private static Envelope? Parse(byte[] bytes)
    {
        try
        {
            return JsonSerializer.Deserialize<Envelope>(bytes, Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static bool TryBuildUri(string raw, out Uri uri, out string error)
    {
        uri = null!;
        var value = raw.Trim();
        if (!value.Contains("://", StringComparison.Ordinal))
        {
            value = "ws://" + value;
        }

        if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed) || parsed.Scheme is not ("ws" or "wss" or "http" or "https"))
        {
            error = L.T("websocket.address_scheme", "Adres ws:// ya da wss:// ile başlamalı.");
            return false;
        }

        // http(s) yazılmışsa karşılığı kullanılır (bazı servisler belgelerinde böyle verir).
        uri = parsed.Scheme switch
        {
            "http" => new UriBuilder(parsed) { Scheme = "ws" }.Uri,
            "https" => new UriBuilder(parsed) { Scheme = "wss" }.Uri,
            _ => parsed,
        };
        error = string.Empty;
        return true;
    }

    private static string Innermost(Exception ex)
    {
        while (ex.InnerException is not null)
        {
            ex = ex.InnerException;
        }

        return ex.Message;
    }

    private static async Task CloseQuietly(WebSocket socket, WebSocketCloseStatus status, string reason)
    {
        try
        {
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                await socket.CloseAsync(status, reason, CancellationToken.None);
            }
        }
        catch (WebSocketException)
        {
        }
    }
}
