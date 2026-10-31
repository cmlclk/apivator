using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Application.Audit;
using Apivator.Application.Auth;
using Apivator.Application.Collections;
using Apivator.Application.GitSync;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Forks;
using Apivator.Domain.Organizations;
using Apivator.Domain.Variables;
using Apivator.Domain.Workspaces;
using Apivator.Infrastructure.Persistence;
using LibGit2Sharp;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public sealed partial class GitSyncTests(ApivatorApiFactory factory) : IDisposable
{
    private sealed record User(HttpClient Client, Guid Id, string Email);

    private sealed record Setup(User Admin, User Editor, User Viewer, Guid OrgId, Guid WorkspaceId, Guid CollectionId, ApiRequestDto List, ApiRequestDto Get);

    private static readonly JsonSerializerOptions WebJson = new(JsonSerializerDefaults.Web);

    private ApivatorApiFactory Factory => factory;

    private readonly List<string> _dirs = [];

    public void Dispose()
    {
        foreach (var dir in _dirs.Where(Directory.Exists))
        {
            foreach (var file in Directory.EnumerateFiles(dir, "*", SearchOption.AllDirectories))
            {
                File.SetAttributes(file, FileAttributes.Normal);
            }

            Directory.Delete(dir, true);
        }
    }

    private string TempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), "apivator-gittest-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        _dirs.Add(dir);
        return dir;
    }

    private string BareRepo()
    {
        var path = TempDir();
        Repository.Init(path, isBare: true);
        return path;
    }

    private async Task<User> UserAsync(string name)
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email, name);
        client.WithBearer(auth.AccessToken);
        return new User(client, auth.User.Id, email);
    }

    private async Task<User> MemberAsync(User owner, Guid orgId, Guid workspaceId, WorkspaceRole role, string name)
    {
        var user = await UserAsync(name);
        await (await owner.Client.PostAsJsonAsync($"/api/organizations/{orgId}/invitations", new InviteRequest(user.Email, OrganizationRole.Member, workspaceId, role))).ReadAsync<InvitationDto>();
        var token = TestHelpers.QueryValue(factory.Emails.LastTo(user.Email).TextBody, "token");
        await (await user.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();
        return user;
    }

    /// <summary>Ekip workspace'i; collection: kökte "Listele", "Kullanıcılar" klasöründe "Getir", gizli değişken ve Bearer.</summary>
    private async Task<Setup> SetupAsync()
    {
        var admin = await UserAsync("Yönetici Kişi");
        var org = await (await admin.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest("Git Ekibi"))).ReadAsync<OrganizationDto>();
        var workspace = (await admin.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.Single(w => w.OrganizationId == org.Id);
        var editor = await MemberAsync(admin, org.Id, workspace.Id, WorkspaceRole.Editor, "Düzenleyici");
        var viewer = await MemberAsync(admin, org.Id, workspace.Id, WorkspaceRole.Viewer, "Görüntüleyici");
        var c = admin.Client;
        var collection = await (await c.PostAsJsonAsync($"/api/workspaces/{workspace.Id}/collections", new CreateCollectionRequest("Kullanıcılar API"))).ReadAsync<CollectionTreeDto>();
        (await c.PatchAsJsonAsync($"/api/collections/{collection.Id}", new UpdateCollectionRequest(
            null, "Açıklama", new RequestAuth { Type = AuthType.Bearer, BearerToken = "ULTRA-GIZLI-TOKEN" },
            [new Variable("base", "https://api.test"), new Variable("apiKey", "GIZLI-DEGER-123", true, true)]))).EnsureSuccessStatusCode();
        var folder = await (await c.PostAsJsonAsync($"/api/collections/{collection.Id}/folders", new CreateFolderRequest("Kullanıcılar", null))).ReadAsync<FolderDto>();
        var list = await (await c.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Listele", null, new RequestDefinition { Url = "{{base}}/users" }))).ReadAsync<ApiRequestDto>();
        var get = await (await c.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Getir", folder.Id, new RequestDefinition { Url = "{{base}}/users/1", Auth = new RequestAuth { Type = AuthType.Basic, BasicUsername = "ali", BasicPassword = "SIFRE-XYZ" } }))).ReadAsync<ApiRequestDto>();
        return new Setup(admin, editor, viewer, org.Id, workspace.Id, collection.Id, list, get);
    }

    private static Task<HttpResponseMessage> ConnectAsync(User user, Guid collectionId, string remote, string? token = "ghp_super_secret_token", string branch = "main", string? path = null) =>
        user.Client.PutAsJsonAsync($"/api/collections/{collectionId}/git", new ConnectGitRequest(remote, branch, path, "ali", token));

    private static async Task<GitSyncDto> ConnectedAsync(Setup s, string remote)
    {
        var response = await ConnectAsync(s.Admin, s.CollectionId, remote);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.ReadAsync<GitSyncDto>();
    }

    private static async Task<GitPushResult> PushAsync(User user, Guid collectionId, string? message = null) =>
        await (await user.Client.PostAsJsonAsync($"/api/collections/{collectionId}/git/push", new PushGitRequest(message))).ReadAsync<GitPushResult>();

    private static async Task<GitPullPreviewDto> PreviewAsync(User user, Guid collectionId) =>
        await (await user.Client.PostAsync($"/api/collections/{collectionId}/git/pull/preview", null)).ReadAsync<GitPullPreviewDto>();

    private static Task<HttpResponseMessage> PullAsync(User user, Guid collectionId, PullGitRequest body) =>
        user.Client.PostAsJsonAsync($"/api/collections/{collectionId}/git/pull", body);

    private static Dictionary<string, string> RepoFiles(string bare, string branch = "main")
    {
        using var repo = new Repository(bare);
        var files = new Dictionary<string, string>();
        Walk(repo.Branches[branch].Tip.Tree, string.Empty, files);
        return files;
    }

    private static void Walk(Tree tree, string prefix, Dictionary<string, string> files)
    {
        foreach (var entry in tree)
        {
            if (entry.Target is Tree child)
            {
                Walk(child, prefix + entry.Name + "/", files);
            }
            else if (entry.Target is Blob blob)
            {
                files[prefix + entry.Name] = blob.GetContentText();
            }
        }
    }

    /// <summary>Çıplak depoyu klonlar, <paramref name="change"/> ile çalışma kopyasını değiştirir, commit'ler ve gönderir.</summary>
    private void RemoteCommit(string bare, Action<string> change)
    {
        var work = TempDir();
        Repository.Clone(bare, work, new CloneOptions { BranchName = "main" });
        change(work);
        using var repo = new Repository(work);
        Commands.Stage(repo, "*");
        var sig = new Signature("Uzak Kişi", "uzak@example.com", DateTimeOffset.UtcNow);
        repo.Commit("uzakta düzenleme", sig, sig);
        repo.Network.Push(repo.Network.Remotes["origin"], "refs/heads/main:refs/heads/main");
    }

    private void RemoteEdit(string bare, string path, Func<string, string> edit) =>
        RemoteCommit(bare, work =>
        {
            var file = Path.Combine(work, path);
            File.WriteAllText(file, edit(File.ReadAllText(file)));
        });

    private static async Task<ApiRequestDto> RequestAsync(User user, Guid id) =>
        (await user.Client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{id}"))!;

    private static async Task<HttpResponseMessage> EditUrlAsync(User user, Guid id, string url)
    {
        var r = await RequestAsync(user, id);
        return await user.Client.PutAsJsonAsync($"/api/requests/{id}", new UpdateApiRequestRequest(r.Name, r.Definition with { Url = url }, r.Version));
    }

    [Fact]
    public async Task Connect_ValidatesAddress_AndNeverReturnsToken()
    {
        var s = await SetupAsync();
        var bare = BareRepo();

        Assert.Equal(HttpStatusCode.BadRequest, (await ConnectAsync(s.Admin, s.CollectionId, "http://10.1.2.3/r.git")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ConnectAsync(s.Admin, s.CollectionId, "https://10.1.2.3/r.git")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ConnectAsync(s.Admin, s.CollectionId, "https://kullanici:sifre@github.com/o/r.git")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ConnectAsync(s.Admin, s.CollectionId, "git@github.com:o/r.git")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ConnectAsync(s.Admin, s.CollectionId, bare, branch: "../x")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await ConnectAsync(s.Admin, s.CollectionId, bare, path: "../disari")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await ConnectAsync(s.Editor, s.CollectionId, bare)).StatusCode);

        var json = await (await ConnectAsync(s.Admin, s.CollectionId, bare)).Content.ReadAsStringAsync();
        Assert.DoesNotContain("ghp_super_secret_token", json);
        var dto = JsonSerializer.Deserialize<GitSyncDto>(json, WebJson)!;
        Assert.True(dto.HasToken);
        Assert.Equal("apivator", dto.FolderPath);

        var seen = await s.Editor.Client.GetStringAsync($"/api/collections/{s.CollectionId}/git");
        Assert.DoesNotContain("ghp_super_secret_token", seen);

        var again = await (await ConnectAsync(s.Admin, s.CollectionId, bare, token: null)).ReadAsync<GitSyncDto>();
        Assert.True(again.HasToken);
        var cleared = await (await s.Admin.Client.PutAsJsonAsync($"/api/collections/{s.CollectionId}/git", new ConnectGitRequest(bare, "main", null, null, null, true))).ReadAsync<GitSyncDto>();
        Assert.False(cleared.HasToken);

        Assert.Equal(HttpStatusCode.Forbidden, (await s.Editor.Client.DeleteAsync($"/api/collections/{s.CollectionId}/git")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await s.Admin.Client.DeleteAsync($"/api/collections/{s.CollectionId}/git")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await s.Admin.Client.GetAsync($"/api/collections/{s.CollectionId}/git")).StatusCode);
    }

    [Fact]
    public async Task Push_WritesFiles_WithoutSecrets_AndIsIdempotent()
    {
        var s = await SetupAsync();
        var bare = BareRepo();
        await ConnectedAsync(s, bare);

        var result = await PushAsync(s.Editor, s.CollectionId, "ilk gönderim");

        Assert.False(result.NoChanges);
        Assert.Equal(0, result.Status.Ahead);
        Assert.Equal(result.Commit, result.Status.LastCommit);
        var files = RepoFiles(bare);
        Assert.Equal(
            ["apivator/Kullanıcılar/Getir.request.json", "apivator/Kullanıcılar/folder.json", "apivator/Listele.request.json", "apivator/collection.json"],
            files.Keys.Order(StringComparer.Ordinal));
        var all = string.Concat(files.Values);
        Assert.DoesNotContain("ULTRA-GIZLI-TOKEN", all);
        Assert.DoesNotContain("GIZLI-DEGER-123", all);
        Assert.DoesNotContain("SIFRE-XYZ", all);
        Assert.Contains("{{bearerToken}}", files["apivator/collection.json"]);
        Assert.Contains("{{basicPassword}}", files["apivator/Kullanıcılar/Getir.request.json"]);
        Assert.Contains("{{base}}/users/1", files["apivator/Kullanıcılar/Getir.request.json"]);

        using (var repo = new Repository(bare))
        {
            var commit = repo.Branches["main"].Tip;
            Assert.Equal("ilk gönderim", commit.MessageShort);
            Assert.Equal("Düzenleyici", commit.Author.Name);
            Assert.Equal(s.Editor.Email, commit.Author.Email, ignoreCase: true);
        }

        var again = await PushAsync(s.Admin, s.CollectionId);
        Assert.True(again.NoChanges);
        Assert.Null(again.Commit);
    }

    [Fact]
    public async Task Push_SameState_ProducesIdenticalFiles()
    {
        var s = await SetupAsync();
        var bareA = BareRepo();
        var bareB = BareRepo();
        await ConnectedAsync(s, bareA);
        await PushAsync(s.Admin, s.CollectionId);
        await ConnectAsync(s.Admin, s.CollectionId, bareB);
        await PushAsync(s.Admin, s.CollectionId);

        Assert.Equal(RepoFiles(bareA), RepoFiles(bareB));
    }

    [Fact]
    public async Task Pull_AppliesRemoteEdits_KeepingIds_AndSecrets()
    {
        var s = await SetupAsync();
        var bare = BareRepo();
        await ConnectedAsync(s, bare);
        await PushAsync(s.Admin, s.CollectionId);

        RemoteCommit(bare, work =>
        {
            var list = Path.Combine(work, "apivator/Listele.request.json");
            File.WriteAllText(list, File.ReadAllText(list).Replace("{{base}}/users", "{{base}}/people", StringComparison.Ordinal));
            var get = Path.Combine(work, "apivator/Kullanıcılar/Getir.request.json");
            File.WriteAllText(get, File.ReadAllText(get).Replace("\"ali\"", "\"veli\"", StringComparison.Ordinal));
            File.WriteAllText(Path.Combine(work, "apivator/Yeni.request.json"), "{ \"name\": \"Yeni\", \"definition\": { \"method\": \"POST\", \"url\": \"{{base}}/new\" } }");
        });

        var preview = await PreviewAsync(s.Admin, s.CollectionId);
        Assert.Equal(3, preview.Changes.Count);
        Assert.All(preview.Changes, c => Assert.False(c.Conflict));
        Assert.Equal([ForkChangeType.Added, ForkChangeType.Modified, ForkChangeType.Modified], preview.Changes.Select(c => c.Remote!.Value).Order());

        var pulled = await (await PullAsync(s.Editor, s.CollectionId, new PullGitRequest(preview.RemoteHead))).ReadAsync<GitPullResult>();

        Assert.Equal(3, pulled.Applied);
        Assert.Equal(0, pulled.Status.Behind);
        Assert.Equal(0, pulled.Status.Ahead);
        Assert.Equal("{{base}}/people", (await RequestAsync(s.Admin, s.List.Id)).Definition.Url);
        var get = await RequestAsync(s.Admin, s.Get.Id);
        Assert.Equal(("veli", "SIFRE-XYZ"), (get.Definition.Auth.BasicUsername, get.Definition.Auth.BasicPassword));
        var tree = (await s.Admin.Client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{s.WorkspaceId}/collections"))!.Single(t => t.Id == s.CollectionId);
        Assert.Equal(3, tree.Requests.Count);
        Assert.Contains(tree.Requests, r => r.Name == "Yeni");

        Assert.Empty((await PreviewAsync(s.Admin, s.CollectionId)).Changes);
        // Elle yazılan dosyaya kimlik/sıra eklenir (tek normalleştirme commit'i); ardından değişiklik kalmaz.
        Assert.False((await PushAsync(s.Admin, s.CollectionId)).NoChanges);
        Assert.True((await PushAsync(s.Admin, s.CollectionId)).NoChanges);
    }

    [Fact]
    public async Task Pull_DetectsConflicts_AndKeepsMine()
    {
        var s = await SetupAsync();
        var bare = BareRepo();
        await ConnectedAsync(s, bare);
        await PushAsync(s.Admin, s.CollectionId);

        (await EditUrlAsync(s.Admin, s.List.Id, "{{base}}/yerel")).EnsureSuccessStatusCode();
        (await EditUrlAsync(s.Admin, s.Get.Id, "{{base}}/yerel-getir")).EnsureSuccessStatusCode();
        RemoteEdit(bare, "apivator/Listele.request.json", t => t.Replace("{{base}}/users", "{{base}}/uzak", StringComparison.Ordinal));

        Assert.Equal(HttpStatusCode.Conflict, (await s.Admin.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest())).StatusCode);

        var preview = await PreviewAsync(s.Admin, s.CollectionId);
        var change = Assert.Single(preview.Changes);
        Assert.True(change.Conflict);
        Assert.Equal("Listele", change.Name);
        Assert.Contains("yerel", change.Mine);
        Assert.Contains("uzak", change.Theirs);

        Assert.Equal(HttpStatusCode.Conflict, (await PullAsync(s.Admin, s.CollectionId, new PullGitRequest(preview.RemoteHead))).StatusCode);
        Assert.Equal("{{base}}/yerel", (await RequestAsync(s.Admin, s.List.Id)).Definition.Url);

        var mine = await (await PullAsync(s.Admin, s.CollectionId, new PullGitRequest(preview.RemoteHead, new Dictionary<string, string> { [change.Key] = "mine" }))).ReadAsync<GitPullResult>();
        Assert.Equal(0, mine.Applied);
        Assert.Equal("{{base}}/yerel", (await RequestAsync(s.Admin, s.List.Id)).Definition.Url);
        Assert.Equal(2, mine.Status.Ahead);

        var pushed = await PushAsync(s.Admin, s.CollectionId, "yerel kazandı");
        Assert.False(pushed.NoChanges);
        Assert.Contains("{{base}}/yerel", RepoFiles(bare)["apivator/Listele.request.json"]);
    }

    [Fact]
    public async Task Pull_Theirs_WinsConflict_AndStaleHeadIsRejected()
    {
        var s = await SetupAsync();
        var bare = BareRepo();
        await ConnectedAsync(s, bare);
        await PushAsync(s.Admin, s.CollectionId);
        (await EditUrlAsync(s.Admin, s.List.Id, "{{base}}/yerel")).EnsureSuccessStatusCode();
        RemoteEdit(bare, "apivator/Listele.request.json", t => t.Replace("{{base}}/users", "{{base}}/uzak", StringComparison.Ordinal));
        var preview = await PreviewAsync(s.Admin, s.CollectionId);
        var key = preview.Changes.Single().Key;

        Assert.Equal(HttpStatusCode.Conflict, (await PullAsync(s.Admin, s.CollectionId, new PullGitRequest("eski-bir-commit", new Dictionary<string, string> { [key] = "theirs" }))).StatusCode);

        (await PullAsync(s.Admin, s.CollectionId, new PullGitRequest(preview.RemoteHead, new Dictionary<string, string> { [key] = "theirs" }))).EnsureSuccessStatusCode();
        Assert.Equal("{{base}}/uzak", (await RequestAsync(s.Admin, s.List.Id)).Definition.Url);
    }

    [Fact]
    public async Task Pull_RemoteDeletion_RemovesRequest()
    {
        var s = await SetupAsync();
        var bare = BareRepo();
        await ConnectedAsync(s, bare);
        await PushAsync(s.Admin, s.CollectionId);

        RemoteCommit(bare, work => File.Delete(Path.Combine(work, "apivator/Listele.request.json")));

        var change = Assert.Single((await PreviewAsync(s.Admin, s.CollectionId)).Changes);
        Assert.Equal(ForkChangeType.Removed, change.Remote);
        (await PullAsync(s.Admin, s.CollectionId, new PullGitRequest())).EnsureSuccessStatusCode();
        var tree = (await s.Admin.Client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{s.WorkspaceId}/collections"))!.Single(t => t.Id == s.CollectionId);
        Assert.Equal(["Getir"], tree.Requests.Select(r => r.Name));
    }

    [Fact]
    public async Task Viewer_CannotPushOrPull_ButCanSeeStatus()
    {
        var s = await SetupAsync();
        await ConnectedAsync(s, BareRepo());

        Assert.Equal(HttpStatusCode.Forbidden, (await s.Viewer.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest())).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await s.Viewer.Client.PostAsync($"/api/collections/{s.CollectionId}/git/pull/preview", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await PullAsync(s.Viewer, s.CollectionId, new PullGitRequest())).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await s.Viewer.Client.GetAsync($"/api/collections/{s.CollectionId}/git")).StatusCode);

        var stranger = await UserAsync("Yabancı");
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.Client.GetAsync($"/api/collections/{s.CollectionId}/git")).StatusCode);
    }

    [Fact]
    public async Task Operations_AreAudited()
    {
        var s = await SetupAsync();
        var bare = BareRepo();
        await ConnectedAsync(s, bare);
        await PushAsync(s.Editor, s.CollectionId);
        RemoteEdit(bare, "apivator/Listele.request.json", t => t.Replace("{{base}}/users", "{{base}}/uzak", StringComparison.Ordinal));
        (await PullAsync(s.Editor, s.CollectionId, new PullGitRequest())).EnsureSuccessStatusCode();
        (await s.Admin.Client.DeleteAsync($"/api/collections/{s.CollectionId}/git")).EnsureSuccessStatusCode();

        var page = (await s.Admin.Client.GetFromJsonAsync<AuditPageDto>($"/api/organizations/{s.OrgId}/audit?limit=200&action=git"))!;
        Assert.Equal(["git.connected", "git.pushed", "git.pulled", "git.disconnected"], page.Items.Select(e => e.Action).Reverse());
        var pushed = page.Items.Single(e => e.Action == "git.pushed");
        Assert.Equal("Düzenleyici", pushed.ActorName);
        Assert.Equal("Kullanıcılar API", pushed.TargetName);
        Assert.Equal(s.WorkspaceId, pushed.WorkspaceId);
        Assert.DoesNotContain("ghp_super_secret_token", JsonSerializer.Serialize(page));
    }

    [Fact]
    public async Task InvalidRemoteFiles_AreReported_AndStatusKeepsError()
    {
        var s = await SetupAsync();
        var bare = BareRepo();
        await ConnectedAsync(s, bare);
        await PushAsync(s.Admin, s.CollectionId);
        RemoteEdit(bare, "apivator/Listele.request.json", _ => "{ bozuk json");

        var response = await s.Admin.Client.PostAsync($"/api/collections/{s.CollectionId}/git/pull/preview", null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var status = await s.Admin.Client.GetFromJsonAsync<GitSyncDto>($"/api/collections/{s.CollectionId}/git");
        Assert.Contains("Listele.request.json", status!.LastError);
    }

    [Fact]
    public async Task MissingRepository_SurfacesError()
    {
        var s = await SetupAsync();
        (await ConnectAsync(s.Admin, s.CollectionId, Path.Combine(Path.GetTempPath(), "apivator-yok-" + Guid.NewGuid().ToString("N")))).EnsureSuccessStatusCode();

        var push = await s.Admin.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest());

        Assert.Equal(HttpStatusCode.BadRequest, push.StatusCode);
        Assert.NotNull((await s.Admin.Client.GetFromJsonAsync<GitSyncDto>($"/api/collections/{s.CollectionId}/git"))!.LastError);
    }

    [Fact]
    public async Task Scheduler_ChecksRemote_AndReportsBehind()
    {
        var s = await SetupAsync();
        var bare = BareRepo();
        await ConnectedAsync(s, bare);
        await PushAsync(s.Admin, s.CollectionId);
        RemoteEdit(bare, "apivator/Listele.request.json", t => t.Replace("{{base}}/users", "{{base}}/uzak", StringComparison.Ordinal));

        (await s.Editor.Client.PutAsJsonAsync($"/api/collections/{s.CollectionId}/git/schedule", new SetGitScheduleRequest(1))).EnsureSuccessStatusCode();
        await factory.Services.GetRequiredService<Apivator.Infrastructure.GitSync.GitCheckScheduler>().RunDueAsync();

        var status = (await s.Admin.Client.GetFromJsonAsync<GitSyncDto>($"/api/collections/{s.CollectionId}/git"))!;
        Assert.Equal(1, status.Behind);
        Assert.NotNull(status.LastCheckedAt);
        Assert.Equal(HttpStatusCode.BadRequest, (await s.Editor.Client.PutAsJsonAsync($"/api/collections/{s.CollectionId}/git/schedule", new SetGitScheduleRequest(5))).StatusCode);
    }

    private static string EmptyAdvertisement()
    {
        static string Pkt(string text) => (text.Length + 4).ToString("x4", System.Globalization.CultureInfo.InvariantCulture) + text;
        return Pkt("# service=git-upload-pack\n") + "0000"
            + Pkt(new string('0', 40) + " capabilities^{}\0multi_ack side-band-64k ofs-delta agent=test\n") + "0000";
    }

    /// <summary>127.0.0.1 üzerinde (Proxy:AllowedNetworks izinli) tek istekliğine yanıt veren sahte git sunucusu.</summary>
    private static (string Url, Task<string?> Auth, IDisposable Stop) FakeGitServer(Func<HttpListenerResponse, string> respond)
    {
        var port = Random.Shared.Next(20000, 40000);
        var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        var auth = Task.Run(async () =>
        {
            var context = await listener.GetContextAsync();
            var header = context.Request.Headers["Authorization"];
            var body = System.Text.Encoding.UTF8.GetBytes(respond(context.Response));
            context.Response.ContentType = "application/x-git-upload-pack-advertisement";
            await context.Response.OutputStream.WriteAsync(body);
            context.Response.Close();
            return header;
        });
        return ($"http://127.0.0.1:{port}/repo.git", auth, new Stopper(listener));
    }

    private sealed class Stopper(HttpListener listener) : IDisposable
    {
        public void Dispose() => listener.Close();
    }

    [Fact]
    public async Task Transport_ReadsThroughGuardedClient_WithBasicAuth()
    {
        factory.CreateClient().Dispose();
        var remote = factory.Services.GetRequiredService<IGitRemote>();
        var (url, auth, stop) = FakeGitServer(_ => EmptyAdvertisement());
        using var server = stop;

        var tree = await remote.ReadAsync(new GitRemoteSpec(url, "main", "ali", "tok-123"), "apivator");

        Assert.Null(tree.Head);
        Assert.Empty(tree.Files);
        Assert.Equal("Basic " + Convert.ToBase64String("ali:tok-123"u8.ToArray()), await auth);
    }

    [Fact]
    public async Task Transport_RejectsRedirectToBlockedAddress()
    {
        factory.CreateClient().Dispose();
        var remote = factory.Services.GetRequiredService<IGitRemote>();
        var (url, _, stop) = FakeGitServer(response =>
        {
            response.StatusCode = 302;
            response.Headers["Location"] = "http://10.9.9.9/ic-ag.git/info/refs?service=git-upload-pack";
            return string.Empty;
        });
        using var server = stop;

        var error = await Assert.ThrowsAsync<GitRemoteException>(() => remote.ReadAsync(new GitRemoteSpec(url, "main", null, null), "apivator"));

        Assert.Contains("izin verilmiyor", error.Message);
    }

    [Fact]
    public async Task Transport_RejectsBlockedAddress_EvenWithoutPreCheck()
    {
        factory.CreateClient().Dispose();
        var remote = factory.Services.GetRequiredService<IGitRemote>();

        var error = await Assert.ThrowsAsync<GitRemoteException>(() => remote.ReadAsync(new GitRemoteSpec("https://10.1.2.3/r.git", "main", null, null), "apivator"));

        Assert.Contains("izin verilmiyor", error.Message);
    }
}
