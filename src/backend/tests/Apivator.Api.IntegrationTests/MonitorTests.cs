using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Application.Collections;
using Apivator.Application.Environments;
using Apivator.Application.Monitors;
using Apivator.Application.Runs;
using Apivator.Domain.Collections;
using Apivator.Domain.Monitors;
using Apivator.Domain.Runs;
using Apivator.Domain.Variables;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class MonitorTests(ApivatorApiFactory factory, TestTargetServer target) : IClassFixture<TestTargetServer>
{
    private sealed record Setup(HttpClient Client, string Email, Guid WorkspaceId, Guid CollectionId, Guid EnvironmentId);

    private async Task<Setup> SetupAsync()
    {
        var email = TestHelpers.NewEmail();
        var client = factory.CreateClient();
        client.WithBearer((await client.RegisterAsync(email)).AccessToken);
        var workspaceId = (await client.GetFromJsonAsync<List<Application.Workspaces.WorkspaceDto>>("/api/workspaces"))!.Single().Id;
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("Sağlık"))).ReadAsync<CollectionTreeDto>();
        await client.PostAsJsonAsync(
            $"/api/collections/{collection.Id}/requests",
            new CreateApiRequestRequest("Durum", null, new RequestDefinition
            {
                Url = "{{base}}/health-check",
                Scripts = new ScriptSet { PostResponse = "pm.test('200 döner', () => pm.response.to.have.status(200));" },
            }));
        var environment = await (await client.PostAsJsonAsync(
            $"/api/workspaces/{workspaceId}/environments",
            new CreateEnvironmentRequest("Canlı", [new Variable("base", target.BaseUrl, IsSecret: true)]))).ReadAsync<EnvironmentDto>();
        return new Setup(client, email, workspaceId, collection.Id, environment.Id);
    }

    private static async Task<MonitorDto> CreateAsync(Setup s, MonitorSettings settings) =>
        await (await s.Client.PostAsJsonAsync($"/api/workspaces/{s.WorkspaceId}/monitors", new CreateMonitorRequest(s.CollectionId, settings))).ReadAsync<MonitorDto>();

    private MonitorSettings Settings(Setup s, MonitorNotifyMode mode = MonitorNotifyMode.Changes) =>
        new("Canlı sağlık", s.EnvironmentId, "*/15 * * * *", "Europe/Istanbul", [], $"{target.BaseUrl}/hooks", WebhookKind.Generic, mode);

    private static async Task<MonitorRunPointDto> RunNowAsync(Setup s, MonitorDto monitor) =>
        await (await s.Client.PostAsync($"/api/monitors/{monitor.Id}/run", null)).ReadAsync<MonitorRunPointDto>();

    private static async Task<MonitorDto> GetAsync(Setup s, MonitorDto monitor) =>
        (await s.Client.GetFromJsonAsync<List<MonitorDto>>($"/api/workspaces/{s.WorkspaceId}/monitors"))!.Single(m => m.Id == monitor.Id);

    private int EmailsTo(string email, string subjectPart) =>
        factory.Emails.Sent.Count(m => string.Equals(m.To, email, StringComparison.OrdinalIgnoreCase) && m.Subject.Contains(subjectPart, StringComparison.Ordinal));

    [Fact]
    public async Task RunNow_UsesEnvironmentInitialValues_AndRecordsHistory()
    {
        target.HealthStatus = 200;
        var s = await SetupAsync();
        var monitor = await CreateAsync(s, Settings(s));
        Assert.True(monitor.Enabled);
        Assert.True(monitor.NextRunAt > DateTimeOffset.UtcNow);
        Assert.Equal("Sağlık", monitor.CollectionName);

        var point = await RunNowAsync(s, monitor);

        Assert.True(point.Healthy);
        // Elle çalıştırma "monitörden" değil, sunucuda normal bir çalıştırma olarak görünür; yine monitörün geçmişindedir.
        Assert.Equal((RunOrigin.Server, 1, 1, 0), (point.Origin, point.TotalRequests, point.TestsPassed, point.TestsFailed));
        var after = await GetAsync(s, monitor);
        Assert.Equal((MonitorHealth.Healthy, point.Id, monitor.NextRunAt), (after.Health, after.LastRunId, after.NextRunAt));

        var history = (await s.Client.GetFromJsonAsync<List<MonitorRunPointDto>>($"/api/monitors/{monitor.Id}/runs"))!;
        Assert.Equal([point.Id], history.Select(p => p.Id));
        var detail = await s.Client.GetFromJsonAsync<RunDetailDto>($"/api/runs/{point.Id}");
        Assert.Equal("Canlı", detail!.Summary.EnvironmentName);
    }

    [Fact]
    public async Task Failures_NotifyOnChange_AndOnRecovery()
    {
        var s = await SetupAsync();
        var monitor = await CreateAsync(s, Settings(s));
        target.HealthStatus = 500;
        var hooksBefore = target.Hooks.Count;

        var failed = await RunNowAsync(s, monitor);
        Assert.False(failed.Healthy);
        Assert.Equal(1, EmailsTo(s.Email, "Başarısız"));
        var hook = JsonDocument.Parse(target.Hooks.Last()).RootElement;
        Assert.Equal("monitor.failed", hook.GetProperty("event").GetString());
        Assert.Equal("Durum", hook.GetProperty("failures")[0].GetProperty("requestName").GetString());
        Assert.Equal(hooksBefore + 1, target.Hooks.Count);

        // Yalnızca durum değişince: ikinci başarısızlık sessiz.
        await RunNowAsync(s, monitor);
        Assert.Equal(1, EmailsTo(s.Email, "Başarısız"));
        Assert.Equal(2, (await GetAsync(s, monitor)).ConsecutiveFailures);

        target.HealthStatus = 200;
        await RunNowAsync(s, monitor);
        Assert.Equal(1, EmailsTo(s.Email, "Düzeldi"));
        Assert.Equal("monitor.recovered", JsonDocument.Parse(target.Hooks.Last()).RootElement.GetProperty("event").GetString());
        Assert.Equal((MonitorHealth.Healthy, 0), ((await GetAsync(s, monitor)).Health, (await GetAsync(s, monitor)).ConsecutiveFailures));
    }

    [Fact]
    public async Task EveryFailureMode_NotifiesEachTime_ToGivenAddresses()
    {
        var s = await SetupAsync();
        var monitor = await CreateAsync(s, Settings(s, MonitorNotifyMode.EveryFailure) with { NotifyEmails = ["nobetci@example.com"], WebhookUrl = null });
        target.HealthStatus = 503;

        await RunNowAsync(s, monitor);
        await RunNowAsync(s, monitor);
        target.HealthStatus = 200;

        Assert.Equal(2, EmailsTo("nobetci@example.com", "Başarısız"));
        Assert.Equal(0, EmailsTo(s.Email, "Başarısız"));
    }

    [Fact]
    public async Task Scheduler_RunsDueMonitorsOnce_AndAdvancesTheSchedule()
    {
        target.HealthStatus = 200;
        var s = await SetupAsync();
        var monitor = await CreateAsync(s, Settings(s));
        var paused = await CreateAsync(s, Settings(s) with { Name = "Kapalı", Enabled = false });
        Assert.Null(paused.NextRunAt);

        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Monitors.Where(m => m.Id == monitor.Id || m.Id == paused.Id)
                .ExecuteUpdateAsync(u => u.SetProperty(m => m.NextRunAt, DateTimeOffset.UtcNow.AddMinutes(-1)));
        }

        var scheduler = factory.Services.GetRequiredService<IMonitorScheduler>();
        Assert.True(await scheduler.RunDueAsync() >= 1);

        var after = await GetAsync(s, monitor);
        Assert.Equal(MonitorHealth.Healthy, after.Health);
        Assert.True(after.NextRunAt > DateTimeOffset.UtcNow);
        var scheduledRun = Assert.Single((await s.Client.GetFromJsonAsync<List<MonitorRunPointDto>>($"/api/monitors/{monitor.Id}/runs"))!);
        // Zamanlanmış çalıştırma runner geçmişinde "monitörden" görünür.
        Assert.Equal(RunOrigin.Monitor, scheduledRun.Origin);
        Assert.Null((await GetAsync(s, paused)).LastRunAt);

        // Zamanı yeniden gelmeden ikinci tarama onu çalıştırmaz.
        await scheduler.RunDueAsync();
        Assert.Single((await s.Client.GetFromJsonAsync<List<MonitorRunPointDto>>($"/api/monitors/{monitor.Id}/runs"))!);
    }

    [Fact]
    public async Task MonitorIsSuspended_WhenItsOwnerLostAccess_AndAnotherMemberCanTakeItOver()
    {
        var s = await SetupAsync();
        var monitor = await CreateAsync(s, Settings(s));
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Monitors.Where(m => m.Id == monitor.Id).ExecuteUpdateAsync(u => u.SetProperty(m => m.CreatedById, Guid.NewGuid()));
        }

        var response = await s.Client.PostAsync($"/api/monitors/{monitor.Id}/run", null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var suspended = await GetAsync(s, monitor);
        Assert.False(suspended.Enabled);
        Assert.Contains("erişimi kalmadığı", suspended.LastError, StringComparison.Ordinal);

        var reopened = await (await s.Client.PutAsJsonAsync($"/api/monitors/{monitor.Id}", Settings(s))).ReadAsync<MonitorDto>();
        Assert.True(reopened.Enabled);
        Assert.Null(reopened.LastError);
        // Yeniden açan kişi sahibi olur; çalıştırmalar artık onun yetkisiyle yapılır.
        Assert.Equal("Test Kullanıcı", reopened.CreatedByName);
        target.HealthStatus = 200;
        Assert.True((await RunNowAsync(s, reopened)).Healthy);
    }

    [Theory]
    [InlineData("* * * * *", "UTC", null, null)]
    [InlineData("0 9 * * *", "Bilinmeyen/Yer", null, null)]
    [InlineData("0 9 * * *", "UTC", "eposta-degil", null)]
    [InlineData("0 9 * * *", "UTC", null, "ftp://hooks.example.com")]
    public async Task Create_ValidatesSettings(string cron, string zone, string? email, string? webhook)
    {
        var s = await SetupAsync();
        var settings = new MonitorSettings("m", null, cron, zone, email is null ? [] : [email], webhook);

        var response = await s.Client.PostAsJsonAsync($"/api/workspaces/{s.WorkspaceId}/monitors", new CreateMonitorRequest(s.CollectionId, settings));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Strangers_CannotSeeOrRunMonitors()
    {
        var s = await SetupAsync();
        var monitor = await CreateAsync(s, Settings(s));
        var (stranger, _) = await factory.CreateUserAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/workspaces/{s.WorkspaceId}/monitors")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsync($"/api/monitors/{monitor.Id}/run", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/monitors/{monitor.Id}/runs")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.DeleteAsync($"/api/monitors/{monitor.Id}")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await s.Client.DeleteAsync($"/api/monitors/{monitor.Id}")).StatusCode);
        Assert.Empty((await s.Client.GetFromJsonAsync<List<MonitorDto>>($"/api/workspaces/{s.WorkspaceId}/monitors"))!);
    }
}
