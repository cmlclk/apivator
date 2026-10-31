using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Application.Auth;
using Apivator.Application.Collections;
using Apivator.Application.Docs;
using Apivator.Application.Environments;
using Apivator.Application.Examples;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Docs;
using Apivator.Domain.Organizations;
using Apivator.Domain.Variables;
using Apivator.Domain.Workspaces;

namespace Apivator.Api.IntegrationTests;

/// <summary>Açıklamalar, collection dokümantasyonu ve yayınlama (organizasyon içi / herkese açık).</summary>
[Collection(ApiCollection.Name)]
public class DocumentationTests(ApivatorApiFactory factory)
{
    private sealed record User(HttpClient Client, Guid Id, string Email);

    private sealed record Setup(User Admin, User Editor, Guid OrgId, Guid WorkspaceId, Guid CollectionId, Guid EnvironmentId, Guid FolderId, Guid RequestId);

    private async Task<User> UserAsync(string name)
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email, name);
        client.WithBearer(auth.AccessToken);
        return new User(client, auth.User.Id, email);
    }

    private async Task<User> MemberAsync(User owner, Guid orgId, Guid? workspaceId, WorkspaceRole role, string name)
    {
        var user = await UserAsync(name);
        await (await owner.Client.PostAsJsonAsync($"/api/organizations/{orgId}/invitations", new InviteRequest(user.Email, OrganizationRole.Member, workspaceId, role))).ReadAsync<InvitationDto>();
        var token = TestHelpers.QueryValue(factory.Emails.LastTo(user.Email).TextBody, "token");
        await (await user.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();
        return user;
    }

    private async Task<Setup> SetupAsync()
    {
        var admin = await UserAsync("Yönetici");
        var org = await (await admin.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest("Mağaza A.Ş."))).ReadAsync<OrganizationDto>();
        var workspace = (await admin.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.Single(w => w.OrganizationId == org.Id);
        var editor = await MemberAsync(admin, org.Id, workspace.Id, WorkspaceRole.Editor, "Düzenleyici");
        var c = admin.Client;

        var collection = await (await c.PostAsJsonAsync($"/api/workspaces/{workspace.Id}/collections", new CreateCollectionRequest("Mağaza API"))).ReadAsync<CollectionTreeDto>();
        await (await c.PatchAsJsonAsync($"/api/collections/{collection.Id}", new UpdateCollectionRequest(
            null,
            "# Mağaza API\n\nÜrün ve sipariş uçları.",
            new RequestAuth { Type = AuthType.Bearer, BearerToken = "{{token}}" },
            [new Variable("baseUrl", "https://varsayilan.test"), new Variable("anahtar", "cok-gizli", IsSecret: true), new Variable("kapali", "x", Enabled: false)]))).ReadAsync<CollectionTreeDto>();
        var env = await (await c.PostAsJsonAsync($"/api/workspaces/{workspace.Id}/environments", new CreateEnvironmentRequest(
            "Test", [new Variable("baseUrl", "https://test.magaza.test"), new Variable("token", "jwt-degeri", IsSecret: true)]))).ReadAsync<EnvironmentDto>();

        var folder = await (await c.PostAsJsonAsync($"/api/collections/{collection.Id}/folders", new CreateFolderRequest("Ürünler", null))).ReadAsync<FolderDto>();
        var described = await (await c.PatchAsJsonAsync($"/api/folders/{folder.Id}", new UpdateFolderRequest(null, new RequestAuth { Type = AuthType.ApiKey, ApiKeyName = "X-Api-Key", ApiKeyValue = "sir" }, Description: "  Ürün kataloğu.  "))).ReadAsync<FolderDto>();
        Assert.Equal("Ürün kataloğu.", described.Description);

        var request = await (await c.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Ürün getir", folder.Id, new RequestDefinition
        {
            Method = "GET",
            Url = "{{baseUrl}}/urunler/1?api_key=abc123&dil=tr&token={{token}}",
            Description = "Tek bir ürünü döner.",
            Headers =
            [
                new KeyValueItem("Accept", "application/json", Description: "Yanıt biçimi"),
                new KeyValueItem("X-Api-Key", "duz-anahtar"),
                new KeyValueItem("Authorization", "Bearer {{token}}"),
                new KeyValueItem("X-Kapali", "1", Enabled: false),
            ],
            Scripts = new ScriptSet { PreRequest = "pm.environment.set('gizli', 'x');" },
        }))).ReadAsync<ApiRequestDto>();
        await (await c.PostAsJsonAsync($"/api/requests/{request.Id}/examples", new CreateExampleRequest(
            "Başarılı", 200, [new KeyValueItem("Content-Type", "application/json")], "{\"id\":1,\"ad\":\"Kalem\"}", null))).ReadAsync<ExampleDto>();
        await c.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Kökteki", null, new RequestDefinition { Method = "POST", Url = "{{baseUrl}}/siparis" }));
        return new Setup(admin, editor, org.Id, workspace.Id, collection.Id, env.Id, folder.Id, request.Id);
    }

    [Fact]
    public async Task Documentation_ContainsDescriptionsAndExamples_ButNoSecrets()
    {
        var s = await SetupAsync();

        var doc = await (await s.Admin.Client.GetAsync($"/api/collections/{s.CollectionId}/documentation?environmentId={s.EnvironmentId}")).ReadAsync<DocumentationDto>();

        Assert.Equal(("Mağaza API", "# Mağaza API\n\nÜrün ve sipariş uçları.", "Test"), (doc.Name, doc.Description, doc.EnvironmentName));
        Assert.Equal((AuthType.Bearer, "Authorization: Bearer <token>"), (doc.Auth.Type, doc.Auth.Detail));
        Assert.Equal("Ürün kataloğu.", Assert.Single(doc.Folders).Description);

        // Değişkenler: environment collection'ı ezer; gizliler değersiz, devre dışılar yok.
        Assert.Equal(["anahtar", "baseUrl", "token"], doc.Variables.Select(v => v.Key).Order());
        Assert.Equal(("https://test.magaza.test", "environment"), (doc.Variables.Single(v => v.Key == "baseUrl").Value, doc.Variables.Single(v => v.Key == "baseUrl").Source));
        Assert.All(doc.Variables.Where(v => v.IsSecret), v => Assert.Equal(string.Empty, v.Value));

        var request = doc.Requests.Single(r => r.Name == "Ürün getir");
        Assert.Equal("Tek bir ürünü döner.", request.Description);
        Assert.Equal("{{baseUrl}}/urunler/1?api_key=••••••&dil=tr&token={{token}}", request.Url);
        Assert.Equal(["Accept", "X-Api-Key", "Authorization"], request.Headers.Select(h => h.Key));
        Assert.Equal(["application/json", "••••••", "Bearer {{token}}"], request.Headers.Select(h => h.Value));
        Assert.Equal("Yanıt biçimi", request.Headers[0].Description);
        Assert.Equal((AuthType.ApiKey, "X-Api-Key: <anahtar> (header)", "Ürünler"), (request.Auth.Type, request.Auth.Detail, request.Auth.Source));
        Assert.Equal(("Başarılı", 200, "{\"id\":1,\"ad\":\"Kalem\"}"), (request.Examples[0].Name, request.Examples[0].Status, request.Examples[0].Body));
        Assert.Equal("collection", doc.Requests.Single(r => r.Name == "Kökteki").Auth.Source);

        // Sızmaması gerekenler: gizli değişken değerleri, auth'taki anahtar, script'ler.
        var raw = await s.Admin.Client.GetStringAsync($"/api/collections/{s.CollectionId}/documentation?environmentId={s.EnvironmentId}");
        foreach (var secret in new[] { "cok-gizli", "jwt-degeri", "duz-anahtar", "abc123", "\"sir\"", "pm.environment" })
        {
            Assert.DoesNotContain(secret, raw, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Publish_OrganizationOnly_RequiresMembership()
    {
        var s = await SetupAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.Client.GetAsync($"/api/collections/{s.CollectionId}/publication")).StatusCode);

        // Düzenleyici organizasyon içi yayınlayabilir ama herkese açık yapamaz.
        var publication = await (await s.Editor.Client.PutAsJsonAsync($"/api/collections/{s.CollectionId}/publication", new PublishDocRequest(DocVisibility.Organization, s.EnvironmentId))).ReadAsync<DocPublicationDto>();
        Assert.Equal(("Test", "Düzenleyici"), (publication.EnvironmentName, publication.PublishedBy));
        Assert.EndsWith($"/docs/{publication.Slug}", publication.Url, StringComparison.Ordinal);
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Editor.Client.PutAsJsonAsync($"/api/collections/{s.CollectionId}/publication", new PublishDocRequest(DocVisibility.Public, null))).StatusCode);

        // Organizasyondaki ama workspace'e üye olmayan biri okuyabilir; dışarıdaki göremez, oturumsuz olana 401.
        var colleague = await MemberAsync(s.Admin, s.OrgId, null, WorkspaceRole.Viewer, "Meslektaş");
        var doc = await (await colleague.Client.GetAsync($"/api/docs/{publication.Slug}")).ReadAsync<DocumentationDto>();
        Assert.Equal(2, doc.Requests.Count);
        var outsider = await UserAsync("Yabancı");
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync($"/api/docs/{publication.Slug}")).StatusCode);
        var anonymous = await factory.CreateClient().GetAsync($"/api/docs/{publication.Slug}");
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        Assert.Contains("docs.login_required", await anonymous.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Publish_Public_IsAnonymous_LiveAndRevocable()
    {
        var s = await SetupAsync();
        var publication = await (await s.Admin.Client.PutAsJsonAsync($"/api/collections/{s.CollectionId}/publication", new PublishDocRequest(DocVisibility.Public, null))).ReadAsync<DocPublicationDto>();
        var anonymous = factory.CreateClient();

        var response = await anonymous.GetAsync($"/api/docs/{publication.Slug}");
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        var doc = await response.ReadAsync<DocumentationDto>();
        Assert.Null(doc.EnvironmentName);
        Assert.Equal("https://varsayilan.test", doc.Variables.Single(v => v.Key == "baseUrl").Value);

        // Canlı: değişiklik hemen görünür.
        var current = (await s.Admin.Client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{s.RequestId}"))!;
        await (await s.Admin.Client.PutAsJsonAsync($"/api/requests/{s.RequestId}", new UpdateApiRequestRequest(current.Name, current.Definition with { Description = "Güncel açıklama" }, current.Version))).ReadAsync<ApiRequestDto>();
        doc = await (await anonymous.GetAsync($"/api/docs/{publication.Slug}")).ReadAsync<DocumentationDto>();
        Assert.Equal("Güncel açıklama", doc.Requests.Single(r => r.Id == s.RequestId).Description);

        // Bağlantı yenilenince eskisi çalışmaz; yayından kaldırınca yenisi de.
        var renewed = await (await s.Admin.Client.PostAsync($"/api/collections/{s.CollectionId}/publication/regenerate", null)).ReadAsync<DocPublicationDto>();
        Assert.NotEqual(publication.Slug, renewed.Slug);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"/api/docs/{publication.Slug}")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync($"/api/docs/{renewed.Slug}")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.Client.DeleteAsync($"/api/collections/{s.CollectionId}/publication")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"/api/docs/{renewed.Slug}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/docs/../../etc")).StatusCode);
    }

    [Fact]
    public async Task Documentation_RequiresAccess_AndValidatesEnvironment()
    {
        var s = await SetupAsync();
        var (stranger, strangerWorkspace) = await factory.CreateUserAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/collections/{s.CollectionId}/documentation")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PutAsJsonAsync($"/api/collections/{s.CollectionId}/publication", new PublishDocRequest(DocVisibility.Public, null))).StatusCode);

        var otherEnv = await (await stranger.PostAsJsonAsync($"/api/workspaces/{strangerWorkspace}/environments", new CreateEnvironmentRequest("Başka"))).ReadAsync<EnvironmentDto>();
        Assert.Equal(HttpStatusCode.BadRequest, (await s.Admin.Client.GetAsync($"/api/collections/{s.CollectionId}/documentation?environmentId={otherEnv.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await s.Admin.Client.PutAsJsonAsync($"/api/collections/{s.CollectionId}/publication", new PublishDocRequest(DocVisibility.Organization, otherEnv.Id))).StatusCode);
    }

    [Fact]
    public async Task Descriptions_RoundTripThroughPostmanAndOpenApi()
    {
        var s = await SetupAsync();
        var postman = JsonDocument.Parse(await s.Admin.Client.GetStringAsync($"/api/collections/{s.CollectionId}/export/postman")).RootElement;
        var folderItem = postman.GetProperty("item").EnumerateArray().Single(i => i.GetProperty("name").GetString() == "Ürünler");
        Assert.Equal("Ürün kataloğu.", folderItem.GetProperty("description").GetString());
        Assert.Equal("Tek bir ürünü döner.", folderItem.GetProperty("item")[0].GetProperty("request").GetProperty("description").GetString());

        var imported = await (await s.Admin.Client.PostAsJsonAsync($"/api/workspaces/{s.WorkspaceId}/import/postman", postman)).ReadAsync<Application.Import.ImportResult>();
        var copyId = imported.Id;
        var copy = await (await s.Admin.Client.GetAsync($"/api/collections/{copyId}/documentation")).ReadAsync<DocumentationDto>();
        Assert.Equal("Ürün kataloğu.", copy.Folders.Single().Description);
        Assert.Equal("Tek bir ürünü döner.", copy.Requests.Single(r => r.Name == "Ürün getir").Description);

        var openApi = JsonDocument.Parse(await s.Admin.Client.GetStringAsync($"/api/collections/{s.CollectionId}/export/openapi")).RootElement;
        Assert.Equal("Ürün kataloğu.", openApi.GetProperty("tags")[0].GetProperty("description").GetString());
        Assert.Equal("Tek bir ürünü döner.", openApi.GetProperty("paths").GetProperty("/urunler/1").GetProperty("get").GetProperty("description").GetString());

        var tooLong = new string('a', RequestDefinition.DescriptionMaxLength + 1);
        Assert.Equal(HttpStatusCode.BadRequest, (await s.Admin.Client.PatchAsJsonAsync($"/api/folders/{s.FolderId}", new UpdateFolderRequest(null, Description: tooLong))).StatusCode);
    }
}
