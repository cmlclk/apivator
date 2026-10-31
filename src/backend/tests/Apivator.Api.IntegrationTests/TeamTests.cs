using System.Net;
using System.Net.Http.Json;
using Apivator.Application.Account;
using Apivator.Application.Auth;
using Apivator.Application.Collections;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class TeamTests(ApivatorApiFactory factory)
{
    private sealed record User(HttpClient Client, Guid Id, string Email, Guid PersonalWorkspaceId);

    private async Task<User> UserAsync(string name = "Test Kullanıcı")
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email, name);
        client.WithBearer(auth.AccessToken);
        var workspaces = await client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces");
        return new User(client, auth.User.Id, email, workspaces!.Single().Id);
    }

    private static async Task<(OrganizationDto Org, WorkspaceDto General)> OrganizationAsync(User owner, string name = "Ekip A.Ş.")
    {
        var org = await (await owner.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest(name))).ReadAsync<OrganizationDto>();
        var general = (await owner.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.Single(w => w.OrganizationId == org.Id);
        return (org, general);
    }

    /// <summary>Davet eder ve e-postadaki token'ı döner.</summary>
    private async Task<string> InviteAsync(User admin, Guid orgId, string email, OrganizationRole role = OrganizationRole.Member, Guid? workspaceId = null, WorkspaceRole? workspaceRole = null)
    {
        await (await admin.Client.PostAsJsonAsync($"/api/organizations/{orgId}/invitations", new InviteRequest(email, role, workspaceId, workspaceRole))).ReadAsync<InvitationDto>();
        return TestHelpers.QueryValue(factory.Emails.LastTo(email).TextBody, "token");
    }

    private async Task<User> MemberAsync(User owner, Guid orgId, OrganizationRole role = OrganizationRole.Member, Guid? workspaceId = null, WorkspaceRole? workspaceRole = null)
    {
        var user = await UserAsync("Üye");
        var token = await InviteAsync(owner, orgId, user.Email, role, workspaceId, workspaceRole);
        await (await user.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();
        return user;
    }

    private static async Task<WorkspaceRole?> RoleInAsync(User user, Guid workspaceId) =>
        (await user.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.SingleOrDefault(w => w.Id == workspaceId)?.Role;

    private static Task<HttpResponseMessage> CreateCollectionAsync(User user, Guid workspaceId, string name = "C") =>
        user.Client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest(name));

    [Fact]
    public async Task PersonalOrganization_CannotBeShared()
    {
        var a = await UserAsync();
        var personal = (await a.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!.Single();
        Assert.True(personal.IsPersonal);

        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PostAsJsonAsync($"/api/organizations/{personal.Id}/invitations", new InviteRequest("x@example.com"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PostAsJsonAsync($"/api/organizations/{personal.Id}/workspaces", new CreateWorkspaceRequest("W"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PostAsJsonAsync($"/api/organizations/{personal.Id}/teams", new CreateTeamRequest("T"))).StatusCode);
    }

    [Fact]
    public async Task Invitation_AddsMemberWithWorkspaceRole_AndTokenWorksOnce()
    {
        var a = await UserAsync("Ayşe");
        var b = await UserAsync("Bora");
        var (org, general) = await OrganizationAsync(a);
        Assert.Equal((OrganizationRole.Owner, WorkspaceRole.Admin), (org.Role, general.Role));

        var token = await InviteAsync(a, org.Id, b.Email.ToUpperInvariant(), workspaceId: general.Id, workspaceRole: WorkspaceRole.Viewer);
        Assert.Contains("Ekip A.Ş.", factory.Emails.LastTo(b.Email).Subject, StringComparison.Ordinal);

        var preview = await factory.CreateClient().GetFromJsonAsync<InvitationPreviewDto>($"/api/invitations/preview?token={Uri.EscapeDataString(token)}");
        Assert.Equal(("Ekip A.Ş.", "Ayşe", "Genel", InvitationStatus.Pending, true), (preview!.OrganizationName, preview.InvitedByName, preview.WorkspaceName, preview.Status, preview.AccountExists));

        // Başka bir hesap bu bağlantıyı kullanamaz.
        var c = await UserAsync();
        var mismatch = await c.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token));
        Assert.Equal(HttpStatusCode.Forbidden, mismatch.StatusCode);

        await (await b.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();
        Assert.Equal(WorkspaceRole.Viewer, await RoleInAsync(b, general.Id));
        Assert.Equal(HttpStatusCode.Forbidden, (await CreateCollectionAsync(b, general.Id)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await b.Client.GetAsync($"/api/workspaces/{general.Id}/collections")).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await b.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await a.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(b.Email))).StatusCode);

        var members = await a.Client.GetFromJsonAsync<OrganizationMembersDto>($"/api/organizations/{org.Id}/members");
        Assert.Equal(["Ayşe", "Bora"], members!.Members.Select(m => m.DisplayName));
        Assert.Empty(members.Invitations);
    }

    [Fact]
    public async Task InAppAccept_RequiresConfirmedEmail()
    {
        var a = await UserAsync();
        var (org, _) = await OrganizationAsync(a);
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email);
        client.WithBearer(auth.AccessToken);
        await InviteAsync(a, org.Id, email);

        var mine = await client.GetFromJsonAsync<List<MyInvitationDto>>("/api/me/invitations");
        var invitation = Assert.Single(mine!);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync($"/api/invitations/{invitation.Id}/accept", null)).StatusCode);

        var confirmation = factory.Emails.Sent.Last(m => m.To == email && m.TextBody.Contains("confirm-email", StringComparison.Ordinal));
        await client.PostAsJsonAsync("/api/auth/confirm-email", new ConfirmEmailRequest(
            Guid.Parse(TestHelpers.QueryValue(confirmation.TextBody, "userId")), TestHelpers.QueryValue(confirmation.TextBody, "token")));

        await (await client.PostAsync($"/api/invitations/{invitation.Id}/accept", null)).ReadAsync<AcceptedInvitationDto>();
        Assert.Empty((await client.GetFromJsonAsync<List<MyInvitationDto>>("/api/me/invitations"))!);
    }

    [Fact]
    public async Task Resend_InvalidatesOldLink_AndRevokeStopsAcceptance()
    {
        var a = await UserAsync();
        var b = await UserAsync();
        var (org, _) = await OrganizationAsync(a);
        var first = await InviteAsync(a, org.Id, b.Email);
        var pending = (await a.Client.GetFromJsonAsync<OrganizationMembersDto>($"/api/organizations/{org.Id}/members"))!.Invitations.Single();

        await (await a.Client.PostAsync($"/api/invitations/{pending.Id}/resend", null)).ReadAsync<InvitationDto>();
        var second = TestHelpers.QueryValue(factory.Emails.LastTo(b.Email).TextBody, "token");
        Assert.NotEqual(first, second);
        var old = await factory.CreateClient().GetFromJsonAsync<InvitationPreviewDto>($"/api/invitations/preview?token={Uri.EscapeDataString(first)}");
        Assert.Equal(InvitationStatus.Revoked, old!.Status);

        var current = (await a.Client.GetFromJsonAsync<OrganizationMembersDto>($"/api/organizations/{org.Id}/members"))!.Invitations.Single();
        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.DeleteAsync($"/api/invitations/{current.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await b.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(second))).StatusCode);
    }

    [Fact]
    public async Task TeamRole_RaisesEffectiveRole_UntilTeamIsRemoved()
    {
        var a = await UserAsync();
        var (org, general) = await OrganizationAsync(a);
        var b = await MemberAsync(a, org.Id, workspaceId: general.Id, workspaceRole: WorkspaceRole.Viewer);
        var outsider = await UserAsync();

        var team = await (await a.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/teams", new CreateTeamRequest("Backend"))).ReadAsync<TeamDto>();
        Assert.Equal(HttpStatusCode.Conflict, (await a.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/teams", new CreateTeamRequest("Backend"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PostAsJsonAsync($"/api/teams/{team.Id}/members", new AddTeamMemberRequest(outsider.Id))).StatusCode);
        var withB = await (await a.Client.PostAsJsonAsync($"/api/teams/{team.Id}/members", new AddTeamMemberRequest(b.Id))).ReadAsync<TeamDto>();
        Assert.Single(withB.Members);

        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.PutAsJsonAsync($"/api/workspaces/{general.Id}/members/teams/{team.Id}", new SetRoleRequest(WorkspaceRole.Editor))).StatusCode);
        Assert.Equal(WorkspaceRole.Editor, await RoleInAsync(b, general.Id));
        Assert.Equal(HttpStatusCode.Created, (await CreateCollectionAsync(b, general.Id)).StatusCode);

        var members = await b.Client.GetFromJsonAsync<WorkspaceMembersDto>($"/api/workspaces/{general.Id}/members");
        Assert.Equal(("Backend", WorkspaceRole.Editor, 1), (members!.Teams.Single().Name, members.Teams.Single().Role, members.Teams.Single().MemberCount));
        Assert.Single(members.OrganizationAdmins);

        // Viewer/Editor üyeler yönetemez.
        Assert.Equal(HttpStatusCode.Forbidden, (await b.Client.DeleteAsync($"/api/workspaces/{general.Id}/members/teams/{team.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.DeleteAsync($"/api/workspaces/{general.Id}/members/teams/{team.Id}")).StatusCode);
        Assert.Equal(WorkspaceRole.Viewer, await RoleInAsync(b, general.Id));
    }

    [Fact]
    public async Task OrganizationAdmins_AreAdminInEveryTeamWorkspace()
    {
        var a = await UserAsync();
        var (org, _) = await OrganizationAsync(a);
        var b = await MemberAsync(a, org.Id);
        var c = await MemberAsync(a, org.Id);

        var w2 = await (await a.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/workspaces", new CreateWorkspaceRequest("Ödeme"))).ReadAsync<WorkspaceDto>();
        Assert.Null(await RoleInAsync(b, w2.Id));

        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.PatchAsJsonAsync($"/api/organizations/{org.Id}/members/{b.Id}", new ChangeOrganizationRoleRequest(OrganizationRole.Admin))).StatusCode);
        Assert.Equal(WorkspaceRole.Admin, await RoleInAsync(b, w2.Id));
        Assert.Null(await RoleInAsync(c, w2.Id));

        // Yönetici başkasını davet edebilir ve workspace'e ekleyebilir; üye çıkarılınca her şeyini kaybeder.
        Assert.Equal(HttpStatusCode.NoContent, (await b.Client.PutAsJsonAsync($"/api/workspaces/{w2.Id}/members/users/{c.Id}", new SetRoleRequest(WorkspaceRole.Editor))).StatusCode);
        Assert.Equal(WorkspaceRole.Editor, await RoleInAsync(c, w2.Id));
        Assert.Equal(HttpStatusCode.NoContent, (await b.Client.DeleteAsync($"/api/organizations/{org.Id}/members/{c.Id}")).StatusCode);
        Assert.Null(await RoleInAsync(c, w2.Id));
        Assert.Single((await c.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!);
    }

    [Fact]
    public async Task Ownership_CanOnlyBeTransferredByOwner()
    {
        var a = await UserAsync();
        var (org, _) = await OrganizationAsync(a);
        var b = await MemberAsync(a, org.Id, OrganizationRole.Admin);

        Assert.Equal(HttpStatusCode.Forbidden, (await b.Client.PatchAsJsonAsync($"/api/organizations/{org.Id}/members/{b.Id}", new ChangeOrganizationRoleRequest(OrganizationRole.Owner))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await b.Client.DeleteAsync($"/api/organizations/{org.Id}/members/{a.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.DeleteAsync($"/api/organizations/{org.Id}/members/{a.Id}")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.PatchAsJsonAsync($"/api/organizations/{org.Id}/members/{b.Id}", new ChangeOrganizationRoleRequest(OrganizationRole.Owner))).StatusCode);
        var orgs = await a.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations");
        Assert.Equal(OrganizationRole.Admin, orgs!.Single(o => o.Id == org.Id).Role);

        // Eski sahip artık ayrılabilir.
        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.DeleteAsync($"/api/organizations/{org.Id}/members/{a.Id}")).StatusCode);
    }

    [Fact]
    public async Task WorkspaceManagement_Rules()
    {
        var a = await UserAsync();
        var (org, general) = await OrganizationAsync(a);
        var b = await MemberAsync(a, org.Id, workspaceId: general.Id, workspaceRole: WorkspaceRole.Editor);
        var outsider = await UserAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PutAsJsonAsync($"/api/workspaces/{general.Id}/members/users/{outsider.Id}", new SetRoleRequest(WorkspaceRole.Viewer))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PutAsJsonAsync($"/api/workspaces/{a.PersonalWorkspaceId}/members/users/{b.Id}", new SetRoleRequest(WorkspaceRole.Viewer))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await b.Client.PatchAsJsonAsync($"/api/workspaces/{general.Id}", new RenameRequest("X"))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.PatchAsJsonAsync($"/api/workspaces/{general.Id}", new RenameRequest("Ortak"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.DeleteAsync($"/api/workspaces/{a.PersonalWorkspaceId}")).StatusCode);

        // Üye kendisi ayrılabilir.
        Assert.Equal(HttpStatusCode.NoContent, (await b.Client.DeleteAsync($"/api/workspaces/{general.Id}/members/users/{b.Id}")).StatusCode);
        Assert.Null(await RoleInAsync(b, general.Id));

        await CreateCollectionAsync(a, general.Id);
        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.DeleteAsync($"/api/workspaces/{general.Id}")).StatusCode);
        Assert.Null(await RoleInAsync(a, general.Id));
    }

    [Fact]
    public async Task Collection_CanBeMovedAndCopiedAcrossWorkspaces()
    {
        var a = await UserAsync();
        var (org, general) = await OrganizationAsync(a);
        var b = await MemberAsync(a, org.Id, workspaceId: general.Id, workspaceRole: WorkspaceRole.Viewer);

        var collection = await (await CreateCollectionAsync(a, a.PersonalWorkspaceId, "Mağaza")).ReadAsync<CollectionTreeDto>();
        await a.Client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Ürünler", null, new RequestDefinition { Url = "http://localhost/urunler" }));

        // Kişisel → takım: iki tarafta da Editor.
        var moved = await (await a.Client.PostAsJsonAsync($"/api/collections/{collection.Id}/move", new CollectionTargetRequest(general.Id))).ReadAsync<CollectionTreeDto>();
        Assert.Equal(general.Id, moved.WorkspaceId);
        var shared = await b.Client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{general.Id}/collections");
        Assert.Equal("Ürünler", Assert.Single(shared!).Requests.Single().Name);

        // Viewer taşıyamaz ama kendi workspace'ine kopyalayabilir.
        Assert.Equal(HttpStatusCode.Forbidden, (await b.Client.PostAsJsonAsync($"/api/collections/{collection.Id}/move", new CollectionTargetRequest(b.PersonalWorkspaceId))).StatusCode);
        var copy = await (await b.Client.PostAsJsonAsync($"/api/collections/{collection.Id}/duplicate", new CollectionTargetRequest(b.PersonalWorkspaceId))).ReadAsync<CollectionTreeDto>();
        Assert.Equal(("Mağaza", b.PersonalWorkspaceId), (copy.Name, copy.WorkspaceId));
        var mine = await b.Client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{b.PersonalWorkspaceId}/collections");
        Assert.Equal("Ürünler", mine!.Single().Requests.Single().Name);

        // Erişimi olmayan workspace'e kopyalanamaz.
        Assert.Equal(HttpStatusCode.NotFound, (await b.Client.PostAsJsonAsync($"/api/collections/{collection.Id}/duplicate", new CollectionTargetRequest(a.PersonalWorkspaceId))).StatusCode);
    }

    [Fact]
    public async Task OrganizationLanguage_OnlyAdminsChange_AndMustBeSupported()
    {
        var owner = await UserAsync();
        var (org, _) = await OrganizationAsync(owner);
        Assert.Equal("tr", org.DefaultLanguage);
        var member = await MemberAsync(owner, org.Id);

        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.PutAsJsonAsync($"/api/organizations/{org.Id}/language", new SetOrganizationLanguageRequest("en"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PutAsJsonAsync($"/api/organizations/{org.Id}/language", new SetOrganizationLanguageRequest("xx"))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.PutAsJsonAsync($"/api/organizations/{org.Id}/language", new SetOrganizationLanguageRequest("en"))).StatusCode);
        Assert.Equal("en", (await member.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!.Single(o => o.Id == org.Id).DefaultLanguage);
    }

    [Fact]
    public async Task AcceptedInvitation_SetsOrganizationLanguage_OnlyWhenUserHasNone()
    {
        var owner = await UserAsync();
        var (org, _) = await OrganizationAsync(owner);
        await owner.Client.PutAsJsonAsync($"/api/organizations/{org.Id}/language", new SetOrganizationLanguageRequest("en"));

        var fresh = await MemberAsync(owner, org.Id);
        Assert.Equal("en", (await fresh.Client.GetFromJsonAsync<PreferencesDto>("/api/me/preferences"))!.Language);

        // Kendi tercihi olan kullanıcının dili değişmez.
        var chosen = await UserAsync();
        var preferences = (await chosen.Client.GetFromJsonAsync<PreferencesDto>("/api/me/preferences"))! with { Language = "tr" };
        await chosen.Client.PutAsJsonAsync("/api/me/preferences", preferences);
        var token = await InviteAsync(owner, org.Id, chosen.Email);
        await (await chosen.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();
        Assert.Equal("tr", (await chosen.Client.GetFromJsonAsync<PreferencesDto>("/api/me/preferences"))!.Language);
    }

    [Fact]
    public async Task Invitation_EmailUsesSenderLanguage_ThenOrganizationDefault()
    {
        var owner = await UserAsync();
        var (org, _) = await OrganizationAsync(owner);

        var turkish = TestHelpers.NewEmail();
        await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(turkish));
        Assert.Contains("davet etti", factory.Emails.LastTo(turkish).Subject, StringComparison.Ordinal);

        var explicitEnglish = TestHelpers.NewEmail();
        var englishInvite = await (await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(explicitEnglish, Language: "en"))).ReadAsync<InvitationDto>();
        Assert.Contains("invited you to the", factory.Emails.LastTo(explicitEnglish).Subject, StringComparison.Ordinal);
        Assert.Contains("Accept invitation", factory.Emails.LastTo(explicitEnglish).TextBody, StringComparison.Ordinal);

        // Yeniden gönderimde de seçilen dil korunur.
        var sentBefore = factory.Emails.Sent.Count(m => m.To == explicitEnglish);
        await (await owner.Client.PostAsync($"/api/invitations/{englishInvite.Id}/resend", null)).ReadAsync<InvitationDto>();
        Assert.Equal(sentBefore + 1, factory.Emails.Sent.Count(m => m.To == explicitEnglish));
        Assert.Contains("invited you to the", factory.Emails.LastTo(explicitEnglish).Subject, StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(TestHelpers.NewEmail(), Language: "xx"))).StatusCode);

        await owner.Client.PutAsJsonAsync($"/api/organizations/{org.Id}/language", new SetOrganizationLanguageRequest("en"));
        var fallback = TestHelpers.NewEmail();
        await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(fallback));
        Assert.Contains("invited you to the", factory.Emails.LastTo(fallback).Subject, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AccountEmail_FollowsAcceptLanguage()
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/register")
        {
            Content = JsonContent.Create(new RegisterRequest(email, TestHelpers.Password, "Test")),
        };
        request.Headers.TryAddWithoutValidation("Accept-Language", "en-US,en;q=0.9");
        Assert.True((await client.SendAsync(request)).IsSuccessStatusCode);

        var sent = factory.Emails.LastTo(email);
        Assert.Equal("Confirm your Apivator account", sent.Subject);
        Assert.Contains("Hi Test,", sent.TextBody, StringComparison.Ordinal);
    }
}
