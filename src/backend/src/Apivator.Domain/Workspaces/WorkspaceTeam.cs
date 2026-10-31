namespace Apivator.Domain.Workspaces;

/// <summary>Bir takımın workspace'teki rolü; takımın tüm üyeleri bu rolü alır.</summary>
public sealed class WorkspaceTeam
{
    private WorkspaceTeam()
    {
    }

    internal WorkspaceTeam(Guid workspaceId, Guid teamId, WorkspaceRole role)
    {
        WorkspaceId = workspaceId;
        TeamId = teamId;
        Role = role;
    }

    public Guid WorkspaceId { get; private set; }

    public Guid TeamId { get; private set; }

    public WorkspaceRole Role { get; internal set; }
}
