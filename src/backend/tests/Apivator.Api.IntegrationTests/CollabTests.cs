using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Channels;
using Apivator.Api.Realtime;
using Apivator.Application.Collections;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

namespace Apivator.Api.IntegrationTests;

/// <summary>İsteklerin ortak (Yjs) taslağı: katılım, iletim, yetki, sıkıştırma ve çıkınca silinme.</summary>
[Collection(ApiCollection.Name)]
public sealed class CollabTests(ApivatorApiFactory factory)
{
    private sealed record User(HttpClient Client, Guid Id, string Email, string Token);

    private sealed record Join(bool CanEdit, bool First, List<string> Updates, long Generation);

    private sealed class Live(HubConnection connection) : IAsyncDisposable
    {
        private readonly Channel<(string Name, string Payload)> _events = Channel.CreateUnbounded<(string, string)>();

        public HubConnection Connection { get; } = connection;

        public void Listen()
        {
            Connection.On<Guid, string>("docUpdate", (_, update) => _events.Writer.TryWrite(("docUpdate", update)));
            Connection.On<Guid, string, Guid, string>("docAwareness", (_, payload, userId, name) => _events.Writer.TryWrite(("docAwareness", $"{payload}|{userId}|{name}")));
            Connection.On<Guid>("docRevoked", id => _events.Writer.TryWrite(("docRevoked", id.ToString())));
        }

        public async Task<string> NextAsync(string name)
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            while (true)
            {
                var (eventName, payload) = await _events.Reader.ReadAsync(timeout.Token);
                if (eventName == name)
                {
                    return payload;
                }
            }
        }

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

        public Task<Join> JoinAsync(Guid requestId) => Connection.InvokeAsync<Join>("JoinDocument", requestId);

