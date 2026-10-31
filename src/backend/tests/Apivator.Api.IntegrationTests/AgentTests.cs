using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Agent;
using Apivator.Application.Execution;
using Apivator.Domain.Collections;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;

namespace Apivator.Api.IntegrationTests;

/// <summary>Masaüstü ajanı: gerçek bir loopback portunda çalıştırılır (veritabanı gerekmez).</summary>
public sealed class AgentTests(TestTargetServer target) : IClassFixture<TestTargetServer>, IAsyncLifetime
{
    private const string Token = "test-ajan-tokeni-0123456789abcdefghij";
    private WebApplication? _app;
    private HttpClient _client = null!;
    private string _baseUrl = string.Empty;

    public async Task InitializeAsync()
    {
        _app = AgentHost.Build(new AgentOptions { Token = Token }, config =>
            config.AddInMemoryCollection(new Dictionary<string, string?> { ["Scripts:TimeoutSeconds"] = "3" }));
        var port = await AgentHost.StartAsync(_app);
        _baseUrl = $"http://127.0.0.1:{port}";
        _client = new HttpClient { BaseAddress = new Uri(_baseUrl) };
        _client.DefaultRequestHeaders.Add(AgentOptions.TokenHeader, Token);
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        if (_app is not null)
        {
            await _app.DisposeAsync();
        }
    }

