using System.Net;
using System.Net.Http.Json;
using Apivator.Agent;
using Apivator.Application.Import;
using Microsoft.AspNetCore.Builder;

namespace Apivator.Api.IntegrationTests;

/// <summary>Masaüstü ajanı belgeyi bu bilgisayardan (localhost dahil) bulur ve çeker.</summary>
public sealed class AgentSpecFetchTests(SpecServer server) : IClassFixture<SpecServer>, IAsyncLifetime
{
    private const string Token = "test-ajan-tokeni-0123456789abcdefghij";
    private WebApplication? _app;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _app = AgentHost.Build(new AgentOptions { Token = Token });
        var port = await AgentHost.StartAsync(_app);
        _client = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{port}") };
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
    public async Task FetchesFromLocalhost_AndOffersVersions()
    {
        var localhost = server.BaseUrl.Replace("127.0.0.1", "localhost", StringComparison.Ordinal);
        server.Set("/a1/openapi/v1.json", """{"openapi":"3.0.1","info":{"title":"Yerel","version":"v1"},"paths":{}}""");

        var found = await (await _client.PostAsJsonAsync("/openapi/fetch", new SpecFetchRequest(localhost + "/a1"))).ReadAsync<SpecFetchResult>();
        Assert.Equal($"{localhost}/a1/openapi/v1.json", found.Url);
        Assert.Contains("\"Yerel\"", found.Content, StringComparison.Ordinal);

        server.Set("/a1/swagger/index.html", """<html><script>SwaggerUIBundle({ urls: [{ url: "/a1/v1.json", name: "Bir" }, { url: "/a1/v2.json", name: "İki" }] })</script></html>""", "text/html");
        var choices = await (await _client.PostAsJsonAsync("/openapi/fetch", new SpecFetchRequest(localhost + "/a1/swagger/index.html"))).ReadAsync<SpecFetchResult>();
        Assert.Equal(["Bir", "İki"], choices.Choices!.Select(c => c.Name));

        var missing = await _client.PostAsJsonAsync("/openapi/fetch", new SpecFetchRequest(localhost + "/a1/yok.json"));
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
    }
}
