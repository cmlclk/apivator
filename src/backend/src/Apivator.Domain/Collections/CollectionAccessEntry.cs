using Apivator.Domain.Common;
using Apivator.Domain.Workspaces;

namespace Apivator.Domain.Collections;

/// <summary>
/// Bir kullanıcının ya da takımın tek bir collection'daki rolü (Viewer ya da Editor). Workspace rolünün yerine geçer:
/// düzenleyiciyi bu collection'da görüntüleyiciye indirmek (daraltma) ya da görüntüleyiciye bu collection'ı
/// düzenleme izni vermek için kullanılır. Workspace yöneticileri her collection'da yöneticidir; kayıt onları etkilemez.
/// Kayıt workspace'e erişim vermez: kişi workspace'e başka yoldan erişemiyorsa hiçbir şey görmez.
/// </summary>
public sealed class CollectionAccessEntry : Entity
{
    public const int MaxPerCollection = 200;

    private CollectionAccessEntry()
    {
    }

    public Guid CollectionId { get; private set; }

    /// <summary>Kullanıcı kaydında dolu; takım kaydında null.</summary>
    public Guid? UserId { get; private set; }

    /// <summary>Takım kaydında dolu; kullanıcı kaydında null.</summary>
    public Guid? TeamId { get; private set; }

    public WorkspaceRole Role { get; private set; }

    public Guid CreatedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public static bool IsAssignable(WorkspaceRole role) => role is WorkspaceRole.Viewer or WorkspaceRole.Editor;

    public static CollectionAccessEntry ForUser(Guid collectionId, Guid userId, WorkspaceRole role, Guid createdById, DateTimeOffset now) =>
        Create(collectionId, userId, null, role, createdById, now);

    public static CollectionAccessEntry ForTeam(Guid collectionId, Guid teamId, WorkspaceRole role, Guid createdById, DateTimeOffset now) =>
        Create(collectionId, null, teamId, role, createdById, now);

    public void ChangeRole(WorkspaceRole role)
    {
        if (!IsAssignable(role))
        {
            throw new ArgumentOutOfRangeException(nameof(role), "Collection rolü Viewer ya da Editor olabilir.");
        }

        Role = role;
    }

    private static CollectionAccessEntry Create(Guid collectionId, Guid? userId, Guid? teamId, WorkspaceRole role, Guid createdById, DateTimeOffset now)
    {
        if (!IsAssignable(role))
        {
            throw new ArgumentOutOfRangeException(nameof(role), "Collection rolü Viewer ya da Editor olabilir.");
        }

        return new CollectionAccessEntry
        {
            CollectionId = collectionId,
            UserId = userId,
            TeamId = teamId,
            Role = role,
            CreatedById = createdById,
            CreatedAt = now,
        };
    }

    /// <summary>
    /// Collection'daki etkin rol. Sıra: workspace yöneticisi her zaman yönetici; kişiye özel kayıt; takım kayıtlarının
    /// en yükseği; collection kısıtlıysa görüntüleyici; yoksa workspace rolü. Workspace'e erişimi olmayana null.
    /// </summary>
    public static WorkspaceRole? Effective(
        WorkspaceRole? workspaceRole,
        bool editingRestricted,
        WorkspaceRole? userEntry,
        IEnumerable<WorkspaceRole> teamEntries)
    {
        if (workspaceRole is null)
        {
            return null;
        }

        if (workspaceRole == WorkspaceRole.Admin)
        {
            return WorkspaceRole.Admin;
        }

        if (userEntry is { } direct)
        {
            return direct;
        }

        var teams = teamEntries.ToList();
        if (teams.Count > 0)
        {
            return teams.Max();
        }

        return editingRestricted ? WorkspaceRole.Viewer : workspaceRole;
    }
}