        public ValueTask DisposeAsync() => Connection.DisposeAsync();
    }

    private static string B64(string text) => Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(text));

    private async Task<User> UserAsync(string name)
    {
        var client = factory.CreateClient();
        var email = TestHelpers.NewEmail();
        var auth = await client.RegisterAsync(email, name);
        client.WithBearer(auth.AccessToken);
        return new User(client, auth.User.Id, email, auth.AccessToken);
    }

    private async Task<Live> ConnectAsync(User user)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(factory.Server.BaseAddress, "hubs/workspace"), options =>
            {
                options.Transports = HttpTransportType.WebSockets;
                options.SkipNegotiation = true;
                options.AccessTokenProvider = () => Task.FromResult<string?>(user.Token);
                options.WebSocketFactory = async (context, ct) =>
                {
                    var uri = new UriBuilder(context.Uri);
                    uri.Query = (uri.Query.Length > 1 ? uri.Query[1..] + "&" : string.Empty) + "access_token=" + Uri.EscapeDataString(user.Token);
                    return await factory.Server.CreateWebSocketClient().ConnectAsync(uri.Uri, ct);
                };
            })
            .Build();
        var live = new Live(connection);
        live.Listen();
        await connection.StartAsync();
        await connection.InvokeAsync("RefreshGroups");
        return live;
    }

    private async Task<(Guid RequestId, User Owner, User Member, Guid WorkspaceId)> RequestAsync(WorkspaceRole memberRole)
    {
        var owner = await UserAsync("Ayşe");
        var org = await (await owner.Client.PostAsJsonAsync("/api/organizations", new CreateOrganizationRequest("Ortak A.Ş."))).ReadAsync<OrganizationDto>();
        var general = (await owner.Client.GetFromJsonAsync<List<WorkspaceDto>>("/api/workspaces"))!.Single(w => w.OrganizationId == org.Id);
        var member = await UserAsync("Mert");
        await (await owner.Client.PostAsJsonAsync($"/api/organizations/{org.Id}/invitations", new InviteRequest(member.Email, OrganizationRole.Member, general.Id, memberRole))).ReadAsync<InvitationDto>();
        var token = TestHelpers.QueryValue(factory.Emails.LastTo(member.Email).TextBody, "token");
        await (await member.Client.PostAsJsonAsync("/api/invitations/accept", new AcceptInvitationRequest(token))).ReadAsync<AcceptedInvitationDto>();

        var collection = await (await owner.Client.PostAsJsonAsync($"/api/workspaces/{general.Id}/collections", new CreateCollectionRequest("Ödeme"))).ReadAsync<CollectionTreeDto>();
        var request = await (await owner.Client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Liste", null, new RequestDefinition { Url = "https://x.test" }))).ReadAsync<ApiRequestDto>();
        return (request.Id, owner, member, general.Id);
    }

    [Fact]
    public async Task FirstJoinerSeeds_LaterJoinerGetsTheLog_AndUpdatesAreRelayedToOthersOnly()
    {
        var (requestId, owner, member, _) = await RequestAsync(WorkspaceRole.Editor);
        await using var a = await ConnectAsync(owner);
        await using var b = await ConnectAsync(member);

        var first = await a.JoinAsync(requestId);
        Assert.True(first.First);
        Assert.True(first.CanEdit);
        Assert.Empty(first.Updates);

        await a.Connection.InvokeAsync("SendUpdate", requestId, B64("tohum"));
        var second = await b.JoinAsync(requestId);
        Assert.False(second.First);
        Assert.Equal([B64("tohum")], second.Updates);

        await b.Connection.InvokeAsync("SendUpdate", requestId, B64("b-yazdı"));
        Assert.Equal(B64("b-yazdı"), await a.NextAsync("docUpdate"));
        await b.NoneAsync("docUpdate");

        await a.Connection.InvokeAsync("SendAwareness", requestId, B64("imleç"));
        // Kimlik istemcinin yazdığından değil, sunucunun bildiğinden gelir.
        Assert.Equal($"{B64("imleç")}|{owner.Id}|Ayşe", await b.NextAsync("docAwareness"));
    }

    [Fact]
    public async Task EditorDemotedToViewer_CanNoLongerWrite()
    {
        var (requestId, owner, member, workspaceId) = await RequestAsync(WorkspaceRole.Editor);
        var previous = CollabDocuments.RecheckAfter;
        CollabDocuments.RecheckAfter = TimeSpan.Zero;
        try
        {
            await using var editor = await ConnectAsync(member);
            await using var other = await ConnectAsync(owner);
            await editor.JoinAsync(requestId);
            await other.JoinAsync(requestId);
            await editor.Connection.InvokeAsync("SendUpdate", requestId, B64("önce"));
            Assert.Equal(B64("önce"), await other.NextAsync("docUpdate"));

            var demote = await owner.Client.PutAsJsonAsync($"/api/workspaces/{workspaceId}/members/users/{member.Id}", new { role = "Viewer" });
            Assert.True(demote.IsSuccessStatusCode);

            await Assert.ThrowsAsync<HubException>(() => editor.Connection.InvokeAsync("SendUpdate", requestId, B64("sonra")));
            await Assert.ThrowsAsync<HubException>(() => editor.Connection.InvokeAsync<bool>("CompactDocument", requestId, 1, 0L, B64("x")));
            await other.NoneAsync("docUpdate");
        }
        finally
        {
            CollabDocuments.RecheckAfter = previous;
        }
    }

    [Fact]
    public async Task DocumentIsCapped_AndMessageRateIsLimited()
    {
        var (requestId, owner, _, _) = await RequestAsync(WorkspaceRole.Editor);
        await using var live = await ConnectAsync(owner);
        await live.JoinAsync(requestId);

        var big = Convert.ToBase64String(new byte[900_000]);
        for (var i = 0; i < 8; i++)
        {
            await live.Connection.InvokeAsync("SendUpdate", requestId, big);
        }

        // 8 MB sınırı aşılınca eklenmez; sıkıştırma gerekir.
        await Assert.ThrowsAsync<HubException>(() => live.Connection.InvokeAsync("SendUpdate", requestId, big));

        // Belge sınırdayken tek çıkış sıkıştırmadır ve hız bütçesine bağlı değildir.
        Assert.True(await live.Connection.InvokeAsync<bool>("CompactDocument", requestId, 8, 0L, B64("kucuk")));
        await live.Connection.InvokeAsync("SendUpdate", requestId, big);

        await using var chatty = await ConnectAsync(owner);
        await chatty.JoinAsync(requestId);
        var limited = false;
        for (var i = 0; i < 400 && !limited; i++)
        {
            try
            {
                await chatty.Connection.InvokeAsync("SendAwareness", requestId, B64("x"));
            }
            catch (HubException)
            {
                limited = true;
            }
        }

        Assert.True(limited);
    }

    [Fact]
    public async Task Viewer_Receives_ButCannotWrite()
    {
        var (requestId, owner, member, _) = await RequestAsync(WorkspaceRole.Viewer);
        await using var editor = await ConnectAsync(owner);
        await using var viewer = await ConnectAsync(member);
        await editor.JoinAsync(requestId);
        var joined = await viewer.JoinAsync(requestId);
        Assert.False(joined.CanEdit);

        await editor.Connection.InvokeAsync("SendUpdate", requestId, B64("canlı"));
        Assert.Equal(B64("canlı"), await viewer.NextAsync("docUpdate"));

        await Assert.ThrowsAsync<HubException>(() => viewer.Connection.InvokeAsync("SendUpdate", requestId, B64("izinsiz")));
        await editor.NoneAsync("docUpdate");
    }

    [Fact]
    public async Task Stranger_CannotJoin_AndUnjoinedConnectionCannotSend()
    {
        var (requestId, owner, _, _) = await RequestAsync(WorkspaceRole.Editor);
        var stranger = await UserAsync("Yabancı");
        await using var outsider = await ConnectAsync(stranger);

        await Assert.ThrowsAsync<HubException>(() => outsider.JoinAsync(requestId));
        await Assert.ThrowsAsync<HubException>(() => outsider.Connection.InvokeAsync("SendUpdate", requestId, B64("x")));
        await Assert.ThrowsAsync<HubException>(() => outsider.JoinAsync(Guid.NewGuid()));

        await using var member = await ConnectAsync(owner);
        await Assert.ThrowsAsync<HubException>(() => member.Connection.InvokeAsync("SendUpdate", requestId, B64("katılmadan")));
    }

    [Fact]
    public async Task RejectsMalformedAndOversizedUpdates()
    {
        var (requestId, owner, _, _) = await RequestAsync(WorkspaceRole.Editor);
        await using var live = await ConnectAsync(owner);
        await live.JoinAsync(requestId);

        await Assert.ThrowsAsync<HubException>(() => live.Connection.InvokeAsync("SendUpdate", requestId, "bu base64 değil!"));
        var tooBig = Convert.ToBase64String(new byte[1_200_000]);
        await Assert.ThrowsAsync<HubException>(() => live.Connection.InvokeAsync("SendUpdate", requestId, tooBig));
    }

    [Fact]
    public async Task Compaction_ReplacesTheLog_AndStaleGenerationIsRefused()
    {
        var (requestId, owner, member, _) = await RequestAsync(WorkspaceRole.Editor);
        await using var a = await ConnectAsync(owner);
        await using var b = await ConnectAsync(member);
        await a.JoinAsync(requestId);
        foreach (var part in new[] { "1", "2", "3" })
        {
            await a.Connection.InvokeAsync("SendUpdate", requestId, B64(part));
        }

        Assert.True(await a.Connection.InvokeAsync<bool>("CompactDocument", requestId, 3, 0L, B64("123")));
        Assert.False(await a.Connection.InvokeAsync<bool>("CompactDocument", requestId, 1, 0L, B64("eski")));

        var late = await b.JoinAsync(requestId);
        Assert.Equal([B64("123")], late.Updates);
        Assert.Equal(1, late.Generation);
    }

    [Fact]
    public async Task DocumentIsEvicted_WhenTheLastParticipantLeaves()
    {
        var (requestId, owner, member, _) = await RequestAsync(WorkspaceRole.Editor);
        await using var a = await ConnectAsync(owner);
        await using var b = await ConnectAsync(member);
        await a.JoinAsync(requestId);
        await b.JoinAsync(requestId);
        await a.Connection.InvokeAsync("SendUpdate", requestId, B64("durum"));

        await a.Connection.InvokeAsync("LeaveDocument", requestId);
        Assert.Equal([B64("durum")], (await a.JoinAsync(requestId)).Updates);

        await a.Connection.InvokeAsync("LeaveDocument", requestId);
        await b.Connection.InvokeAsync("LeaveDocument", requestId);
        var fresh = await b.JoinAsync(requestId);
        Assert.True(fresh.First);
        Assert.Empty(fresh.Updates);
    }

    [Fact]
    public async Task SeedClaim_PassesOn_WhenTheSeederLeavesWithoutSending()
    {
        var (requestId, owner, member, _) = await RequestAsync(WorkspaceRole.Editor);
        await using var a = await ConnectAsync(owner);
        await using var b = await ConnectAsync(member);
        Assert.True((await a.JoinAsync(requestId)).First);
        Assert.False((await b.JoinAsync(requestId)).First);

        await a.Connection.InvokeAsync("LeaveDocument", requestId);
        await b.Connection.InvokeAsync("LeaveDocument", requestId);
        await using var c = await ConnectAsync(owner);
        Assert.True((await c.JoinAsync(requestId)).First);
    }
}

