using Apivator.Domain.Collections;
using Apivator.Domain.Common;

namespace Apivator.Domain.History;

/// <summary>
/// Kullanıcının gönderdiği bir istek. Tanım {{değişken}} hâliyle saklanır; değişkenlerin güncel değerleri
/// (token gibi) buraya girmez. Her kullanıcı yalnızca kendi geçmişini görür.
/// </summary>
public sealed class HistoryEntry : Entity
{
    public const int MaxEntriesPerUser = 500;
    public const int UrlMaxLength = 2048;

    private HistoryEntry()
    {
        Method = string.Empty;
        Url = string.Empty;
        Definition = RequestDefinition.Default;
    }

    public Guid UserId { get; private set; }

    public Guid WorkspaceId { get; private set; }

    /// <summary>Kayıtlı bir istekten gönderildiyse onun Id'si.</summary>
    public Guid? RequestId { get; private set; }

    public string Method { get; private set; }

    /// <summary>Listede gösterilen (kısaltılmış) URL.</summary>
    public string Url { get; private set; }

    public RequestDefinition Definition { get; private set; }

    public int? Status { get; private set; }

    public double? TimeMs { get; private set; }

    public long? Size { get; private set; }

    public DateTimeOffset ExecutedAt { get; private set; }

    public static HistoryEntry Create(
        Guid userId,
        Guid workspaceId,
        Guid? requestId,
        RequestDefinition definition,
        int? status,
        double? timeMs,
        long? size,
        DateTimeOffset executedAt)
    {
        var normalized = definition.Normalize();
        return new HistoryEntry
        {
            UserId = userId,
            WorkspaceId = workspaceId,
            RequestId = requestId,
            Method = normalized.Method.Length > 20 ? normalized.Method[..20] : normalized.Method,
            Url = normalized.Url.Length > UrlMaxLength ? normalized.Url[..UrlMaxLength] : normalized.Url,
            Definition = normalized,
            Status = status,
            TimeMs = timeMs,
            Size = size,
            ExecutedAt = executedAt,
        };
    }
}
