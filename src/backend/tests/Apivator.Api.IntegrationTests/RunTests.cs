using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Application.Collections;
using Apivator.Application.Execution;
using Apivator.Application.Runs;
using Apivator.Domain.Collections;
using Apivator.Domain.Runs;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class RunTests(ApivatorApiFactory factory, TestTargetServer target) : IClassFixture<TestTargetServer>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private sealed record Setup(HttpClient Client, Guid WorkspaceId, CollectionTreeDto Collection);

    private async Task<Setup> CollectionAsync(ScriptSet? collectionScripts = null, RequestAuth? auth = null)
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("Koşu"))).ReadAsync<CollectionTreeDto>();
        if (collectionScripts is not null || auth is not null)
        {
            await client.PatchAsJsonAsync($"/api/collections/{collection.Id}", new UpdateCollectionRequest(null, null, auth, null, collectionScripts));
        }

        return new Setup(client, workspaceId, collection);
    }

    private static async Task<ApiRequestDto> RequestAsync(Setup s, string name, string url, string? post = null, Guid? folderId = null, IReadOnlyList<KeyValueItem>? headers = null) =>
        await (await s.Client.PostAsJsonAsync(
            $"/api/collections/{s.Collection.Id}/requests",
            new CreateApiRequestRequest(name, folderId, new RequestDefinition
            {
                Url = url,
                Headers = headers ?? [],
                Scripts = new ScriptSet { PostResponse = post ?? string.Empty },
            }))).ReadAsync<ApiRequestDto>();

    private static async Task<List<RunEvent>> RunAsync(Setup s, StartRunRequest request)
    {
        var response = await s.Client.PostAsJsonAsync("/api/runs", request);
        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        Assert.StartsWith("application/x-ndjson", response.Content.Headers.ContentType?.ToString(), StringComparison.Ordinal);
        var text = await response.Content.ReadAsStringAsync();
        return text.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(line => JsonSerializer.Deserialize<RunEvent>(line, Json)!).ToList();
    }

    [Fact]
    public async Task Run_ExecutesRequestsInOrder_ForEachIteration_AndSavesReport()
    {
        var s = await CollectionAsync(new ScriptSet { PreRequest = "pm.variables.set('kok', 'evet');" });
        await RequestAsync(s, "Bir", $"{target.BaseUrl}/echo?n=1", "pm.test('ok', () => pm.response.to.have.status(200));");
        await RequestAsync(s, "İki", $"{target.BaseUrl}/status/404", "pm.test('bulunamadı mı', () => pm.response.to.have.status(200));");
        await RequestAsync(s, "Üç", $"{target.BaseUrl}/echo?iter={{{{$randomInt}}}}&k={{{{kok}}}}");

        var events = await RunAsync(s, new StartRunRequest(s.Collection.Id, Iterations: 2));

        Assert.Equal("start", events[0].Type);
        Assert.Equal(["Bir", "İki", "Üç"], events[0].Requests!.Select(r => r.Name));
        var results = events.Where(e => e.Type == "result").Select(e => e.Result!).ToList();
        Assert.Equal(["Bir", "İki", "Üç", "Bir", "İki", "Üç"], results.Select(r => r.Name));
        Assert.Equal([0, 0, 0, 1, 1, 1], results.Select(r => r.Iteration));
        Assert.EndsWith("&k=evet", results[2].Url, StringComparison.Ordinal);

        var done = events[^1];
        Assert.Equal("done", done.Type);
        Assert.Equal(RunStatus.Completed, done.Summary!.Status);
        Assert.Equal((6, 2, 2, 2), (done.Summary.TotalRequests, done.Summary.FailedRequests, done.Summary.TestsPassed, done.Summary.TestsFailed));

        var list = await s.Client.GetFromJsonAsync<List<RunSummaryDto>>($"/api/workspaces/{s.WorkspaceId}/runs?collectionId={s.Collection.Id}", Json);
        Assert.Equal(done.RunId, Assert.Single(list!).Id);
        Assert.Equal("Test Kullanıcı", list![0].UserName);
        var detail = await s.Client.GetFromJsonAsync<RunDetailDto>($"/api/runs/{done.RunId}", Json);
        Assert.Equal(6, detail!.Results.Count);
    }

    [Fact]
    public async Task Run_UsesDataRows_AndCarriesVariablesBetweenRequests()
    {
        var s = await CollectionAsync(auth: new RequestAuth { Type = AuthType.Bearer, BearerToken = "{{token}}" });
        await RequestAsync(s, "Giriş", $"{target.BaseUrl}/echo?kullanici={{{{kullanici}}}}", "pm.environment.set('token', 'tkn-' + pm.iterationData.get('kullanici'));");
        await RequestAsync(s, "Profil", $"{target.BaseUrl}/echo", "pm.test('token taşındı', () => pm.expect(pm.response.json().headers.authorization).to.equal('Bearer tkn-' + pm.iterationData.get('kullanici')));");

        var events = await RunAsync(s, new StartRunRequest(
            s.Collection.Id,
            Iterations: 5,
            Data: [new() { ["kullanici"] = "ayse" }, new() { ["kullanici"] = "mehmet" }],
            Variables: new ExecutionVariables { Environment = [], EnvironmentName = "Test" }));

        Assert.Equal(2, events[0].Iterations);
        var results = events.Where(e => e.Type == "result").Select(e => e.Result!).ToList();
        Assert.Equal(["?kullanici=ayse", "?kullanici=mehmet"], results.Where(r => r.Name == "Giriş").Select(r => new Uri(r.Url).Query));
        Assert.All(results.Where(r => r.Name == "Profil"), r => Assert.Equal("passed", Assert.Single(r.Tests).Status));
        Assert.Equal("tkn-mehmet", events[^1].Variables!.Environment!["token"]);
    }

    [Fact]
    public async Task SetNextRequest_ControlsFlow()
    {
        var s = await CollectionAsync();
        await RequestAsync(s, "A", $"{target.BaseUrl}/echo", "pm.execution.setNextRequest('C');");
        await RequestAsync(s, "B", $"{target.BaseUrl}/echo");
        await RequestAsync(s, "C", $"{target.BaseUrl}/echo", "pm.execution.setNextRequest(null);");
        await RequestAsync(s, "D", $"{target.BaseUrl}/echo");

        var events = await RunAsync(s, new StartRunRequest(s.Collection.Id));

        Assert.Equal(["A", "C"], events.Where(e => e.Type == "result").Select(e => e.Result!.Name));
    }

    [Fact]
    public async Task Run_CanTargetAFolderOrSelectedRequests()
    {
        var s = await CollectionAsync();
        var folder = await (await s.Client.PostAsJsonAsync($"/api/collections/{s.Collection.Id}/folders", new CreateFolderRequest("Klasör", null))).ReadAsync<FolderDto>();
        await RequestAsync(s, "Klasörde", $"{target.BaseUrl}/echo", folderId: folder.Id);
        var root1 = await RequestAsync(s, "Kök 1", $"{target.BaseUrl}/echo");
        await RequestAsync(s, "Kök 2", $"{target.BaseUrl}/echo");

        var folderRun = await RunAsync(s, new StartRunRequest(s.Collection.Id, FolderId: folder.Id));
        Assert.Equal(["Klasörde"], folderRun.Where(e => e.Type == "result").Select(e => e.Result!.Name));
        Assert.Equal("Koşu / Klasör", folderRun[^1].Summary!.Name);

        var selected = await RunAsync(s, new StartRunRequest(s.Collection.Id, RequestIds: [root1.Id]));
        Assert.Equal(["Kök 1"], selected.Where(e => e.Type == "result").Select(e => e.Result!.Name));
    }

    [Fact]
    public async Task Run_ValidatesAndChecksAccess()
    {
        var s = await CollectionAsync();
        var (stranger, _) = await factory.CreateUserAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync("/api/runs", new StartRunRequest(s.Collection.Id))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await s.Client.PostAsJsonAsync("/api/runs", new StartRunRequest(s.Collection.Id, Iterations: 0))).StatusCode);
    }

    [Fact]
    public async Task DesktopRun_UsesSourceFromServer_RunsInAgent_AndReportIsSaved()
    {
        var s = await CollectionAsync(new ScriptSet { PreRequest = "pm.variables.set('kok', 'masaustu');" });
        var folder = await (await s.Client.PostAsJsonAsync($"/api/collections/{s.Collection.Id}/folders", new CreateFolderRequest("Klasör", null))).ReadAsync<FolderDto>();
        await RequestAsync(s, "Klasörde", $"{target.BaseUrl}/echo?k={{{{kok}}}}", "pm.test('ok', () => pm.response.to.have.status(200));", folder.Id);
        await RequestAsync(s, "Kökte", $"{target.BaseUrl}/status/500");

        var source = await s.Client.GetFromJsonAsync<RunSourceDto>($"/api/collections/{s.Collection.Id}/run-source", Json);
        Assert.Equal((2, 1), (source!.Requests.Count, source.Folders.Count));
        Assert.Contains("{{kok}}", source.Requests.Single(r => r.Name == "Klasörde").Definition.Url, StringComparison.Ordinal);

        const string token = "runner-ajan-tokeni-0123456789abcdefghij";
        await using var agent = Apivator.Agent.AgentHost.Build(new Apivator.Agent.AgentOptions { Token = token });
        var port = await Apivator.Agent.AgentHost.StartAsync(agent);
        using var local = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{port}") };
        local.DefaultRequestHeaders.Add(Apivator.Agent.AgentOptions.TokenHeader, token);
        var run = new StartRunRequest(s.Collection.Id, Iterations: 2);
        var response = await local.PostAsJsonAsync("/runs", new LocalRunRequest(run, source));
        var events = (await response.Content.ReadAsStringAsync())
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => JsonSerializer.Deserialize<RunEvent>(line, Json)!)
            .ToList();

        Assert.Equal(["Klasörde", "Kökte", "Klasörde", "Kökte"], events.Where(e => e.Type == "result").Select(e => e.Result!.Name));
        Assert.EndsWith("k=masaustu", events.First(e => e.Type == "result").Result!.Url, StringComparison.Ordinal);
        var report = events[^1].Report!;
        Assert.Equal((RunStatus.Completed, 2, 4), (report.Status, report.Iterations, report.Results.Count));

        var saved = await (await s.Client.PostAsJsonAsync("/api/runs/report", new RunReportRequest(
            s.Collection.Id, null, report.Name, "Yerel", report.Iterations, 0, report.Status, report.StartedAt, report.FinishedAt, report.Results)))
            .ReadAsync<RunSummaryDto>();
        Assert.Equal((RunOrigin.Desktop, 4, 2, 2), (saved.Origin, saved.TotalRequests, saved.FailedRequests, saved.TestsPassed));

        var list = await s.Client.GetFromJsonAsync<List<RunSummaryDto>>($"/api/workspaces/{s.WorkspaceId}/runs?collectionId={s.Collection.Id}", Json);
        Assert.Equal(RunOrigin.Desktop, Assert.Single(list!).Origin);
        Assert.Equal("Yerel", list![0].EnvironmentName);
    }

    [Fact]
    public async Task DesktopRun_SourceAndReport_CheckAccessAndValidate()
    {
        var s = await CollectionAsync();
        var (stranger, _) = await factory.CreateUserAsync();
        var now = DateTimeOffset.UtcNow;
        RunReportRequest Report(int iterations = 1, DateTimeOffset? finished = null) =>
            new(s.Collection.Id, null, "Koşu", null, iterations, 0, RunStatus.Completed, now, finished ?? now.AddSeconds(1), []);

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/collections/{s.Collection.Id}/run-source")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync("/api/runs/report", Report())).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await s.Client.PostAsJsonAsync("/api/runs/report", Report(iterations: 0))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await s.Client.PostAsJsonAsync("/api/runs/report", Report(finished: now.AddSeconds(-5)))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await s.Client.PostAsJsonAsync("/api/runs/report", Report())).StatusCode);
    }

    [Fact]
    public async Task RunLimits_ArePerUser_NotShared()
    {
        var a = await CollectionAsync();
        var b = await CollectionAsync();
        var now = DateTimeOffset.UtcNow;
        RunReportRequest Report(Setup s) => new(s.Collection.Id, null, "Koşu", null, 1, 0, RunStatus.Completed, now, now, []);

        // Varsayılan: kullanıcı başına dakikada 10 çalıştırma.
        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 11; i++)
        {
            statuses.Add((await a.Client.PostAsJsonAsync("/api/runs/report", Report(a))).StatusCode);
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, statuses[^1]);
        Assert.Equal(HttpStatusCode.OK, (await b.Client.PostAsJsonAsync("/api/runs/report", Report(b))).StatusCode);
    }

    [Fact]
    public async Task Run_CanBeDeleted()
    {
        var s = await CollectionAsync();
        await RequestAsync(s, "A", $"{target.BaseUrl}/echo");
        var done = (await RunAsync(s, new StartRunRequest(s.Collection.Id)))[^1];

        Assert.Equal(HttpStatusCode.NoContent, (await s.Client.DeleteAsync($"/api/runs/{done.RunId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await s.Client.GetAsync($"/api/runs/{done.RunId}")).StatusCode);
    }

    [Fact]
    public async Task Run_StopsWhenClientDisconnects_AndSavesStoppedReport()
    {
        var s = await CollectionAsync();
        await RequestAsync(s, "Hızlı", $"{target.BaseUrl}/echo");
        await RequestAsync(s, "Yavaş", $"{target.BaseUrl}/slow");

        using (var cts = new CancellationTokenSource())
        using (var message = new HttpRequestMessage(HttpMethod.Post, "/api/runs") { Content = JsonContent.Create(new StartRunRequest(s.Collection.Id, Iterations: 3)) })
        using (var response = await s.Client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cts.Token))
        using (var reader = new StreamReader(await response.Content.ReadAsStreamAsync(cts.Token)))
        {
            Assert.Contains("\"start\"", await reader.ReadLineAsync(cts.Token), StringComparison.Ordinal);
            Assert.Contains("Hızlı", await reader.ReadLineAsync(cts.Token), StringComparison.Ordinal);
            await cts.CancelAsync();
        }

        RunSummaryDto? saved = null;
        for (var i = 0; i < 50 && saved is null; i++)
        {
            await Task.Delay(100);
            saved = (await s.Client.GetFromJsonAsync<List<RunSummaryDto>>($"/api/workspaces/{s.WorkspaceId}/runs", Json))!.FirstOrDefault();
        }

        Assert.NotNull(saved);
        Assert.Equal(RunStatus.Stopped, saved.Status);
        Assert.Equal(1, saved.TotalRequests);
    }
}
