using System.Net;
using System.Net.Http.Json;
using Apivator.Application.Account;
using Apivator.Application.History;
using Apivator.Domain.Collections;
using Apivator.Domain.History;
using Apivator.Infrastructure.History;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class HistoryTests(ApivatorApiFactory factory)
{
    private static RecordHistoryRequest Entry(string url, int status = 200) =>
        new(new RequestDefinition { Method = "get", Url = url }, null, status, 12.5, 100);

    [Fact]
    public async Task Record_ThenList_NewestFirst()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/history", Entry("{{baseUrl}}/a"));
        await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/history", Entry("{{baseUrl}}/b", 404));

        var list = await client.GetFromJsonAsync<List<HistoryEntryDto>>($"/api/workspaces/{workspaceId}/history");

        Assert.NotNull(list);
        Assert.Equal(["{{baseUrl}}/b", "{{baseUrl}}/a"], list.Select(h => h.Url));
        Assert.Equal("GET", list[0].Method);
        Assert.Equal(404, list[0].Status);
    }

    [Fact]
    public async Task List_PagesWithBeforeCursor()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        for (var i = 0; i < 5; i++)
        {
            await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/history", Entry($"https://x.test/{i}"));
        }

        var first = (await client.GetFromJsonAsync<List<HistoryEntryDto>>($"/api/workspaces/{workspaceId}/history?limit=2"))!;
        var cursor = Uri.EscapeDataString(first[^1].ExecutedAt.ToString("O"));
        var second = (await client.GetFromJsonAsync<List<HistoryEntryDto>>($"/api/workspaces/{workspaceId}/history?limit=2&before={cursor}"))!;

        Assert.Equal(["https://x.test/4", "https://x.test/3"], first.Select(h => h.Url));
        Assert.Equal(["https://x.test/2", "https://x.test/1"], second.Select(h => h.Url));
    }

    [Fact]
    public async Task History_IsPrivatePerUser_AndCanBeDeleted()
    {
        var (owner, workspaceId) = await factory.CreateUserAsync();
        var entry = await (await owner.PostAsJsonAsync($"/api/workspaces/{workspaceId}/history", Entry("https://x.test"))).ReadAsync<HistoryEntryDto>();
        var (stranger, _) = await factory.CreateUserAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/workspaces/{workspaceId}/history")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.DeleteAsync($"/api/history/{entry.Id}")).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await owner.DeleteAsync($"/api/history/{entry.Id}")).StatusCode);
        Assert.Empty((await owner.GetFromJsonAsync<List<HistoryEntryDto>>($"/api/workspaces/{workspaceId}/history"))!);
    }

    [Fact]
    public async Task Clear_RemovesAll()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/history", Entry("https://x.test/1"));
        await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/history", Entry("https://x.test/2"));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/workspaces/{workspaceId}/history")).StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<HistoryEntryDto>>($"/api/workspaces/{workspaceId}/history"))!);
    }

    private static RecordHistoryRequest WithBody(string url, string body) =>
        Entry(url) with { Response = new HistoryResponseBody(body, "application/json", false) };

    private static Task<HttpResponseMessage> SetSaveResponsesAsync(HttpClient client, bool on) =>
        client.PutAsJsonAsync("/api/me/preferences", new PreferencesDto("system", null, true, true, true, null, on));

    [Fact]
    public async Task Response_IgnoredUnlessPreferenceOn()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var entry = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/history", WithBody("https://x.test", "{}"))).ReadAsync<HistoryEntryDto>();

        Assert.False(entry.HasResponse);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/history/{entry.Id}/response")).StatusCode);
    }

    [Fact]
    public async Task Response_SavedWhenOn_PrivateAndLimited_DeletedWhenTurnedOff()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        (await SetSaveResponsesAsync(client, true)).EnsureSuccessStatusCode();
        var url = $"/api/workspaces/{workspaceId}/history";
        var small = await (await client.PostAsJsonAsync(url, WithBody("https://x.test/a", """{"ok":true}"""))).ReadAsync<HistoryEntryDto>();
        var big = await (await client.PostAsJsonAsync(url, WithBody("https://x.test/b", new string('x', HistoryResponse.MaxBodyLength + 10)))).ReadAsync<HistoryEntryDto>();
        var none = await (await client.PostAsJsonAsync(url, Entry("https://x.test/c"))).ReadAsync<HistoryEntryDto>();

        var list = (await client.GetFromJsonAsync<List<HistoryEntryDto>>(url))!;
        Assert.Equal([false, true, true], list.Select(h => h.HasResponse));
        var saved = (await client.GetFromJsonAsync<HistoryResponseDto>($"/api/history/{small.Id}/response"))!;
        Assert.Equal(new HistoryResponseDto("""{"ok":true}""", "application/json", false), saved);
        var cut = (await client.GetFromJsonAsync<HistoryResponseDto>($"/api/history/{big.Id}/response"))!;
        Assert.Equal(HistoryResponse.MaxBodyLength, cut.Body.Length);
        Assert.True(cut.Truncated);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/history/{none.Id}/response")).StatusCode);

        var (stranger, _) = await factory.CreateUserAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/history/{small.Id}/response")).StatusCode);

        // Saklama kapatılınca eski gövdeler de silinir.
        (await SetSaveResponsesAsync(client, false)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/history/{small.Id}/response")).StatusCode);
        Assert.All((await client.GetFromJsonAsync<List<HistoryEntryDto>>(url))!, h => Assert.False(h.HasResponse));
    }

    [Fact]
    public async Task Retention_RemovesOldResponses_KeepsEntries()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        (await SetSaveResponsesAsync(client, true)).EnsureSuccessStatusCode();
        var url = $"/api/workspaces/{workspaceId}/history";
        var old = await (await client.PostAsJsonAsync(url, WithBody("https://x.test/old", "eski"))).ReadAsync<HistoryEntryDto>();
        var fresh = await (await client.PostAsJsonAsync(url, WithBody("https://x.test/new", "yeni"))).ReadAsync<HistoryEntryDto>();
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var id = old.Id;
            var executedAt = DateTimeOffset.UtcNow.AddDays(-31);
            await db.History.Where(h => h.Id == id).ExecuteUpdateAsync(u => u.SetProperty(h => h.ExecutedAt, executedAt));
        }

        Assert.True(await factory.Services.GetRequiredService<HistoryResponseRetention>().PurgeAsync(CancellationToken.None) >= 1);

        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/history/{old.Id}/response")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync($"/api/history/{fresh.Id}/response")).StatusCode);
        Assert.Equal(2, (await client.GetFromJsonAsync<List<HistoryEntryDto>>(url))!.Count);
    }

    [Fact]
    public async Task Record_KeepsOnlyNewestEntries()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        for (var i = 0; i < HistoryEntry.MaxEntriesPerUser + 3; i++)
        {
            (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/history", Entry($"https://x.test/{i}"))).EnsureSuccessStatusCode();
        }

        var all = new List<HistoryEntryDto>();
        string? cursor = null;
        while (true)
        {
            var page = (await client.GetFromJsonAsync<List<HistoryEntryDto>>(
                $"/api/workspaces/{workspaceId}/history?limit=200" + (cursor is null ? string.Empty : $"&before={cursor}")))!;
            if (page.Count == 0)
            {
                break;
            }

            all.AddRange(page);
            cursor = Uri.EscapeDataString(page[^1].ExecutedAt.ToString("O"));
        }

        Assert.Equal(HistoryEntry.MaxEntriesPerUser, all.Count);
        Assert.Equal($"https://x.test/{HistoryEntry.MaxEntriesPerUser + 2}", all[0].Url);
        Assert.DoesNotContain(all, h => h.Url == "https://x.test/0");
    }
}
