using System.Net;
using System.Net.Http.Json;
using Apivator.Application.GitSync;
using Apivator.Domain.Forks;

namespace Apivator.Api.IntegrationTests;

// Uçtan uca: API üzerinden bağla → gönder → uzakta düzenle → al → çakışma; hepsi gerçek git smart-HTTP sunucusu
// (git http-backend, Basic kimlik doğrulamalı) üzerinden http:// ile. git yüklü değilse atlanır.
public sealed partial class GitSyncTests
{
    private const string HttpToken = "ghp_super_secret_token";

    [Fact]
    public async Task Http_ConnectPushPullAndConflict_EndToEnd()
    {
        using var server = GitHttpFixture.Create("ali", HttpToken);
        if (server is null)
        {
            return; // git yüklü değil: atlandı
        }

        var s = await SetupAsync();
        (await ConnectAsync(s.Admin, s.CollectionId, server.Url)).EnsureSuccessStatusCode();

        var pushed = await PushAsync(s.Editor, s.CollectionId, "http ile");
        Assert.False(pushed.NoChanges);
        var files = RepoFiles(server.BarePath);
        Assert.Contains("apivator/Listele.request.json", files.Keys);
        Assert.DoesNotContain("ULTRA-GIZLI-TOKEN", string.Concat(files.Values));
        Assert.Equal(0, server.Rejected);
        Assert.True(server.Authorized > 0);

        RemoteEdit(server.BarePath, "apivator/Listele.request.json", t => t.Replace("{{base}}/users", "{{base}}/uzak", StringComparison.Ordinal));
        var preview = await PreviewAsync(s.Admin, s.CollectionId);
        Assert.Equal(ForkChangeType.Modified, Assert.Single(preview.Changes).Remote);
        (await PullAsync(s.Admin, s.CollectionId, new PullGitRequest(preview.RemoteHead))).EnsureSuccessStatusCode();
        Assert.Equal("{{base}}/uzak", (await RequestAsync(s.Admin, s.List.Id)).Definition.Url);

        (await EditUrlAsync(s.Admin, s.List.Id, "{{base}}/yerel")).EnsureSuccessStatusCode();
        RemoteEdit(server.BarePath, "apivator/Listele.request.json", t => t.Replace("{{base}}/uzak", "{{base}}/baska", StringComparison.Ordinal));
        var conflict = Assert.Single((await PreviewAsync(s.Admin, s.CollectionId)).Changes);
        Assert.True(conflict.Conflict);
        Assert.Equal(HttpStatusCode.Conflict, (await s.Admin.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest())).StatusCode);
        (await PullAsync(s.Admin, s.CollectionId, new PullGitRequest(null, new Dictionary<string, string> { [conflict.Key] = "theirs" }))).EnsureSuccessStatusCode();
        Assert.Equal("{{base}}/baska", (await RequestAsync(s.Admin, s.List.Id)).Definition.Url);
    }

    [Fact]
    public async Task Http_WrongToken_IsReportedAsAuthenticationFailure()
    {
        using var server = GitHttpFixture.Create("ali", HttpToken);
        if (server is null)
        {
            return;
        }

        var s = await SetupAsync();
        (await ConnectAsync(s.Admin, s.CollectionId, server.Url, token: "yanlis")).EnsureSuccessStatusCode();

        var response = await s.Editor.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest());

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync();
        Assert.Contains("kimlik doğrulama", text);
        Assert.DoesNotContain("yanlis", text);
        Assert.True(server.Rejected > 0);
    }
}
