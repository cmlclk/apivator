using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Application.Collections;
using Apivator.Application.Environments;
using Apivator.Application.Import;
using Apivator.Domain.Collections;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class ImportTests(ApivatorApiFactory factory)
{
    private static JsonElement Fixture(string name) =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name))).RootElement.Clone();

    private static async Task<ImportResult> ImportAsync(HttpClient client, Guid workspaceId, JsonElement document)
    {
        var response = await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/import/postman", document);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await response.ReadAsync<ImportResult>();
    }

    private static async Task<(CollectionTreeDto Tree, Dictionary<string, ApiRequestDto> Requests)> LoadAsync(HttpClient client, Guid workspaceId, Guid collectionId)
    {
        var tree = (await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single(c => c.Id == collectionId);
        var requests = new Dictionary<string, ApiRequestDto>();
        foreach (var summary in tree.Requests)
        {
            requests[summary.Name] = (await client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{summary.Id}"))!;
        }

        return (tree, requests);
    }

    [Fact]
    public async Task ImportCollection_MapsStructureAuthBodiesAndVariables()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();

        var result = await ImportAsync(client, workspaceId, Fixture("sample.postman_collection.json"));

        Assert.Equal("collection", result.Kind);
        Assert.Equal("Ödeme API", result.Name);
        Assert.Equal(2, result.Folders);
        Assert.Equal(10, result.Requests);
        Assert.Equal(3, result.Variables);
        Assert.DoesNotContain(result.Warnings, w => w.Contains("script", StringComparison.Ordinal));
        Assert.Equal(1, result.Examples);
        Assert.Contains(result.Warnings, w => w.Contains("dosya alanı aktarıldı", StringComparison.Ordinal));
        Assert.DoesNotContain(result.Warnings, w => w.Contains("oauth2", StringComparison.Ordinal));

        var (tree, requests) = await LoadAsync(client, workspaceId, result.Id);
        Assert.Equal("Ödeme servisinin uçları.", tree.Description);
        Assert.Equal(AuthType.Bearer, tree.Auth.Type);
        Assert.Equal("{{token}}", tree.Auth.BearerToken);
        Assert.Equal(["baseUrl", "apiVersion", "retry"], tree.Variables.Select(v => v.Key));
        Assert.False(tree.Variables[1].Enabled);
        Assert.Equal("3", tree.Variables[2].Value);

        var customers = tree.Folders.Single(f => f.Name == "Müşteriler");
        var admin = tree.Folders.Single(f => f.Name == "Yönetim");
        Assert.Null(customers.ParentFolderId);
        Assert.Equal(customers.Id, admin.ParentFolderId);
        Assert.Equal(AuthType.Inherit, customers.Auth.Type);
        Assert.Equal(AuthType.Basic, admin.Auth.Type);
        Assert.Equal("admin", admin.Auth.BasicUsername);
        Assert.Equal(2, admin.SortOrder);

        var example = Assert.Single(tree.Examples);
        Assert.Equal(("Başarılı", 200, requests["Müşteri listesi"].Id), (example.Name, example.Status, example.RequestId));

        Assert.Equal("console.log('collection');", tree.Scripts.PreRequest);

        var list = requests["Müşteri listesi"].Definition;
        Assert.StartsWith("pm.test('200'", list.Scripts.PostResponse, StringComparison.Ordinal);
        Assert.Equal("{{baseUrl}}/customers?page=1&size=20", list.Url);
        Assert.Equal(AuthType.Inherit, list.Auth.Type);
        Assert.False(list.Headers.Single(h => h.Key == "X-Debug").Enabled);
        Assert.Equal(customers.Id, requests["Müşteri listesi"].FolderId);

        var create = requests["Müşteri oluştur"].Definition;
        Assert.Equal(BodyMode.Raw, create.Body.Mode);
        Assert.Equal(RawLanguage.Json, create.Body.RawLanguage);
        Assert.Contains("Ayşe", create.Body.Raw, StringComparison.Ordinal);

        Assert.Equal(AuthType.None, requests["Herkese açık sağlık"].Definition.Auth.Type);
        Assert.Equal(admin.Id, requests["Müşteri sil"].FolderId);

        var token = requests["Token al"].Definition;
        Assert.Equal("https://auth.odeme.test/oauth/token", token.Url);
        Assert.Equal(BodyMode.UrlEncoded, token.Body.Mode);
        Assert.False(token.Body.Form.Single(f => f.Key == "scope").Enabled);

        var upload = requests["Dekont yükle"].Definition;
        Assert.Equal(BodyMode.FormData, upload.Body.Mode);
        Assert.Equal(["aciklama", "dosya"], upload.Body.Form.Select(f => f.Key));
        Assert.Equal(FormFieldType.File, upload.Body.Form[1].Type);
        Assert.Equal("dekont.pdf", upload.Body.Form[1].Value);

        var graphql = requests["GraphQL sorgusu"].Definition;
        Assert.Equal(BodyMode.GraphQL, graphql.Body.Mode);
        Assert.Equal("query { customers { id } }", graphql.Body.Raw);
        Assert.Equal("{\"first\": 10}", graphql.Body.GraphqlVariables);

        var apiKey = requests["API key ile"].Definition;
        Assert.Equal("GET", apiKey.Method);
        Assert.Equal(AuthType.ApiKey, apiKey.Auth.Type);
        Assert.Equal(ApiKeyLocation.Query, apiKey.Auth.ApiKeyIn);
        Assert.Equal("api_key", apiKey.Auth.ApiKeyName);

        Assert.Equal((AuthType.OAuth2, OAuth2GrantType.AuthorizationCode), (requests["OAuth 2 korumalı"].Definition.Auth.Type, requests["OAuth 2 korumalı"].Definition.Auth.OAuth2GrantType));
        Assert.Equal("https://example.com/ping", requests["Sadece URL"].Definition.Url);
    }

    [Fact]
    public async Task ImportEnvironment_KeepsSecretAndDisabledFlags()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();

        var result = await ImportAsync(client, workspaceId, Fixture("sample.postman_environment.json"));

        Assert.Equal("environment", result.Kind);
        var environment = (await client.GetFromJsonAsync<List<EnvironmentDto>>($"/api/workspaces/{workspaceId}/environments"))!.Single(e => e.Id == result.Id);
        Assert.Equal("Ödeme - Test", environment.Name);
        Assert.True(environment.Variables.Single(v => v.Key == "token").IsSecret);
        Assert.False(environment.Variables.Single(v => v.Key == "eski").Enabled);
    }

    [Fact]
    public async Task ExportCollection_RoundTripsThroughImport()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var original = await ImportAsync(client, workspaceId, Fixture("sample.postman_collection.json"));

        var response = await client.GetAsync($"/api/collections/{original.Id}/export/postman");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(".postman_collection.json", response.Content.Headers.ContentDisposition?.ToString(), StringComparison.Ordinal);
        var exported = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
        Assert.Equal("https://schema.getpostman.com/json/collection/v2.1.0/collection.json", exported.GetProperty("info").GetProperty("schema").GetString());

        var copy = await ImportAsync(client, workspaceId, exported);
        Assert.Equal(["1 dosya alanı aktarıldı; dosyalar Postman'deki gibi saklanmaz, göndermeden önce yeniden seçin."], copy.Warnings);
        Assert.Equal((original.Folders, original.Requests, original.Variables, original.Examples), (copy.Folders, copy.Requests, copy.Variables, copy.Examples));

        var (a, aRequests) = await LoadAsync(client, workspaceId, original.Id);
        var (b, bRequests) = await LoadAsync(client, workspaceId, copy.Id);
        Assert.Equal(a.Auth, b.Auth);
        Assert.Equal(a.Scripts, b.Scripts);
        Assert.Equal(a.Examples.Select(e => (e.Name, e.Status)), b.Examples.Select(e => (e.Name, e.Status)));
        Assert.Equal(a.Variables, b.Variables);
        Assert.Equal(a.Folders.Select(f => (f.Name, f.SortOrder, f.Auth)), b.Folders.Select(f => (f.Name, f.SortOrder, f.Auth)));
        foreach (var (name, request) in aRequests)
        {
            var other = bRequests[name].Definition;
            Assert.Equal(request.Definition.Method, other.Method);
            Assert.Equal(request.Definition.Url, other.Url);
            Assert.Equal(request.Definition.Auth, other.Auth);
            Assert.Equal(request.Definition.Body.Mode, other.Body.Mode);
            Assert.Equal(request.Definition.Body.Raw, other.Body.Raw);
            Assert.Equal(request.Definition.Body.GraphqlVariables, other.Body.GraphqlVariables);
            Assert.Equal(request.Definition.Body.FileName, other.Body.FileName);
            Assert.Equal(request.Definition.Body.Form, other.Body.Form);
            Assert.Equal(request.Definition.Headers, other.Headers);
            Assert.Equal(request.Definition.Scripts, other.Scripts);
        }
    }

    [Fact]
    public async Task ExportEnvironment_ProducesPostmanFormat()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var imported = await ImportAsync(client, workspaceId, Fixture("sample.postman_environment.json"));

        var json = JsonDocument.Parse(await client.GetStringAsync($"/api/environments/{imported.Id}/export/postman")).RootElement;

        Assert.Equal("environment", json.GetProperty("_postman_variable_scope").GetString());
        var token = json.GetProperty("values").EnumerateArray().Single(v => v.GetProperty("key").GetString() == "token");
        Assert.Equal("secret", token.GetProperty("type").GetString());
    }

    [Theory]
    [InlineData("""{"foo": 1}""")]
    [InlineData("""{"id": "x", "name": "v1", "order": [], "requests": []}""")]
    [InlineData("[1, 2]")]
    public async Task Import_RejectsUnknownFormats(string body)
    {
        var (client, workspaceId) = await factory.CreateUserAsync();

        var response = await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/import/postman", JsonDocument.Parse(body).RootElement);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ImportAndExport_RequireWorkspaceAccess()
    {
        var (owner, workspaceId) = await factory.CreateUserAsync();
        var imported = await ImportAsync(owner, workspaceId, Fixture("sample.postman_collection.json"));
        var (stranger, _) = await factory.CreateUserAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync($"/api/workspaces/{workspaceId}/import/postman", Fixture("sample.postman_environment.json"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/collections/{imported.Id}/export/postman")).StatusCode);
    }
}
