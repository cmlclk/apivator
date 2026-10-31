namespace Apivator.Application.Abstractions;

public enum MergeRequestEmailKind
{
    Opened,
    Merged,
    Declined,
}

public sealed record MergeRequestEmail(
    string To,
    string RecipientName,
    MergeRequestEmailKind Kind,
    string ActorName,
    string Title,
    string Summary,
    Guid WorkspaceId,
    Guid MergeRequestId);

/// <summary>Birleştirme isteği e-postaları (kullanıcı tercihlerinden kapatılabilir).</summary>
public interface IMergeRequestMailer
{
    Task SendAsync(MergeRequestEmail mail, CancellationToken ct = default);
}
