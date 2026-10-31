using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Channels;
using Apivator.Application.Collections;
using Apivator.Application.Comments;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public sealed class RealtimeTests(ApivatorApiFactory factory)
{
    private sealed record User(HttpClient Client, Guid Id, string Email, string Token);

    /// <summary>Canlı kanal bağlantısı; gelen olaylar ad ve JSON gövde olarak sırayla okunur.</summary>
    private sealed class Live(HubConnection connection) : IAsyncDisposable
    {
        private readonly Channel<(string Name, JsonElement Body)> _events = Channel.CreateUnbounded<(string, JsonElement)>();

        public HubConnection Connection { get; } = connection;

        public void Listen(params string[] names)
        {
            foreach (var name in names)
            {
                Connection.On<JsonElement>(name, body => _events.Writer.TryWrite((name, body)));
            }

            Connection.On("accessChanged", () => _events.Writer.TryWrite(("accessChanged", default)));
            Connection.On("notificationsChanged", () => _events.Writer.TryWrite(("notificationsChanged", default)));
            Connection.On("invitationsChanged", () => _events.Writer.TryWrite(("invitationsChanged", default)));
        }

        /// <summary>Koşula uyan ilk olayı bekler (aradakiler atlanır).</summary>
        public async Task<JsonElement> NextAsync(string name, Func<JsonElement, bool>? match = null)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            while (true)
            {
                var (eventName, body) = await _events.Reader.ReadAsync(timeout.Token);
                if (eventName == name && (match is null || match(body)))
                {
                    return body;
                }
            }
        }

        /// <summary>Kısa bir süre içinde bu adda olay gelmediğini doğrular.</summary>
        public async Task NoneAsync(string name)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(700));
            try
            {
                while (true)
                {
                    var (eventName, _) = await _events.Reader.ReadAsync(timeout.Token);
                    Assert.NotEqual(name, eventName);
                }
            }
            catch (OperationCanceledException)
            {
            }
        }

        public ValueTask DisposeAsync() => Connection.DisposeAsync();
    }

    private async Task<User> UserAsync(string name)
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email, name);
        client.WithBearer(auth.AccessToken);
        return new User(client, auth.User.Id, email, auth.AccessToken);
    }

    /// <summary>Tarayıcı gibi WebSocket kullanır: token sorgu dizgisinde (access_token) gider.</summary>
    private async Task<Live> ConnectAsync(User user)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "hubs/workspace"), options =>
            {
                options.Transports = HttpTransportType.WebSockets;
                options.SkipNegotiation = true;
                options.AccessTokenProvider = () => Task.FromResult<string?>(user.Token);
                // Özel fabrikada .NET istemcisi başlık ekleyemez; tarayıcıdaki gibi sorgu dizgisine konur.
                options.WebSocketFactory = async (context, ct) =>
                {
                    var uri = new UriBuilder(context.Uri);
                    uri.Query = (uri.Query.Length > 1 ? uri.Query[1..] + "&" : string.Empty) + "access_token=" + Uri.EscapeDataString(user.Token);
                    return await factory.Server.CreateWebSocketClient().ConnectAsync(uri.Uri, ct);
                };
            })
            .Build();
        var live = new Live(connection);
        live.Listen("workspaceChanged", "organizationChanged", "presence");
        await connection.StartAsync();
        // Sunucu OnConnectedAsync'i el sıkışmadan sonra çalıştırır; ilk çağrı ondan sonra işlenir (gruplar hazır).
        await connection.InvokeAsync("RefreshGroups");
        return live;
    }

    private async Task<(OrganizationDto Org, WorkspaceDto General, User Member)> TeamAsync(User owner, WorkspaceRole memberRole = WorkspaceRole.Editor)
    {
        var org = await (await owner.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest("Canlı A.Ş."))).ReadAsync<OrganizationDto>();
        var general = (await owner.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.Single(w => w.OrganizationId == org.Id);
        var member = await UserAsync("Mert");
        await (await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(member.Email, OrganizationRole.Member, general.Id, memberRole))).ReadAsync<InvitationDto>();
        var token = TestHelpers.QueryValue(factory.Emails.LastTo(member.Email).TextBody, "token");
        await (await member.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();
        return (org, general, member);
    }

    private static bool IsRequest(JsonElement change, Guid requestId, int version) =>
        change.GetProperty("requests").EnumerateArray().Any(r =>
            r.GetProperty("id").GetGuid() == requestId && r.GetProperty("version").GetInt32() == version);

    [Fact]
    public async Task Member_SeesChanges_WithRequestVersion_AndWhoMadeThem()
    {
        var owner = await UserAsync("Ayşe");
        var (_, general, member) = await TeamAsync(owner);
        await using var live = await ConnectAsync(member);
        await live.Connection.InvokeAsync<JsonElement>("JoinWorkspace", general.Id);

        owner.Client.DefaultRequestHeaders.Add("X-Apivator-Client", "sekme-1");
        var collection = await (await owner.Client.PostAsJsonAsync($"/api/workspaces/{general.Id}/collections", new CreateCollectionRequest("Ödeme"))).ReadAsync<CollectionTreeDto>();
        var created = await live.NextAsync("workspaceChanged", e => e.GetProperty("collections").GetBoolean());
        Assert.Equal(general.Id, created.GetProperty("workspaceId").GetGuid());
        Assert.Equal("sekme-1", created.GetProperty("actor").GetProperty("clientId").GetString());
        Assert.Equal("Ayşe", created.GetProperty("actor").GetProperty("displayName").GetString());

        var request = await (await owner.Client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Liste", null, new RequestDefinition { Url = "https://x.test" }))).ReadAsync<ApiRequestDto>();
        await live.NextAsync("workspaceChanged", e => IsRequest(e, request.Id, request.Version));

        var updated = await (await owner.Client.PutAsJsonAsync($"/api/requests/{request.Id}", new UpdateApiRequestRequest("Liste", new RequestDefinition { Url = "https://y.test" }, request.Version))).ReadAsync<ApiRequestDto>();
        Assert.Equal(request.Version + 1, updated.Version);
        await live.NextAsync("workspaceChanged", e => IsRequest(e, request.Id, updated.Version));

        await owner.Client.DeleteAsync($"/api/requests/{request.Id}");
        await live.NextAsync("workspaceChanged", e => e.GetProperty("requests").EnumerateArray().Any(r =>
            r.GetProperty("id").GetGuid() == request.Id && r.GetProperty("deleted").GetBoolean()));
    }

    [Fact]
    public async Task Outsider_CannotJoin_AndReceivesNothing()
    {
        var owner = await UserAsync("Ayşe");
        var (_, general, _) = await TeamAsync(owner);
        var outsider = await UserAsync("Yabancı");
        await using var live = await ConnectAsync(outsider);

        var error = await Assert.ThrowsAsync<HubException>(() => live.Connection.InvokeAsync<JsonElement>("JoinWorkspace", general.Id));
        Assert.Contains("erişiminiz yok", error.Message, StringComparison.Ordinal);

        await owner.Client.PostAsJsonAsync($"/api/workspaces/{general.Id}/collections", new CreateCollectionRequest("Gizli"));
        await live.NoneAsync("workspaceChanged");
    }

    [Fact]
    public async Task Presence_ShowsWhoIsOnline_AndWhichRequestTheyHaveOpen()
    {
        var owner = await UserAsync("Ayşe");
        var (_, general, member) = await TeamAsync(owner);
        var requestId = Guid.NewGuid();

        await using var ownerLive = await ConnectAsync(owner);
        var first = await ownerLive.Connection.InvokeAsync<JsonElement>("JoinWorkspace", general.Id);
        Assert.Single(first.GetProperty("users").EnumerateArray());

        var memberLive = await ConnectAsync(member);
        await memberLive.Connection.InvokeAsync<JsonElement>("JoinWorkspace", general.Id);
        await memberLive.Connection.InvokeAsync("ViewRequest", (Guid?)requestId);

        var seen = await ownerLive.NextAsync("presence", p => p.GetProperty("users").EnumerateArray().Any(u =>
            u.GetProperty("displayName").GetString() == "Mert" &&
            u.GetProperty("requestIds").EnumerateArray().Any(r => r.GetGuid() == requestId)));
        Assert.Equal(2, seen.GetProperty("users").GetArrayLength());

        await memberLive.DisposeAsync();
        await ownerLive.NextAsync("presence", p => p.GetProperty("users").GetArrayLength() == 1);
    }

    [Fact]
    public async Task AccessAndInvitationChanges_ReachTheAffectedPerson()
    {
        var owner = await UserAsync("Ayşe");
        var (org, general, member) = await TeamAsync(owner);
        var second = await (await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/workspaces", new CreateWorkspaceRequest("Mobil"))).ReadAsync<WorkspaceDto>();

        await using var memberLive = await ConnectAsync(member);
        await owner.Client.PutAsJsonAsync($"/api/workspaces/{second.Id}/members/users/{member.Id}", new SetRoleRequest(WorkspaceRole.Viewer));
        await memberLive.NextAsync("organizationChanged", e => e.GetProperty("organizationId").GetGuid() == org.Id);
        await memberLive.NextAsync("accessChanged");

        // Hesabı olan birine davet: uygulamadaki davet bildirimi hemen güncellenir.
        var invited = await UserAsync("Deniz");
        await using var invitedLive = await ConnectAsync(invited);
        await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(invited.Email, OrganizationRole.Member, general.Id, WorkspaceRole.Viewer));
        await invitedLive.NextAsync("invitationsChanged");
    }

    [Fact]
    public async Task MovingCollection_NotifiesBothWorkspaces()
    {
        var owner = await UserAsync("Ayşe");
        var (org, general, member) = await TeamAsync(owner);
        var target = await (await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/workspaces", new CreateWorkspaceRequest("Hedef"))).ReadAsync<WorkspaceDto>();
        await owner.Client.PutAsJsonAsync($"/api/workspaces/{target.Id}/members/users/{member.Id}", new SetRoleRequest(WorkspaceRole.Viewer));
        var collection = await (await owner.Client.PostAsJsonAsync($"/api/workspaces/{general.Id}/collections", new CreateCollectionRequest("Taşınan"))).ReadAsync<CollectionTreeDto>();

        await using var source = await ConnectAsync(member);
        await source.Connection.InvokeAsync<JsonElement>("JoinWorkspace", general.Id);
        await using var destination = await ConnectAsync(owner);
        await destination.Connection.InvokeAsync<JsonElement>("JoinWorkspace", target.Id);

        await (await owner.Client.PostAsJsonAsync($"/api/collections/{collection.Id}/move", new CollectionTargetRequest(target.Id))).ReadAsync<CollectionTreeDto>();
        await source.NextAsync("workspaceChanged", e => e.GetProperty("workspaceId").GetGuid() == general.Id && e.GetProperty("collections").GetBoolean());
        await destination.NextAsync("workspaceChanged", e => e.GetProperty("workspaceId").GetGuid() == target.Id && e.GetProperty("collections").GetBoolean());
    }

    [Fact]
    public async Task RemovedMember_IsDroppedFromWorkspaceEvents()
    {
        var owner = await UserAsync("Ayşe");
        var (org, general, member) = await TeamAsync(owner);
        await using var live = await ConnectAsync(member);
        await live.Connection.InvokeAsync<JsonElement>("JoinWorkspace", general.Id);

        // Organizasyondan çıkarılan kişi açık bağlantısında da artık olay almaz.
        (await owner.Client.DeleteAsync($"/api/organizations/{org.Id}/members/{member.Id}")).EnsureSuccessStatusCode();
        await live.NextAsync("accessChanged");

        await owner.Client.PostAsJsonAsync($"/api/workspaces/{general.Id}/collections", new CreateCollectionRequest("Sonradan"));
        await live.NoneAsync("workspaceChanged");
    }

    [Fact]
    public async Task CommentsAndMentions_ArriveLive()
    {
        var owner = await UserAsync("Ayşe");
        var (_, general, member) = await TeamAsync(owner);
        var collection = await (await owner.Client.PostAsJsonAsync($"/api/workspaces/{general.Id}/collections", new CreateCollectionRequest("Yorumlu"))).ReadAsync<CollectionTreeDto>();
        await using var live = await ConnectAsync(owner);
        await live.Connection.InvokeAsync<JsonElement>("JoinWorkspace", general.Id);

        await member.Client.PostAsJsonAsync("/api/comments", new CreateCommentRequest(Domain.Comments.CommentTarget.Collection, collection.Id, $"@[Ayşe]({owner.Id}) bakar mısın?"));
        await live.NextAsync("workspaceChanged", e => e.GetProperty("comments").GetBoolean());
        await live.NextAsync("notificationsChanged");

        await member.Client.PatchAsJsonAsync($"/api/collections/{collection.Id}", new { name = "Yorumlu 2" });
        await live.NextAsync("workspaceChanged", e => e.GetProperty("activity").GetBoolean());
    }
}
