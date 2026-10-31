using System.Net;
using System.Net.Http.Json;
using Apivator.Application.Auth;
using Apivator.Application.Collections;
using Apivator.Application.Examples;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class CollectionAccessTests(ApivatorApiFactory factory)
{
    private sealed record User(HttpClient Client, Guid Id, string Email);

    private sealed record Setup(User Admin, User Editor, User Viewer, Guid OrgId, Guid WorkspaceId, Guid CollectionId, ApiRequestDto Request);

    private async Task<User> UserAsync(string name)
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email, name);
        client.WithBearer(auth.AccessToken);
        return new User(client, auth.User.Id, email);
    }

    private async Task<User> MemberAsync(User owner, Guid orgId, Guid workspaceId, WorkspaceRole role, string name)
    {
        var user = await UserAsync(name);
        await (await owner.Client.PostAsJsonAsync($"/api/organizations/{orgId}/invitations", new InviteRequest(user.Email, OrganizationRole.Member, workspaceId, role))).ReadAsync<InvitationDto>();
        var token = TestHelpers.QueryValue(factory.Emails.LastTo(user.Email).TextBody, "token");
        await (await user.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();
        return user;
    }

    /// <summary>Ekip workspace'i: yönetici, düzenleyici ve görüntüleyici; bir collection ve içinde bir istek.</summary>
    private async Task<Setup> SetupAsync()
    {
        var admin = await UserAsync("Yönetici");
        var org = await (await admin.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest("Ekip"))).ReadAsync<OrganizationDto>();
        var workspace = (await admin.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.Single(w => w.OrganizationId == org.Id);
        var editor = await MemberAsync(admin, org.Id, workspace.Id, WorkspaceRole.Editor, "Düzenleyici");
        var viewer = await MemberAsync(admin, org.Id, workspace.Id, WorkspaceRole.Viewer, "Görüntüleyici");
        var collection = await (await admin.Client.PostAsJsonAsync($"/api/workspaces/{workspace.Id}/collections", new CreateCollectionRequest("Ödeme API"))).ReadAsync<CollectionTreeDto>();
        var request = await (await admin.Client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Ödeme al", null, new RequestDefinition { Method = "POST", Url = "https://odeme.test/al" }))).ReadAsync<ApiRequestDto>();
        return new Setup(admin, editor, viewer, org.Id, workspace.Id, collection.Id, request);
    }

    private static Task<HttpResponseMessage> PutAccessAsync(User user, Guid collectionId, bool restricted, params CollectionAccessInput[] entries) =>
        user.Client.PutAsJsonAsync($"/api/collections/{collectionId}/access", new UpdateCollectionAccessRequest(restricted, entries));

    private static async Task<HttpResponseMessage> EditAsync(User user, Guid requestId, string url)
    {
        var current = (await user.Client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{requestId}"))!;
        return await user.Client.PutAsJsonAsync($"/api/requests/{requestId}", new UpdateApiRequestRequest(current.Name, current.Definition with { Url = url }, current.Version));
    }

    private static async Task<WorkspaceRole?> RoleInTreeAsync(User user, Guid workspaceId, Guid collectionId) =>
        (await user.Client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single(c => c.Id == collectionId).Role;

    [Fact]
    public async Task RestrictedCollection_OnlyListedEditorsCanChangeIt()
    {
        var s = await SetupAsync();
        Assert.Equal(HttpStatusCode.OK, (await EditAsync(s.Editor, s.Request.Id, "https://odeme.test/v1/al")).StatusCode);

        var updated = await (await PutAccessAsync(s.Admin, s.CollectionId, true, new CollectionAccessInput(s.Viewer.Id, null, WorkspaceRole.Editor))).ReadAsync<CollectionAccessDto>();
        Assert.True(updated.EditingRestricted);
        var entry = Assert.Single(updated.Entries);
        Assert.Equal((CollectionAccessSubject.User, "Görüntüleyici", WorkspaceRole.Editor, (WorkspaceRole?)WorkspaceRole.Viewer), (entry.Kind, entry.Name, entry.Role, entry.WorkspaceRole));

        // Workspace düzenleyicisi artık bu collection'da görüntüleyici: hiçbir içerik değişikliği yapamaz.
        var denied = await EditAsync(s.Editor, s.Request.Id, "https://odeme.test/v2/al");
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.Contains("collection.forbidden", await denied.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Editor.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/folders", new CreateFolderRequest("K", null))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Editor.Client.PostAsJsonAsync($"/api/requests/{s.Request.Id}/examples", new CreateExampleRequest("Ö", 200, [], "{}", null))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Editor.Client.DeleteAsync($"/api/requests/{s.Request.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Editor.Client.PatchAsJsonAsync($"/api/collections/{s.CollectionId}", new UpdateCollectionRequest("Yeni ad", null))).StatusCode);
        // Okuma serbest; workspace'teki diğer işler etkilenmez.
        Assert.Equal(HttpStatusCode.OK, (await s.Editor.Client.GetAsync($"/api/requests/{s.Request.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await s.Editor.Client.PostAsJsonAsync($"/api/workspaces/{s.WorkspaceId}/collections", new CreateCollectionRequest("Kendi"))).StatusCode);

        // Workspace görüntüleyicisi bu collection'da düzenleyici.
        Assert.Equal(HttpStatusCode.OK, (await EditAsync(s.Viewer, s.Request.Id, "https://odeme.test/v3/al")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await s.Viewer.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/folders", new CreateFolderRequest("K", null))).StatusCode);

        Assert.Equal(WorkspaceRole.Viewer, await RoleInTreeAsync(s.Editor, s.WorkspaceId, s.CollectionId));
        Assert.Equal(WorkspaceRole.Editor, await RoleInTreeAsync(s.Viewer, s.WorkspaceId, s.CollectionId));
        Assert.Equal(WorkspaceRole.Admin, await RoleInTreeAsync(s.Admin, s.WorkspaceId, s.CollectionId));

        // Kısıtlama kalkınca workspace rolleri yeniden geçerli; görüntüleyicinin kişisel kaydı sürer.
        await PutAccessAsync(s.Admin, s.CollectionId, false, new CollectionAccessInput(s.Viewer.Id, null, WorkspaceRole.Editor));
        Assert.Equal(HttpStatusCode.OK, (await EditAsync(s.Editor, s.Request.Id, "https://odeme.test/v4/al")).StatusCode);
        Assert.Equal(WorkspaceRole.Editor, await RoleInTreeAsync(s.Viewer, s.WorkspaceId, s.CollectionId));
    }

    [Fact]
    public async Task TeamEntries_NarrowMembers_AndDirectEntriesWin()
    {
        var s = await SetupAsync();
        var team = await (await s.Admin.Client.PostAsJsonAsync($"/api/organizations/{s.OrgId}/teams", new CreateTeamRequest("Mobil"))).ReadAsync<TeamDto>();
        await (await s.Admin.Client.PostAsJsonAsync($"/api/teams/{team.Id}/members", new AddTeamMemberRequest(s.Editor.Id))).ReadAsync<TeamDto>();

        var dto = await (await PutAccessAsync(s.Admin, s.CollectionId, false, new CollectionAccessInput(null, team.Id, WorkspaceRole.Viewer))).ReadAsync<CollectionAccessDto>();
        Assert.Equal((CollectionAccessSubject.Team, "Mobil", (WorkspaceRole?)null), (dto.Entries[0].Kind, dto.Entries[0].Name, dto.Entries[0].WorkspaceRole));
        Assert.Equal(HttpStatusCode.Forbidden, (await EditAsync(s.Editor, s.Request.Id, "https://odeme.test/x")).StatusCode);

        await PutAccessAsync(s.Admin, s.CollectionId, false, new CollectionAccessInput(null, team.Id, WorkspaceRole.Viewer), new CollectionAccessInput(s.Editor.Id, null, WorkspaceRole.Editor));
        Assert.Equal(HttpStatusCode.OK, (await EditAsync(s.Editor, s.Request.Id, "https://odeme.test/y")).StatusCode);

        // Rol değişikliği mevcut kaydın kimliğini korur.
        var before = (await s.Viewer.Client.GetFromJsonAsync<CollectionAccessDto>($"/api/collections/{s.CollectionId}/access"))!;
        var after = await (await PutAccessAsync(s.Admin, s.CollectionId, false, new CollectionAccessInput(null, team.Id, WorkspaceRole.Editor), new CollectionAccessInput(s.Editor.Id, null, WorkspaceRole.Editor))).ReadAsync<CollectionAccessDto>();
        Assert.Equal(before.Entries.Select(e => e.Id), after.Entries.Select(e => e.Id));
        Assert.False(before.CanManage);
        Assert.Equal(WorkspaceRole.Viewer, before.MyRole);
    }

    [Fact]
    public async Task OnlyWorkspaceAdmins_ManageRoles_WithValidation()
    {
        var s = await SetupAsync();
        var outsider = await UserAsync("Dışarıdan");

        Assert.Equal(HttpStatusCode.Forbidden, (await PutAccessAsync(s.Editor, s.CollectionId, true)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync($"/api/collections/{s.CollectionId}/access")).StatusCode);

        async Task<string> Invalid(params CollectionAccessInput[] entries)
        {
            var response = await PutAccessAsync(s.Admin, s.CollectionId, false, entries);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            return await response.Content.ReadAsStringAsync();
        }

        Assert.Contains("collection.access_not_member", await Invalid(new CollectionAccessInput(outsider.Id, null, WorkspaceRole.Editor)), StringComparison.Ordinal);
        Assert.Contains("collection.access_admin", await Invalid(new CollectionAccessInput(s.Admin.Id, null, WorkspaceRole.Viewer)), StringComparison.Ordinal);
        Assert.Contains("collection.access_role", await Invalid(new CollectionAccessInput(s.Editor.Id, null, WorkspaceRole.Admin)), StringComparison.Ordinal);
        Assert.Contains("collection.access_duplicate", await Invalid(new CollectionAccessInput(s.Editor.Id, null, WorkspaceRole.Viewer), new CollectionAccessInput(s.Editor.Id, null, WorkspaceRole.Editor)), StringComparison.Ordinal);
        Assert.Contains("collection.access_subject", await Invalid(new CollectionAccessInput(null, null, WorkspaceRole.Viewer)), StringComparison.Ordinal);
        Assert.Contains("collection.access_team", await Invalid(new CollectionAccessInput(null, Guid.NewGuid(), WorkspaceRole.Viewer)), StringComparison.Ordinal);

        // Kişisel workspace'te kullanılamaz.
        var personal = (await s.Admin.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.First(w => w.Id != s.WorkspaceId);
        var own = await (await s.Admin.Client.PostAsJsonAsync($"/api/workspaces/{personal.Id}/collections", new CreateCollectionRequest("Kişisel"))).ReadAsync<CollectionTreeDto>();
        Assert.Equal(HttpStatusCode.BadRequest, (await PutAccessAsync(s.Admin, own.Id, true)).StatusCode);
    }

    [Fact]
    public async Task MovingIntoRestrictedCollection_RequiresEditingThere_AndMovingAwayClearsRoles()
    {
        var s = await SetupAsync();
        var other = await (await s.Editor.Client.PostAsJsonAsync($"/api/workspaces/{s.WorkspaceId}/collections", new CreateCollectionRequest("Diğer"))).ReadAsync<CollectionTreeDto>();
        var mine = await (await s.Editor.Client.PostAsJsonAsync($"/api/collections/{other.Id}/requests", new CreateApiRequestRequest("Benim", null, new RequestDefinition()))).ReadAsync<ApiRequestDto>();
        await PutAccessAsync(s.Admin, s.CollectionId, true);

        var move = await s.Editor.Client.PostAsJsonAsync($"/api/requests/{mine.Id}/move", new MoveApiRequestRequest(null, 0, s.CollectionId));
        Assert.Equal(HttpStatusCode.Forbidden, move.StatusCode);

        // Collection başka workspace'e taşınınca roller ve kısıtlama sıfırlanır.
        await PutAccessAsync(s.Admin, s.CollectionId, true, new CollectionAccessInput(s.Viewer.Id, null, WorkspaceRole.Editor));
        var personal = (await s.Admin.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.First(w => w.Id != s.WorkspaceId);
        await (await s.Admin.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/move", new { workspaceId = personal.Id })).ReadAsync<CollectionTreeDto>();
        var access = (await s.Admin.Client.GetFromJsonAsync<CollectionAccessDto>($"/api/collections/{s.CollectionId}/access"))!;
        Assert.False(access.EditingRestricted);
        Assert.Empty(access.Entries);
    }
}
