using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Application.Execution;
using Apivator.Domain.Collections;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class ScriptTests(ApivatorApiFactory factory, TestTargetServer target) : IClassFixture<TestTargetServer>
{
    private static ExecutionVariables Vars(Dictionary<string, string>? environment = null) => new()
    {
        Environment = environment ?? [],
        Collection = [],
        Globals = [],
        EnvironmentName = "Test",
    };

    private async Task<ExecuteHttpResponse> RunAsync(
        string url,
        string? pre = null,
        string? post = null,
        ExecutionVariables? variables = null,
        string method = "GET",
        RequestBody? body = null,
        IReadOnlyList<KeyValueItem>? headers = null)
    {
        var (client, _) = await factory.CreateUserAsync();
        var request = new ExecuteHttpRequest(
            method,
            url,
            headers,
            body,
            PreRequestScripts: pre is null ? null : [pre],
            PostResponseScripts: post is null ? null : [post],
            Variables: variables ?? Vars(),
            Info: new ExecutionInfo("Deneme"));
        return await (await client.PostAsJsonAsync("/api/execute", request)).ReadAsync<ExecuteHttpResponse>();
    }

    private async Task<ExecuteHttpResponse> RunAsync(string language, string post)
    {
        var (client, _) = await factory.CreateUserAsync();
        var request = new ExecuteHttpRequest("GET", $"{target.BaseUrl}/echo", null, null, PostResponseScripts: [post], Variables: Vars(), Info: new ExecutionInfo("Deneme"));
        using var message = new HttpRequestMessage(HttpMethod.Post, "/api/execute") { Content = JsonContent.Create(request) };
        message.Headers.TryAddWithoutValidation("Accept-Language", language);
        return await (await client.SendAsync(message)).ReadAsync<ExecuteHttpResponse>();
    }

    private static JsonElement Echo(ExecuteHttpResponse response) => JsonDocument.Parse(response.Body).RootElement;

    [Fact]
    public async Task PreRequest_SetsVariablesAndHeaders_UsedInRequest()
    {
        var response = await RunAsync(
            "{{base}}/echo?id={{id}}",
            pre: """
                pm.environment.set("id", 42);
                pm.variables.set("token", "gizli");
                pm.request.headers.add({ key: "X-Token", value: "{{token}}" });
                console.log("hazır", { id: pm.environment.get("id") });
                """,
            variables: Vars(new() { ["base"] = target.BaseUrl }));

        Assert.Null(response.Error);
        var echo = Echo(response);
        Assert.Equal("?id=42", echo.GetProperty("query").GetString());
        Assert.Equal("gizli", echo.GetProperty("headers").GetProperty("x-token").GetString());
        Assert.Equal("42", response.Variables!.Environment!["id"]);
        var log = Assert.Single(response.Console);
        Assert.Equal(("log", "prerequest"), (log.Level, log.Phase));
        Assert.Contains("hazır", log.Message, StringComparison.Ordinal);
        // Aynı çalıştırmada Postman gibi tipiyle okunur (42), saklanırken metne çevrilir ("42").
        Assert.Contains("\"id\": 42", log.Message, StringComparison.Ordinal);
        Assert.Contains("x-token", response.Request!.Headers.Select(h => h.Key.ToLowerInvariant()));
    }

    [Fact]
    public async Task PostResponse_RunsTestsWithChaiAndResponseAssertions()
    {
        var response = await RunAsync(
            $"{target.BaseUrl}/echo",
            method: "POST",
            body: new RequestBody { Mode = BodyMode.Raw, Raw = "{\"ad\":\"Ayşe\"}", RawLanguage = RawLanguage.Json },
            post: """
                pm.test("durum 200", function () { pm.response.to.have.status(200); });
                pm.test("JSON", () => pm.response.to.be.json);
                pm.test("gövde", function () {
                    const json = pm.response.json();
                    pm.expect(json.method).to.eql("POST");
                    pm.expect(JSON.parse(json.body)).to.have.property("ad", "Ayşe");
                });
                pm.test("bilerek kalan", function () { pm.expect(pm.response.code).to.equal(201); });
                pm.test.skip("atlanan");
                pm.test("süre", () => pm.expect(pm.response.responseTime).to.be.below(10000));
                pm.collectionVariables.set("son", pm.response.json().method);
                """);

        Assert.Null(response.Error);
        Assert.Equal(
            [("durum 200", "passed"), ("JSON", "passed"), ("gövde", "passed"), ("bilerek kalan", "failed"), ("atlanan", "skipped"), ("süre", "passed")],
            response.Tests.Select(t => (t.Name, t.Status)));
        Assert.Contains("expected 200 to equal 201", response.Tests[3].Error, StringComparison.Ordinal);
        Assert.Equal("POST", response.Variables!.Collection!["son"]);
    }

    [Fact]
    public async Task PreRequestError_StopsTheRequest()
    {
        var response = await RunAsync($"{target.BaseUrl}/echo", pre: "const x = 1;\nundefinedFunction();");

        Assert.Equal("script_error", response.Error?.Code);
        Assert.Contains("satır 2", response.Error!.Message, StringComparison.Ordinal);
        Assert.Null(response.Status);
    }

    [Fact]
    public async Task SyntaxError_IsReported()
    {
        var response = await RunAsync($"{target.BaseUrl}/echo", post: "pm.test('x', function () {");

        Assert.Null(response.Error);
        Assert.Contains(response.Console, c => c.Level == "error" && c.Message.Contains("Post-response", StringComparison.Ordinal));
    }

    [Fact]
    public async Task SkipRequest_DoesNotSend()
    {
        var response = await RunAsync($"{target.BaseUrl}/echo", pre: "pm.execution.skipRequest();");

        Assert.True(response.Skipped);
        Assert.Null(response.Request);
    }

    [Fact]
    public async Task SendRequest_CanChainCalls()
    {
        var response = await RunAsync(
            $"{target.BaseUrl}/echo",
            pre: $$"""
                pm.sendRequest({ url: "{{target.BaseUrl}}/echo?from=script", method: "POST", body: { mode: "raw", raw: "x" } }, function (err, res) {
                    pm.environment.set("kaynak", res.json().query);
                    pm.environment.set("kod", res.code);
                });
                """);

        Assert.Equal("?from=script", response.Variables!.Environment!["kaynak"]);
        Assert.Equal("200", response.Variables.Environment["kod"]);
    }

    [Fact]
    public async Task InfiniteLoop_TimesOut()
    {
        var response = await RunAsync($"{target.BaseUrl}/echo", pre: "while (true) {}");

        Assert.Equal("script_error", response.Error?.Code);

        // Hızlı makinede süre dolmadan komut sınırı devreye girer; ikisi de sonsuz döngüyü durdurur.
        Assert.True(
            response.Error!.Message.Contains("süre", StringComparison.Ordinal) || response.Error.Message.Contains("sonsuz döngü", StringComparison.Ordinal),
            response.Error.Message);
    }

    [Fact]
    public async Task Sandbox_HasNoAccessToDotNet()
    {
        var response = await RunAsync(
            $"{target.BaseUrl}/echo",
            post: """
                pm.test("CLR yok", () => {
                    pm.expect(typeof importNamespace).to.equal("undefined");
                    pm.expect(typeof System).to.equal("undefined");
                    pm.expect(typeof __hostSend).to.equal("function");
                });
                """);

        Assert.Equal("passed", Assert.Single(response.Tests).Status);
    }

    [Fact]
    public async Task Libraries_AndLegacyApi_Work()
    {
        var response = await RunAsync(
            $"{target.BaseUrl}/echo",
            post: """
                const hash = CryptoJS.HmacSHA256("mesaj", "anahtar").toString();
                postman.setEnvironmentVariable("hmac", hash);
                pm.environment.set("ilk", _.first([3, 2, 1]));
                pm.environment.set("b64", btoa("apivator"));
                tests["eski API"] = responseCode.code === 200;
                pm.environment.set("kalıcı", pm.variables.get("geçici"));
                """,
            pre: "pm.variables.set('geçici', 'evet');");

        var env = response.Variables!.Environment!;
        Assert.Equal("6f4e1f2bd5b1ac0d43f81d84f1863ea61d65fc9bfcf68cb8ed8b5f0a48093b14".Length, env["hmac"].Length);
        Assert.Equal("3", env["ilk"]);
        Assert.Equal("YXBpdmF0b3I=", env["b64"]);
        Assert.Equal("evet", env["kalıcı"]);
        Assert.Equal(("eski API", "passed"), (response.Tests.Single().Name, response.Tests.Single().Status));
    }

    [Fact]
    public async Task UnresolvedVariable_AfterScripts_IsAnError()
    {
        var response = await RunAsync("{{yok}}/echo", pre: "console.log('çalıştı');");

        Assert.Equal("unresolved_variables", response.Error?.Code);
        Assert.Single(response.Console);
    }

    [Fact]
    public async Task NextRequest_IsReturned()
    {
        var response = await RunAsync($"{target.BaseUrl}/echo", post: "pm.execution.setNextRequest('Token al');");

        Assert.Equal("Token al", response.NextRequest?.Value);
    }

    [Fact]
    public async Task DynamicVariables_InScripts_MatchSharedContract()
    {
        // Ortak sözleşmedeki (src/shared/dynamic-variables.json) her ad pm.variables.replaceIn ile çözülür.
        var names = JsonSerializer.Serialize(DynamicVariableContract.Rules.Select(r => r.Name));
        var unknown = JsonSerializer.Serialize(DynamicVariableContract.Unresolved);
        var before = DateTimeOffset.UtcNow;
        var response = await RunAsync(
            $"{target.BaseUrl}/echo",
            pre: $$$"""
                const names = {{{names}}};
                const out = {};
                for (const name of names) {
                    out[name] = [];
                    for (let i = 0; i < 20; i++) out[name].push(pm.variables.replaceIn("{{" + name + "}}"));
                }
                pm.environment.set("dinamik", JSON.stringify(out));
                pm.environment.set("bilinmeyen", JSON.stringify({{{unknown}}}.map(n => pm.variables.replaceIn("{{" + n + "}}"))));
                pm.environment.set("uuid", require("uuid").v4());
                """);

        Assert.Null(response.Error);
        var now = DateTimeOffset.UtcNow;
        var env = response.Variables!.Environment!;
        var values = JsonSerializer.Deserialize<Dictionary<string, string[]>>(env["dinamik"])!;
        Assert.Equal(DynamicVariableContract.Rules.Count, values.Count);
        foreach (var rule in DynamicVariableContract.Rules)
        {
            foreach (var value in values[rule.Name])
            {
                // Zaman kuralları isteğin başı ya da sonuna göre sağlanmalı (çalışma birkaç saniye sürebilir).
                var problem = DynamicVariableContract.Violation(rule, value, before) is null
                    ? null
                    : DynamicVariableContract.Violation(rule, value, now);
                Assert.True(problem is null, $"{rule.Name}: {problem}: {value}");
            }
        }

        Assert.Equal(
            DynamicVariableContract.Unresolved.Select(n => "{{" + n + "}}"),
            JsonSerializer.Deserialize<string[]>(env["bilinmeyen"])!);
        Assert.Null(DynamicVariableContract.Violation(DynamicVariableContract.Get("$randomUUID"), env["uuid"], now));
    }

    [Fact]
    public async Task HostDynamic_DirectCalls_AreSafe_AndOverwriteDoesNotAffectReplaceIn()
    {
        // Script ev sahibi fonksiyonunu doğrudan çağırabilir ya da üzerine yazabilir: sunucu çökmemeli.
        var response = await RunAsync(
            $"{target.BaseUrl}/echo",
            pre: """
                const out = [];
                for (const arg of [undefined, null, 123, {}, { toString() { return "$guid"; } }, "$yok", "$guid"]) {
                    try { out.push(String(__hostDynamic(arg))); } catch (e) { out.push("hata"); }
                }
                try { out.push(String(__hostDynamic())); } catch (e) { out.push("hata"); }
                __hostDynamic = () => "sahte";
                pm.environment.set("sonuç", JSON.stringify(out));
                pm.environment.set("e", pm.variables.replaceIn("{{$randomEmail}}"));
                """);

        Assert.Null(response.Error);
        var env = response.Variables!.Environment!;
        var results = JsonSerializer.Deserialize<string[]>(env["sonuç"])!;
        Assert.Equal(8, results.Length);
        Assert.Equal("null", results[5]);
        Assert.Null(DynamicVariableContract.Violation(DynamicVariableContract.Get("$guid"), results[6], DateTimeOffset.UtcNow));
        Assert.Null(DynamicVariableContract.Violation(DynamicVariableContract.Get("$randomEmail"), env["e"], DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task HostSend_InvalidDirectCalls_AreScriptErrors_NotServerErrors()
    {
        // Geçersiz argümanla doğrudan çağrı script içinde yakalanabilir bir hata olmalı; sunucu 500 vermemeli.
        var response = await RunAsync(
            $"{target.BaseUrl}/echo",
            pre: """
                const out = [];
                for (const arg of [undefined, null, "null", "{bozuk", 123]) {
                    try { __hostSend(arg); out.push("geçti"); } catch (e) { out.push("hata"); }
                }
                pm.environment.set("sonuç", JSON.stringify(out));
                """);

        Assert.Null(response.Error);
        var results = JsonSerializer.Deserialize<string[]>(response.Variables!.Environment!["sonuç"])!;
        Assert.Equal(["hata", "hata", "hata", "hata", "hata"], results);
    }

    [Fact]
    public async Task ApivatorMessages_FollowTheRequestLanguage_ChaiMessagesStayEnglish()
    {
        const string script = """
            pm.test("durum", () => pm.response.to.have.status(201));
            pm.test("json", () => pm.response.json());
            pm.test("atla", () => pm.execution.skipRequest());
            pm.test("chai", () => pm.expect(pm.response.code).to.equal(201));
            pm.test("sınıf", () => pm.response.to.be.clientError);
            """;

        var english = await RunAsync("en", script);
        Assert.Contains("expected the status code to be 201, got 200", english.Tests[0].Error, StringComparison.Ordinal);
        Assert.Contains("expected the response to be a client error (4xx), status code 200", english.Tests[4].Error, StringComparison.Ordinal);
        Assert.Contains("skipRequest can only be used in the pre-request script.", english.Tests[2].Error, StringComparison.Ordinal);
        Assert.Contains("expected 200 to equal 201", english.Tests[3].Error, StringComparison.Ordinal);

        var turkish = await RunAsync("tr", script);
        Assert.Contains("durum kodunun 201 olması bekleniyordu, gelen 200", turkish.Tests[0].Error, StringComparison.Ordinal);
        Assert.Contains("expected 200 to equal 201", turkish.Tests[3].Error, StringComparison.Ordinal);

        // Değerler JS String() ile yazılır: dizi "a,b" (Jint'in C# ToString'i "(2)[]" yazardı).
        var array = await RunAsync("en", "pm.test(\"gövde\", () => pm.response.to.have.body(['a', 'b']));");
        Assert.Contains("\"a,b\"", array.Tests[0].Error, StringComparison.Ordinal);
    }
}