/// <summary>
/// Redis'li günlük testi yalnızca erişilebilir bir Redis varsa (localhost:6379 ya da APIVATOR_TEST_REDIS) çalışır;
/// yoksa "atlandı" olarak raporlanır, sessizce geçmez.
/// </summary>
public sealed class RedisFactAttribute : FactAttribute
{
    public static string Endpoint => Environment.GetEnvironmentVariable("APIVATOR_TEST_REDIS") ?? "127.0.0.1:6379";

    public RedisFactAttribute()
    {
        try
        {
            using var probe = StackExchange.Redis.ConnectionMultiplexer.Connect(Endpoint + ",connectTimeout=2000,abortConnect=true");
            if (!probe.IsConnected)
            {
                Skip = $"Redis ({Endpoint}) erişilemiyor; Redis günlüğü doğrulanamadı.";
            }
        }
        catch (StackExchange.Redis.RedisConnectionException ex)
        {
            Skip = $"Redis ({Endpoint}) erişilemiyor; Redis günlüğü doğrulanamadı: {ex.Message}";
        }
    }
}

public sealed class RedisDocumentLogTests
{
    [RedisFact]
    public async Task Redis_JoinAppendCompactLeave_BehaveLikeMemory_AndEnforceByteCap()
    {
        using var connection = StackExchange.Redis.ConnectionMultiplexer.Connect(RedisFactAttribute.Endpoint);

        var log = new RedisDocumentLog(connection);
        var id = Guid.NewGuid();

        var first = await log.JoinAsync(id, "a");
        Assert.True(first.First);
        var second = await log.JoinAsync(id, "b");
        Assert.False(second.First);

        Assert.Equal(1, await log.AppendAsync(id, [1, 2]));
        Assert.Equal(2, await log.AppendAsync(id, [3]));
        Assert.Equal(-1, await log.AppendAsync(id, new byte[(int)CollabDocuments.MaxDocumentBytes]));

        Assert.True(await log.CompactAsync(id, 2, 0, [1, 2, 3]));
        Assert.False(await log.CompactAsync(id, 1, 0, [9]));
        var late = await log.JoinAsync(id, "c");
        Assert.Single(late.Updates);
        Assert.Equal([1, 2, 3], late.Updates[0]);
        Assert.Equal(1, late.Generation);

        await log.LeaveAsync(id, "a");
        await log.LeaveAsync(id, "b");
        await log.LeaveAsync(id, "c");
        var fresh = await log.JoinAsync(id, "d");
        Assert.True(fresh.First);
        Assert.Empty(fresh.Updates);
        await log.LeaveAsync(id, "d");
    }
}