    [Fact]
    public async Task EveryRequest_NeedsTheSessionToken()
    {
        using var anonymous = new HttpClient { BaseAddress = new Uri(_baseUrl) };
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/health")).StatusCode);

        using var wrong = new HttpRequestMessage(HttpMethod.Get, "/health");
        wrong.Headers.Add(AgentOptions.TokenHeader, Token + "x");
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.SendAsync(wrong)).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await _client.GetAsync("/health")).StatusCode);
    }

    [Fact]
    public async Task ForeignHostHeader_IsRejected()
    {
        // DNS rebinding: kötü niyetli bir alan adı 127.0.0.1'e çözülse bile Host başlığı tutmaz.
        using var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Host = "evil.example";
        Assert.Equal(HttpStatusCode.MisdirectedRequest, (await _client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task Cors_AllowsOnlyTheDesktopOrigins()
    {
        async Task<string?> Preflight(string origin)
        {
            using var request = new HttpRequestMessage(HttpMethod.Options, "/execute");
            request.Headers.Add("Origin", origin);
            request.Headers.Add("Access-Control-Request-Method", "POST");
            request.Headers.Add("Access-Control-Request-Headers", $"content-type,{AgentOptions.TokenHeader}");
            using var response = await _client.SendAsync(request);
            return response.Headers.TryGetValues("Access-Control-Allow-Origin", out var values) ? values.Single() : null;
        }

        Assert.Equal("tauri://localhost", await Preflight("tauri://localhost"));
        Assert.Equal("http://tauri.localhost", await Preflight("http://tauri.localhost"));
        Assert.Null(await Preflight("https://evil.example"));
    }

    [Fact]
    public async Task Execute_ReachesLocalhost_AndRunsScripts()
    {
        var response = await (await _client.PostAsJsonAsync("/execute", new ExecuteHttpRequest(
            "GET",
            $"{target.BaseUrl}/echo",
            null,
            null,
            Auth: new RequestAuth { Type = AuthType.Bearer, BearerToken = "yerel" },
            PostResponseScripts: ["pm.test('yerel hedef', () => pm.response.to.have.status(200));"]))).ReadAsync<ExecuteHttpResponse>();

        Assert.Null(response.Error);
        Assert.Equal(200, response.Status);
        Assert.Equal("Bearer yerel", JsonDocument.Parse(response.Body).RootElement.GetProperty("headers").GetProperty("authorization").GetString());
        Assert.Equal(TestResultDto.Passed, Assert.Single(response.Tests!).Status);
    }

    [Fact]
    public async Task OAuthToken_IsFetchedThroughTheAgent()
    {
        var token = await (await _client.PostAsJsonAsync("/oauth2/token", new OAuth2TokenRequest(new RequestAuth
        {
            Type = AuthType.OAuth2,
            OAuth2GrantType = OAuth2GrantType.ClientCredentials,
            OAuth2TokenUrl = $"{target.BaseUrl}/oauth/token",
            OAuth2ClientId = "istemci",
            OAuth2ClientSecret = "gizli",
            OAuth2Scope = "yerel",
        }))).ReadAsync<OAuth2TokenDto>();

        Assert.Equal("tkn-cc-yerel", token.AccessToken);
    }

    [Fact]
    public async Task OAuthLoopback_DeliversTheCodeOnce()
    {
        var state = "durum-" + Guid.NewGuid().ToString("N");
        var session = await (await _client.PostAsJsonAsync("/oauth/sessions", new OAuthSessionRequest(state))).ReadAsync<JsonElement>();
        var redirect = session.GetProperty("redirectUri").GetString()!;
        Assert.Equal($"{_baseUrl}/oauth/callback", redirect);

        Assert.Equal("pending", (await _client.GetFromJsonAsync<JsonElement>($"/oauth/sessions/{state}")).GetProperty("status").GetString());

        // Sistem tarayıcısı: token başlığı olmadan.
        using var browser = new HttpClient();
        var page = await browser.GetAsync($"{redirect}?state={state}&code=kod-42");
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.Contains("Giriş tamamlandı", await page.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // Aynı state ikinci kez kullanılamaz.
        Assert.Equal(HttpStatusCode.BadRequest, (await browser.GetAsync($"{redirect}?state={state}&code=baska")).StatusCode);

        var done = await _client.GetFromJsonAsync<JsonElement>($"/oauth/sessions/{state}");
        Assert.Equal(("done", "kod-42"), (done.GetProperty("status").GetString(), done.GetProperty("code").GetString()));
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/oauth/sessions/{state}")).StatusCode);
    }

    [Fact]
    public async Task OAuthCallback_RejectsUnknownState_AndEncodesErrors()
    {
        using var browser = new HttpClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await browser.GetAsync($"{_baseUrl}/oauth/callback?state=bilinmeyen&code=x")).StatusCode);

        var state = "durum-" + Guid.NewGuid().ToString("N");
        await _client.PostAsJsonAsync("/oauth/sessions", new OAuthSessionRequest(state));
        var html = await browser.GetStringAsync(
            $"{_baseUrl}/oauth/callback?state={state}&error=access_denied&error_description={Uri.EscapeDataString("<script>alert(1)</script>")}");

        Assert.DoesNotContain("<script>", html, StringComparison.Ordinal);
        Assert.Contains("&lt;script&gt;", html, StringComparison.Ordinal);
        var done = await _client.GetFromJsonAsync<JsonElement>($"/oauth/sessions/{state}");
        Assert.Equal("access_denied", done.GetProperty("error").GetString());
    }

    [Fact]
    public void Options_RequireAStrongTokenFromTheEnvironment()
    {
        Assert.Throws<ArgumentException>(() => AgentOptions.Parse([], _ => null));
        Assert.Throws<ArgumentException>(() => AgentOptions.Parse([], _ => "kisa"));

        var options = AgentOptions.Parse(["--port", "0", "--parent-pid", "42", "--origin", "http://localhost:1420"], _ => Token);
        Assert.Equal((0, 42), (options.Port, options.ParentProcessId));
        Assert.Contains("http://localhost:1420", options.AllowedOrigins);
        Assert.Contains("tauri://localhost", options.AllowedOrigins);
    }

    [Fact]
    public async Task ErrorsAndCallbackPage_FollowAcceptLanguageAndLangQuery()
    {
        using var english = new HttpRequestMessage(HttpMethod.Post, "/oauth/sessions") { Content = JsonContent.Create(new OAuthSessionRequest("kisa")) };
        english.Headers.TryAddWithoutValidation("Accept-Language", "en-US,en;q=0.9");
        var rejected = await _client.SendAsync(english);
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        Assert.Contains("state must be 16–256 characters.", await rejected.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var turkish = await _client.PostAsJsonAsync("/oauth/sessions", new OAuthSessionRequest("kisa"));
        Assert.Contains("state 16–256 karakter olmalı.", await turkish.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        // Sistem tarayıcısı token taşımaz; dil tarayıcının Accept-Language başlığından ya da ?lang= parametresinden gelir.
        using var browser = new HttpClient();
        using var page = new HttpRequestMessage(HttpMethod.Get, $"{_baseUrl}/oauth/callback?state=bilinmeyen&code=x");
        page.Headers.TryAddWithoutValidation("Accept-Language", "en");
        var html = await (await browser.SendAsync(page)).Content.ReadAsStringAsync();
        Assert.Contains("<html lang=\"en\">", html, StringComparison.Ordinal);
        Assert.Contains("Sign-in request not recognized", html, StringComparison.Ordinal);

        var fallback = await (await browser.GetAsync($"{_baseUrl}/oauth/callback?state=bilinmeyen&lang=en")).Content.ReadAsStringAsync();
        Assert.Contains("Sign-in request not recognized", fallback, StringComparison.Ordinal);
        Assert.Contains("<html lang=\"tr\">", await (await browser.GetAsync($"{_baseUrl}/oauth/callback?state=bilinmeyen")).Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }
}
