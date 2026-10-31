using Apivator.Domain.Common;
using Apivator.Domain.Variables;

namespace Apivator.Domain.Workspaces;

/// <summary>Collection ve environment'ların yaşadığı, yetkinin verildiği birim.</summary>
public sealed class Workspace : Entity
{
    public const int NameMaxLength = 100;

    private readonly List<WorkspaceMember> _members = [];
    private readonly List<WorkspaceTeam> _teams = [];

    private Workspace()
    {
        Name = string.Empty;
    }

    public Guid OrganizationId { get; private set; }

    public string Name { get; private set; }

    public WorkspaceType Type { get; private set; }

    public Guid CreatedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public IReadOnlyCollection<WorkspaceMember> Members => _members;

    public IReadOnlyCollection<WorkspaceTeam> Teams => _teams;

    /// <summary>Workspace'teki tüm istekler için geçerli değişkenler (en düşük öncelik).</summary>
    public IReadOnlyList<Variable> Globals { get; private set; } = [];

    internal static Workspace Create(Guid organizationId, string name, WorkspaceType type, Guid createdById, DateTimeOffset now)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);

        var workspace = new Workspace
        {
            OrganizationId = organizationId,
            Name = name.Trim().Length > NameMaxLength ? name.Trim()[..NameMaxLength] : name.Trim(),
            Type = type,
            CreatedById = createdById,
            CreatedAt = now,
        };

        workspace._members.Add(new WorkspaceMember(workspace.Id, createdById, WorkspaceRole.Admin, now));
        return workspace;
    }

    public void AddMember(Guid userId, WorkspaceRole role, DateTimeOffset now)
    {
        if (Type == WorkspaceType.Personal)
        {
            throw new InvalidOperationException("Kişisel workspace'e üye eklenemez.");
        }

        if (_members.Any(m => m.UserId == userId))
        {
            throw new InvalidOperationException("Kullanıcı zaten bu workspace'in üyesi.");
        }

        _members.Add(new WorkspaceMember(Id, userId, role, now));
    }

    public void Rename(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        Name = name.Trim().Length > NameMaxLength ? name.Trim()[..NameMaxLength] : name.Trim();
    }

    /// <summary>Kullanıcıyı ekler ya da rolünü değiştirir.</summary>
    public void SetMemberRole(Guid userId, WorkspaceRole role, DateTimeOffset now)
    {
        if (_members.FirstOrDefault(m => m.UserId == userId) is { } existing)
        {
            existing.Role = role;
            return;
        }

        AddMember(userId, role, now);
    }

    public bool RemoveMember(Guid userId) => _members.RemoveAll(m => m.UserId == userId) > 0;

    /// <summary>Takımı ekler ya da rolünü değiştirir.</summary>
    public void SetTeamRole(Guid teamId, WorkspaceRole role)
    {
        if (Type == WorkspaceType.Personal)
        {
            throw new InvalidOperationException("Kişisel workspace'e takım eklenemez.");
        }

        if (_teams.FirstOrDefault(t => t.TeamId == teamId) is { } existing)
        {
            existing.Role = role;
            return;
        }

        _teams.Add(new WorkspaceTeam(Id, teamId, role));
    }

    public bool RemoveTeam(Guid teamId) => _teams.RemoveAll(t => t.TeamId == teamId) > 0;

    public void SetGlobals(IReadOnlyList<Variable> globals) => Globals = globals;

    public WorkspaceRole? RoleOf(Guid userId) => _members.FirstOrDefault(m => m.UserId == userId)?.Role;
}
