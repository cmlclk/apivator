namespace Apivator.Domain.History;

/// <summary>
/// Bir geçmiş kaydının yanıt gövdesi (isteğe bağlı; kullanıcı tercihi açıksa saklanır). Liste sorgusu gövdeleri
/// yüklemesin diye ayrı tabloda durur; kayıt silinince birlikte silinir. Yalnızca metin gövdeler saklanır.
/// </summary>
public sealed class HistoryResponse
{
    /// <summary>Saklanan gövdenin en fazla uzunluğu (UTF-16 karakter); aşan kısım atılır.</summary>
    public const int MaxBodyLength = 256 * 1024;
    public const int ContentTypeMaxLength = 200;

    private HistoryResponse()
    {
        Body = string.Empty;
    }

    public Guid HistoryEntryId { get; private set; }

    public string Body { get; private set; }

    public string? ContentType { get; private set; }

    /// <summary>Gövde istemcide ya da burada kısaltıldı.</summary>
    public bool Truncated { get; private set; }

    public static HistoryResponse Create(Guid historyEntryId, string body, string? contentType, bool truncated)
    {
        var cut = body.Length > MaxBodyLength;
        if (cut && char.IsHighSurrogate(body[MaxBodyLength - 1]))
        {
            // Vekil çiftini ortadan bölme.
            body = body[..(MaxBodyLength - 1)];
        }
        else if (cut)
        {
            body = body[..MaxBodyLength];
        }

        contentType = string.IsNullOrWhiteSpace(contentType) ? null : contentType.Trim();
        if (contentType is { Length: > ContentTypeMaxLength })
        {
            contentType = contentType[..ContentTypeMaxLength];
        }

        return new HistoryResponse
        {
            HistoryEntryId = historyEntryId,
            Body = body,
            ContentType = contentType,
            Truncated = truncated || cut,
        };
    }
}
