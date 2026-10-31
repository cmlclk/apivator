using Apivator.Domain.Collections;
using Apivator.Domain.Common;

namespace Apivator.Domain.Mocks;

/// <summary>
/// Mock'a gelen bir çağrının kaydı: ne istendi, hangi örnekle eşleşti, ne döndü. Mock başına en yeni
/// <see cref="MaxPerMock"/> kayıt tutulur; header ve body kısaltılarak saklanır.
/// </summary>
public sealed class MockCall : Entity
{
    public const int MaxPerMock = 500;
    public const int PathMaxLength = 2048;
    public const int BodyPreviewLength = 16 * 1024;
    public const int MaxHeaders = 50;

    private MockCall()
    {
        Method = string.Empty;
        Path = string.Empty;
        RequestHeaders = [];
        RequestBody = string.Empty;
    }

    public Guid MockServerId { get; private set; }

    public DateTimeOffset At { get; private set; }

    public string Method { get; private set; }

    /// <summary>Mock adresinden sonraki yol ve query (ör. <c>/users/1?x=2</c>).</summary>
    public string Path { get; private set; }

    public IReadOnlyList<KeyValueItem> RequestHeaders { get; private set; }

    public string RequestBody { get; private set; }

    public int Status { get; private set; }

    public Guid? ExampleId { get; private set; }

    /// <summary>Eşleşen örneğin "İstek adı / Örnek adı" biçiminde adı; eşleşme yoksa null.</summary>
    public string? MatchedName { get; private set; }

    /// <summary>Eşleşme olmadığında ya da istek reddedildiğinde nedeni.</summary>
    public string? Error { get; private set; }

    public int DurationMs { get; private set; }

    public static MockCall Create(
        Guid mockServerId,
        DateTimeOffset at,
        string method,
        string path,
        IReadOnlyList<KeyValueItem> requestHeaders,
        string requestBody,
        int status,
        Guid? exampleId,
        string? matchedName,
        string? error,
        int durationMs) => new()
        {
            MockServerId = mockServerId,
            At = at,
            Method = Truncate(method, 20),
            Path = Truncate(path, PathMaxLength),
            RequestHeaders = requestHeaders.Take(MaxHeaders).ToList(),
            RequestBody = Truncate(requestBody, BodyPreviewLength),
            Status = status,
            ExampleId = exampleId,
            MatchedName = matchedName is null ? null : Truncate(matchedName, 420),
            Error = error is null ? null : Truncate(error, 500),
            DurationMs = durationMs,
        };

    private static string Truncate(string value, int max) => value.Length > max ? value[..max] : value;
}
