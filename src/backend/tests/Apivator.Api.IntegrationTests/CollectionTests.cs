using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Application.Collections;
using Apivator.Domain.Collections;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class CollectionTests(ApivatorApiFactory factory)
{
    private static readonly RequestDefinition PostUser = new()
    {
        Method = "post",
        Url = "https://api.example.com/users?active=true",
        Headers = [new KeyValueItem("X-Trace", "1"), new KeyValueItem("X-Off", "0", Enabled: false)],
        Body = new RequestBody { Mode = BodyMode.Raw, RawLanguage = RawLanguage.Json, Raw = "{\"name\":\"Ayşe\"}" },
    };

    [Fact]
    public async Task CreateCollectionFolderAndRequest_AppearsInTree()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();

        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("Ödeme API"))).ReadAsync<CollectionTreeDto>();
        var folder = await (await client.PostAsJsonAsync($"/api/collections/{collection.Id}/folders", new CreateFolderRequest("Kullanıcılar", null))).ReadAsync<FolderDto>();
        var request = await (await client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Kullanıcı oluştur", folder.Id, PostUser))).ReadAsync<ApiRequestDto>();

        Assert.Equal("POST", request.Definition.Method);
        Assert.Equal(1, request.Version);

        var tree = await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections");
        var only = Assert.Single(tree!);
        Assert.Equal("Ödeme API", only.Name);
        Assert.Equal("Kullanıcılar", Assert.Single(only.Folders).Name);
        var summary = Assert.Single(only.Requests);
        Assert.Equal(folder.Id, summary.FolderId);
        Assert.Equal("POST", summary.Method);

        var loaded = await client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{request.Id}");
        Assert.Equal(PostUser.Body.Raw, loaded!.Definition.Body.Raw);
        Assert.Equal(2, loaded.Definition.Headers.Count);
        Assert.False(loaded.Definition.Headers[1].Enabled);
    }

    [Fact]
    public async Task ListRequests_ReturnsDefinitionsAndTreeCarriesVersions()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("Çevrimdışı"))).ReadAsync<CollectionTreeDto>();
        var first = await (await client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Bir", null, PostUser))).ReadAsync<ApiRequestDto>();
        await client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("İki", null, new RequestDefinition { Url = "https://x.test" }));
        await client.PutAsJsonAsync($"/api/requests/{first.Id}", new UpdateApiRequestRequest("Bir", PostUser with { Url = "https://api.example.com/v2" }, first.Version));

        var all = await client.GetFromJsonAsync<List<ApiRequestDto>>($"/api/collections/{collection.Id}/requests");
        Assert.Equal(["Bir", "İki"], all!.Select(r => r.Name));
        Assert.Equal(("https://api.example.com/v2", 2), (all![0].Definition.Url, all[0].Version));

        var tree = (await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single();
        Assert.Equal([2, 1], tree.Requests.OrderBy(r => r.Name).Select(r => r.Version));

        var (stranger, _) = await factory.CreateUserAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/collections/{collection.Id}/requests")).StatusCode);
    }

    [Fact]
    public async Task UpdateRequest_WithStaleVersion_ReturnsConflict()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var request = await CreateRequestAsync(client, workspaceId);

        var first = await client.PutAsJsonAsync($"/api/requests/{request.Id}", new UpdateApiRequestRequest("Yeni ad", PostUser with { Url = "https://x.test" }, request.Version));
        var updated = await first.ReadAsync<ApiRequestDto>();
        Assert.Equal(2, updated.Version);
        Assert.Equal("https://x.test", updated.Definition.Url);

        var stale = await client.PutAsJsonAsync($"/api/requests/{request.Id}", new UpdateApiRequestRequest("Eski", PostUser, request.Version));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
    }

    [Fact]
    public async Task OtherUser_CannotSeeOrChangeCollection()
    {
        var (owner, workspaceId) = await factory.CreateUserAsync();
        var request = await CreateRequestAsync(owner, workspaceId);
        var (stranger, _) = await factory.CreateUserAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/workspaces/{workspaceId}/collections")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/requests/{request.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.DeleteAsync($"/api/collections/{request.CollectionId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("Sızma"))).StatusCode);
    }

    [Fact]
    public async Task DeleteFolder_RemovesNestedFoldersAndRequests()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("C"))).ReadAsync<CollectionTreeDto>();
        var parent = await (await client.PostAsJsonAsync($"/api/collections/{collection.Id}/folders", new CreateFolderRequest("Üst", null))).ReadAsync<FolderDto>();
        var child = await (await client.PostAsJsonAsync($"/api/collections/{collection.Id}/folders", new CreateFolderRequest("Alt", parent.Id))).ReadAsync<FolderDto>();
        await client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Alt istek", child.Id, null));
        await client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Kök istek", null, null));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/folders/{parent.Id}")).StatusCode);

        var tree = (await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single();
        Assert.Empty(tree.Folders);
        Assert.Equal("Kök istek", Assert.Single(tree.Requests).Name);
    }

    [Fact]
    public async Task MoveRequest_IntoFolder()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var request = await CreateRequestAsync(client, workspaceId);
        var folder = await (await client.PostAsJsonAsync($"/api/collections/{request.CollectionId}/folders", new CreateFolderRequest("Klasör", null))).ReadAsync<FolderDto>();

        var moved = await (await client.PostAsJsonAsync($"/api/requests/{request.Id}/move", new MoveApiRequestRequest(folder.Id, 0))).ReadAsync<ApiRequestDto>();

        Assert.Equal(folder.Id, moved.FolderId);
    }

    [Fact]
    public async Task CollectionFolderAndRequestAuth_RoundTrip()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("C"))).ReadAsync<CollectionTreeDto>();
        Assert.Equal(AuthType.None, collection.Auth.Type);

        var bearer = new RequestAuth { Type = AuthType.Bearer, BearerToken = "t0k3n" };
        var updated = await (await client.PatchAsJsonAsync($"/api/collections/{collection.Id}", new UpdateCollectionRequest(null, null, bearer))).ReadAsync<CollectionTreeDto>();
        Assert.Equal("t0k3n", updated.Auth.BearerToken);
        Assert.Equal("C", updated.Name);

        // Collection'ın üstü olmadığı için "miras al" seçilemez; yetkilendirmesiz kabul edilir.
        var inherit = await (await client.PatchAsJsonAsync($"/api/collections/{collection.Id}", new UpdateCollectionRequest(null, null, RequestAuth.Inherit))).ReadAsync<CollectionTreeDto>();
        Assert.Equal(AuthType.None, inherit.Auth.Type);

        var folder = await (await client.PostAsJsonAsync($"/api/collections/{collection.Id}/folders", new CreateFolderRequest("F", null))).ReadAsync<FolderDto>();
        Assert.Equal(AuthType.Inherit, folder.Auth.Type);
        var basic = new RequestAuth { Type = AuthType.Basic, BasicUsername = "u", BasicPassword = "p" };
        var renamed = await (await client.PatchAsJsonAsync($"/api/folders/{folder.Id}", new UpdateFolderRequest(null, basic))).ReadAsync<FolderDto>();
        Assert.Equal("F", renamed.Name);
        Assert.Equal(AuthType.Basic, renamed.Auth.Type);

        var request = await (await client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("R", folder.Id, new RequestDefinition { Url = "https://x.test", Auth = new RequestAuth { Type = AuthType.ApiKey, ApiKeyName = "k", ApiKeyValue = "v", ApiKeyIn = ApiKeyLocation.Query } }))).ReadAsync<ApiRequestDto>();
        var loaded = await client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{request.Id}");
        Assert.Equal(ApiKeyLocation.Query, loaded!.Definition.Auth.ApiKeyIn);

        var tree = (await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single();
        Assert.Equal(AuthType.Basic, tree.Folders.Single().Auth.Type);
    }

    [Fact]
    public async Task RequestWithoutAuth_DefaultsToInherit()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var request = await CreateRequestAsync(client, workspaceId);
        Assert.Equal(AuthType.Inherit, request.Definition.Auth.Type);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CreateCollection_WithEmptyName_ReturnsBadRequest(string name)
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var response = await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest(name));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CreateRequest_WithInvalidMethod_ReturnsBadRequest()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("C"))).ReadAsync<CollectionTreeDto>();

        var response = await client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("X", null, new RequestDefinition { Method = "GE T" }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("en-US,en;q=0.9", "Invalid HTTP method.")]
    [InlineData(null, "Geçersiz HTTP method.")]
    public async Task CreateRequest_WithInvalidMethod_DetailFollowsAcceptLanguage(string? acceptLanguage, string expected)
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("C"))).ReadAsync<CollectionTreeDto>();

        using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/collections/{collection.Id}/requests")
        {
            Content = JsonContent.Create(new CreateApiRequestRequest("X", null, new RequestDefinition { Method = "GE T" })),
        };
        if (acceptLanguage is not null)
        {
            request.Headers.TryAddWithoutValidation("Accept-Language", acceptLanguage);
        }

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(expected, body.RootElement.GetProperty("detail").GetString());
    }

    private static async Task<ApiRequestDto> CreateRequestAsync(HttpClient client, Guid workspaceId)
    {
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("Test"))).ReadAsync<CollectionTreeDto>();
        return await (await client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("İstek", null, PostUser))).ReadAsync<ApiRequestDto>();
    }
}
