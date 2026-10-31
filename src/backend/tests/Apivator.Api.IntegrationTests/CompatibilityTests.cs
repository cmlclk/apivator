using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Apivator.Application.Execution;
using Apivator.Domain.Collections;

namespace Apivator.Api.IntegrationTests;

/// <summary>
/// Postman script uyumluluk seti (depo kökündeki <c>compat/</c>):
/// <list type="bullet">
/// <item><c>compat/cases/*.json</c>: her vaka bir script'i sahte bir yanıtla çalıştırır ve test sonuçlarını,
/// değişkenleri, konsol çıktısını karşılaştırır.</item>
/// <item><c>compat/collections/*.json</c>: ekibin Postman'den dışa aktardığı collection'lar. Her script sahte bir
/// yanıtla çalıştırılır; yalnızca söz dizimi hataları ve desteklenmeyen API'ler (tanımsız global, desteklenmeyen
/// modül) başarısızlık sayılır. Gerçek yanıt olmadığı için doğrulama hataları yok sayılır.</item>
/// </list>
/// Ayrıntılar: <c>compat/README.md</c>.
/// </summary>
[Collection(ApiCollection.Name)]
public partial class CompatibilityTests(ApivatorApiFactory factory, TestTargetServer target) : IClassFixture<TestTargetServer>
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static string CompatDirectory(string sub) => Path.Combine(AppContext.BaseDirectory, "compat", sub);

    private static IEnumerable<string> Files(string sub) =>
        Directory.Exists(CompatDirectory(sub)) ? Directory.GetFiles(CompatDirectory(sub), "*.json").Order() : [];

    public static TheoryData<string> Cases()
    {
        var data = new TheoryData<string>();
        foreach (var file in Files("cases"))
        {
            foreach (var item in JsonDocument.Parse(File.ReadAllText(file)).RootElement.EnumerateArray())
            {
                data.Add($"{Path.GetFileNameWithoutExtension(file)} › {item.GetProperty("name").GetString()}");
            }
        }

        return data;
    }

    public static TheoryData<string> Collections()
    {
        var data = new TheoryData<string>();
        foreach (var file in Files("collections"))
        {
            data.Add(Path.GetFileName(file));
        }

        return data;
    }

    private static JsonElement FindCase(string id)
    {
        var separator = id.IndexOf(" › ", StringComparison.Ordinal);
        var file = Path.Combine(CompatDirectory("cases"), id[..separator] + ".json");
        var name = id[(separator + 3)..];
        return JsonDocument.Parse(File.ReadAllText(file)).RootElement.EnumerateArray().Single(c => c.GetProperty("name").GetString() == name).Clone();
    }

    /// <summary>Script metin ya da satır dizisi olabilir (JSON'da okunaklı yazmak için).</summary>
    private static string? Script(JsonElement owner, string name) =>
        !owner.TryGetProperty(name, out var value) ? null
        : value.ValueKind == JsonValueKind.Array ? string.Join('\n', value.EnumerateArray().Select(l => l.GetString()))
        : value.GetString();

    private static Dictionary<string, string>? Scope(JsonElement owner, string name) =>
        owner.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Object
            ? value.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString()! : p.Value.GetRawText())
            : null;

    private async Task<ExecuteHttpResponse> ExecuteAsync(
        string method,
        string url,
        List<KeyValueItem> headers,
        RequestBody? body,
        string? pre,
        string? post,
        ExecutionVariables variables)
    {
        var (client, _) = await factory.CreateUserAsync();
        var request = new ExecuteHttpRequest(
            method,
            url,
            headers,
            body,
            PreRequestScripts: pre is null ? null : [pre],
            PostResponseScripts: post is null ? null : [post],
            Variables: variables,
            Info: new ExecutionInfo("Uyumluluk"));
        return await (await client.PostAsJsonAsync("/api/execute", request)).ReadAsync<ExecuteHttpResponse>();
    }

    private static KeyValueItem RespondHeader(JsonElement? response) =>
        new("X-Respond", Convert.ToBase64String(Encoding.UTF8.GetBytes(response?.GetRawText() ?? "{\"status\":200}")));

    private static List<string> Errors(ExecuteHttpResponse response) =>
        [
            .. response.Error?.Code == "script_error" ? [response.Error.Message] : Array.Empty<string>(),
            .. response.Console.Where(c => c.Level == "error").Select(c => c.Message),
        ];

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task Case(string id)
    {
        var item = FindCase(id);
        var request = item.TryGetProperty("request", out var r) ? r : default;
        var path = request.ValueKind == JsonValueKind.Object && request.TryGetProperty("url", out var u) ? u.GetString()! : "/respond";
        var headers = new List<KeyValueItem>();
        if (request.ValueKind == JsonValueKind.Object && request.TryGetProperty("headers", out var h))
        {
            headers.AddRange(h.EnumerateObject().Select(p => new KeyValueItem(p.Name, p.Value.GetString()!)));
        }

        JsonElement? response = item.TryGetProperty("response", out var resp) ? resp : null;
        if (path.StartsWith("/respond", StringComparison.Ordinal))
        {
            headers.Add(RespondHeader(response));
        }

        RequestBody? body = request.ValueKind == JsonValueKind.Object && request.TryGetProperty("body", out var b)
            ? new RequestBody { Mode = BodyMode.Raw, Raw = b.ValueKind == JsonValueKind.String ? b.GetString()! : b.GetRawText() }
            : null;
        var vars = item.TryGetProperty("variables", out var v) ? v : default;
        var variables = new ExecutionVariables
        {
            Environment = (vars.ValueKind == JsonValueKind.Object ? Scope(vars, "environment") : null) ?? [],
            Collection = (vars.ValueKind == JsonValueKind.Object ? Scope(vars, "collection") : null) ?? [],
            Globals = (vars.ValueKind == JsonValueKind.Object ? Scope(vars, "globals") : null) ?? [],
            Data = vars.ValueKind == JsonValueKind.Object ? Scope(vars, "data") : null,
            EnvironmentName = "Uyumluluk",
        };
        var method = request.ValueKind == JsonValueKind.Object && request.TryGetProperty("method", out var m) ? m.GetString()! : "GET";
        var url = path.StartsWith("http", StringComparison.Ordinal) ? path : "{{__base}}" + path;
        variables.Globals!["__base"] = target.BaseUrl;

        var result = await ExecuteAsync(method, url, headers, body, Script(item, "prerequest"), Script(item, "test"), variables);

        var expect = item.TryGetProperty("expect", out var e) ? e : default;
        var errors = Errors(result);
        if (expect.ValueKind == JsonValueKind.Object && expect.TryGetProperty("error", out var expectedError))
        {
            Assert.Contains(errors, x => x.Contains(expectedError.GetString()!, StringComparison.Ordinal));
        }
        else
        {
            Assert.True(errors.Count == 0, $"Script hatası: {string.Join(" | ", errors)}");
        }

        if (expect.ValueKind == JsonValueKind.Object && expect.TryGetProperty("tests", out var tests))
        {
            foreach (var test in tests.EnumerateObject())
            {
                var actual = result.Tests.FirstOrDefault(t => t.Name == test.Name);
                Assert.True(actual is not null, $"\"{test.Name}\" testi çalışmadı. Çalışanlar: {string.Join(", ", result.Tests.Select(t => t.Name))}");
                Assert.True(actual!.Status == test.Value.GetString(), $"\"{test.Name}\": beklenen {test.Value.GetString()}, gelen {actual.Status} ({actual.Error})");
            }
        }
        else if (!(expect.ValueKind == JsonValueKind.Object && expect.TryGetProperty("error", out _)))
        {
            Assert.NotEmpty(result.Tests);
            var failed = result.Tests.Where(t => t.Status != TestResultDto.Passed).ToList();
            Assert.True(failed.Count == 0, string.Join(" | ", failed.Select(t => $"{t.Name}: {t.Status} {t.Error}")));
        }

        foreach (var (scope, actual) in new[]
        {
            ("environment", result.Variables?.Environment),
            ("collection", result.Variables?.Collection),
            ("globals", result.Variables?.Globals),
        })
        {
            if (expect.ValueKind != JsonValueKind.Object || Scope(expect, scope) is not { } expected)
            {
                continue;
            }

            foreach (var (key, value) in expected)
            {
                if (value == "<yok>")
                {
                    Assert.False(actual?.ContainsKey(key) == true, $"{scope}.{key} silinmiş olmalıydı");
                }
                else if (value.StartsWith("~/", StringComparison.Ordinal))
                {
                    Assert.True(actual?.TryGetValue(key, out var got) == true && Regex.IsMatch(got, value[2..^1]), $"{scope}.{key} = {actual?.GetValueOrDefault(key)} /{value[2..^1]}/ ile eşleşmiyor");
                }
                else
                {
                    Assert.True(actual?.GetValueOrDefault(key) == value, $"{scope}.{key}: beklenen {value}, gelen {actual?.GetValueOrDefault(key)}");
                }
            }
        }

        if (expect.ValueKind == JsonValueKind.Object && expect.TryGetProperty("console", out var console))
        {
            foreach (var line in console.EnumerateArray())
            {
                Assert.True(result.Console.Any(c => c.Message.Contains(line.GetString()!, StringComparison.Ordinal)), $"Konsolda \"{line.GetString()}\" yok: {string.Join(" | ", result.Console.Select(c => c.Message))}");
            }
        }

        if (expect.ValueKind == JsonValueKind.Object && expect.TryGetProperty("nextRequest", out var next))
        {
            Assert.Equal(next.ValueKind == JsonValueKind.Null ? null : next.GetString(), result.NextRequest?.Value);
        }
    }

    [GeneratedRegex(@"SyntaxError|ReferenceError|desteklenmiyor|is not defined|is not a function|Unexpected token")]
    private static partial Regex Unsupported();

    /// <summary>Ekibin collection'larındaki her script desteklenmeyen bir şey kullanmıyor mu?</summary>
    [Theory]
    [MemberData(nameof(Collections))]
    public async Task Collection(string file)
    {
        var root = JsonDocument.Parse(File.ReadAllText(Path.Combine(CompatDirectory("collections"), file))).RootElement;
        var problems = new List<string>();
        var count = 0;
        foreach (var (path, pre, post) in Scripts(root, ""))
        {
            count++;
            // Gerçek yanıt yok: boş bir JSON nesnesi döner. Yanıta bağlı doğrulamaların kalması beklenir.
            var result = await ExecuteAsync(
                "GET",
                "{{__base}}/respond",
                [RespondHeader(JsonDocument.Parse("{\"status\":200,\"headers\":{\"Content-Type\":\"application/json\"},\"body\":\"{}\"}").RootElement)],
                null,
                pre,
                post,
                new ExecutionVariables { Environment = [], Collection = [], Globals = new() { ["__base"] = target.BaseUrl } });
            var messages = Errors(result).Concat(result.Tests.Where(t => t.Error is not null).Select(t => t.Error!));
            problems.AddRange(messages.Where(x => Unsupported().IsMatch(x)).Distinct().Select(x => $"{path}: {x}"));
        }

        Assert.True(count > 0, $"{file} içinde script bulunamadı.");
        Assert.True(problems.Count == 0, $"{file}: {problems.Count} uyumsuzluk:\n" + string.Join('\n', problems));
    }

    private static IEnumerable<(string Path, string? Pre, string? Post)> Scripts(JsonElement node, string path)
    {
        string? Event(string listen) =>
            node.TryGetProperty("event", out var events)
                ? string.Join('\n', events.EnumerateArray()
                    .Where(e => e.GetProperty("listen").GetString() == listen && e.TryGetProperty("script", out _))
                    .SelectMany(e => e.GetProperty("script").TryGetProperty("exec", out var exec)
                        ? exec.ValueKind == JsonValueKind.Array ? exec.EnumerateArray().Select(l => l.GetString() ?? string.Empty) : [exec.GetString() ?? string.Empty]
                        : []))
                : null;

        var name = node.TryGetProperty("name", out var n) ? n.GetString() : node.TryGetProperty("info", out var info) ? info.GetProperty("name").GetString() : "?";
        var here = path.Length == 0 ? name! : $"{path} / {name}";
        var pre = Event("prerequest");
        var post = Event("test");
        if (!string.IsNullOrWhiteSpace(pre) || !string.IsNullOrWhiteSpace(post))
        {
            yield return (here, string.IsNullOrWhiteSpace(pre) ? null : pre, string.IsNullOrWhiteSpace(post) ? null : post);
        }

        if (node.TryGetProperty("item", out var items))
        {
            foreach (var child in items.EnumerateArray())
            {
                foreach (var script in Scripts(child, here))
                {
                    yield return script;
                }
            }
        }
    }
}
