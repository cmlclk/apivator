using System.Net.WebSockets;

namespace Apivator.Application.Execution;

/// <summary>
/// Akan yanıtın (Server-Sent Events) bir olayı: "open" (durum ve header'lar), "event" (bir SSE olayı),
/// "body" (yanıt SSE değilse gövdenin tamamı), "done" (akış bitti) ya da "error".
/// </summary>
public sealed record StreamEvent(string Type)
{
    public int? Status { get; init; }

    public string? StatusText { get; init; }

    public IReadOnlyList<HttpHeaderDto>? Headers { get; init; }

    /// <summary>SSE olay adı (event:); belirtilmemişse "message".</summary>
    public string? Event { get; init; }

    public string? Data { get; init; }

    public string? Id { get; init; }

    public string? Message { get; init; }

    public double? ElapsedMs { get; init; }
}

/// <summary>Akan yanıtı olay olay iletir (SSE). İstemci bağlantıyı kesince ya da süre dolunca biter.</summary>
public interface IRequestStreamer
{
    Task StreamAsync(ExecuteHttpRequest request, Func<StreamEvent, Task> emit, CancellationToken cancellationToken = default);
}

/// <summary>
/// Tarayıcıdaki istemci ile hedef WebSocket sunucusu arasında köprü. İstemci ilk mesajda bağlanılacak adresi ve
/// header'ları gönderir; sonra mesajlar iki yöne JSON zarflarıyla aktarılır.
/// </summary>
public interface IWebSocketRelay
{
    Task RunAsync(WebSocket client, CancellationToken cancellationToken = default);
}
