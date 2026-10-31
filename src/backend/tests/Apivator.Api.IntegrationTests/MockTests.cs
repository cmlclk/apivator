using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Apivator.Application.ApiKeys;
using Apivator.Application.Collections;
using Apivator.Application.Environments;
using Apivator.Application.Examples;
using Apivator.Application.Mocks;
using Apivator.Domain.Collections;
using Apivator.Domain.Variables;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class MockTests(ApivatorApiFactory factory)
{
    private sealed record Setup(HttpClient Client, Guid WorkspaceId, Guid CollectionId, Guid RequestId);

    private static async Task<Setup> SetupAsync(ApivatorApiFactory factory)
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("Kullanıcılar API"))).ReadAsync<CollectionTreeDto>();
        var request = await (await client.PostAsJsonAsync(
            $"/api/collections/{collection.Id}/requests",
            new CreateApiRequestRequest("Kullanıcı getir", null, new RequestDefinition { Url = "{{baseUrl}}/users/:id" }))).ReadAsync<ApiRequestDto>();
        await client.PostAsJsonAsync(
            $"/api/requests/{request.Id}/examples",
            new CreateExampleRequest("Bulundu", 200, [new KeyValueItem("Content-Type", "application/json"), new KeyValueItem("X-Ortam", "{{ortam}}")], "{\"id\":1,\"ad\":\"Ayşe\",\"sırr\":\"{{gizli}}\"}", null));
        await client.PostAsJsonAsync(
            $"/api/requests/{request.Id}/examples",
            new CreateExampleRequest("Yok", 404, [], string.Empty, null));
        return new Setup(client, workspaceId, collection.Id, request.Id);
    }

    private static async Task<MockServerDto> CreateMockAsync(Setup s, bool isPrivate = false, Guid? environmentId = null, int delayMs = 0) =>
        await (await s.Client.PostAsJsonAsync(
            $"/api/workspaces/{s.WorkspaceId}/mocks",
            new CreateMockRequest(s.CollectionId, "Kullanıcı mock'u", environmentId, isPrivate, delayMs))).ReadAsync<MockServerDto>();

    private static async Task<List<MockCallDto>> CallsAsync(Setup s, MockServerDto mock) =>
        (await s.Client.GetFromJsonAsync<List<MockCallDto>>($"/api/mocks/{mock.Id}/calls"))!;

    [Fact]
    public async Task Mock_ServesExamples_ResolvesPublicVariables_AndLogsCalls()
    {
        var s = await SetupAsync(factory);
        var environment = await (await s.Client.PostAsJsonAsync(
            $"/api/workspaces/{s.WorkspaceId}/environments",
            new CreateEnvironmentRequest("Test", [new Variable("ortam", "test"), new Variable("gizli", "PAROLA", IsSecret: true)]))).ReadAsync<EnvironmentDto>();
        var mock = await CreateMockAsync(s, environmentId: environment.Id);
        Assert.Equal($"/mock/{mock.Key}", mock.Path);
        Assert.Equal("Kullanıcılar API", mock.CollectionName);

        var routes = (await s.Client.GetFromJsonAsync<List<MockRouteDto>>($"/api/mocks/{mock.Id}/routes"))!;
        Assert.Equal([("GET", "/users/:id", 200, "Bulundu"), ("GET", "/users/:id", 404, "Yok")], routes.Select(r => (r.Method, r.Path, r.Status, r.ExampleName)));

        var anonymous = factory.CreateClient();
        var ok = await anonymous.GetAsync($"{mock.Path}/users/7?ayrinti=1");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal("application/json", ok.Content.Headers.ContentType?.MediaType);
        Assert.Equal("test", ok.Headers.GetValues("X-Ortam").Single());
        var body = await ok.Content.ReadAsStringAsync();
        Assert.Contains("Ayşe", body, StringComparison.Ordinal);
        Assert.Contains("{{gizli}}", body, StringComparison.Ordinal);
        Assert.DoesNotContain("PAROLA", body, StringComparison.Ordinal);

        var chosen = new HttpRequestMessage(HttpMethod.Get, $"{mock.Path}/users/7");
        chosen.Headers.Add("x-mock-response-code", "404");
        var notFound = await anonymous.SendAsync(chosen);
        Assert.Equal(HttpStatusCode.NotFound, notFound.StatusCode);
        Assert.Equal(string.Empty, await notFound.Content.ReadAsStringAsync());

        var unmatched = await anonymous.PostAsync($"{mock.Path}/orders", new StringContent("{\"a\":1}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NotFound, unmatched.StatusCode);
        Assert.Contains("eşleşen", await unmatched.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        var error = await unmatched.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("mockRequestNotFoundError", error.GetProperty("error").GetProperty("name").GetString());

        var calls = await CallsAsync(s, mock);
        Assert.Equal(3, calls.Count);
        Assert.Equal(("POST", "/orders", 404, (string?)null, "{\"a\":1}"), (calls[0].Method, calls[0].Path, calls[0].Status, calls[0].MatchedName, calls[0].RequestBody));
        Assert.Equal(("GET", "/users/7?ayrinti=1", 200, "Kullanıcı getir / Bulundu"), (calls[2].Method, calls[2].Path, calls[2].Status, calls[2].MatchedName));

        Assert.Equal(HttpStatusCode.NoContent, (await s.Client.DeleteAsync($"/api/mocks/{mock.Id}/calls")).StatusCode);
        Assert.Empty(await CallsAsync(s, mock));
    }

    [Fact]
    public async Task PrivateMock_RequiresAWorkspaceMembersApiKey()
    {
        var s = await SetupAsync(factory);
        var mock = await CreateMockAsync(s, isPrivate: true);
        var anonymous = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"{mock.Path}/users/1")).StatusCode);

        var (stranger, _) = await factory.CreateUserAsync();
        var strangerKey = await (await stranger.PostAsJsonAsync("/api/me/api-keys", new CreateApiKeyRequest("yabancı"))).ReadAsync<CreatedApiKeyDto>();
        var withStrangerKey = new HttpRequestMessage(HttpMethod.Get, $"{mock.Path}/users/1");
        withStrangerKey.Headers.Add("x-api-key", strangerKey.Secret);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.SendAsync(withStrangerKey)).StatusCode);

        var ownKey = await (await s.Client.PostAsJsonAsync("/api/me/api-keys", new CreateApiKeyRequest("mock"))).ReadAsync<CreatedApiKeyDto>();
        var withOwnKey = new HttpRequestMessage(HttpMethod.Get, $"{mock.Path}/users/1");
        withOwnKey.Headers.Add("x-api-key", ownKey.Secret);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.SendAsync(withOwnKey)).StatusCode);

        var logged = (await CallsAsync(s, mock))[0];
        Assert.Equal("•••", logged.RequestHeaders.Single(h => h.Key == "x-api-key").Value);
        Assert.DoesNotContain(logged.RequestHeaders, h => h.Value.Contains(ownKey.Secret, StringComparison.Ordinal));
    }

    [Fact]
    public async Task DisabledOrRegeneratedMock_StopsAnswering()
    {
        var s = await SetupAsync(factory);
        var mock = await CreateMockAsync(s);
        var anonymous = factory.CreateClient();

        var disabled = await (await s.Client.PutAsJsonAsync($"/api/mocks/{mock.Id}", new UpdateMockRequest("Kapalı", null, false, 0, false))).ReadAsync<MockServerDto>();
        Assert.False(disabled.Enabled);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"{mock.Path}/users/1")).StatusCode);

        await s.Client.PutAsJsonAsync($"/api/mocks/{mock.Id}", new UpdateMockRequest("Açık", null, false, 0, true));
        var regenerated = await (await s.Client.PostAsync($"/api/mocks/{mock.Id}/regenerate-key", null)).ReadAsync<MockServerDto>();
        Assert.NotEqual(mock.Key, regenerated.Key);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"{mock.Path}/users/1")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await anonymous.GetAsync($"{regenerated.Path}/users/1")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await s.Client.DeleteAsync($"/api/mocks/{mock.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"{regenerated.Path}/users/1")).StatusCode);
    }

    [Fact]
    public async Task ExampleChanges_AreServedImmediately()
    {
        var s = await SetupAsync(factory);
        var mock = await CreateMockAsync(s);
        var created = await (await s.Client.PostAsJsonAsync(
            $"/api/collections/{s.CollectionId}/requests",
            new CreateApiRequestRequest("Sipariş oluştur", null, new RequestDefinition { Method = "POST", Url = "https://api.example.com/orders" }))).ReadAsync<ApiRequestDto>();
        await s.Client.PostAsJsonAsync($"/api/requests/{created.Id}/examples", new CreateExampleRequest("Oluştu", 201, [], "{\"id\":99}", null));

        var response = await factory.CreateClient().PostAsync($"{mock.Path}/orders", new StringContent("{}", Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal("{\"id\":99}", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Mock_AllowsCrossOriginCalls()
    {
        var s = await SetupAsync(factory);
        var mock = await CreateMockAsync(s);
        var client = factory.CreateClient();

        var preflight = new HttpRequestMessage(HttpMethod.Options, $"{mock.Path}/users/1");
        preflight.Headers.Add("Origin", "http://localhost:3000");
        preflight.Headers.Add("Access-Control-Request-Method", "PUT");
        preflight.Headers.Add("Access-Control-Request-Headers", "x-mock-response-code,content-type");
        var answer = await client.SendAsync(preflight);
        Assert.True(answer.IsSuccessStatusCode);
        Assert.Equal("*", answer.Headers.GetValues("Access-Control-Allow-Origin").Single());

        var call = new HttpRequestMessage(HttpMethod.Get, $"{mock.Path}/users/1");
        call.Headers.Add("Origin", "http://localhost:3000");
        Assert.Equal("*", (await client.SendAsync(call)).Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Fact]
    public async Task Management_IsLimitedToWorkspaceMembers()
    {
        var s = await SetupAsync(factory);
        var mock = await CreateMockAsync(s);
        var (stranger, strangerWorkspace) = await factory.CreateUserAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/workspaces/{s.WorkspaceId}/mocks")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/mocks/{mock.Id}/calls")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.DeleteAsync($"/api/mocks/{mock.Id}")).StatusCode);
        // Başkasının collection'ı kendi workspace'inde mock'lanamaz.
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync(
            $"/api/workspaces/{strangerWorkspace}/mocks", new CreateMockRequest(s.CollectionId, "x"))).StatusCode);

        var list = (await s.Client.GetFromJsonAsync<List<MockServerDto>>($"/api/workspaces/{s.WorkspaceId}/mocks"))!;
        Assert.Equal([mock.Id], list.Select(m => m.Id));
    }

    [Fact]
    public async Task Create_ValidatesInput()
    {
        var s = await SetupAsync(factory);
        var (_, otherWorkspace) = await factory.CreateUserAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await s.Client.PostAsJsonAsync($"/api/workspaces/{s.WorkspaceId}/mocks", new CreateMockRequest(s.CollectionId, " "))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await s.Client.PostAsJsonAsync($"/api/workspaces/{s.WorkspaceId}/mocks", new CreateMockRequest(s.CollectionId, "m", DelayMs: 70_000))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await s.Client.PostAsJsonAsync($"/api/workspaces/{s.WorkspaceId}/mocks", new CreateMockRequest(s.CollectionId, "m", EnvironmentId: Guid.NewGuid()))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await s.Client.PostAsJsonAsync($"/api/workspaces/{otherWorkspace}/mocks", new CreateMockRequest(s.CollectionId, "m"))).StatusCode);
    }

    [Fact]
    public async Task OldCalls_ArePruned()
    {
        using var app = factory.WithWebHostBuilder(b =>
        {
            b.UseSetting("Mocks:PruneEvery", "1");
            b.UseSetting("Mocks:MaxCallsPerMock", "3");
        });
        var (client, workspaceId) = await app.CreateUserAsync();
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("C"))).ReadAsync<CollectionTreeDto>();
        var mock = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/mocks", new CreateMockRequest(collection.Id, "m"))).ReadAsync<MockServerDto>();
        var anonymous = app.CreateClient();

        for (var i = 0; i < 5; i++)
        {
            await anonymous.GetAsync($"{mock.Path}/x/{i}");
            await Task.Delay(5);
        }

        var calls = (await client.GetFromJsonAsync<List<MockCallDto>>($"/api/mocks/{mock.Id}/calls"))!;
        Assert.Equal(["/x/4", "/x/3", "/x/2"], calls.Select(c => c.Path));
    }
}
