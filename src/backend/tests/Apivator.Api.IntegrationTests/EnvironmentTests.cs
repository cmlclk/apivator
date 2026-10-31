using System.Net;
using System.Net.Http.Json;
using Apivator.Application.Collections;
using Apivator.Application.Environments;
using Apivator.Domain.Variables;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class EnvironmentTests(ApivatorApiFactory factory)
{
    [Fact]
    public async Task CreateUpdateDelete_Environment()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();

        var created = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/environments", new CreateEnvironmentRequest(
            "Geliştirme",
            [new Variable(" baseUrl ", "http://localhost:5000"), new Variable("", "boş satır"), new Variable("token", "", IsSecret: true)]))).ReadAsync<EnvironmentDto>();

        Assert.Equal(1, created.Version);
        Assert.Equal(["baseUrl", "token"], created.Variables.Select(v => v.Key));
        Assert.True(created.Variables[1].IsSecret);

        var updated = await (await client.PutAsJsonAsync($"/api/environments/{created.Id}", new UpdateEnvironmentRequest(
            "Test", [new Variable("baseUrl", "https://test.example.com")], created.Version))).ReadAsync<EnvironmentDto>();
        Assert.Equal("Test", updated.Name);
        Assert.Equal(2, updated.Version);

        var stale = await client.PutAsJsonAsync($"/api/environments/{created.Id}", new UpdateEnvironmentRequest("Eski", [], created.Version));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        var list = await client.GetFromJsonAsync<List<EnvironmentDto>>($"/api/workspaces/{workspaceId}/environments");
        Assert.Equal("https://test.example.com", Assert.Single(list!).Variables.Single().Value);

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/environments/{created.Id}")).StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<EnvironmentDto>>($"/api/workspaces/{workspaceId}/environments"))!);
    }

    [Fact]
    public async Task InvalidVariableName_ReturnsBadRequest()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var response = await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/environments", new CreateEnvironmentRequest("E", [new Variable("{{x}}", "v")]));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task OtherUser_CannotAccessEnvironments()
    {
        var (owner, workspaceId) = await factory.CreateUserAsync();
        var env = await (await owner.PostAsJsonAsync($"/api/workspaces/{workspaceId}/environments", new CreateEnvironmentRequest("Canlı"))).ReadAsync<EnvironmentDto>();
        var (stranger, _) = await factory.CreateUserAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/workspaces/{workspaceId}/environments")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PutAsJsonAsync($"/api/environments/{env.Id}", new UpdateEnvironmentRequest("x", [], 1))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.DeleteAsync($"/api/environments/{env.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/workspaces/{workspaceId}/globals")).StatusCode);
    }

    [Fact]
    public async Task Globals_StartEmpty_AndCanBeUpdated()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();

        Assert.Empty((await client.GetFromJsonAsync<GlobalsDto>($"/api/workspaces/{workspaceId}/globals"))!.Variables);

        await (await client.PutAsJsonAsync($"/api/workspaces/{workspaceId}/globals", new UpdateGlobalsRequest([new Variable("apiVersion", "v2")]))).ReadAsync<GlobalsDto>();

        var globals = await client.GetFromJsonAsync<GlobalsDto>($"/api/workspaces/{workspaceId}/globals");
        Assert.Equal("v2", Assert.Single(globals!.Variables).Value);
    }

    [Fact]
    public async Task CollectionVariables_RoundTrip()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("C"))).ReadAsync<CollectionTreeDto>();
        Assert.Empty(collection.Variables);

        var updated = await (await client.PatchAsJsonAsync($"/api/collections/{collection.Id}", new UpdateCollectionRequest(null, null, null, [new Variable("userId", "42", Enabled: false)]))).ReadAsync<CollectionTreeDto>();
        var variable = Assert.Single(updated.Variables);
        Assert.False(variable.Enabled);

        var tree = (await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single();
        Assert.Equal("42", tree.Variables.Single().Value);
    }
}
