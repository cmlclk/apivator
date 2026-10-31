using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;

namespace Apivator.Domain.Tests;

public class OrganizationTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 20, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Create_AddsOwnerAsMember()
    {
        var owner = Guid.NewGuid();
        var organization = Organization.Create("Ayşe Yılmaz", owner, isPersonal: true, Now);

        var member = Assert.Single(organization.Members);
        Assert.Equal(owner, member.UserId);
        Assert.Equal(OrganizationRole.Owner, member.Role);
        Assert.StartsWith("ayse-yilmaz-", organization.Slug, StringComparison.Ordinal);
    }

    [Fact]
    public void AddWorkspace_MakesCreatorAdmin()
    {
        var owner = Guid.NewGuid();
        var organization = Organization.Create("Ekip", owner, isPersonal: false, Now);

        var workspace = organization.AddWorkspace("Ödeme API", WorkspaceType.Team, owner, Now);

        Assert.Equal(organization.Id, workspace.OrganizationId);
        Assert.Equal(WorkspaceRole.Admin, workspace.RoleOf(owner));
    }

    [Fact]
    public void PersonalOrganization_RejectsTeamWorkspace()
    {
        var organization = Organization.Create("Ayşe", Guid.NewGuid(), isPersonal: true, Now);

        Assert.Throws<InvalidOperationException>(() =>
            organization.AddWorkspace("Ekip", WorkspaceType.Team, organization.OwnerId, Now));
    }

    [Fact]
    public void PersonalWorkspace_RejectsNewMembers()
    {
        var organization = Organization.Create("Ayşe", Guid.NewGuid(), isPersonal: true, Now);
        var workspace = organization.AddWorkspace("Kişisel", WorkspaceType.Personal, organization.OwnerId, Now);

        Assert.Throws<InvalidOperationException>(() => workspace.AddMember(Guid.NewGuid(), WorkspaceRole.Editor, Now));
    }

    [Fact]
    public void TeamWorkspace_RejectsDuplicateMember()
    {
        var owner = Guid.NewGuid();
        var other = Guid.NewGuid();
        var workspace = Organization.Create("Ekip", owner, isPersonal: false, Now)
            .AddWorkspace("API", WorkspaceType.Team, owner, Now);

        workspace.AddMember(other, WorkspaceRole.Viewer, Now);

        Assert.Equal(WorkspaceRole.Viewer, workspace.RoleOf(other));
        Assert.Throws<InvalidOperationException>(() => workspace.AddMember(other, WorkspaceRole.Editor, Now));
    }
}
