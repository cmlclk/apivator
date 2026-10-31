using System.Runtime.CompilerServices;
using System.Text;

namespace Apivator.Infrastructure.Execution;

/// <summary>Bir Server-Sent Events olayı.</summary>
internal sealed record SseEvent(string Event, string Data, string? Id);

/// <summary>
/// text/event-stream ayrıştırıcısı (WHATWG HTML, "event stream interpretation"): satırlar <c>alan: değer</c>,
/// boş satır olayı bitirir, ":" ile başlayan satırlar yorumdur. Birden çok <c>data:</c> satırı "\n" ile
/// birleşir. Son boş satırı gelmeden kapanan olay atılır.
/// </summary>
internal static class SseParser
{
    public static async IAsyncEnumerable<SseEvent> ReadAsync(TextReader reader, [EnumeratorCancellation] CancellationToken ct = default)
    {
        var data = new StringBuilder();
        var hasData = false;
        string? eventName = null;
        string? lastId = null;

        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (line.Length == 0)
            {
                if (hasData)
                {
                    yield return new SseEvent(string.IsNullOrEmpty(eventName) ? "message" : eventName, data.ToString(), lastId);
                }

                data.Clear();
                hasData = false;
                eventName = null;
                continue;
            }

            if (line[0] == ':')
            {
                continue;
            }

            var colon = line.IndexOf(':', StringComparison.Ordinal);
            var field = colon < 0 ? line : line[..colon];
            var value = colon < 0 ? string.Empty : line[(colon + 1)..];
            if (value.StartsWith(' '))
            {
                value = value[1..];
            }

            switch (field)
            {
                case "data":
                    if (hasData)
                    {
                        data.Append('\n');
                    }

                    data.Append(value);
                    hasData = true;
                    break;
                case "event":
                    eventName = value;
                    break;
                case "id" when !value.Contains('\0', StringComparison.Ordinal):
                    lastId = value;
                    break;
            }
        }
    }
}
