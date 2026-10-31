using System.Net;
using System.Net.Http.Json;
using Apivator.Application.Activity;
using Apivator.Application.Collections;
using Apivator.Application.Comments;
using Apivator.Application.Environments;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Activity;
using Apivator.Domain.Collections;
using Apivator.Domain.Comments;
using Apivator.Domain.Organizations;
using Apivator.Domain.Variables;
using Apivator.Domain.Workspaces;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public sealed class ActivityTests(ApivatorApiFactory factory)
{
    private sealed record User(HttpClient Client, Guid Id, string Email);

    private async Task<User> UserAsync(string name)
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email, name);
        client.WithBearer(auth.AccessToken);
        return new User(client, auth.User.Id, email);
    }

    /// <summary>Sahip + verilen roldeki üye, ortak "Genel" workspace'i ve içinde bir istek.</summary>
    private async Task<(User Owner, User Member, WorkspaceDto Workspace, CollectionTreeDto Collection, ApiRequestDto Request)> SetupAsync(WorkspaceRole memberRole = WorkspaceRole.Editor)
    {
        var owner = await UserAsync("Ayşe");
        var org = await (await owner.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest("Geçmiş A.Ş."))).ReadAsync<OrganizationDto>();
        var general = (await owner.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.Single(w => w.OrganizationId == org.Id);
        var member = await UserAsync("Mert");
        await (await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(member.Email, OrganizationRole.Member, general.Id, memberRole))).ReadAsync<InvitationDto>();
        var token = TestHelpers.QueryValue(factory.Emails.LastTo(member.Email).TextBody, "token");
        await (await member.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();

        var collection = await (await owner.Client.PostAsJsonAsync($"/api/workspaces/{general.Id}/collections", new CreateCollectionRequest("Ödeme"))).ReadAsync<CollectionTreeDto>();
        var request = await (await owner.Client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Liste", null, new RequestDefinition { Url = "https://x.test/v1" }))).ReadAsync<ApiRequestDto>();
        return (owner, member, general, collection, request);
    }

    private static async Task<ApiRequestDto> SaveAsync(User user, ApiRequestDto request, string name, string url) =>
        await (await user.Client.PutAsJsonAsync($"/api/requests/{request.Id}", new UpdateApiRequestRequest(name, new RequestDefinition { Url = url }, request.Version))).ReadAsync<ApiRequestDto>();

    [Fact]
    public async Task RequestHistory_RecordsWhoChangedWhat_AndRestoresOldVersion()
    {
        var (owner, member, workspace, _, v1) = await SetupAsync();
        var v2 = await SaveAsync(member, v1, "Liste", "https://x.test/v2");
        var v3 = await SaveAsync(owner, v2, "Ödeme listesi", "https://x.test/v2");

        var versions = (await owner.Client.GetFromJsonAsync<List<VersionDto<RequestSnapshot>>>($"/api/requests/{v1.Id}/versions"))!;
        Assert.Equal(
            [(ChangeAction.Renamed, "Ayşe", 3), (ChangeAction.Updated, "Mert", 2), (ChangeAction.Created, "Ayşe", 1)],
            versions.Select(v => (v.Action, v.UserName, v.Version!.Value)));
        Assert.Equal("https://x.test/v2", versions[1].Snapshot!.Definition.Url);

        // Görüntülenen sürüm eskiyse geri yükleme reddedilir.
        var created = versions[^1];
        var stale = await member.Client.PostAsJsonAsync($"/api/requests/{v1.Id}/restore", new RestoreVersionRequest(created.Id, v2.Version));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        var restored = await (await member.Client.PostAsJsonAsync($"/api/requests/{v1.Id}/restore", new RestoreVersionRequest(created.Id, v3.Version))).ReadAsync<ApiRequestDto>();
        Assert.Equal(("Liste", "https://x.test/v1", 4), (restored.Name, restored.Definition.Url, restored.Version));

        var feed = await owner.Client.GetFromJsonAsync<ActivityPage>($"/api/workspaces/{workspace.Id}/activity");
        var latest = feed!.Items[0];
        Assert.Equal((ChangeAction.Restored, "v1", "Mert", ChangeTarget.Request), (latest.Action, latest.Detail, latest.UserName, latest.TargetType));
        Assert.Contains(feed.Items, i => i.TargetType == ChangeTarget.Collection && i.Action == ChangeAction.Created);
    }

    [Fact]
    public async Task Rename_IsRecordedWithOldName_AndSortingIsNot()
    {
        var (owner, _, workspace, collection, request) = await SetupAsync();
        await owner.Client.PatchAsJsonAsync($"/api/collections/{collection.Id}", new { name = "Ödemeler" });
        var second = await (await owner.Client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("İkinci", null, null))).ReadAsync<ApiRequestDto>();
        // Sıralama değişikliği (aynı yere taşıma) kayda geçmez.
        await owner.Client.PostAsJsonAsync($"/api/requests/{second.Id}/move", new MoveApiRequestRequest(null, 0));

        var feed = await owner.Client.GetFromJsonAsync<ActivityPage>($"/api/workspaces/{workspace.Id}/activity");
        var renamed = Assert.Single(feed!.Items, i => i.Action == ChangeAction.Renamed);
        Assert.Equal(("Ödemeler", "Ödeme"), (renamed.TargetName, renamed.Detail));
        Assert.DoesNotContain(feed.Items, i => (i.TargetId == second.Id || i.TargetId == request.Id) && i.Action == ChangeAction.Moved);
    }

    [Fact]
    public async Task Viewer_ReadsHistory_ButCannotRestore()
    {
        var (owner, viewer, _, _, v1) = await SetupAsync(WorkspaceRole.Viewer);
        var v2 = await SaveAsync(owner, v1, "Liste", "https://x.test/v2");
        var versions = (await viewer.Client.GetFromJsonAsync<List<VersionDto<RequestSnapshot>>>($"/api/requests/{v1.Id}/versions"))!;

        var response = await viewer.Client.PostAsJsonAsync($"/api/requests/{v1.Id}/restore", new RestoreVersionRequest(versions[^1].Id, v2.Version));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        var outsider = await UserAsync("Yabancı");
        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync($"/api/requests/{v1.Id}/versions")).StatusCode);
    }

    [Fact]
    public async Task DeletedRequest_CanBeBroughtBack_OnceWithSameId()
    {
        var (owner, member, workspace, collection, request) = await SetupAsync();
        await SaveAsync(owner, request, "Liste", "https://x.test/son");
        (await member.Client.DeleteAsync($"/api/requests/{request.Id}")).EnsureSuccessStatusCode();

        var feed = await owner.Client.GetFromJsonAsync<ActivityPage>($"/api/workspaces/{workspace.Id}/activity");
        var deleted = feed!.Items[0];
        Assert.Equal((ChangeAction.Deleted, "Mert", true), (deleted.Action, deleted.UserName, deleted.Restorable));

        var back = await (await owner.Client.PostAsync($"/api/activity/{deleted.Id}/restore", null)).ReadAsync<ApiRequestDto>();
        Assert.Equal((request.Id, collection.Id, "https://x.test/son"), (back.Id, back.CollectionId, back.Definition.Url));
        Assert.Equal(HttpStatusCode.Conflict, (await owner.Client.PostAsync($"/api/activity/{deleted.Id}/restore", null)).StatusCode);
    }

    [Fact]
    public async Task CopyingACollection_ShowsOneEntry_NotOnePerRequest()
    {
        var (owner, _, workspace, collection, _) = await SetupAsync();
        await owner.Client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("İkinci", null, null));
        var copy = await (await owner.Client.PostAsJsonAsync($"/api/collections/{collection.Id}/duplicate", new { })).ReadAsync<CollectionTreeDto>();

        var feed = await owner.Client.GetFromJsonAsync<ActivityPage>($"/api/workspaces/{workspace.Id}/activity");
        Assert.Single(feed!.Items, i => i.CollectionId == copy.Id);

        // Ama kopyalanan isteğin kendi geçmişi oluştu sürümüyle başlar.
        var tree = (await owner.Client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspace.Id}/collections"))!.Single(c => c.Id == copy.Id);
        Assert.Equal(2, tree.Requests.Count);
        var history = await owner.Client.GetFromJsonAsync<List<VersionDto<RequestSnapshot>>>($"/api/requests/{tree.Requests[0].Id}/versions");
        Assert.Equal(ChangeAction.Created, Assert.Single(history!).Action);
    }

    [Fact]
    public async Task Environment_CanBeRestored()
    {
        var (owner, _, workspace, _, _) = await SetupAsync();
        var env = await (await owner.Client.PostAsJsonAsync($"/api/workspaces/{workspace.Id}/environments", new CreateEnvironmentRequest("Test", [new Variable("baseUrl", "https://test")]))).ReadAsync<EnvironmentDto>();
        var changed = await (await owner.Client.PutAsJsonAsync($"/api/environments/{env.Id}", new UpdateEnvironmentRequest("Test", [new Variable("baseUrl", "https://yanlis")], env.Version))).ReadAsync<EnvironmentDto>();

        var versions = (await owner.Client.GetFromJsonAsync<List<VersionDto<EnvironmentSnapshot>>>($"/api/environments/{env.Id}/versions"))!;
        var restored = await (await owner.Client.PostAsJsonAsync($"/api/environments/{env.Id}/restore", new RestoreVersionRequest(versions[^1].Id, changed.Version))).ReadAsync<EnvironmentDto>();
        Assert.Equal("https://test", restored.Variables[0].Value);
    }

    [Fact]
    public async Task Comments_MentionAndReply_NotifyTheRightPeople()
    {
        var (owner, viewer, workspace, _, request) = await SetupAsync(WorkspaceRole.Viewer);
        var outsider = await UserAsync("Yabancı");

        // Görüntüleyici de yorum yazabilir; erişimi olmayan kişiden bahsetmek bildirim üretmez.
        var body = $"@[Ayşe]({owner.Id}) bu URL eski mi? @[Yabancı]({outsider.Id})";
        var root = await (await viewer.Client.PostAsJsonAsync("/api/comments", new CreateCommentRequest(CommentTarget.Request, request.Id, body))).ReadAsync<CommentDto>();
        Assert.Equal("Mert", root.AuthorName);

        var ownerNotifications = await owner.Client.GetFromJsonAsync<NotificationsDto>("/api/me/notifications");
        var mention = Assert.Single(ownerNotifications!.Items);
        Assert.Equal((NotificationKind.Mention, "Mert", "Liste", 1), (mention.Kind, mention.ActorName, mention.TargetName, ownerNotifications.Unread));
        Assert.StartsWith("@Ayşe bu URL eski mi?", mention.Preview, StringComparison.Ordinal);
        Assert.Contains("comments=1", factory.Emails.LastTo(owner.Email).TextBody, StringComparison.Ordinal);
        Assert.Empty((await outsider.Client.GetFromJsonAsync<NotificationsDto>("/api/me/notifications"))!.Items);

        await (await owner.Client.PostAsJsonAsync("/api/comments", new CreateCommentRequest(CommentTarget.Request, request.Id, "Evet, v2'ye geçtik.", root.Id))).ReadAsync<CommentDto>();
        var reply = Assert.Single((await viewer.Client.GetFromJsonAsync<NotificationsDto>("/api/me/notifications"))!.Items);
        Assert.Equal(NotificationKind.Reply, reply.Kind);

        var counts = await owner.Client.GetFromJsonAsync<List<CommentCountDto>>($"/api/workspaces/{workspace.Id}/comment-counts");
        Assert.Equal(2, Assert.Single(counts!).Open);
        (await viewer.Client.PostAsJsonAsync($"/api/comments/{root.Id}/resolve", new ResolveCommentRequest(true))).EnsureSuccessStatusCode();
        Assert.Empty((await owner.Client.GetFromJsonAsync<List<CommentCountDto>>($"/api/workspaces/{workspace.Id}/comment-counts"))!);

        await owner.Client.PostAsJsonAsync("/api/me/notifications/read", new MarkNotificationsReadRequest(null));
        Assert.Equal(0, (await owner.Client.GetFromJsonAsync<NotificationsDto>("/api/me/notifications"))!.Unread);

        Assert.Equal(HttpStatusCode.NotFound, (await outsider.Client.GetAsync($"/api/comments?targetType=Request&targetId={request.Id}")).StatusCode);
        var thread = await viewer.Client.GetFromJsonAsync<List<CommentDto>>($"/api/comments?targetType=Request&targetId={request.Id}");
        Assert.Equal(2, thread!.Count);
        Assert.Equal((true, true, false, false), (thread[0].CanEdit, thread[0].CanDelete, thread[1].CanEdit, thread[1].CanDelete));
    }

    [Fact]
    public async Task OnlyAuthorEdits_AdminCanDeleteAnyComment()
    {
        var (owner, member, _, _, request) = await SetupAsync();
        var comment = await (await member.Client.PostAsJsonAsync("/api/comments", new CreateCommentRequest(CommentTarget.Request, request.Id, "İlk"))).ReadAsync<CommentDto>();

        Assert.Equal(HttpStatusCode.Forbidden, (await owner.Client.PatchAsJsonAsync($"/api/comments/{comment.Id}", new EditCommentRequest("Değişti"))).StatusCode);
        var edited = await (await member.Client.PatchAsJsonAsync($"/api/comments/{comment.Id}", new EditCommentRequest($"Düzeltme @[Ayşe]({owner.Id})"))).ReadAsync<CommentDto>();
        Assert.NotNull(edited.EditedAt);
        // Düzenlemede eklenen bahsetme de bildirilir.
        Assert.Single((await owner.Client.GetFromJsonAsync<NotificationsDto>("/api/me/notifications"))!.Items);

        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.DeleteAsync($"/api/comments/{comment.Id}")).StatusCode);
    }

    [Fact]
    public async Task Comments_MentionEmail_FollowsRecipientThenOrganizationLanguage()
    {
        var (owner, member, workspace, _, request) = await SetupAsync();
        var orgId = workspace.OrganizationId;
        Task Mention() => member.Client.PostAsJsonAsync("/api/comments", new CreateCommentRequest(CommentTarget.Request, request.Id, $"@[Ayşe]({owner.Id}) bakar mısın?"));

        // Tercih de organizasyon dili de yok: Türkçe.
        await Mention();
        Assert.Contains("bir yorumda sizden bahsetti", factory.Emails.LastTo(owner.Email).Subject, StringComparison.Ordinal);

        // Tercih yok, organizasyonun varsayılan dili İngilizce: İngilizce.
        Assert.Equal(HttpStatusCode.NoContent, (await owner.Client.PutAsJsonAsync($"/api/organizations/{orgId}/language", new SetOrganizationLanguageRequest("en"))).StatusCode);
        await Mention();
        Assert.Contains("mentioned you in a comment", factory.Emails.LastTo(owner.Email).Subject, StringComparison.Ordinal);
        Assert.Contains("lang=\"en\"", factory.Emails.LastTo(owner.Email).HtmlBody, StringComparison.Ordinal);

        // Alıcının kayıtlı dili organizasyonunkinden önce gelir.
        var preferences = new Apivator.Application.Account.PreferencesDto("system", null, true, true, true, "tr");
        await (await owner.Client.PutAsJsonAsync("/api/me/preferences", preferences)).ReadAsync<Apivator.Application.Account.PreferencesDto>();
        await Mention();
        Assert.Contains("bir yorumda sizden bahsetti", factory.Emails.LastTo(owner.Email).Subject, StringComparison.Ordinal);
    }
}
