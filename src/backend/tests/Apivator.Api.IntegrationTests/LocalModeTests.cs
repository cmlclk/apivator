using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Application.Collections;
using Apivator.Application.Workspaces;
using Apivator.Domain.Workspaces;
using Apivator.Infrastructure.Identity;
using Apivator.Infrastructure.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Api.IntegrationTests;

/// <summary>Yerel mod (kişisel kullanım) her zaman SQLite dosyasıyla, masaüstündeki gibi koşar.</summary>
public sealed class LocalModeApiFactory : WebApplicationFactory<Program>
{
    public const string Token = "local-mode-test-token-0123456789abcdef0123";

    private readonly string _sqlitePath = Path.Combine(Path.GetTempPath(), $"apivator-local-{Guid.NewGuid():N}.db");

    public string ConfiguredToken { get; init; } = Token;

    public HttpClient CreateAuthorizedClient()
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        return client;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("LocalMode:Enabled", "true");
        builder.UseSetting("LocalMode:Token", ConfiguredToken);
        builder.UseSetting("Database:Provider", "Sqlite");
        builder.UseSetting("ConnectionStrings:Sqlite", $"Data Source={_sqlitePath}");
        builder.UseSetting("Monitors:SchedulerEnabled", "false");
        builder.UseSetting("SourceChecks:SchedulerEnabled", "false");
        builder.UseSetting("GitSync:SchedulerEnabled", "false");
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        SqliteConnection.ClearAllPools();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try
            {
                File.Delete(_sqlitePath + suffix);
            }
            catch (IOException)
            {
                // Geçici klasörde kalabilir.
            }
        }
    }
}

public class LocalModeTests(LocalModeApiFactory factory) : IClassFixture<LocalModeApiFactory>
{
    [Fact]
    public async Task Info_ReportsLocalMode_Anonymously()
    {
        var info = await factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/info");
        Assert.True(info.GetProperty("localMode").GetBoolean());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("wrong-token-wrong-token-wrong-token-0000")]
    public async Task Requests_WithoutTheAppToken_AreUnauthorized(string? token)
    {
        var client = factory.CreateClient();
        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/workspaces")).StatusCode);
    }

    [Fact]
    public async Task LocalUser_HasPersonalWorkspace_AndCanCreateCollections()
    {
        var client = factory.CreateAuthorizedClient();
        var workspace = Assert.Single((await client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!);
        Assert.Equal(WorkspaceType.Personal, workspace.Type);

        var me = await client.GetFromJsonAsync<JsonElement>("/api/me");
        Assert.Equal(LocalUser.Id, me.GetProperty("id").GetGuid());

        var created = await client.PostAsJsonAsync($"/api/workspaces/{workspace.Id}/collections", new CreateCollectionRequest("Yerel API"));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var tree = await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspace.Id}/collections");
        Assert.Contains(tree!, c => c.Name == "Yerel API");
    }

    [Fact]
    public async Task EnsureLocalUser_IsIdempotent()
    {
        _ = factory.CreateClient(); // sunucu başlarken bir kez oluşturur
        await LocalUser.EnsureAsync(factory.Services);

        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(1, await db.Users.CountAsync(u => u.Id == LocalUser.Id));
        Assert.Equal(1, await db.Organizations.CountAsync(o => o.OwnerId == LocalUser.Id));
    }

    [Theory]
    [InlineData("POST", "/api/auth/login")]
    [InlineData("POST", "/api/auth/register")]
    [InlineData("GET", "/api/auth/sso/discover?email=a@b.c")]
    [InlineData("POST", "/api/organizations")]
    [InlineData("GET", "/api/organizations/00000000-0000-0000-0000-000000000001/members")]
    [InlineData("GET", "/api/organizations/00000000-0000-0000-0000-000000000001/audit")]
    [InlineData("PATCH", "/api/teams/00000000-0000-0000-0000-000000000001")]
    [InlineData("GET", "/api/invitations/preview?token=x")]
    [InlineData("GET", "/api/me/invitations")]
    [InlineData("GET", "/api/me/2fa")]
    [InlineData("GET", "/api/me/sessions")]
    [InlineData("GET", "/api/me/api-keys")]
    [InlineData("GET", "/api/workspaces/00000000-0000-0000-0000-000000000001/members")]
    [InlineData("GET", "/hubs/workspace/negotiate")]
    public async Task TeamAndAccountEndpoints_AreClosed(string method, string path)
    {
        var response = await factory.CreateAuthorizedClient().SendAsync(new HttpRequestMessage(new HttpMethod(method), path));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("local_mode.unavailable", (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("code").GetString());
    }

    [Fact]
    public async Task OrganizationList_StaysOpen()
    {
        var response = await factory.CreateAuthorizedClient().GetAsync("/api/organizations");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("tauri://localhost", true)]
    [InlineData("http://tauri.localhost", true)]
    [InlineData("http://localhost:5173", false)]
    [InlineData("https://evil.example", false)]
    public async Task Cors_AllowsOnlyTheAppOrigins(string origin, bool allowed)
    {
        var preflight = new HttpRequestMessage(HttpMethod.Options, "/api/workspaces");
        preflight.Headers.Add("Origin", origin);
        preflight.Headers.Add("Access-Control-Request-Method", "GET");

        var response = await factory.CreateClient().SendAsync(preflight);

        Assert.Equal(allowed, response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values) && values.Single() == origin);
    }

    [Fact]
    public async Task Requests_ForOtherHostNames_AreRejected()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/info");
        request.Headers.Host = "attacker.example";

        var response = await factory.CreateClient().SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public void ShortToken_PreventsStartup()
    {
        using var weak = new LocalModeApiFactory { ConfiguredToken = "too-short" };
        var error = Assert.ThrowsAny<Exception>(() => weak.CreateClient());
        Assert.Contains("LocalMode:Token", error.ToString(), StringComparison.Ordinal);
    }
}

[Collection(ApiCollection.Name)]
public class TeamModeInfoTests(ApivatorApiFactory factory)
{
    [Fact]
    public async Task Info_ReportsTeamMode()
    {
        var info = await factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/info");
        Assert.False(info.GetProperty("localMode").GetBoolean());
    }
}
