using System.Text.Json.Serialization;
using Apivator.Domain.Common;

namespace Apivator.Domain.Forks;

[JsonConverter(typeof(JsonStringEnumConverter<MergeRequestStatus>))]
public enum MergeRequestStatus
{
    Open,
    Merged,

    /// <summary>Kaynağın düzenleyicilerinden biri reddetti.</summary>
    Declined,

    /// <summary>Açan kişi geri çekti ya da fork silindi.</summary>
    Closed,
}

[JsonConverter(typeof(JsonStringEnumConverter<ForkChangeType>))]
public enum ForkChangeType
{
    Added,
    Modified,
    Removed,
}

/// <summary>Birleştirilen bir değişikliğin kaydı (istek geçmişte görünsün diye).</summary>
public sealed record MergedChange(ForkItemKind Kind, string Name, ForkChangeType Change);

public sealed record MergeApproval(Guid UserId, DateTimeOffset At);

/// <summary>Fork'taki değişikliklerin kaynağa alınması isteği: farklar istek bazında incelenir, yorumlanır, onaylanır.</summary>
public sealed class MergeRequest : Entity
{
    public const int TitleMaxLength = 200;
    public const int DescriptionMaxLength = 10_000;

    private MergeRequest()
    {
        Title = string.Empty;
        Approvals = [];
        MergedChanges = [];
    }

    public Guid? ForkId { get; private set; }

    public Guid SourceCollectionId { get; private set; }

    public Guid ForkCollectionId { get; private set; }

    /// <summary>Kaynağın workspace'i: istek, yorumlar ve yetki burada.</summary>
    public Guid WorkspaceId { get; private set; }

    public string Title { get; private set; }

    public string? Description { get; private set; }

    public MergeRequestStatus Status { get; private set; }

    public Guid AuthorId { get; private set; }

    public IReadOnlyList<MergeApproval> Approvals { get; private set; }

    public IReadOnlyList<MergedChange> MergedChanges { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public DateTimeOffset? ClosedAt { get; private set; }

    public Guid? ClosedById { get; private set; }

    public static MergeRequest Create(Guid forkId, Guid sourceCollectionId, Guid forkCollectionId, Guid workspaceId, string title, string? description, Guid authorId, DateTimeOffset now) => new()
    {
        ForkId = forkId,
        SourceCollectionId = sourceCollectionId,
        ForkCollectionId = forkCollectionId,
        WorkspaceId = workspaceId,
        Title = Names.Clean(title, TitleMaxLength),
        Description = Clean(description),
        Status = MergeRequestStatus.Open,
        AuthorId = authorId,
        CreatedAt = now,
        UpdatedAt = now,
    };

    public void Edit(string title, string? description, DateTimeOffset now)
    {
        Title = Names.Clean(title, TitleMaxLength);
        Description = Clean(description);
        UpdatedAt = now;
    }

    /// <summary>Onay verir; aynı kişi ikinci kez onaylarsa onayı geri alınır.</summary>
    public void ToggleApproval(Guid userId, DateTimeOffset now)
    {
        Approvals = Approvals.Any(a => a.UserId == userId)
            ? Approvals.Where(a => a.UserId != userId).ToList()
            : [.. Approvals, new MergeApproval(userId, now)];
        UpdatedAt = now;
    }

    public void MarkMerged(IReadOnlyList<MergedChange> changes, Guid userId, DateTimeOffset now) =>
        Finish(MergeRequestStatus.Merged, userId, now, changes);

    public void Decline(Guid userId, DateTimeOffset now) => Finish(MergeRequestStatus.Declined, userId, now, []);

    public void Close(Guid userId, DateTimeOffset now) => Finish(MergeRequestStatus.Closed, userId, now, []);

    private void Finish(MergeRequestStatus status, Guid userId, DateTimeOffset now, IReadOnlyList<MergedChange> changes)
    {
        Status = status;
        ClosedAt = now;
        ClosedById = userId;
        MergedChanges = changes;
        UpdatedAt = now;
    }

    private static string? Clean(string? description)
    {
        var trimmed = description?.Trim();
        return string.IsNullOrEmpty(trimmed) ? null : trimmed.Length > DescriptionMaxLength ? trimmed[..DescriptionMaxLength] : trimmed;
    }
}
