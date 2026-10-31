using System.Diagnostics;
using System.Net.WebSockets;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Apivator.Infrastructure.Execution;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Grpc;

/// <summary>
/// gRPC köprüsü. İstemci → köprü:
/// <c>{"type":"start","url","metadata":[{key,value}],"method":"/paket.Servis/Metot","descriptorSet":"base64","deadlineSeconds"}</c>,
/// sonra <c>{"type":"send","message":"{json}"}</c>, <c>{"type":"end"}</c> (istemci akışı bitti) ve <c>{"type":"cancel"}</c>.
/// Köprü → istemci: <c>headers</c>, <c>sent</c> (gönderilen mesajın ikili boyutu), <c>message</c> (JSON metni),
/// <c>status</c> (kod, ad, mesaj, trailer'lar, süre) ve <c>error</c> (gönderilemeyen mesaj gibi çağrıyı bitirmeyen hatalar).
/// Unary ve sunucu akışında istemci tek mesajdan sonra <c>end</c> gönderir.
/// </summary>
internal sealed class GrpcRelay(IExecutionHttpClientSource clients, IOptionsMonitor<ProxyOptions> options, TimeProvider clock) : IGrpcRelay
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly JsonSerializerOptions MessageJson = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private sealed record Envelope(
        string Type,
        string? Url = null,
        IReadOnlyList<HttpHeaderDto>? Metadata = null,
        string? Method = null,
        string? DescriptorSet = null,
        double? DeadlineSeconds = null,
        string? Message = null);

    private sealed record Outgoing(
        string Type,
        string? Data = null,
        int? Size = null,
        IReadOnlyList<HttpHeaderDto>? Metadata = null,
        int? Code = null,
        string? Name = null,
        string? Message = null,
        double? TimeMs = null,
        DateTimeOffset? At = null);

    public async Task RunAsync(WebSocket client, CancellationToken cancellationToken = default)
    {
        var settings = options.CurrentValue;
        var maxBytes = settings.WebSocketMaxMessageBytes;
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
                await client.SendAsync(JsonSerializer.SerializeToUtf8Bytes(message, Json), WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch (WebSocketException)
            {
            }
            finally
            {
                sendLock.Release();
            }
        }

        // Tanımlar büyük olabileceği için ilk mesajın sınırı daha geniştir.
        var first = await ReceiveAsync(client, Math.Max(maxBytes, ProtoSchema.MaxProtoBytes * 4), cancellationToken);
        var start = first is { } raw ? Parse(raw) : null;
        if (start is not { Type: "start" } || string.IsNullOrWhiteSpace(start.Method) || string.IsNullOrWhiteSpace(start.DescriptorSet))
        {
            await Send(new Outgoing("error", Message: L.T("grpc.first_message", "İlk mesaj çağrılacak metodu ve tanımları içermeli.")));
            await CloseQuietly(client);
            return;
        }

        if (!GrpcCall.TryParseAddress(start.Url, out var address, out var addressError))
        {
            await Fail(addressError);
            return;
        }

        ProtoSchema schema;
        try
        {
            schema = ProtoSchema.FromDescriptorSet(Convert.FromBase64String(start.DescriptorSet));
        }
        catch (Exception ex) when (ex is FormatException or ProtoBuf.ProtoException or InvalidOperationException)
        {
            await Fail(L.T("grpc.schema_unreadable", "Servis tanımları okunamadı; tanımları yeniden yükleyin."));
            return;
        }

        if (schema.Method(start.Method) is not { } method)
        {
            await Fail(L.T("grpc.method_missing", "{method} metodu tanımlarda yok.", ("method", start.Method)));
            return;
        }

        var codec = new ProtoJson(schema);
        TimeSpan? deadline = start.DeadlineSeconds is > 0 and var seconds ? TimeSpan.FromSeconds(Math.Min(seconds, settings.StreamMaxMinutes * 60)) : null;
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        lifetime.CancelAfter(TimeSpan.FromMinutes(settings.StreamMaxMinutes));
        var stopwatch = Stopwatch.StartNew();

        GrpcCall call;
        try
        {
            call = GrpcCall.Start(clients.CreateClient(), address, start.Method, start.Metadata ?? [], deadline, maxBytes, lifetime.Token);
        }
        catch (ProtoException ex)
        {
            await Fail(ex.Message);
            return;
        }

        using (call)
        {
            var clientStreaming = method.Method.ClientStreaming;
            var sentCount = 0;

            // İstemciden gelenler: mesajlar kodlanıp çağrıya yazılır.
            var fromClient = Task.Run(
                async () =>
                {
                    // Okuma çağrının iptal belirteciyle kesilmez: WebSocket okuması iptal edilirse soket düşer ve
                    // son "status" mesajı istemciye ulaşmayabilir. Döngü, kapanış el sıkışmasıyla biter.
                    while (client.State == WebSocketState.Open)
                    {
                        var received = await ReceiveAsync(client, maxBytes, cancellationToken);
                        if (received is null)
                        {
                            call.Cancel();
                            return;
                        }

                        var envelope = Parse(received);
                        switch (envelope?.Type)
                        {
                            case "cancel":
                                call.Cancel();
                                return;
                            case "end":
                                call.CompleteRequest();
                                break;
                            case "send":
                                if (!clientStreaming && sentCount > 0)
                                {
                                    await Send(new Outgoing("error", Message: L.T("grpc.single_request", "Bu metot tek istek mesajı alır.")));
                                    break;
                                }

                                byte[] bytes;
                                try
                                {
                                    using var document = JsonDocument.Parse(string.IsNullOrWhiteSpace(envelope.Message) ? "{}" : envelope.Message);
                                    bytes = codec.Encode(method.Method.InputType, document.RootElement);
                                }
                                catch (JsonException ex)
                                {
                                    await Send(new Outgoing("error", Message: L.T("grpc.invalid_json", "Mesaj geçerli bir JSON değil: {message}", ("message", ex.Message))));
                                    break;
                                }
                                catch (ProtoException ex)
                                {
                                    await Send(new Outgoing("error", Message: ex.Message));
                                    break;
                                }

                                if (call.Send(bytes))
                                {
                                    sentCount++;
                                    await Send(new Outgoing("sent", Data: envelope.Message, Size: bytes.Length, At: clock.GetUtcNow()));
                                    if (!clientStreaming)
                                    {
                                        call.CompleteRequest();
                                    }
                                }
                                else
                                {
                                    await Send(new Outgoing("error", Message: L.T("grpc.request_stream_closed", "İstek akışı kapandı; mesaj gönderilmedi.")));
                                }

                                break;
                        }
                    }
                },
                CancellationToken.None);

            GrpcCallStatus status;
            try
            {
                await call.WhenStarted;
                if (call.EarlyStatus is null || call.ResponseHeaders.Count > 0)
                {
                    await Send(new Outgoing("headers", Metadata: call.ResponseHeaders, At: clock.GetUtcNow()));
                }
                while (await call.ReadAsync() is { } data)
                {
                    string text;
                    try
                    {
                        text = JsonSerializer.Serialize(codec.Decode(method.Method.OutputType, data), MessageJson);
                    }
                    catch (ProtoException ex)
                    {
                        text = JsonSerializer.Serialize(new { _cozulemedi = ex.Message, _ham = Convert.ToBase64String(data) }, MessageJson);
                    }

                    await Send(new Outgoing("message", Data: text, Size: data.Length, At: clock.GetUtcNow()));
                }

                status = call.FinalStatus();
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                status = deadline is not null && stopwatch.Elapsed >= deadline.Value
                    ? new GrpcCallStatus(GrpcStatus.DeadlineExceeded, L.T("grpc.deadline", "Süre ({seconds:0.#} sn) doldu.", ("seconds", deadline.Value.TotalSeconds)), [])
                    : lifetime.IsCancellationRequested
                        ? new GrpcCallStatus(GrpcStatus.Cancelled, L.T("grpc.time_limit", "Çağrı {minutes} dakika sınırına ulaştı.", ("minutes", settings.StreamMaxMinutes)), [])
                        : new GrpcCallStatus(GrpcStatus.Cancelled, L.T("grpc.cancelled", "Çağrı iptal edildi."), []);
            }
            catch (HttpRequestException ex)
            {
                status = new GrpcCallStatus(GrpcStatus.Unavailable, GrpcService.Explain(ex, address, settings.SslErrorHint), []);
            }
            catch (Exception ex) when (ex is ProtoException or IOException)
            {
                status = new GrpcCallStatus(call.Token.IsCancellationRequested ? GrpcStatus.Cancelled : GrpcStatus.Internal, ex.Message, []);
            }

            await Send(new Outgoing(
                "status",
                Code: status.Code,
                Name: status.Name,
                Message: status.Message,
                Metadata: status.Trailers,
                TimeMs: stopwatch.Elapsed.TotalMilliseconds,
                At: clock.GetUtcNow()));
            call.Cancel();
            await CloseQuietly(client);
            await Task.WhenAny(fromClient, Task.Delay(TimeSpan.FromSeconds(2), CancellationToken.None));
        }

        async Task Fail(string message)
        {
            await Send(new Outgoing("status", Code: GrpcStatus.Internal, Name: GrpcStatus.Name(GrpcStatus.Internal), Message: message, TimeMs: 0, At: clock.GetUtcNow()));
            await CloseQuietly(client);
        }
    }

    private static async Task<byte[]?> ReceiveAsync(WebSocket socket, int maxBytes, CancellationToken ct)
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
            catch (OperationCanceledException)
            {
                return null;
            }

            if (result.MessageType == WebSocketMessageType.Close)
            {
                return null;
            }

            if (!tooBig && buffer.Length + result.Count > maxBytes)
            {
                tooBig = true;
                buffer.SetLength(0);
            }
            else if (!tooBig)
            {
                buffer.Write(chunk, 0, result.Count);
            }

            if (result.EndOfMessage)
            {
                // Sınırı aşan mesaj boş zarf olarak döner; Parse null verir ve yok sayılır.
                return tooBig ? [] : buffer.ToArray();
            }
        }
    }

    private static Envelope? Parse(byte[] bytes)
    {
        if (bytes.Length == 0)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<Envelope>(bytes, Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static async Task CloseQuietly(WebSocket socket)
    {
        try
        {
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                // Yalnızca kapanış çerçevesi gönderilir; karşı tarafın yanıtını okuma döngüsü alır.
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, string.Empty, CancellationToken.None);
            }
        }
        catch (WebSocketException)
        {
        }
    }
}
