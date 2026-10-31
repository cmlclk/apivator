using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class HealthTests(ApivatorApiFactory factory)
{
    [Theory]
    [InlineData("/health/live")]
    [InlineData("/health/ready")]
    public async Task HealthEndpoints_ReturnOk(string path)
    {
        var response = await factory.CreateClient().GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Ping_IsAnonymousNoContent()
    {
        var response = await factory.CreateClient().GetAsync("/api/ping");
        Assert.Equal(System.Net.HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Ready_ReportsDatabaseAndVersion_AsJson()
    {
        var body = await factory.CreateClient().GetFromJsonAsync<JsonElement>("/health/ready");
        Assert.Equal("Healthy", body.GetProperty("status").GetString());
        Assert.Equal("Healthy", body.GetProperty("checks").GetProperty("postgres").GetString());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("version").GetString()));
    }

    [Fact]
    public async Task RequestLog_HasPathStatusAndUser_ButNeverTheQueryString()
    {
        var logs = new ListLoggerProvider();
        using var app = factory.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<ILoggerProvider>(logs)));
        var client = app.CreateClient();
        await client.GetAsync("/api/invitations/preview?token=COK-GIZLI-TOKEN");
        var authed = app.CreateClient();
        authed.WithBearer((await authed.RegisterAsync(TestHelpers.NewEmail())).AccessToken);
        await authed.GetAsync("/api/workspaces");

        var lines = logs.Messages.Where(m => m.Category == "Apivator.Requests").Select(m => m.Text).ToList();
        Assert.Contains(lines, l => l.StartsWith("HTTP GET /api/invitations/preview 4", StringComparison.Ordinal));
        Assert.Contains(lines, l => l.StartsWith("HTTP GET /api/workspaces 200", StringComparison.Ordinal) && !l.EndsWith("ms ", StringComparison.Ordinal));
        Assert.DoesNotContain(logs.Messages, m => m.Text.Contains("COK-GIZLI-TOKEN", StringComparison.Ordinal));
    }

    private sealed class ListLoggerProvider : ILoggerProvider
    {
        public System.Collections.Concurrent.ConcurrentQueue<(string Category, string Text)> Messages { get; } = new();

        public ILogger CreateLogger(string categoryName) => new ListLogger(categoryName, Messages);

        public void Dispose()
        {
        }

        private sealed class ListLogger(string category, System.Collections.Concurrent.ConcurrentQueue<(string, string)> messages) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
                messages.Enqueue((category, formatter(state, exception)));
        }
    }
}
