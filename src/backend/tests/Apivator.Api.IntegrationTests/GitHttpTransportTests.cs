using Apivator.Application.GitSync;
using LibGit2Sharp;
using Microsoft.Extensions.DependencyInjection;

namespace Apivator.Api.IntegrationTests;

/// <summary>Özel smart-HTTP aktarımını gerçek bir git sunucusuyla (<c>git http-backend</c>) dener; git yoksa atlanır.</summary>
[Collection(ApiCollection.Name)]
public sealed class GitHttpTransportTests(ApivatorApiFactory factory)
{
    [Fact]
    public async Task PushThenFetch_WorksOverGuardedHttp_IncludingShallowFetch()
    {
        using var server = GitHttpFixture.Create("ali", "tok");
        if (server is null)
        {
            return; // git yüklü değil: atlandı
        }

        factory.CreateClient().Dispose();
        var remote = factory.Services.GetRequiredService<IGitRemote>();
        var spec = new GitRemoteSpec(server.Url, "main", "ali", "tok");
        var author = new GitAuthor("Test", "t@example.com");

        var first = await remote.PushAsync(spec, "apivator", new Dictionary<string, string> { ["collection.json"] = "{ \"name\": \"A\" }\n" }, null, "ilk", author);
        var tree = await remote.ReadAsync(spec, "apivator");
        var second = await remote.PushAsync(spec, "apivator", new Dictionary<string, string> { ["collection.json"] = "{ \"name\": \"B\" }\n", ["Yeni.request.json"] = "{}\n" }, tree.Head, "ikinci", author);
        var after = await remote.ReadAsync(spec, "apivator");

        Assert.NotNull(first);
        Assert.Equal(first, tree.Head);
        Assert.Single(tree.Files);
        Assert.NotNull(second);
        Assert.Equal(second, after.Head);
        Assert.Equal(["Yeni.request.json", "collection.json"], after.Files.Keys.Order(StringComparer.Ordinal));
        using var bare = new Repository(server.BarePath);
        Assert.Equal(2, bare.Branches["main"].Commits.Count());
        Assert.Equal(0, server.Rejected);
    }
}
