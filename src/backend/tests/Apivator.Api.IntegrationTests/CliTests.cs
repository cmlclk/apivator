using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Xml.Linq;
using Apivator.Application.ApiKeys;
using Apivator.Application.Collections;
using Apivator.Application.Environments;
using Apivator.Application.Runs;
using Apivator.Cli;
using Apivator.Domain.Collections;
using Apivator.Domain.Runs;
using Apivator.Domain.Variables;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public sealed class CliTests(ApivatorApiFactory factory, TestTargetServer target) : IClassFixture<TestTargetServer>, IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("apivator-cli-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private sealed record Captured(int ExitCode, string Out, string Error);

    private Task<Captured> CliAsync(params string[] args) => CliWithLangAsync(null, null, args);

    private async Task<Captured> CliWithLangAsync(string? osLanguage, string? envLang, params string[] args)
    {
        var output = new StringWriter();
        var error = new StringWriter();
        var console = new CliConsole(output, error, Color: false, Environment: name => name == "APIVATOR_LANG" ? envLang : null, SystemLanguage: osLanguage);
        var code = await CliApp.RunAsync(args, console, CancellationToken.None, factory.Server.CreateHandler());
        return new Captured(code, output.ToString(), error.ToString());
    }

    private string Write(string name, string content)
    {
        var path = Path.Combine(_dir, name);
        File.WriteAllText(path, content);
        return path;
    }

    /// <summary>Postman v2.1 biçiminde iki istek: biri geçen, biri isteğe bağlı olarak kalan testle.</summary>
    private string CollectionFile(bool failing) => Write("collection.json", $$"""
        {
          "info": { "name": "Dosyadan", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
          "variable": [{ "key": "base", "value": "{{target.BaseUrl}}" }],
          "item": [
            { "name": "Klasör", "item": [
              { "name": "Echo", "request": { "method": "GET", "url": "{{"{{"}}base{{"}}"}}/echo?u={{"{{"}}user{{"}}"}}&t={{"{{"}}token{{"}}"}}" },
                "event": [{ "listen": "test", "script": { "exec": [
                  "pm.test('200', () => pm.response.to.have.status(200));",
                  "pm.test('veri ve değişken geldi', () => pm.expect(pm.response.json().query).to.include('u=' + pm.iterationData.get('user')).and.include('t=gizli'));"
                ] } }] }
            ]},
            { "name": "Durum", "request": { "method": "GET", "url": "{{"{{"}}base{{"}}"}}/status/404" },
              "event": [{ "listen": "test", "script": { "exec": ["pm.test('404', () => pm.response.to.have.status({{(failing ? 200 : 404)}}));"] } }] }
          ]
        }
        """);

    [Fact]
    public async Task FileMode_RunsWithDataAndVariables_WritesReports_AndExitCodeFollowsTests()
    {
        var collection = CollectionFile(failing: true);
        var data = Write("data.csv", "user\nayse\nbora\n");
        var junit = Path.Combine(_dir, "out", "junit.xml");
        var html = Path.Combine(_dir, "out", "rapor.html");

        var run = await CliAsync("run", collection, "-d", data, "--env-var", "token=gizli", "-r", "cli", "--reporter-junit-export", junit, "--reporter-html-export", html);

        Assert.True(run.ExitCode == CliApp.Failed, run.Out + run.Error);
        Assert.True(run.Out.Contains("✓ veri ve değişken geldi", StringComparison.Ordinal), run.Out);
        Assert.Contains("İterasyon 2/2", run.Out, StringComparison.Ordinal);
        Assert.Contains("✓ veri ve değişken geldi", run.Out, StringComparison.Ordinal);
        Assert.Contains("✗ Başarısız", run.Out, StringComparison.Ordinal);

        var suites = XDocument.Load(junit).Root!;
        Assert.Equal(("6", "2", "0"), ((string)suites.Attribute("tests")!, (string)suites.Attribute("failures")!, (string)suites.Attribute("errors")!));
        Assert.Equal(4, suites.Elements("testsuite").Count());
        Assert.Contains("<strong>Durum</strong> <span class=\"muted\">#2</span>", File.ReadAllText(html), StringComparison.Ordinal);

        Assert.Equal(CliApp.Success, (await CliAsync("run", collection, "-d", data, "--env-var", "token=gizli", "--suppress-exit-code")).ExitCode);
        Assert.Equal(CliApp.Success, (await CliAsync("run", CollectionFile(failing: false), "-d", data, "--env-var", "token=gizli")).ExitCode);
    }

    [Fact]
    public async Task Bail_StopsAtFirstFailure_AndFolderRunsOnlyThatFolder()
    {
        var collection = CollectionFile(failing: true);
        var bail = await CliAsync("run", collection, "-n", "3", "--bail", "-r", "json", "--reporter-json-export", Path.Combine(_dir, "r.json"));
        Assert.Equal(CliApp.Failed, bail.ExitCode);
        var json = File.ReadAllText(Path.Combine(_dir, "r.json"));
        Assert.True(json.Contains("\"stopReason\": \"--bail", StringComparison.Ordinal), json[..Math.Min(json.Length, 600)]);
        // İlk istekte (veri ve değişken yok) test kalır; diğer istek ve iterasyonlar çalışmaz.
        Assert.Contains("\"requests\": {\n      \"total\": 1,", json.ReplaceLineEndings("\n"), StringComparison.Ordinal);

        var folder = await CliAsync("run", collection, "--folder", "klasör", "--env-var", "token=gizli", "--env-var", "user=x", "--iteration-count", "1");
        Assert.DoesNotContain("→ Durum", folder.Out, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(new[] { "run" }, "collection'ı verin")]
    [InlineData(new[] { "run", "yok.json" }, "bir dosya değil")]
    [InlineData(new[] { "run", "x", "--bilinmeyen" }, "Bilinmeyen seçenek")]
    [InlineData(new[] { "run", "x", "-n", "0" }, "arasında bir sayı")]
    [InlineData(new[] { "run", "x", "--server", "http://localhost" }, "hem --server hem --api-key")]
    [InlineData(new[] { "uç" }, "Bilinmeyen komut")]
    public async Task UsageErrors_ExitWith2(string[] args, string message)
    {
        var result = await CliAsync(args);
        Assert.Equal(CliApp.UsageError, result.ExitCode);
        Assert.Contains(message, result.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ServerMode_RunsCollectionByName_WithEnvironment_AndSavesCliReport()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("Ödeme API"))).ReadAsync<CollectionTreeDto>();
        await (await client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("Echo", null, new RequestDefinition
        {
            Url = "{{base}}/echo",
            Scripts = new ScriptSet { PostResponse = "pm.test('ok', () => pm.response.to.have.status(200));" },
        }))).ReadAsync<ApiRequestDto>();
        await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/environments", new CreateEnvironmentRequest("Test", [new Variable("base", target.BaseUrl)]))).ReadAsync<EnvironmentDto>();
        var key = await (await client.PostAsJsonAsync("/api/me/api-keys", new CreateApiKeyRequest("CI"))).ReadAsync<CreatedApiKeyDto>();

        var listed = await CliAsync("list", "--server", "http://localhost", "--api-key", key.Secret);
        Assert.Contains($"Ödeme API  {collection.Id}", listed.Out, StringComparison.Ordinal);

        var run = await CliAsync("run", "ödeme api", "--server", "http://localhost", "--api-key", key.Secret, "-e", "Test");
        Assert.True(run.ExitCode == CliApp.Success, run.Out + run.Error);
        Assert.Contains("environment: Test", run.Out, StringComparison.Ordinal);
        Assert.Contains("Rapor sunucuya kaydedildi", run.Out, StringComparison.Ordinal);

        var runs = await client.GetFromJsonAsync<List<RunSummaryDto>>($"/api/workspaces/{workspaceId}/runs?collectionId={collection.Id}");
        var saved = Assert.Single(runs!);
        Assert.Equal((RunOrigin.Cli, "Test", 1, 1), (saved.Origin, saved.EnvironmentName, saved.TestsPassed, saved.TotalRequests));

        var wrong = await CliAsync("run", "Ödeme API", "--server", "http://localhost", "--api-key", "apv_yanlis");
        Assert.Equal(CliApp.UsageError, wrong.ExitCode);
        Assert.Contains("API anahtarı geçersiz", wrong.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ApiKey_IsShownOnce_ReadsAndReports_ButCannotChangeAnything()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var created = await (await client.PostAsJsonAsync("/api/me/api-keys", new CreateApiKeyRequest("GitHub Actions", 30))).ReadAsync<CreatedApiKeyDto>();
        Assert.StartsWith(created.Key.Prefix, created.Secret, StringComparison.Ordinal);
        Assert.NotNull(created.Key.ExpiresAt);

        var listed = Assert.Single((await client.GetFromJsonAsync<List<ApiKeyDto>>("/api/me/api-keys"))!);
        Assert.Equal(("GitHub Actions", created.Key.Prefix), (listed.Name, listed.Prefix));

        var keyClient = factory.CreateClient();
        keyClient.DefaultRequestHeaders.Add("X-Api-Key", created.Secret);
        Assert.Equal(HttpStatusCode.OK, (await keyClient.GetAsync("/api/workspaces")).StatusCode);

        var write = await keyClient.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("Olmamalı"));
        Assert.Equal(HttpStatusCode.Forbidden, write.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await keyClient.GetAsync("/api/me/api-keys")).StatusCode);

        // Son kullanım zamanı yazılır.
        Assert.NotNull(Assert.Single((await client.GetFromJsonAsync<List<ApiKeyDto>>("/api/me/api-keys"))!).LastUsedAt);

        (await client.DeleteAsync($"/api/me/api-keys/{created.Key.Id}")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await keyClient.GetAsync("/api/workspaces")).StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<ApiKeyDto>>("/api/me/api-keys"))!);

        var bearer = factory.CreateClient();
        bearer.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "apv_hicbiryerde");
        Assert.Equal(HttpStatusCode.Unauthorized, (await bearer.GetAsync("/api/workspaces")).StatusCode);
    }

    [Fact]
    public async Task Lang_EnglishHelpAndErrors_AndOsLanguageAndPrecedence()
    {
        var help = await CliAsync("--help", "--lang", "en");
        Assert.Contains("runs collections on the command line", help.Out, StringComparison.Ordinal);
        Assert.Contains("--lang <tr|en>", help.Out, StringComparison.Ordinal);

        var usage = await CliAsync("run", "x", "--bilinmeyen", "--lang=en");
        Assert.Equal(CliApp.UsageError, usage.ExitCode);
        Assert.Contains("Error: Unknown option", usage.Error, StringComparison.Ordinal);

        Assert.Contains("Desteklenmeyen dil: de", (await CliAsync("run", "x", "--lang", "de")).Error, StringComparison.Ordinal);

        // İşletim sistemi dili, APIVATOR_LANG ve --lang öncelik sırası; desteklenmeyen dil Türkçe'ye düşer.
        Assert.Contains("Kullanım:", (await CliWithLangAsync(null, null, "--help")).Out, StringComparison.Ordinal);
        Assert.Contains("Usage:", (await CliWithLangAsync("en-US", null, "--help")).Out, StringComparison.Ordinal);
        Assert.Contains("Kullanım:", (await CliWithLangAsync("de-DE", null, "--help")).Out, StringComparison.Ordinal);
        Assert.Contains("Usage:", (await CliWithLangAsync("tr-TR", "en", "--help")).Out, StringComparison.Ordinal);
        Assert.Contains("Kullanım:", (await CliWithLangAsync("en-US", "en", "--help", "--lang", "tr")).Out, StringComparison.Ordinal);

        // Başka bir seçeneğin değeri olarak geçen "--lang" dil sayılmaz.
        Assert.Equal("tr", CliOptions.ResolveLanguage(["run", "x", "--env-var", "--lang=en"], _ => null, null));
        Assert.Equal("en", CliOptions.ResolveLanguage(["run", "x", "-e", "env.json", "--lang", "en"], _ => null, null));
    }

    [Fact]
    public async Task Lang_English_ReportsAreEnglish_ButJsonAndExitCodeAreLanguageIndependent()
    {
        var collection = CollectionFile(failing: true);
        var data = Write("data.csv", "user\nayse\nbora\n");
        var results = new Dictionary<string, (Captured Run, string Json)>();
        foreach (var lang in new[] { "tr", "en" })
        {
            var json = Path.Combine(_dir, $"{lang}.json");
            var html = Path.Combine(_dir, $"{lang}.html");
            var run = await CliAsync("run", collection, "-d", data, "--env-var", "token=gizli", "--lang", lang, "-r", "cli", "--reporter-json-export", json, "--reporter-html-export", html);
            results[lang] = (run, File.ReadAllText(json));
            var page = File.ReadAllText(html);
            Assert.Contains(lang == "en" ? "<html lang=\"en\">" : "<html lang=\"tr\">", page, StringComparison.Ordinal);
            Assert.Contains(lang == "en" ? "tests failed" : "kalan test", page, StringComparison.Ordinal);
        }

        Assert.Equal(CliApp.Failed, results["en"].Run.ExitCode);
        Assert.Equal(results["tr"].Run.ExitCode, results["en"].Run.ExitCode);
        Assert.Contains("✗ Failed", results["en"].Run.Out, StringComparison.Ordinal);
        Assert.Contains("Iteration 2/2", results["en"].Run.Out, StringComparison.Ordinal);

        // Zaman damgaları ve süreler dışında yapı ve değerler aynıdır.
        // Betik hata iletileri insan içindir ve dile uyar; yapı ve diğer değerler aynı kalır.
        static string Normalize(string json) => System.Text.RegularExpressions.Regex.Replace(json, "\"(startedAt|finishedAt|timeMs|size|requestId)\": [^,\n]+|\"(error|message)\": \"[^\"]*\"", "\"x\": 0");
        Assert.Equal(Normalize(results["tr"].Json), Normalize(results["en"].Json));
    }

    [Fact]
    public async Task ServerMode_SendsAcceptLanguage()
    {
        var (client, _) = await factory.CreateUserAsync();
        var key = await (await client.PostAsJsonAsync("/api/me/api-keys", new CreateApiKeyRequest("CI"))).ReadAsync<CreatedApiKeyDto>();

        // Sunucu hatası etkin dilde gelir (geçersiz anahtar CLI'ın kendi iletisiyle).
        var wrong = await CliAsync("list", "--server", "http://localhost", "--api-key", "apv_yanlis", "--lang", "en");
        Assert.Contains("The API key is invalid", wrong.Error, StringComparison.Ordinal);

        var headers = new List<string>();
        var spy = new HeaderSpy(factory.Server.CreateHandler(), request => headers.Add(request.Headers.AcceptLanguage.ToString()));
        var console = new CliConsole(new StringWriter(), new StringWriter(), Color: false, Environment: _ => null);
        await CliApp.RunAsync(["list", "--server", "http://localhost", "--api-key", key.Secret, "--lang", "en"], console, CancellationToken.None, spy);
        Assert.NotEmpty(headers);
        Assert.All(headers, h => Assert.Equal("en", h));
    }

    private sealed class HeaderSpy(HttpMessageHandler inner, Action<HttpRequestMessage> onRequest) : DelegatingHandler(inner)
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            onRequest(request);
            return base.SendAsync(request, cancellationToken);
        }
    }
}
