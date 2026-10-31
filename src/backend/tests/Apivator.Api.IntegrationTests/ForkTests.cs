using System.Net;
using System.Net.Http.Json;
using Apivator.Application.Account;
using Apivator.Application.Auth;
using Apivator.Application.Collections;
using Apivator.Application.Comments;
using Apivator.Application.Examples;
using Apivator.Application.Forks;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Comments;
using Apivator.Domain.Forks;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class ForkTests(ApivatorApiFactory factory)
{
    private sealed record User(HttpClient Client, Guid Id, string Email, Guid PersonalWorkspaceId);

    private sealed record Source(Guid CollectionId, Guid FolderId, ApiRequestDto List, ApiRequestDto Get);

    private async Task<User> UserAsync(string name = "Test Kullanıcı")
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email, name);
        client.WithBearer(auth.AccessToken);
        var workspaces = await client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces");
        return new User(client, auth.User.Id, email, workspaces!.Single().Id);
    }

    /// <summary>"Kullanıcılar API": kökte "Listele", "Kullanıcılar" klasöründe "Getir" (bir örnekle).</summary>
    private static async Task<Source> SourceAsync(User owner, Guid workspaceId)
    {
        var c = owner.Client;
        var collection = await (await c.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("Kullanıcılar API"))).ReadAsync<CollectionTreeDto>();
        var folder = await (await c.PostAsJsonAsync($"/api/collections/{collection.Id}/folders", new CreateFolderRequest("Kullanıcılar", null))).ReadAsync<FolderDto>();
        var list = await (await c.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Listele", null, new RequestDefinition { Url = "{{base}}/users" }))).ReadAsync<ApiRequestDto>();
        var get = await (await c.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Getir", folder.Id, new RequestDefinition { Url = "{{base}}/users/1" }))).ReadAsync<ApiRequestDto>();
        await c.PostAsJsonAsync($"/api/requests/{get.Id}/examples", new CreateExampleRequest("Bulundu", 200, [], "{\"id\":1}", null));
        return new Source(collection.Id, folder.Id, list, get);
    }

    private static async Task<CollectionTreeDto> TreeAsync(User user, Guid workspaceId, Guid collectionId) =>
        (await user.Client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single(t => t.Id == collectionId);

    private static async Task<ForkInfoDto> ForkAsync(User user, Guid sourceCollectionId, Guid targetWorkspaceId) =>
        await (await user.Client.PostAsJsonAsync($"/api/collections/{sourceCollectionId}/forks", new CreateForkRequest(targetWorkspaceId))).ReadAsync<ForkInfoDto>();

    private static async Task<ForkComparisonDto> CompareAsync(User user, ForkInfoDto fork) =>
        (await user.Client.GetFromJsonAsync<ForkComparisonDto>($"/api/forks/{fork.Id}/compare"))!;

    private static async Task<ApiRequestDto> RequestByNameAsync(User user, Guid workspaceId, Guid collectionId, string name)
    {
        var tree = await TreeAsync(user, workspaceId, collectionId);
        return (await user.Client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{tree.Requests.Single(r => r.Name == name).Id}"))!;
    }

    private static Task<HttpResponseMessage> EditUrlAsync(User user, ApiRequestDto request, string url, string? name = null) =>
        user.Client.PutAsJsonAsync($"/api/requests/{request.Id}", new UpdateApiRequestRequest(name ?? request.Name, request.Definition with { Url = url }, request.Version));

    [Fact]
    public async Task Fork_CopiesEverything_AndStartsInSync()
    {
        var a = await UserAsync();
        var source = await SourceAsync(a, a.PersonalWorkspaceId);

        var fork = await ForkAsync(a, source.CollectionId, a.PersonalWorkspaceId);

        Assert.Equal("Kullanıcılar API (fork)", fork.ForkName);
        Assert.Equal("Kullanıcılar API", fork.SourceName);
        var tree = await TreeAsync(a, a.PersonalWorkspaceId, fork.ForkCollectionId);
        Assert.Equal(["Getir", "Listele"], tree.Requests.Select(r => r.Name).Order());
        Assert.Equal("Kullanıcılar", tree.Folders.Single().Name);
        Assert.Equal(tree.Folders.Single().Id, tree.Requests.Single(r => r.Name == "Getir").FolderId);
        Assert.Single(tree.Examples);
        Assert.Empty((await CompareAsync(a, fork)).Changes);

        var links = await a.Client.GetFromJsonAsync<List<ForkInfoDto>>($"/api/collections/{source.CollectionId}/forks");
        Assert.Equal([fork.Id], links!.Select(f => f.Id));
        var badges = await a.Client.GetFromJsonAsync<List<ForkInfoDto>>($"/api/workspaces/{a.PersonalWorkspaceId}/forks");
        Assert.Equal([fork.ForkCollectionId], badges!.Select(f => f.ForkCollectionId));
    }

    [Fact]
    public async Task ForkChanges_AreMergedIntoTheSource()
    {
        var a = await UserAsync();
        var source = await SourceAsync(a, a.PersonalWorkspaceId);
        var fork = await ForkAsync(a, source.CollectionId, a.PersonalWorkspaceId);
        var ws = a.PersonalWorkspaceId;

        // Fork'ta: bir isteği değiştir, birini sil, yeni klasörün içine yeni istek ekle, örneği değiştir.
        var forkGet = await RequestByNameAsync(a, ws, fork.ForkCollectionId, "Getir");
        await EditUrlAsync(a, forkGet, "{{base}}/v2/users/1", "Kullanıcı getir");
        var forkList = await RequestByNameAsync(a, ws, fork.ForkCollectionId, "Listele");
        await a.Client.DeleteAsync($"/api/requests/{forkList.Id}");
        var admin = await (await a.Client.PostAsJsonAsync($"/api/collections/{fork.ForkCollectionId}/folders", new CreateFolderRequest("Yönetim", null))).ReadAsync<FolderDto>();
        await a.Client.PostAsJsonAsync($"/api/collections/{fork.ForkCollectionId}/requests", new CreateApiRequestRequest("Sil", admin.Id, new RequestDefinition { Method = "DELETE", Url = "{{base}}/users/1" }));
        var forkExample = (await a.Client.GetFromJsonAsync<List<ExampleDto>>($"/api/requests/{forkGet.Id}/examples"))!.Single();
        await a.Client.PatchAsJsonAsync($"/api/examples/{forkExample.Id}", new UpdateExampleRequest(null, null, null, "{\"id\":1,\"ad\":\"Ayşe\"}"));

        var comparison = await CompareAsync(a, fork);
        Assert.Equal(4, comparison.Outgoing);
        Assert.Equal(0, comparison.Incoming);
        Assert.Equal(
            [(ForkItemKind.Folder, "Yönetim", ForkChangeType.Added), (ForkItemKind.Request, "Kullanıcı getir", ForkChangeType.Modified),
             (ForkItemKind.Request, "Listele", ForkChangeType.Removed), (ForkItemKind.Request, "Sil", ForkChangeType.Added)],
            comparison.Changes.Select(c => (c.Kind, c.Name, c.ForkChange!.Value)).OrderBy(x => x.Kind).ThenBy(x => x.Name, StringComparer.Ordinal));

        var mr = await (await a.Client.PostAsJsonAsync($"/api/forks/{fork.Id}/merge-requests", new CreateMergeRequestBody("v2 adresleri", "Getir v2'ye geçti"))).ReadAsync<MergeRequestDto>();
        Assert.True(mr.CanMerge);
        var detail = (await a.Client.GetFromJsonAsync<MergeRequestDetailDto>($"/api/merge-requests/{mr.Id}"))!;
        Assert.Equal(4, detail.Changes.Count);
        var modified = detail.Changes.Single(c => c.ForkChange == ForkChangeType.Modified);
        Assert.Equal("{{base}}/users/1", modified.Base!.Definition!.Url);
        Assert.Equal("{{base}}/v2/users/1", modified.Fork!.Definition!.Url);

        var merged = await (await a.Client.PostAsync($"/api/merge-requests/{mr.Id}/merge", null)).ReadAsync<MergeRequestDto>();

        Assert.Equal(MergeRequestStatus.Merged, merged.Status);
        Assert.Equal(4, merged.MergedChanges.Count);
        var tree = await TreeAsync(a, ws, source.CollectionId);
        Assert.Equal(["Kullanıcı getir", "Sil"], tree.Requests.Select(r => r.Name).Order());
        Assert.Equal(["Kullanıcılar", "Yönetim"], tree.Folders.Select(f => f.Name).Order());
        Assert.Equal(tree.Folders.Single(f => f.Name == "Yönetim").Id, tree.Requests.Single(r => r.Name == "Sil").FolderId);
        // Değiştirilen istek aynı kimlikle güncellenir (yorumlar ve geçmiş korunur).
        var sourceGet = (await a.Client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{source.Get.Id}"))!;
        Assert.Equal(("Kullanıcı getir", "{{base}}/v2/users/1"), (sourceGet.Name, sourceGet.Definition.Url));
        Assert.Contains("Ayşe", (await a.Client.GetFromJsonAsync<List<ExampleDto>>($"/api/requests/{source.Get.Id}/examples"))!.Single().Body, StringComparison.Ordinal);
        Assert.Empty((await CompareAsync(a, fork)).Changes);
    }

    [Fact]
    public async Task SourceChanges_ArePulledIntoTheFork()
    {
        var a = await UserAsync();
        var ws = a.PersonalWorkspaceId;
        var source = await SourceAsync(a, ws);
        var fork = await ForkAsync(a, source.CollectionId, ws);

        await EditUrlAsync(a, source.List, "{{base}}/users?page=1");
        await a.Client.PostAsJsonAsync($"/api/collections/{source.CollectionId}/requests", new CreateApiRequestRequest("Oluştur", source.FolderId, new RequestDefinition { Method = "POST", Url = "{{base}}/users" }));
        await a.Client.PatchAsJsonAsync($"/api/collections/{source.CollectionId}", new UpdateCollectionRequest(null, "Kullanıcı servisi"));

        var comparison = await CompareAsync(a, fork);
        Assert.Equal((3, 0, 0), (comparison.Incoming, comparison.Outgoing, comparison.Conflicts));

        var after = (await (await a.Client.PostAsJsonAsync($"/api/forks/{fork.Id}/pull", new PullRequestBody())).ReadAsync<ForkComparisonDto>());

        Assert.Empty(after.Changes);
        Assert.NotNull(after.Fork.LastPulledAt);
        var tree = await TreeAsync(a, ws, fork.ForkCollectionId);
        Assert.Equal("Kullanıcı servisi", tree.Description);
        Assert.Equal(tree.Folders.Single().Id, tree.Requests.Single(r => r.Name == "Oluştur").FolderId);
        Assert.Equal("{{base}}/users?page=1", (await RequestByNameAsync(a, ws, fork.ForkCollectionId, "Listele")).Definition.Url);
    }

    [Theory]
    [InlineData("fork")]
    [InlineData("source")]
    public async Task Conflicts_BlockMerge_UntilResolvedByPulling(string winner)
    {
        var a = await UserAsync();
        var ws = a.PersonalWorkspaceId;
        var source = await SourceAsync(a, ws);
        var fork = await ForkAsync(a, source.CollectionId, ws);
        await EditUrlAsync(a, await RequestByNameAsync(a, ws, fork.ForkCollectionId, "Listele"), "{{base}}/fork");
        await EditUrlAsync(a, source.List, "{{base}}/kaynak");

        var comparison = await CompareAsync(a, fork);
        var conflict = Assert.Single(comparison.Changes);
        Assert.True(conflict.Conflict);
        Assert.Equal((ForkChangeType.Modified, ForkChangeType.Modified), (conflict.ForkChange, conflict.SourceChange));

        var mr = await (await a.Client.PostAsJsonAsync($"/api/forks/{fork.Id}/merge-requests", new CreateMergeRequestBody("Çakışan"))).ReadAsync<MergeRequestDto>();
        Assert.Equal(1, (await a.Client.GetFromJsonAsync<MergeRequestDetailDto>($"/api/merge-requests/{mr.Id}"))!.Conflicts);
        Assert.Equal(HttpStatusCode.Conflict, (await a.Client.PostAsync($"/api/merge-requests/{mr.Id}/merge", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await a.Client.PostAsJsonAsync($"/api/forks/{fork.Id}/pull", new PullRequestBody())).StatusCode);

        var pulled = await (await a.Client.PostAsJsonAsync(
            $"/api/forks/{fork.Id}/pull", new PullRequestBody(new Dictionary<string, string> { [conflict.Key] = winner }))).ReadAsync<ForkComparisonDto>();

        var forkUrl = (await RequestByNameAsync(a, ws, fork.ForkCollectionId, "Listele")).Definition.Url;
        if (winner == "fork")
        {
            // Fork'unki kaldı; artık çakışma değil, birleştirilmeyi bekleyen bir değişiklik.
            Assert.Equal("{{base}}/fork", forkUrl);
            var pending = Assert.Single(pulled.Changes);
            Assert.Equal((ForkChangeType.Modified, (ForkChangeType?)null, false), (pending.ForkChange!.Value, pending.SourceChange, pending.Conflict));
            await (await a.Client.PostAsync($"/api/merge-requests/{mr.Id}/merge", null)).ReadAsync<MergeRequestDto>();
            Assert.Equal("{{base}}/fork", (await a.Client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{source.List.Id}"))!.Definition.Url);
        }
        else
        {
            Assert.Equal("{{base}}/kaynak", forkUrl);
            Assert.Empty(pulled.Changes);
            Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PostAsync($"/api/merge-requests/{mr.Id}/merge", null)).StatusCode);
        }
    }

    [Fact]
    public async Task DeletedInForkButChangedInSource_CanBeRestoredFromSource()
    {
        var a = await UserAsync();
        var ws = a.PersonalWorkspaceId;
        var source = await SourceAsync(a, ws);
        var fork = await ForkAsync(a, source.CollectionId, ws);
        await a.Client.DeleteAsync($"/api/folders/{(await TreeAsync(a, ws, fork.ForkCollectionId)).Folders.Single().Id}");
        await EditUrlAsync(a, source.Get, "{{base}}/users/{{id}}");

        var comparison = await CompareAsync(a, fork);
        var conflict = comparison.Changes.Single(c => c.Conflict);
        Assert.Equal((ForkChangeType.Removed, ForkChangeType.Modified), (conflict.ForkChange, conflict.SourceChange));
        var folderRemoval = comparison.Changes.Single(c => c.Kind == ForkItemKind.Folder);

        await (await a.Client.PostAsJsonAsync($"/api/forks/{fork.Id}/pull", new PullRequestBody(new Dictionary<string, string>
        {
            [conflict.Key] = "source",
        }))).ReadAsync<ForkComparisonDto>();

        var tree = await TreeAsync(a, ws, fork.ForkCollectionId);
        Assert.Equal("{{base}}/users/{{id}}", (await RequestByNameAsync(a, ws, fork.ForkCollectionId, "Getir")).Definition.Url);
        // Klasör fork'ta silinmiş kalır (yalnızca fork'un değişikliği): istek köke gelir, klasör hâlâ birleştirilmeyi bekler.
        Assert.Empty(tree.Folders);
        Assert.Contains((await CompareAsync(a, fork)).Changes, c => c.Key == folderRemoval.Key && c.ForkChange == ForkChangeType.Removed);
    }

    [Fact]
    public async Task TeamFlow_ViewerForks_EditorApprovesAndMerges_AuthorIsNotified()
    {
        var owner = await UserAsync("Sahip");
        var org = await (await owner.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest("Ekip"))).ReadAsync<OrganizationDto>();
        var general = (await owner.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.Single(w => w.OrganizationId == org.Id);
        var viewer = await UserAsync("Katkıcı");
        await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(viewer.Email, OrganizationRole.Member, general.Id, WorkspaceRole.Viewer));
        var token = TestHelpers.QueryValue(factory.Emails.LastTo(viewer.Email).TextBody, "token");
        await (await viewer.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();
        var source = await SourceAsync(owner, general.Id);
        var stranger = await UserAsync("Yabancı");

        // Görüntüleyici kaynakta değişiklik yapamaz ama kendi workspace'ine fork'layabilir.
        Assert.Equal(HttpStatusCode.Forbidden, (await EditUrlAsync(viewer, source.List, "x")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.Client.PostAsJsonAsync($"/api/collections/{source.CollectionId}/forks", new CreateForkRequest(stranger.PersonalWorkspaceId))).StatusCode);
        var fork = await ForkAsync(viewer, source.CollectionId, viewer.PersonalWorkspaceId);
        await EditUrlAsync(viewer, await RequestByNameAsync(viewer, viewer.PersonalWorkspaceId, fork.ForkCollectionId, "Listele"), "{{base}}/users?limit=50");
        var mr = await (await viewer.Client.PostAsJsonAsync($"/api/forks/{fork.Id}/merge-requests", new CreateMergeRequestBody("Sayfalama"))).ReadAsync<MergeRequestDto>();
        Assert.False(mr.CanMerge);
        Assert.True(mr.CanClose);
        Assert.Equal(HttpStatusCode.Conflict, (await viewer.Client.PostAsJsonAsync($"/api/forks/{fork.Id}/merge-requests", new CreateMergeRequestBody("İkinci"))).StatusCode);

        // Kaynağın yöneticisine bildirim gider; istek workspace listesinde görünür.
        var ownerNotifications = (await owner.Client.GetFromJsonAsync<NotificationsDto>("/api/me/notifications"))!;
        Assert.Contains(ownerNotifications.Items, n => n.Kind == NotificationKind.MergeRequestOpened && n.TargetId == mr.Id && n.TargetType == CommentTarget.MergeRequest);
        var open = (await owner.Client.GetFromJsonAsync<List<MergeRequestDto>>($"/api/workspaces/{general.Id}/merge-requests?status=Open"))!;
        Assert.Equal([mr.Id], open.Select(m => m.Id));
        Assert.Equal("Kişisel Workspace", open.Single().ForkWorkspaceName);
        var openedMail = factory.Emails.LastTo(owner.Email);
        Assert.Contains("merge isteği açtı: Sayfalama", openedMail.Subject, StringComparison.Ordinal);
        Assert.Contains($"mergeRequest={mr.Id}", openedMail.TextBody, StringComparison.Ordinal);

        // Katkıcı birleştirme e-postalarını kapatır: uygulama içi bildirim yine gelir, e-posta gelmez.
        await (await viewer.Client.PutAsJsonAsync("/api/me/preferences", new PreferencesDto("system", null, true, false, true))).ReadAsync<PreferencesDto>();

        // İstek üzerinde yorum (mevcut yorum sistemi), onay ve birleştirme.
        await viewer.Client.PostAsJsonAsync("/api/comments", new CreateCommentRequest(CommentTarget.MergeRequest, mr.Id, "50 yeterli mi?", null));
        Assert.Single((await owner.Client.GetFromJsonAsync<List<CommentDto>>($"/api/comments?targetType=MergeRequest&targetId={mr.Id}"))!);
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.Client.PostAsync($"/api/merge-requests/{mr.Id}/merge", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await viewer.Client.PostAsync($"/api/merge-requests/{mr.Id}/approve", null)).StatusCode);
        var approved = await (await owner.Client.PostAsync($"/api/merge-requests/{mr.Id}/approve", null)).ReadAsync<MergeRequestDto>();
        Assert.Equal(["Sahip"], approved.Approvals.Select(x => x.Name));
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.Client.GetAsync($"/api/merge-requests/{mr.Id}")).StatusCode);

        var merged = await (await owner.Client.PostAsync($"/api/merge-requests/{mr.Id}/merge", null)).ReadAsync<MergeRequestDto>();

        Assert.Equal((MergeRequestStatus.Merged, "Sahip"), (merged.Status, merged.ClosedByName));
        Assert.Equal("{{base}}/users?limit=50", (await owner.Client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{source.List.Id}"))!.Definition.Url);
        var viewerNotifications = (await viewer.Client.GetFromJsonAsync<NotificationsDto>("/api/me/notifications"))!;
        Assert.Contains(viewerNotifications.Items, n => n.Kind == NotificationKind.MergeRequestMerged && n.TargetId == mr.Id);
        Assert.DoesNotContain(factory.Emails.Sent, m => m.To == viewer.Email && m.Subject.Contains("Sayfalama", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Decline_Close_AndUnlink()
    {
        var a = await UserAsync();
        var ws = a.PersonalWorkspaceId;
        var source = await SourceAsync(a, ws);
        var fork = await ForkAsync(a, source.CollectionId, ws);
        await EditUrlAsync(a, await RequestByNameAsync(a, ws, fork.ForkCollectionId, "Listele"), "{{base}}/x");

        Assert.Equal(HttpStatusCode.BadRequest, (await a.Client.PostAsJsonAsync($"/api/forks/{fork.Id}/merge-requests", new CreateMergeRequestBody(" "))).StatusCode);
        var first = await (await a.Client.PostAsJsonAsync($"/api/forks/{fork.Id}/merge-requests", new CreateMergeRequestBody("Bir"))).ReadAsync<MergeRequestDto>();
        Assert.Equal(MergeRequestStatus.Declined, (await (await a.Client.PostAsync($"/api/merge-requests/{first.Id}/decline", null)).ReadAsync<MergeRequestDto>()).Status);
        Assert.Equal(HttpStatusCode.Conflict, (await a.Client.PostAsync($"/api/merge-requests/{first.Id}/merge", null)).StatusCode);

        var second = await (await a.Client.PostAsJsonAsync($"/api/forks/{fork.Id}/merge-requests", new CreateMergeRequestBody("İki"))).ReadAsync<MergeRequestDto>();
        Assert.Equal(HttpStatusCode.NoContent, (await a.Client.DeleteAsync($"/api/forks/{fork.Id}")).StatusCode);

        var closed = (await a.Client.GetFromJsonAsync<MergeRequestDetailDto>($"/api/merge-requests/{second.Id}"))!;
        Assert.Equal(MergeRequestStatus.Closed, closed.Request.Status);
        Assert.Empty((await a.Client.GetFromJsonAsync<List<ForkInfoDto>>($"/api/collections/{source.CollectionId}/forks"))!);
        // Fork collection'ı bağımsız bir collection olarak kalır.
        Assert.Equal("{{base}}/x", (await RequestByNameAsync(a, ws, fork.ForkCollectionId, "Listele")).Definition.Url);
    }
}
