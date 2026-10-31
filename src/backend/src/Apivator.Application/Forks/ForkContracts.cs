using Apivator.Domain.Forks;

namespace Apivator.Application.Forks;

public sealed record CreateForkRequest(Guid TargetWorkspaceId, string? Name = null);

/// <summary>Fork bağı. Kullanıcının göremediği taraf için ad yerine null döner.</summary>
public sealed record ForkInfoDto(
    Guid Id,
    Guid ForkCollectionId,
    string? ForkName,
    Guid? ForkWorkspaceId,
    string? ForkWorkspaceName,
    Guid SourceCollectionId,
    string? SourceName,
    Guid? SourceWorkspaceId,
    string? SourceWorkspaceName,
    string CreatedByName,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastPulledAt);

/// <summary>
/// Bir öğenin iki taraftaki durumu (son eşitlemeye göre). <see cref="Key"/> bağlantı kimliği ("link:…") ya da
/// yalnızca bir tarafta olan öğe için "fork:…"/"source:…". Değişmeyen öğeler listelenmez.
/// </summary>
public sealed record ForkChangeDto(
    string Key,
    ForkItemKind Kind,
    string Name,
    string Path,
    ForkChangeType? ForkChange,
    ForkChangeType? SourceChange,
    bool Conflict,
    ForkSnapshot? Base,
    ForkSnapshot? Fork,
    ForkSnapshot? Source);

/// <summary>Fork'un kaynağa göre durumu: fork'ta yapılanlar (merge edilecekler) ve kaynakta yapılanlar (çekilecekler).</summary>
public sealed record ForkComparisonDto(ForkInfoDto Fork, IReadOnlyList<ForkChangeDto> Changes)
{
    public int Outgoing => Changes.Count(c => c.ForkChange is not null);

    public int Incoming => Changes.Count(c => c.SourceChange is not null);

    public int Conflicts => Changes.Count(c => c.Conflict);
}

/// <summary>Çakışmalarda kimin kazanacağı: anahtar → "source" (kaynağınkini al) ya da "fork" (benimkini koru).</summary>
public sealed record PullRequestBody(IReadOnlyDictionary<string, string>? Resolutions = null);

public sealed record CreateMergeRequestBody(string Title, string? Description = null);

public sealed record EditMergeRequestBody(string Title, string? Description);

public sealed record MergeApprovalDto(Guid UserId, string Name, DateTimeOffset At);

public sealed record MergeRequestDto(
    Guid Id,
    Guid? ForkId,
    Guid WorkspaceId,
    Guid SourceCollectionId,
    string SourceName,
    Guid ForkCollectionId,
    string? ForkName,
    string? ForkWorkspaceName,
    string Title,
    string? Description,
    MergeRequestStatus Status,
    Guid AuthorId,
    string AuthorName,
    IReadOnlyList<MergeApprovalDto> Approvals,
    IReadOnlyList<MergedChange> MergedChanges,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    DateTimeOffset? ClosedAt,
    string? ClosedByName,
    bool CanMerge,
    bool CanClose);

/// <summary>İstek ve (açıksa) canlı hesaplanan farklar: yalnızca fork'ta değişenler.</summary>
public sealed record MergeRequestDetailDto(MergeRequestDto Request, IReadOnlyList<ForkChangeDto> Changes, int Conflicts);
