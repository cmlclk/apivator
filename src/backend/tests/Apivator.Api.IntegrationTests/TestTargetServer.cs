using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Apivator.Api.IntegrationTests;

/// <summary>Yürütme motorunun istek atacağı gerçek bir HTTP sunucusu (127.0.0.1, rastgele port).</summary>
public sealed class TestTargetServer : IAsyncLifetime
{
    private WebApplication? _app;

    public string BaseUrl { get; private set; } = string.Empty;

    /// <summary>/oauth/token'a gelen istek sayısı (önbellek testleri için).</summary>
    public int TokenRequests => _tokenRequests;

    private int _tokenRequests;

    /// <summary>/hooks'a gelen webhook gövdeleri.</summary>
    public System.Collections.Concurrent.ConcurrentQueue<string> Hooks { get; } = new();

    /// <summary>/health-check'in döneceği durum kodu (monitör testleri değiştirir).</summary>
    public int HealthStatus { get; set; } = 200;

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.WebHost.ConfigureKestrel(k => k.RequestHeaderEncodingSelector = (_) => System.Text.Encoding.UTF8);
        _app = builder.Build();
        _app.UseWebSockets();

        _app.MapMethods("/echo", ["GET", "POST", "PUT", "PATCH", "DELETE"], async (HttpContext context) =>
        {
            using var reader = new StreamReader(context.Request.Body);
            var body = await reader.ReadToEndAsync();
            return Results.Json(new
            {
                method = context.Request.Method,
                query = context.Request.QueryString.Value,
                headers = context.Request.Headers.ToDictionary(h => h.Key.ToLowerInvariant(), h => h.Value.ToString()),
                contentType = context.Request.ContentType,
                body,
            });
        });
        // Uyumluluk seti: istenen yanıtı döndürür. X-Respond = base64(JSON {status, statusText?, headers, body}).
        _app.MapMethods("/respond", ["GET", "POST", "PUT", "PATCH", "DELETE"], async (HttpContext context) =>
        {
            var spec = System.Text.Json.JsonDocument.Parse(Convert.FromBase64String(context.Request.Headers["X-Respond"].ToString())).RootElement;
            context.Response.StatusCode = spec.TryGetProperty("status", out var status) ? status.GetInt32() : 200;
            if (spec.TryGetProperty("headers", out var headers))
            {
                foreach (var header in headers.EnumerateObject())
                {
                    context.Response.Headers.Append(header.Name, header.Value.GetString());
                }
            }

            if (spec.TryGetProperty("body", out var body) && body.ValueKind != System.Text.Json.JsonValueKind.Null)
            {
                await context.Response.WriteAsync(body.ValueKind == System.Text.Json.JsonValueKind.String ? body.GetString()! : body.GetRawText());
            }
        });
        _app.MapGet("/status/{code:int}", (int code) => Results.StatusCode(code));
        _app.MapGet("/health-check", () => Results.StatusCode(HealthStatus));
        _app.MapGet("/sse", async (HttpContext context) =>
        {
            context.Response.ContentType = "text/event-stream";
            var auth = context.Request.Headers.Authorization.ToString();
            await context.Response.WriteAsync($": yorum satırı\n\nevent: hello\ndata: {auth}\n\n");
            await context.Response.Body.FlushAsync();
            await context.Response.WriteAsync("id: 2\ndata: satır 1\r\ndata: satır 2\n\n");
            await context.Response.WriteAsync("data: {\"n\":3}\n\ndata: tamamlanmamış");
        });
        _app.Map("/ws", async (HttpContext context) =>
        {
            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = 400;
                return;
            }

            var protocol = context.WebSockets.WebSocketRequestedProtocols.FirstOrDefault();
            using var socket = await context.WebSockets.AcceptWebSocketAsync(protocol);
            var hello = System.Text.Encoding.UTF8.GetBytes($"merhaba {context.Request.Headers["X-Test"]}");
            await socket.SendAsync(hello, System.Net.WebSockets.WebSocketMessageType.Text, true, CancellationToken.None);
            var buffer = new byte[64 * 1024];
            while (true)
            {
                var result = await socket.ReceiveAsync(buffer, CancellationToken.None);
                if (result.MessageType == System.Net.WebSockets.WebSocketMessageType.Close)
                {
                    await socket.CloseAsync(System.Net.WebSockets.WebSocketCloseStatus.NormalClosure, "güle güle", CancellationToken.None);
                    return;
                }

                await socket.SendAsync(buffer.AsMemory(0, result.Count), result.MessageType, result.EndOfMessage, CancellationToken.None);
            }
        });
        _app.MapPost("/hooks", async (HttpContext context) =>
        {
            using var reader = new StreamReader(context.Request.Body);
            Hooks.Enqueue(await reader.ReadToEndAsync());
            return Results.Ok();
        });
        _app.MapGet("/slow", async (CancellationToken ct) =>
        {
            await Task.Delay(TimeSpan.FromSeconds(10), ct);
            return Results.Ok();
        });
        _app.MapGet("/big", () => Results.Text(new string('a', 64 * 1024), "text/plain"));
        _app.MapGet("/binary", () => Results.Bytes(Enumerable.Range(0, 256).Select(i => (byte)i).ToArray(), "image/png"));
        _app.MapGet("/redirect", () => Results.Redirect("/echo?redirected=1"));

        _app.MapPost("/oauth/token", async (HttpContext context) =>
        {
            Interlocked.Increment(ref _tokenRequests);
            var form = await context.Request.ReadFormAsync();
            string? clientId = form["client_id"], secret = form["client_secret"];
            var header = context.Request.Headers.Authorization.ToString();
            if (header.StartsWith("Basic ", StringComparison.Ordinal))
            {
                var pair = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(header[6..])).Split(':', 2);
                (clientId, secret) = (Uri.UnescapeDataString(pair[0]), Uri.UnescapeDataString(pair[1]));
            }

            if (clientId != "istemci" || (form["grant_type"] != "authorization_code" && form["grant_type"] != "refresh_token" && secret != "gizli"))
            {
                return Results.Json(new { error = "invalid_client", error_description = "İstemci tanınmadı." }, statusCode: 401);
            }

            return form["grant_type"].ToString() switch
            {
                "client_credentials" => Results.Json(new { access_token = $"tkn-cc-{form["scope"]}", token_type = "Bearer", expires_in = 3600 }),
                "password" when form["username"] == "ayse" && form["password"] == "sifre" =>
                    Results.Json(new { access_token = "tkn-pw", token_type = "Bearer", expires_in = 3600, refresh_token = "yenile" }),
                "authorization_code" when form["code"] == "kod-123" && form["code_verifier"] == "dogrulayici-123" =>
                    Results.Json(new { access_token = "tkn-code", token_type = "Bearer", expires_in = 60, refresh_token = "yenile" }),
                "refresh_token" when form["refresh_token"] == "yenile" => Results.Json(new { access_token = "tkn-yenilendi", token_type = "Bearer" }),
                _ => Results.Json(new { error = "invalid_grant", error_description = "Geçersiz istek." }, statusCode: 400),
            };
        });
        _app.MapGet("/digest", (HttpContext context) =>
        {
            const string Realm = "test", Nonce = "n0nce";
            var header = context.Request.Headers.Authorization.ToString();
            if (!header.StartsWith("Digest ", StringComparison.Ordinal))
            {
                context.Response.Headers.WWWAuthenticate = $"Digest realm=\"{Realm}\", nonce=\"{Nonce}\", qop=\"auth\", opaque=\"op\"";
                return Results.StatusCode(401);
            }

            var values = System.Text.RegularExpressions.Regex.Matches(header, "(\\w+)=(?:\"([^\"]*)\"|([^\\s,]+))")
                .ToDictionary(m => m.Groups[1].Value, m => m.Groups[2].Success ? m.Groups[2].Value : m.Groups[3].Value);
#pragma warning disable CA5351
            static string Md5(string text) => Convert.ToHexStringLower(System.Security.Cryptography.MD5.HashData(System.Text.Encoding.UTF8.GetBytes(text)));
#pragma warning restore CA5351
            var expected = Md5($"{Md5($"ayse:{Realm}:sifre")}:{Nonce}:{values["nc"]}:{values["cnonce"]}:{values["qop"]}:{Md5($"GET:{values["uri"]}")}");
            return values["response"] == expected && values["opaque"] == "op" ? Results.Text("içeri") : Results.StatusCode(401);
        });

        await _app.StartAsync();
        BaseUrl = _app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            await _app.DisposeAsync();
        }
    }
}
