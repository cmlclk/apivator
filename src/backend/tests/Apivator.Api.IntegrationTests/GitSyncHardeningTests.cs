using System.Net;
using System.Net.Http.Json;
using Apivator.Application.Audit;
using Apivator.Application.Collections;
using Apivator.Application.GitSync;
using Apivator.Domain.Collections;
using Apivator.Infrastructure.Persistence;
using LibGit2Sharp;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Api.IntegrationTests;

// Git senkronu: adres kanonikleştirme, belirteç yaşam döngüsü, gizli değer uyarıları, hata ayrıntısı, geri çekilme.</summary>
public sealed partial class GitSyncTests
{
    [Theory]
    [InlineData("https://evil.test\\@good.test/r.git")]
    [InlineData("https://kullanici@good.test/r.git")]
    [InlineData("https://good.test%40evil.test/r.git")]
    [InlineData("https://good.test/r.git#@evil.test")]
    [InlineData("https://good.test/r.git?@evil.test")]
    [InlineData("https://2130706433/r.git")]
    [InlineData("https://0x7f.0.0.1/r.git")]
    [InlineData("https://0177.0.0.1/r.git")]
    [InlineData("https://[::ffff:127.0.0.1]/r.git")]
    [InlineData("https://good.test/ r.git")]
    public async Task Connect_RejectsNonCanonicalUrls(string url)
    {
        var s = await SetupAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await ConnectAsync(s.Admin, s.CollectionId, url)).StatusCode);
    }

    [Fact]
    public async Task Connect_ChangingHost_DropsStoredToken_UnlessNewOneSent()
    {
        var s = await SetupAsync();
        Assert.True((await (await ConnectAsync(s.Admin, s.CollectionId, "https://127.0.0.1:8441/a.git")).ReadAsync<GitSyncDto>()).HasToken);

        var samePath = await (await ConnectAsync(s.Admin, s.CollectionId, "https://127.0.0.1:8441/b.git", token: null)).ReadAsync<GitSyncDto>();
        Assert.True(samePath.HasToken);

        var otherHost = await (await ConnectAsync(s.Admin, s.CollectionId, "https://127.0.0.1:8442/b.git", token: null)).ReadAsync<GitSyncDto>();
        Assert.False(otherHost.HasToken);

        var withToken = await (await ConnectAsync(s.Admin, s.CollectionId, "https://127.0.0.1:8443/b.git", token: "yeni")).ReadAsync<GitSyncDto>();
        Assert.True(withToken.HasToken);

        var page = (await s.Admin.Client.GetFromJsonAsync<AuditPageDto>($"/api/organizations/{s.OrgId}/audit?limit=200&action=git"))!;
        Assert.Contains(page.Items, e => e.Data.GetValueOrDefault("new_host") == "127.0.0.1:8442");
    }

    [Fact]
    public async Task Push_SanitizesGitSpecialNames()
    {
        var s = await SetupAsync();
        var bare = BareRepo();
        await ConnectedAsync(s, bare);
        foreach (var name in new[] { ".gitmodules", "git~1", "CON", "a:b", "bitis. ", ".git" })
        {
            (await s.Admin.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/requests", new CreateApiRequestRequest(name, null, new RequestDefinition { Url = "{{base}}/x" }))).EnsureSuccessStatusCode();
        }

        await PushAsync(s.Admin, s.CollectionId);

        var files = RepoFiles(bare).Keys.ToList();
        var segments = files.SelectMany(k => k.Split('/')).ToList();
        Assert.DoesNotContain(segments, p => p.StartsWith(".git", StringComparison.OrdinalIgnoreCase) || p.StartsWith("git~", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(segments, p => p.StartsWith("CON", StringComparison.Ordinal) || p.Contains(':', StringComparison.Ordinal) || p.EndsWith(". ", StringComparison.Ordinal));
        Assert.Contains("apivator/_.gitmodules.request.json", files);
    }

    [Fact]
    public async Task Push_WarnsAboutLikelySecrets_UntilAcknowledged()
    {
        var s = await SetupAsync();
        await ConnectedAsync(s, BareRepo());
        var secret = new RequestDefinition
        {
            Url = "{{base}}/x?api_key=abcdef123456",
            Headers = [new KeyValueItem("Authorization", "Bearer abcdefghijklmnopqrstuvwxyz012345")],
        };
        (await s.Admin.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/requests", new CreateApiRequestRequest("Sızıntı", null, secret))).EnsureSuccessStatusCode();

        var blocked = await s.Admin.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest());
        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
        Assert.Contains("Authorization", await blocked.Content.ReadAsStringAsync());

        var ok = await s.Admin.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest(null, true));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
    }

    [Fact]
    public async Task Pull_WarnsWhenHostChangesOnRequestWithSecrets()
    {
        var s = await SetupAsync();
        var bare = BareRepo();
        await ConnectedAsync(s, bare);
        await PushAsync(s.Admin, s.CollectionId);
        RemoteEdit(bare, "apivator/Kullanıcılar/Getir.request.json", t => t.Replace("{{base}}/users/1", "https://kotu.test/users/1", StringComparison.Ordinal));

        var change = Assert.Single((await PreviewAsync(s.Admin, s.CollectionId)).Changes);

        Assert.Contains("kotu.test", change.Warning);
    }

    [Fact]
    public async Task UnreadableToken_IsReported_AndDetailsAreAdminOnly()
    {
        var s = await SetupAsync();
        var missing = Path.Combine(Path.GetTempPath(), "apivator-yok-" + Guid.NewGuid().ToString("N"));
        (await ConnectAsync(s.Admin, s.CollectionId, missing)).EnsureSuccessStatusCode();

        var forEditor = await (await s.Editor.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest())).Content.ReadAsStringAsync();
        var forAdmin = await (await s.Admin.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest())).Content.ReadAsStringAsync();
        Assert.DoesNotContain("Ayrıntı", forEditor);
        Assert.Contains("Ayrıntı", forAdmin);

        await using (var scope = Factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.ExecuteSqlRawAsync("UPDATE collection_git_syncs SET protected_token = 'bozuk'");
        }

        var unreadable = await s.Editor.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest());
        Assert.Equal(HttpStatusCode.BadRequest, unreadable.StatusCode);
        Assert.Contains("çözülemiyor", await unreadable.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Scheduler_DisablesAutoCheck_AfterRepeatedFailures()
    {
        var s = await SetupAsync();
        (await ConnectAsync(s.Admin, s.CollectionId, Path.Combine(Path.GetTempPath(), "apivator-yok-" + Guid.NewGuid().ToString("N")))).EnsureSuccessStatusCode();
        (await s.Editor.Client.PutAsJsonAsync($"/api/collections/{s.CollectionId}/git/schedule", new SetGitScheduleRequest(1))).EnsureSuccessStatusCode();
        var scheduler = Factory.Services.GetRequiredService<Apivator.Infrastructure.GitSync.GitCheckScheduler>();

        for (var i = 0; i < 5; i++)
        {
            await using (var scope = Factory.Services.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var due = DateTimeOffset.UtcNow.AddMinutes(-1);
                await db.GitSyncs.Where(s => s.CheckIntervalHours != null).ExecuteUpdateAsync(u => u
                    .SetProperty(s => s.NextCheckAt, due)
                    .SetProperty(s => s.LockedUntil, (DateTimeOffset?)null));
            }

            await scheduler.RunDueAsync();
        }

        var status = (await s.Admin.Client.GetFromJsonAsync<GitSyncDto>($"/api/collections/{s.CollectionId}/git"))!;
        Assert.Null(status.CheckIntervalHours);
        Assert.Contains("kapatıldı", status.LastError);
    }

    [Fact]
    public async Task ConcurrentPushes_AreSerialized()
    {
        var s = await SetupAsync();
        var bare = BareRepo();
        await ConnectedAsync(s, bare);

        var results = await Task.WhenAll(
            s.Admin.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest()),
            s.Editor.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest()));

        Assert.All(results, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        using var repo = new Repository(bare);
        Assert.Single(repo.Branches["main"].Commits);
    }
}
