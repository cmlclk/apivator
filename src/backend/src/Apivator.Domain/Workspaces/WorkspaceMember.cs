namespace Apivator.Domain.Workspaces;

/// <summary>Bir kullanıcının workspace'teki doğrudan rolü (takım üzerinden gelen roller <see cref="WorkspaceTeam"/>).</summary>
public sealed class WorkspaceMember
{
    private WorkspaceMember()
    {
    }

    internal WorkspaceMember(Guid workspaceId, Guid userId, WorkspaceRole role, DateTimeOffset joinedAt)
    {
        WorkspaceId = workspaceId;
        UserId = userId;
        Role = role;
        JoinedAt = joinedAt;
    }

    public Guid WorkspaceId { get; private set; }

    public Guid UserId { get; private set; }

    public WorkspaceRole Role { get; internal set; }

    public DateTimeOffset JoinedAt { get; private set; }
}
