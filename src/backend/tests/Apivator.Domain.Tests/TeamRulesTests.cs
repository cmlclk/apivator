using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;

namespace Apivator.Domain.Tests;

public class TeamRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 21, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Ownership_IsTransferred_AndOwnerCannotBeRemoved()
    {
        var owner = Guid.NewGuid();
        var member = Guid.NewGuid();
        var org = Organization.Create("Ekip", owner, isPersonal: false, Now);
        org.AddMember(member, OrganizationRole.Member, Now);

        Assert.Throws<InvalidOperationException>(() => org.RemoveMember(owner));
        Assert.Throws<InvalidOperationException>(() => org.ChangeRole(member, OrganizationRole.Owner));
        Assert.Throws<InvalidOperationException>(() => org.AddMember(Guid.NewGuid(), OrganizationRole.Owner, Now));

        org.TransferOwnership(member);
        Assert.Equal((member, OrganizationRole.Owner, OrganizationRole.Admin), (org.OwnerId, org.RoleOf(member), org.RoleOf(owner)));
        org.RemoveMember(owner);
        Assert.Null(org.RoleOf(owner));
    }

    [Fact]
    public void PersonalOrganization_CannotHaveMembersOrTeamWorkspaces()
    {
        var org = Organization.Create("Ayşe", Guid.NewGuid(), isPersonal: true, Now);
        Assert.Throws<InvalidOperationException>(() => org.AddMember(Guid.NewGuid(), OrganizationRole.Member, Now));
        Assert.Throws<InvalidOperationException>(() => org.AddWorkspace("W", WorkspaceType.Team, org.OwnerId, Now));
    }

    [Fact]
    public void Invitation_IsAcceptedOnce_AndExpires()
    {
        var invitation = Invitation.Create(Guid.NewGuid(), " Ayse@Example.COM ", OrganizationRole.Member, null, null, "hash", Guid.NewGuid(), Now);
        Assert.Equal("ayse@example.com", invitation.Email);
        Assert.True(invitation.IsPending(Now));
        Assert.False(invitation.IsPending(Now + Invitation.Lifetime));

        invitation.Accept(Guid.NewGuid(), Now);
        Assert.Throws<InvalidOperationException>(() => invitation.Accept(Guid.NewGuid(), Now));
        Assert.Throws<ArgumentException>(() => Invitation.Create(Guid.NewGuid(), "x@y.z", OrganizationRole.Owner, null, null, "h", Guid.NewGuid(), Now));
    }

    [Fact]
    public void WorkspaceInvitation_DefaultsToEditor()
    {
        var invitation = Invitation.Create(Guid.NewGuid(), "a@b.c", OrganizationRole.Member, Guid.NewGuid(), null, "h", Guid.NewGuid(), Now);
        Assert.Equal(WorkspaceRole.Editor, invitation.WorkspaceRole);
    }

    [Fact]
    public void WorkspaceRoles_AreSetAndReplaced()
    {
        var org = Organization.Create("Ekip", Guid.NewGuid(), isPersonal: false, Now);
        var workspace = org.AddWorkspace("W", WorkspaceType.Team, org.OwnerId, Now);
        var user = Guid.NewGuid();
        var team = Guid.NewGuid();

        workspace.SetMemberRole(user, WorkspaceRole.Viewer, Now);
        workspace.SetMemberRole(user, WorkspaceRole.Editor, Now);
        workspace.SetTeamRole(team, WorkspaceRole.Viewer);
        workspace.SetTeamRole(team, WorkspaceRole.Admin);

        Assert.Equal(WorkspaceRole.Editor, workspace.RoleOf(user));
        Assert.Equal(WorkspaceRole.Admin, workspace.Teams.Single().Role);
        Assert.True(workspace.RemoveTeam(team));
        Assert.True(workspace.RemoveMember(user));
    }
}
