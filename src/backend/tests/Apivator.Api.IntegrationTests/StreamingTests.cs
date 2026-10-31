using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Apivator.Application.Execution;
using Apivator.Domain.Collections;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class StreamingTests(ApivatorApiFactory factory, TestTargetServer target) : IClassFixture<TestTargetServer>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private async Task<List<StreamEvent>> StreamAsync(ExecuteHttpRequest request)
    {
        var (client, _) = await factory.CreateUserAsync();
        var response = await client.PostAsJsonAsync("/api/execute/stream", request);
        response.EnsureSuccessStatusCode();
        Assert.Equal("application/x-ndjson", response.Content.Headers.ContentType?.MediaType);
        var lines = (await response.Content.ReadAsStringAsync()).Split('\n', StringSplitOptions.RemoveEmptyEntries);
        return lines.Select(l => JsonSerializer.Deserialize<StreamEvent>(l, Json)!).ToList();
    }

    [Fact]
    public async Task ServerSentEvents_AreParsedAndStreamed_WithVariablesAndAuth()
    {
        var events = await StreamAsync(new ExecuteHttpRequest("GET", "{{base}}/sse", [], RequestBody.None)
        {
            Auth = RequestAuth.Inherit with { Type = AuthType.Bearer, BearerToken = "{{token}}" },
            Variables = new ExecutionVariables { Environment = new() { ["base"] = target.BaseUrl, ["token"] = "gizli" } },
        });

        Assert.Equal(["open", "event", "event", "event", "done"], events.Select(e => e.Type));
        Assert.Equal(200, events[0].Status);
        Assert.Contains(events[0].Headers!, h => h.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase) && h.Value.StartsWith("text/event-stream", StringComparison.Ordinal));
        Assert.Equal(("hello", "Bearer gizli"), (events[1].Event, events[1].Data));
        Assert.Equal(("message", "satır 1\nsatır 2", "2"), (events[2].Event, events[2].Data, events[2].Id));
        Assert.Equal("{\"n\":3}", events[3].Data);
        // Boş satırla bitmeyen son olay atılır (standarttaki gibi).
        Assert.DoesNotContain(events, e => e.Data == "tamamlanmamış");
    }

    [Fact]
    public async Task NonStreamingResponse_IsReturnedAsBody()
    {
        var events = await StreamAsync(new ExecuteHttpRequest("GET", $"{target.BaseUrl}/echo?x=1", [], RequestBody.None));

        Assert.Equal(["open", "body", "done"], events.Select(e => e.Type));
        Assert.Contains("\"query\":\"?x=1\"", events[1].Data, StringComparison.Ordinal);
        Assert.Contains("event-stream", events[2].Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Stream_IsProtectedLikeNormalRequests()
    {
        var events = await StreamAsync(new ExecuteHttpRequest("GET", "http://169.254.169.254/latest/meta-data", [], RequestBody.None));

        Assert.Equal("error", Assert.Single(events).Type);
        Assert.Contains("izin verilmiyor", events[0].Message, StringComparison.Ordinal);
    }

    private async Task<WebSocket> RelayAsync()
    {
        var (client, _) = await factory.CreateUserAsync();
        var token = client.DefaultRequestHeaders.Authorization!.Parameter;
        var ws = factory.Server.CreateWebSocketClient();
        return await ws.ConnectAsync(new Uri(factory.Server.BaseAddress, $"/hubs/ws-proxy?access_token={token}"), CancellationToken.None);
    }

    private static Task SendAsync(WebSocket socket, object envelope) =>
        socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(envelope, Json), WebSocketMessageType.Text, true, CancellationToken.None);

    private static async Task<JsonElement> ReceiveAsync(WebSocket socket)
    {
        var buffer = new byte[64 * 1024];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var result = await socket.ReceiveAsync(buffer, timeout.Token);
        return JsonDocument.Parse(buffer.AsMemory(0, result.Count)).RootElement.Clone();
    }

    [Fact]
    public async Task WebSocketRelay_ForwardsHeadersTextBinaryAndClose()
    {
        using var socket = await RelayAsync();
        var wsUrl = target.BaseUrl.Replace("http://", "ws://", StringComparison.Ordinal) + "/ws";

        await SendAsync(socket, new { type = "connect", url = wsUrl, headers = new[] { new { key = "X-Test", value = "apivatör" } }, protocols = new[] { "chat.v1" } });

        var open = await ReceiveAsync(socket);
        Assert.Equal(("open", "chat.v1"), (open.GetProperty("type").GetString(), open.GetProperty("protocol").GetString()));
        var hello = await ReceiveAsync(socket);
        Assert.Equal(("message", "merhaba apivatör"), (hello.GetProperty("type").GetString(), hello.GetProperty("data").GetString()));

        await SendAsync(socket, new { type = "send", data = "{\"selam\":1}" });
        var echoed = await ReceiveAsync(socket);
        Assert.Equal(("{\"selam\":1}", false, 11), (echoed.GetProperty("data").GetString(), echoed.GetProperty("binary").GetBoolean(), echoed.GetProperty("size").GetInt32()));

        await SendAsync(socket, new { type = "send", data = Convert.ToBase64String([1, 2, 3]), binary = true });
        var binary = await ReceiveAsync(socket);
        Assert.True(binary.GetProperty("binary").GetBoolean());
        Assert.Equal([1, 2, 3], Convert.FromBase64String(binary.GetProperty("data").GetString()!));

        await SendAsync(socket, new { type = "close", code = 1000, reason = "bitti" });
        var closed = await ReceiveAsync(socket);
        Assert.Equal(("closed", 1000), (closed.GetProperty("type").GetString(), closed.GetProperty("code").GetInt32()));
    }

    [Fact]
    public async Task WebSocketRelay_RefusesBlockedNetworks_AndRequiresLogin()
    {
        using var socket = await RelayAsync();
        await SendAsync(socket, new { type = "connect", url = "ws://10.1.2.3:9000/socket" });

        var error = await ReceiveAsync(socket);
        Assert.Equal("error", error.GetProperty("type").GetString());
        Assert.Contains("izin verilmiyor", error.GetProperty("message").GetString(), StringComparison.Ordinal);

        var anonymous = factory.Server.CreateWebSocketClient();
        await Assert.ThrowsAnyAsync<Exception>(() => anonymous.ConnectAsync(new Uri(factory.Server.BaseAddress, "/hubs/ws-proxy"), CancellationToken.None));
    }
}
