using System.Net;
using System.Net.Http.Json;
using System.Text;
using Apivator.Application.ApiKeys;
using Apivator.Application.Audit;
using Apivator.Application.Collections;
using Apivator.Application.Docs;
using Apivator.Application.Mocks;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Docs;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class AuditTests(ApivatorApiFactory factory)
{
    private sealed record User(HttpClient Client, Guid Id, string Email);

    private async Task<User> UserAsync(string name)
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email, name);
        client.WithBearer(auth.AccessToken);
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36");
        return new User(client, auth.User.Id, email);
    }

    private static async Task<(OrganizationDto Org, WorkspaceDto General)> OrganizationAsync(User owner, string name = "Denetim A.Ş.")
    {
        var org = await (await owner.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest(name))).ReadAsync<OrganizationDto>();
        var general = (await owner.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.Single(w => w.OrganizationId == org.Id);
        return (org, general);
    }

    private async Task<User> MemberAsync(User owner, Guid orgId, string name, OrganizationRole role = OrganizationRole.Member, Guid? workspaceId = null)
    {
        var user = await UserAsync(name);
        await (await owner.Client.PostAsJsonAsync($"/api/organizations/{orgId}/invitations", new InviteRequest(user.Email, role, workspaceId, workspaceId is null ? null : WorkspaceRole.Editor))).ReadAsync<InvitationDto>();
        var token = TestHelpers.QueryValue(factory.Emails.LastTo(user.Email).TextBody, "token");
        await (await user.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();
        return user;
    }

    private static async Task<List<AuditEntryDto>> EntriesAsync(User user, Guid orgId, string query = "") =>
        [.. (await user.Client.GetFromJsonAsync<AuditPageDto>($"/api/organizations/{orgId}/audit?limit=200{query}"))!.Items];

    [Fact]
    public async Task MembershipLifecycle_IsRecorded_WithoutCascadeNoise()
    {
        var owner = await UserAsync("Ayşe Sahip");
        var (org, general) = await OrganizationAsync(owner);
        var member = await MemberAsync(owner, org.Id, "Bora Üye", workspaceId: general.Id);

        var team = await (await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/teams", new CreateTeamRequest("Backend"))).ReadAsync<TeamDto>();
        (await owner.Client.PostAsJsonAsync($"/api/teams/{team.Id}/members", new AddTeamMemberRequest(member.Id))).EnsureSuccessStatusCode();
        (await owner.Client.PatchAsJsonAsync($"/api/organizations/{org.Id}/members/{member.Id}", new ChangeOrganizationRoleRequest(OrganizationRole.Admin))).EnsureSuccessStatusCode();
        (await owner.Client.DeleteAsync($"/api/organizations/{org.Id}/members/{member.Id}")).EnsureSuccessStatusCode();

        var entries = await EntriesAsync(owner, org.Id);
        var actions = entries.Select(e => e.Action).Reverse().ToList();

        // Daveti kabul etme tek kaydetmedir; içindeki üç olayın kendi aralarındaki sırası önemli değil.
        Assert.Equal(["organization.created", "invitation.sent"], actions[..2]);
        Assert.Equal(["invitation.accepted", "member.added", "workspace.member_added"], actions[2..5].Order());
        Assert.Equal(["team.created", "team.member_added", "member.role_changed", "member.removed"], actions[5..]);

        // Organizasyon açılırken eklenen sahip üyeliği ve "Genel" workspace'i ayrıca yazılmaz; üye çıkarılınca
        // takım ve workspace üyelikleri de kalkar ama tek olay ("member.removed") yeterli.
        var created = entries.Single(e => e.Action == "organization.created");
        Assert.Equal(("Ayşe Sahip", owner.Email, "Denetim A.Ş."), (created.ActorName, created.ActorEmail, created.TargetName));
        Assert.Equal("Chrome · Windows", created.Device);
        Assert.False(created.ViaApiKey);

        var added = entries.Single(e => e.Action == "member.added");
        Assert.Equal(("Bora Üye", member.Id), (added.TargetName, added.TargetId));
        Assert.Equal(("invitation", "Member"), (added.Data["via"], added.Data["role"]));
        Assert.Equal("Bora Üye", added.ActorName); // daveti kabul eden kişi

        var roleChanged = entries.Single(e => e.Action == "member.role_changed");
        Assert.Equal(("Member", "Admin", member.Email), (roleChanged.Data["from"], roleChanged.Data["to"], roleChanged.Data["email"]));

        var workspaceMember = entries.Single(e => e.Action == "workspace.member_added");
        Assert.Equal((general.Id, "Genel", "Editor"), (workspaceMember.WorkspaceId, workspaceMember.WorkspaceName, workspaceMember.Data["role"]));
        Assert.Equal("Backend", entries.Single(e => e.Action == "team.member_added").Data["team"]);
    }

    [Fact]
    public async Task OnlyOwnersAndAdmins_CanRead_AndPersonalOrganizationHasNoLog()
    {
        var owner = await UserAsync("Sahip");
        var (org, _) = await OrganizationAsync(owner);
        var member = await MemberAsync(owner, org.Id, "Üye");
        var outsider = await UserAsync("Dışarıdan");

        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync($"/api/organizations/{org.Id}/audit")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await member.Client.GetAsync($"/api/organizations/{org.Id}/audit/export")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync($"/api/organizations/{org.Id}/audit")).StatusCode);

        var personal = (await owner.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!.Single(o => o.IsPersonal);
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.GetAsync($"/api/organizations/{personal.Id}/audit")).StatusCode);

        // Yönetici yapılan üye okuyabilir.
        (await owner.Client.PatchAsJsonAsync($"/api/organizations/{org.Id}/members/{member.Id}", new ChangeOrganizationRoleRequest(OrganizationRole.Admin))).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await member.Client.GetAsync($"/api/organizations/{org.Id}/audit")).StatusCode);
    }

    [Fact]
    public async Task SharingAndAccessChanges_AreRecordedWithWorkspace()
    {
        var owner = await UserAsync("Sahip");
        var (org, general) = await OrganizationAsync(owner);
        var member = await MemberAsync(owner, org.Id, "Cem Editör", workspaceId: general.Id);
        var collection = await (await owner.Client.PostAsJsonAsync($"/api/workspaces/{general.Id}/collections", new CreateCollectionRequest("Ödeme API"))).ReadAsync<CollectionTreeDto>();

        (await owner.Client.PutAsJsonAsync(
            $"/api/collections/{collection.Id}/access",
            new UpdateCollectionAccessRequest(true, [new CollectionAccessInput(member.Id, null, WorkspaceRole.Viewer)]))).EnsureSuccessStatusCode();
        (await owner.Client.PutAsJsonAsync($"/api/collections/{collection.Id}/publication", new PublishDocRequest(DocVisibility.Public, null))).EnsureSuccessStatusCode();
        var mock = await (await owner.Client.PostAsJsonAsync($"/api/workspaces/{general.Id}/mocks", new CreateMockRequest(collection.Id, "Ödeme mock", IsPrivate: true))).ReadAsync<MockServerDto>();
        (await owner.Client.PostAsync($"/api/mocks/{mock.Id}/regenerate-key", null)).EnsureSuccessStatusCode();
        (await owner.Client.DeleteAsync($"/api/collections/{collection.Id}/publication")).EnsureSuccessStatusCode();

        var entries = await EntriesAsync(owner, org.Id, "&action=collection");
        Assert.Equal(["collection.access_granted", "collection.editing_restricted"], entries.Select(e => e.Action).Order());
        var granted = entries.Single(e => e.Action == "collection.access_granted");
        Assert.Equal(("Ödeme API", "Viewer", "user"), (granted.TargetName, granted.Data["role"], granted.Data["subject_type"]));
        Assert.Contains(member.Email, granted.Data["subject"], StringComparison.Ordinal);
        Assert.Equal((general.Id, "Genel"), (granted.WorkspaceId, granted.WorkspaceName));

        var docs = await EntriesAsync(owner, org.Id, "&action=docs");
        Assert.Equal(["docs.published", "docs.unpublished"], docs.Select(e => e.Action).Reverse());
        Assert.Equal("public", docs.Single(e => e.Action == "docs.published").Data["visibility"]);

        var mocks = await EntriesAsync(owner, org.Id, "&action=mock");
        Assert.Equal(["mock.created", "mock.key_regenerated"], mocks.Select(e => e.Action).Reverse());
        Assert.Equal("private", mocks[^1].Data["visibility"]);
    }

    [Fact]
    public async Task ApiKeys_AndAdminActions_AreRecorded()
    {
        var owner = await UserAsync("Sahip");
        var (org, _) = await OrganizationAsync(owner);
        var member = await MemberAsync(owner, org.Id, "Deniz");

        var key = await (await member.Client.PostAsJsonAsync("/api/me/api-keys", new CreateApiKeyRequest("CI anahtarı", 30))).ReadAsync<CreatedApiKeyDto>();
        (await member.Client.DeleteAsync($"/api/me/api-keys/{key.Key.Id}")).EnsureSuccessStatusCode();

        // Kişisel organizasyonlar denetlenmez; anahtar sahibinin kişisel organizasyonuna kayıt yazılmaz.
        var personal = (await member.Client.GetFromJsonAsync<List<OrganizationDto>>("/api/organizations"))!.Single(o => o.IsPersonal);
        Assert.Equal(HttpStatusCode.BadRequest, (await member.Client.GetAsync($"/api/organizations/{personal.Id}/audit")).StatusCode);

        (await owner.Client.PostAsync($"/api/organizations/{org.Id}/members/{member.Id}/revoke-sessions", null)).EnsureSuccessStatusCode();
        (await owner.Client.PostAsync($"/api/organizations/{org.Id}/members/{member.Id}/password-reset", null)).EnsureSuccessStatusCode();

        var entries = await EntriesAsync(owner, org.Id);
        var created = entries.Single(e => e.Action == "api_key.created");
        Assert.Equal(("CI anahtarı", key.Key.Prefix, "Deniz"), (created.TargetName, created.Data["prefix"], created.ActorName));
        Assert.Contains("api_key.revoked", entries.Select(e => e.Action));
        Assert.DoesNotContain(entries, e => e.Data.Values.Any(v => v.Contains(key.Secret, StringComparison.Ordinal)));

        var revoked = entries.Single(e => e.Action == "member.sessions_revoked");
        Assert.Equal(("Sahip", "Deniz", member.Id), (revoked.ActorName, revoked.TargetName, revoked.TargetId));
        Assert.Contains(entries, e => e.Action == "member.password_reset_sent" && e.TargetId == member.Id);
    }

    [Fact]
    public async Task List_PagesWithCursor_AndFilters()
    {
        var owner = await UserAsync("Sahip");
        var (org, _) = await OrganizationAsync(owner);
        for (var i = 0; i < 5; i++)
        {
            (await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/teams", new CreateTeamRequest($"Takım {i}"))).EnsureSuccessStatusCode();
        }

        var first = (await owner.Client.GetFromJsonAsync<AuditPageDto>($"/api/organizations/{org.Id}/audit?limit=4"))!;
        Assert.Equal(4, first.Items.Count);
        Assert.NotNull(first.NextCursor);
        Assert.Equal(365, first.RetentionDays);
        var second = (await owner.Client.GetFromJsonAsync<AuditPageDto>($"/api/organizations/{org.Id}/audit?limit=4&cursor={Uri.EscapeDataString(first.NextCursor!)}"))!;
        Assert.Equal(2, second.Items.Count);
        Assert.Null(second.NextCursor);
        Assert.Empty(first.Items.Select(e => e.Id).Intersect(second.Items.Select(e => e.Id)));
        Assert.Equal("Takım 4", first.Items[0].TargetName);
        Assert.Equal("organization.created", second.Items[^1].Action);

        Assert.Equal(5, (await EntriesAsync(owner, org.Id, "&action=team.created")).Count);
        Assert.Single(await EntriesAsync(owner, org.Id, "&q=" + Uri.EscapeDataString("takım 3")));
        Assert.Empty(await EntriesAsync(owner, org.Id, "&from=" + Uri.EscapeDataString(DateTimeOffset.UtcNow.AddMinutes(5).ToString("O"))));
        Assert.Equal(HttpStatusCode.BadRequest, (await owner.Client.GetAsync($"/api/organizations/{org.Id}/audit?cursor=bozuk")).StatusCode);
    }

    [Fact]
    public async Task Export_WritesCsvAndJson_AndIsItselfRecorded()
    {
        var owner = await UserAsync("Sahip");
        var (org, _) = await OrganizationAsync(owner, "=HYPERLINK(\"http://kotu\")");

        var csv = await owner.Client.GetAsync($"/api/organizations/{org.Id}/audit/export?format=csv");
        csv.EnsureSuccessStatusCode();
        Assert.Equal("text/csv", csv.Content.Headers.ContentType!.MediaType);
        Assert.Contains("denetim-kaydi-", csv.Content.Headers.ContentDisposition!.ToString(), StringComparison.Ordinal);
        var bytes = await csv.Content.ReadAsByteArrayAsync();
        Assert.Equal(new byte[] { 0xEF, 0xBB, 0xBF }, bytes[..3]);
        var lines = Encoding.UTF8.GetString(bytes[3..]).Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.StartsWith("Zaman (UTC);Olay;Yapan", lines[0], StringComparison.Ordinal);
        Assert.Contains(lines, l => l.Contains("organization.created", StringComparison.Ordinal) && l.Contains("\"'=HYPERLINK(\"\"http://kotu\"\")\"", StringComparison.Ordinal));

        var json = await owner.Client.GetAsync($"/api/organizations/{org.Id}/audit/export?format=json&action=organization");
        json.EnsureSuccessStatusCode();
        var rows = (await json.Content.ReadFromJsonAsync<List<AuditEntryDto>>())!;
        Assert.Equal(["organization.created"], rows.Select(r => r.Action));

        var exports = await EntriesAsync(owner, org.Id, "&action=audit.exported");
        Assert.Equal(["json", "csv"], exports.Select(e => e.Data["format"]));
        Assert.Equal("organization", exports[0].Data["action"]);
    }
}
