using System.Net;
using System.Net.Http.Json;
using Apivator.Application.Collections;
using Apivator.Application.Examples;
using Apivator.Domain.Collections;
using Apivator.Domain.Variables;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class TreeTests(ApivatorApiFactory factory)
{
    private static async Task<CollectionTreeDto> CollectionAsync(HttpClient client, Guid workspaceId, string name) =>
        await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest(name))).ReadAsync<CollectionTreeDto>();

    private static async Task<FolderDto> FolderAsync(HttpClient client, Guid collectionId, string name, Guid? parent = null) =>
        await (await client.PostAsJsonAsync($"/api/collections/{collectionId}/folders", new CreateFolderRequest(name, parent))).ReadAsync<FolderDto>();

    private static async Task<ApiRequestDto> RequestAsync(HttpClient client, Guid collectionId, string name, Guid? folder = null) =>
        await (await client.PostAsJsonAsync($"/api/collections/{collectionId}/requests", new CreateApiRequestRequest(name, folder, new RequestDefinition { Url = $"https://x.test/{name}" }))).ReadAsync<ApiRequestDto>();

    private static async Task<CollectionTreeDto> TreeAsync(HttpClient client, Guid workspaceId, Guid collectionId) =>
        (await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single(c => c.Id == collectionId);

    private static IEnumerable<string> Ordered(CollectionTreeDto tree, Guid? folderId) =>
        tree.Requests.Where(r => r.FolderId == folderId).OrderBy(r => r.SortOrder).Select(r => r.Name);

    [Fact]
    public async Task MoveRequest_ReordersSiblings()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var c = await CollectionAsync(client, workspaceId, "C");
        await RequestAsync(client, c.Id, "a");
        await RequestAsync(client, c.Id, "b");
        var third = await RequestAsync(client, c.Id, "c");

        var moved = await (await client.PostAsJsonAsync($"/api/requests/{third.Id}/move", new MoveApiRequestRequest(null, 0))).ReadAsync<ApiRequestDto>();

        Assert.Equal(2, moved.Version);
        Assert.Equal(["c", "a", "b"], Ordered(await TreeAsync(client, workspaceId, c.Id), null));
    }

    [Fact]
    public async Task MoveRequest_ToAnotherCollection_KeepsExamples()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var source = await CollectionAsync(client, workspaceId, "Kaynak");
        var target = await CollectionAsync(client, workspaceId, "Hedef");
        var folder = await FolderAsync(client, target.Id, "Klasör");
        var request = await RequestAsync(client, source.Id, "taşınan");
        await client.PostAsJsonAsync($"/api/requests/{request.Id}/examples", new CreateExampleRequest("Tamam", 200, null, "ok", null));

        var moved = await (await client.PostAsJsonAsync($"/api/requests/{request.Id}/move", new MoveApiRequestRequest(folder.Id, 0, target.Id))).ReadAsync<ApiRequestDto>();

        Assert.Equal((target.Id, folder.Id), (moved.CollectionId, moved.FolderId));
        Assert.Empty((await TreeAsync(client, workspaceId, source.Id)).Requests);
        Assert.Single((await TreeAsync(client, workspaceId, target.Id)).Examples);
    }

    [Fact]
    public async Task MoveFolder_IntoItsOwnChild_IsRejected()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var c = await CollectionAsync(client, workspaceId, "C");
        var parent = await FolderAsync(client, c.Id, "Üst");
        var child = await FolderAsync(client, c.Id, "Alt", parent.Id);

        var response = await client.PostAsJsonAsync($"/api/folders/{parent.Id}/move", new MoveFolderRequest(child.Id, 0));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task MoveFolder_ToAnotherCollection_TakesSubtree()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var source = await CollectionAsync(client, workspaceId, "Kaynak");
        var target = await CollectionAsync(client, workspaceId, "Hedef");
        var parent = await FolderAsync(client, source.Id, "Üst");
        var child = await FolderAsync(client, source.Id, "Alt", parent.Id);
        await RequestAsync(client, source.Id, "derin", child.Id);
        await RequestAsync(client, source.Id, "kökte");

        await (await client.PostAsJsonAsync($"/api/folders/{parent.Id}/move", new MoveFolderRequest(null, 0, target.Id))).ReadAsync<FolderDto>();

        var moved = await TreeAsync(client, workspaceId, target.Id);
        Assert.Equal(["Üst", "Alt"], moved.Folders.Select(f => f.Name).Order().Reverse());
        Assert.Equal(["derin"], moved.Requests.Select(r => r.Name));
        var left = await TreeAsync(client, workspaceId, source.Id);
        Assert.Empty(left.Folders);
        Assert.Equal(["kökte"], left.Requests.Select(r => r.Name));
    }

    [Fact]
    public async Task DuplicateRequest_PlacesCopyAfterOriginal_WithExamples()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var c = await CollectionAsync(client, workspaceId, "C");
        var first = await RequestAsync(client, c.Id, "a");
        await RequestAsync(client, c.Id, "b");
        await client.PostAsJsonAsync($"/api/requests/{first.Id}/examples", new CreateExampleRequest("Tamam", 200, null, "ok", null));

        var copy = await (await client.PostAsJsonAsync($"/api/requests/{first.Id}/duplicate", new { })).ReadAsync<ApiRequestDto>();

        Assert.Equal("a (kopya)", copy.Name);
        Assert.Equal("https://x.test/a", copy.Definition.Url);
        var tree = await TreeAsync(client, workspaceId, c.Id);
        Assert.Equal(["a", "a (kopya)", "b"], Ordered(tree, null));
        Assert.Equal(2, tree.Examples.Count);
    }

    [Fact]
    public async Task DuplicateFolder_CopiesNestedContent()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var c = await CollectionAsync(client, workspaceId, "C");
        var parent = await FolderAsync(client, c.Id, "Üst");
        var child = await FolderAsync(client, c.Id, "Alt", parent.Id);
        await RequestAsync(client, c.Id, "derin", child.Id);

        var copy = await (await client.PostAsJsonAsync($"/api/folders/{parent.Id}/duplicate", new { })).ReadAsync<FolderDto>();

        var tree = await TreeAsync(client, workspaceId, c.Id);
        Assert.Equal("Üst (kopya)", copy.Name);
        var copiedChild = tree.Folders.Single(f => f.ParentFolderId == copy.Id);
        Assert.Equal("Alt", copiedChild.Name);
        Assert.Equal(["derin"], Ordered(tree, copiedChild.Id));
        Assert.Equal(["derin"], Ordered(tree, child.Id));
    }

    [Fact]
    public async Task DuplicateCollection_CopiesEverything()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var c = await CollectionAsync(client, workspaceId, "C");
        await client.PatchAsJsonAsync($"/api/collections/{c.Id}", new UpdateCollectionRequest(null, "Açıklama", new RequestAuth { Type = AuthType.Bearer, BearerToken = "t" }, [new Variable("baseUrl", "https://x.test")]));
        var folder = await FolderAsync(client, c.Id, "Klasör");
        await RequestAsync(client, c.Id, "içeride", folder.Id);
        await RequestAsync(client, c.Id, "kökte");

        var copy = await (await client.PostAsJsonAsync($"/api/collections/{c.Id}/duplicate", new { })).ReadAsync<CollectionTreeDto>();

        var tree = await TreeAsync(client, workspaceId, copy.Id);
        Assert.Equal(("C (kopya)", "Açıklama", "t"), (tree.Name, tree.Description, tree.Auth.BearerToken));
        Assert.Equal(["baseUrl"], tree.Variables.Select(v => v.Key));
        var copiedFolder = Assert.Single(tree.Folders);
        Assert.Equal(["içeride"], Ordered(tree, copiedFolder.Id));
        Assert.Equal(["kökte"], Ordered(tree, null));
    }

    [Fact]
    public async Task Move_ToCollectionInAnotherWorkspace_IsNotFound()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var (other, otherWorkspace) = await factory.CreateUserAsync();
        var mine = await CollectionAsync(client, workspaceId, "Benim");
        var theirs = await CollectionAsync(other, otherWorkspace, "Onların");
        var request = await RequestAsync(client, mine.Id, "r");

        var response = await client.PostAsJsonAsync($"/api/requests/{request.Id}/move", new MoveApiRequestRequest(null, 0, theirs.Id));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
