using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using Apivator.Application.GitSync;
using Apivator.Infrastructure.GitSync;
using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Api.IntegrationTests;

// Ağ hataları, yavaş gövde (slowloris), kilit anahtarı ve adres biçimi dayanıklılığı.
public sealed partial class GitSyncTests
{
    [Fact]
    public async Task StalledBody_HitsTheDeadline_AndReportsGenericError()
    {
        Factory.CreateClient().Dispose();
        var remote = Factory.Services.GetRequiredService<IGitRemote>();
        var port = Random.Shared.Next(20000, 40000);
        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        _ = Task.Run(async () =>
        {
            var context = await listener.GetContextAsync();
            context.Response.SendChunked = true;
            context.Response.ContentType = "application/x-git-upload-pack-advertisement";
            await context.Response.OutputStream.WriteAsync("001e# service=git-upload-pack\n"u8.ToArray());
            await context.Response.OutputStream.FlushAsync();
            await Task.Delay(TimeSpan.FromSeconds(60));
        });
        var previous = GuardedGit.Timeout;
        GuardedGit.Timeout = TimeSpan.FromSeconds(2);
        try
        {
            var watch = Stopwatch.StartNew();
            var error = await Assert.ThrowsAsync<GitRemoteException>(() => remote.ReadAsync(new GitRemoteSpec($"http://127.0.0.1:{port}/r.git", "main", null, null), "apivator"));

            Assert.True(watch.Elapsed < TimeSpan.FromSeconds(30));
            Assert.Contains("bağlanılamadı", error.Message);
            Assert.DoesNotContain("127.0.0.1", error.Message);
        }
        finally
        {
            GuardedGit.Timeout = previous;
        }
    }

    [Fact]
    public async Task ClosedPort_IsReportedAsGenericError_NotServerError()
    {
        var s = await SetupAsync();
        (await ConnectAsync(s.Admin, s.CollectionId, "http://127.0.0.1:1/r.git")).EnsureSuccessStatusCode();

        var forEditor = await s.Editor.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest());

        Assert.Equal(HttpStatusCode.BadRequest, forEditor.StatusCode);
        var text = await forEditor.Content.ReadAsStringAsync();
        Assert.Contains("bağlanılamadı", text);
        Assert.DoesNotContain("127.0.0.1", text);
        var forAdmin = await (await s.Admin.Client.PostAsJsonAsync($"/api/collections/{s.CollectionId}/git/push", new PushGitRequest())).Content.ReadAsStringAsync();
        Assert.Contains("Ayrıntı", forAdmin);
    }

    [Fact]
    public async Task AdvisoryLock_DoesNotBlockOtherCollections_ButBlocksTheSameOne()
    {
        await using var scope = Factory.Services.CreateAsyncScope();
        var gitLock = scope.ServiceProvider.GetRequiredService<IGitLock>();
        var first = Guid.CreateVersion7();
        var second = Guid.CreateVersion7();

        await using var held = await gitLock.AcquireAsync(first);
        using var shortWait = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await using (await gitLock.AcquireAsync(second, shortWait.Token))
        {
            // başka collection engellenmedi
        }

        using var blockedWait = new CancellationTokenSource(TimeSpan.FromSeconds(1));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await gitLock.AcquireAsync(first, blockedWait.Token));
    }

    [Theory]
    [InlineData("https:/good.test/r.git")]
    [InlineData("HTTPS:good.test/r.git")]
    public async Task Connect_RejectsMalformedSchemeSeparators(string url)
    {
        var s = await SetupAsync();

        Assert.Equal(HttpStatusCode.BadRequest, (await ConnectAsync(s.Admin, s.CollectionId, url)).StatusCode);
    }
}
