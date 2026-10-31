using System.Net;
using System.Net.Http.Json;
using Apivator.Application.Collections;
using Apivator.Application.Examples;
using Apivator.Domain.Collections;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class ExampleTests(ApivatorApiFactory factory)
{
    private static async Task<(HttpClient Client, Guid WorkspaceId, Guid CollectionId, ApiRequestDto Request)> SetupAsync(ApivatorApiFactory factory)
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("Örnekler"))).ReadAsync<CollectionTreeDto>();
        var request = await (await client.PostAsJsonAsync(
            $"/api/collections/{collection.Id}/requests",
            new CreateApiRequestRequest("Kullanıcı", null, new RequestDefinition { Url = "{{baseUrl}}/users/1" }))).ReadAsync<ApiRequestDto>();
        return (client, workspaceId, collection.Id, request);
    }

    [Fact]
    public async Task Create_List_Update_Delete()
    {
        var (client, workspaceId, collectionId, request) = await SetupAsync(factory);

        var created = await (await client.PostAsJsonAsync(
            $"/api/requests/{request.Id}/examples",
            new CreateExampleRequest("Bulunamadı", 404, [new KeyValueItem("Content-Type", "application/json")], "{\"hata\":true}", null))).ReadAsync<ExampleDto>();

        Assert.Equal("{{baseUrl}}/users/1", created.Request.Url);
        var tree = (await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single(c => c.Id == collectionId);
        Assert.Equal([(created.Id, "Bulunamadı", 404)], tree.Examples.Select(e => (e.Id, e.Name, e.Status)));

        var updated = await (await client.PatchAsJsonAsync($"/api/examples/{created.Id}", new UpdateExampleRequest("Yok", 410, null, "{}"))).ReadAsync<ExampleDto>();
        Assert.Equal(("Yok", 410, "{}"), (updated.Name, updated.Status, updated.Body));
        Assert.Single(updated.Headers);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/examples/{created.Id}")).StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<ExampleDto>>($"/api/requests/{request.Id}/examples"))!);
    }

    [Fact]
    public async Task Examples_AreDeletedWithTheirRequest()
    {
        var (client, _, _, request) = await SetupAsync(factory);
        var example = await (await client.PostAsJsonAsync($"/api/requests/{request.Id}/examples", new CreateExampleRequest("Tamam", 200, null, "ok", null))).ReadAsync<ExampleDto>();

        await client.DeleteAsync($"/api/requests/{request.Id}");

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/examples/{example.Id}")).StatusCode);
    }

    [Fact]
    public async Task Strangers_CannotSeeOrChangeExamples()
    {
        var (client, _, _, request) = await SetupAsync(factory);
        var example = await (await client.PostAsJsonAsync($"/api/requests/{request.Id}/examples", new CreateExampleRequest("Tamam", 200, null, "ok", null))).ReadAsync<ExampleDto>();
        var (stranger, _) = await factory.CreateUserAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/requests/{request.Id}/examples")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync($"/api/requests/{request.Id}/examples", new CreateExampleRequest("x", 200, null, "", null))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.DeleteAsync($"/api/examples/{example.Id}")).StatusCode);
    }

    [Fact]
    public async Task Create_ValidatesName()
    {
        var (client, _, _, request) = await SetupAsync(factory);

        var response = await client.PostAsJsonAsync($"/api/requests/{request.Id}/examples", new CreateExampleRequest(" ", 200, null, "", null));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
