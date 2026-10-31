using Apivator.Domain.Common;

namespace Apivator.Domain.Collections;

/// <summary>
/// Bir isteğe kaydedilmiş örnek yanıt (Postman'deki "Example"). Belgeleme için ve ileride mock server'ın
/// döneceği yanıt olarak kullanılır. Örneğin alındığı istek tanımı da saklanır.
/// </summary>
public sealed class ResponseExample : Entity
{
    public const int NameMaxLength = 200;
    public const int BodyMaxLength = 5 * 1024 * 1024;
    public const int MaxHeaders = 200;

    private ResponseExample()
    {
        Name = string.Empty;
        Body = string.Empty;
        Headers = [];
        Request = RequestDefinition.Default;
    }

    public Guid RequestId { get; private set; }

    public string Name { get; private set; }

    public int Status { get; private set; }

    public IReadOnlyList<KeyValueItem> Headers { get; private set; }

    public string Body { get; private set; }

    /// <summary>Örneğin alındığı istek (değişkenli hâliyle).</summary>
    public RequestDefinition Request { get; private set; }

    public int SortOrder { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static ResponseExample Create(
        Guid requestId,
        string name,
        int status,
        IReadOnlyList<KeyValueItem> headers,
        string body,
        RequestDefinition request,
        int sortOrder,
        DateTimeOffset now) => new()
        {
            RequestId = requestId,
            Name = Names.Clean(name, NameMaxLength),
            Status = ClampStatus(status),
            Headers = headers.Take(MaxHeaders).ToList(),
            Body = body,
            Request = request.Normalize(),
            SortOrder = sortOrder,
            CreatedAt = now,
            UpdatedAt = now,
        };

    public void Update(string? name, int? status, IReadOnlyList<KeyValueItem>? headers, string? body, DateTimeOffset now)
    {
        if (name is not null)
        {
            Name = Names.Clean(name, NameMaxLength);
        }

        if (status is { } s)
        {
            Status = ClampStatus(s);
        }

        if (headers is not null)
        {
            Headers = headers.Take(MaxHeaders).ToList();
        }

        if (body is not null)
        {
            Body = body;
        }

        UpdatedAt = now;
    }

    /// <summary>Başka bir isteğe kopyalanırken kullanılır.</summary>
    public ResponseExample CopyTo(Guid requestId, DateTimeOffset now) =>
        Create(requestId, Name, Status, Headers, Body, Request, SortOrder, now);

    private static int ClampStatus(int status) => status is >= 100 and <= 599 ? status : 200;
}
