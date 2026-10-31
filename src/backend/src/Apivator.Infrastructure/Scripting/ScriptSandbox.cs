using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Apivator.Domain.Collections;
using Jint;
using Jint.Native;
using Jint.Runtime;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Scripting;

/// <summary>Script'lerin üzerinde çalıştığı istek (pm.request).</summary>
internal sealed record ScriptRequestModel(
    string Method,
    string Url,
    IReadOnlyList<KeyValueItem> Headers,
    RequestBody Body,
    RequestAuth? Auth);

/// <summary>Değişken kapsamlarının çalışma sırasındaki hâli. Local, <c>pm.variables.set</c> içindir.</summary>
internal sealed class ScriptVariables
{
    public Dictionary<string, string>? Environment { get; set; }

    public Dictionary<string, string>? Collection { get; set; }

    public Dictionary<string, string>? Globals { get; set; }

    public Dictionary<string, string> Data { get; set; } = [];

    public Dictionary<string, string> Local { get; set; } = [];

    public string? EnvironmentName { get; set; }

    public static ScriptVariables From(ExecutionVariables? source) => new()
    {
        Environment = source?.Environment is null ? null : new(source.Environment),
        Collection = source?.Collection is null ? null : new(source.Collection),
        Globals = source?.Globals is null ? null : new(source.Globals),
        Data = source?.Data is null ? [] : new(source.Data),
        EnvironmentName = source?.EnvironmentName,
    };

    /// <summary>Öncelik: local &gt; iterasyon verisi &gt; environment &gt; collection &gt; globals.</summary>
    public string? Lookup(string name) =>
        Local.TryGetValue(name, out var local) ? local
        : Data.TryGetValue(name, out var data) ? data
        : Environment is not null && Environment.TryGetValue(name, out var env) ? env
        : Collection is not null && Collection.TryGetValue(name, out var col) ? col
        : Globals is not null && Globals.TryGetValue(name, out var glob) ? glob
        : null;

    public ExecutionVariables ToDto() => new()
    {
        Environment = Environment,
        Collection = Collection,
        Globals = Globals,
        EnvironmentName = EnvironmentName,
    };
}

internal sealed record SandboxResult(
    ScriptRequestModel Request,
    ScriptVariables Variables,
    IReadOnlyList<TestResultDto> Tests,
    IReadOnlyList<ConsoleEntryDto> Console,
    NextRequestDto? NextRequest,
    bool Skip,
    string? Error);

/// <summary>
/// Kullanıcı script'lerini Jint ile yalıtılmış çalıştırır. .NET nesnelerine erişim yoktur (CLR kapalı); süre,
/// bellek, özyineleme ve komut sayısı sınırlıdır. Her aşama yeni bir motorda çalışır.
/// </summary>
internal sealed partial class ScriptSandbox(IRequestExecutor executor, IOptionsMonitor<ScriptOptions> options)
{
    public const string PreRequest = "prerequest";
    public const string Test = "test";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly ConcurrentDictionary<string, Prepared<Acornima.Ast.Script>> Prepared = new();

    [GeneratedRegex(@"\bexpect\b|chai")]
    private static partial Regex UsesChai();

    [GeneratedRegex(@"\b_\s*\.|lodash")]
    private static partial Regex UsesLodash();

    [GeneratedRegex(@"CryptoJS|crypto-js")]
    private static partial Regex UsesCryptoJs();

    [GeneratedRegex(@"\bmoment\b")]
    private static partial Regex UsesMoment();

    // tv4 hem doğrudan hem de pm.response.to.have.jsonSchema için kullanılır.
    [GeneratedRegex(@"\btv4\b|jsonSchema")]
    private static partial Regex UsesTv4();

    public SandboxResult Run(
        string phase,
        IReadOnlyList<(string Source, string Code)> scripts,
        ScriptRequestModel request,
        ExecuteHttpResponse? response,
        ScriptVariables variables,
        ExecutionInfo? info,
        CancellationToken ct)
    {
        var settings = options.CurrentValue;
        var engine = new Engine(o => o
            .LimitMemory(settings.MemoryLimitMb * 1024L * 1024L)
            .TimeoutInterval(TimeSpan.FromSeconds(settings.TimeoutSeconds))
            .LimitRecursion(512)
            .MaxStatements(50_000_000)
            .CancellationToken(ct));

        var sendCount = 0;
        engine.SetValue("__input", JsonSerializer.Serialize(new
        {
            phase,
            request,
            response = response is null ? null : new
            {
                status = response.Status,
                statusText = response.StatusText,
                headers = response.Headers,
                body = response.Body,
                bodyEncoding = response.BodyEncoding,
                size = response.Size,
                timeMs = response.TimeMs,
            },
            variables = new
            {
                environment = variables.Environment,
                collection = variables.Collection,
                globals = variables.Globals,
                data = variables.Data,
                local = variables.Local,
                environmentName = variables.EnvironmentName,
            },
            info,
        }, Json));
        engine.SetValue("__hostSend", new Func<string?, string>(json =>
        {
            if (++sendCount > settings.MaxSendRequests)
            {
                throw new JavaScriptException(L.T("script.send_limit", "Bir script en fazla {max} pm.sendRequest çağırabilir.", ("max", settings.MaxSendRequests)));
            }

            return SendFromScript(json, ct);
        }));

        // Dinamik değişkenler runner ile aynı üreteçten: aynı adlar, biçimler ve kriptografik rastgelelik.
        // Script doğrudan da çağırabilir: null/undefined argüman ev sahibinde istisnaya (500) dönüşmesin.
        engine.SetValue("__msg", new Func<string, JsValue, string>((id, args) => ScriptMessages.Get(id, args)));
        engine.SetValue("__hostDynamic", new Func<string?, string?>(name => name is null ? null : VariableResolver.Dynamic(name)));

        var combined = string.Join('\n', scripts.Select(s => s.Code));
        string? error = null;
        try
        {
            if (UsesChai().IsMatch(combined))
            {
                engine.Execute(Library("chai.js"));
            }

            if (UsesLodash().IsMatch(combined))
            {
                engine.Execute(Library("lodash.min.js"));
            }

            if (UsesCryptoJs().IsMatch(combined))
            {
                engine.Execute(Library("crypto-js.js"));
            }

            if (UsesMoment().IsMatch(combined))
            {
                engine.Execute(Library("moment.min.js"));
            }

            if (UsesTv4().IsMatch(combined))
            {
                engine.Execute(Library("tv4.js"));
            }

            engine.Execute(Library("sandbox.js"));

            foreach (var (source, code) in scripts)
            {
                engine.Invoke("__beforeScript");
                try
                {
                    // Satır numaraları kullanıcının gördüğüyle aynı kalsın diye sarmalayıcı ilk satırda.
                    engine.Execute("(function () {" + code + "\n})();", source);
                    engine.Advanced.ProcessTasks();
                }
                catch (Exception ex) when (IsScriptError(ex))
                {
                    var message = $"{source}: {Describe(ex, source)}";
                    engine.Invoke("__logError", message);
                    if (phase == PreRequest)
                    {
                        error = message;
                        break;
                    }
                }
                finally
                {
                    engine.Invoke("__afterScript");
                }
            }

            engine.Invoke("__drainTimers");
            engine.Advanced.ProcessTasks();
            var output = JsonSerializer.Deserialize<SandboxOutput>(engine.Invoke("__finish").AsString(), Json)!;

            variables.Environment = output.Variables?.Environment ?? variables.Environment;
            variables.Collection = output.Variables?.Collection ?? variables.Collection;
            variables.Globals = output.Variables?.Globals ?? variables.Globals;
            variables.Local = output.Local ?? variables.Local;

            return new SandboxResult(
                output.Request ?? request,
                variables,
                output.Tests ?? [],
                output.Console ?? [],
                output.NextRequest,
                output.Skip,
                error);
        }
        catch (Exception ex) when (IsScriptError(ex))
        {
            var message = L.T("script.environment_error", "Script ortamı: {detail}", ("detail", Describe(ex)));
            return new SandboxResult(request, variables, [], [new ConsoleEntryDto("error", message, phase)], null, false, message);
        }
    }

    private string SendFromScript(string? json, CancellationToken ct)
    {
        // Script doğrudan da çağırabilir: geçersiz argüman ev sahibinde istisnaya (500) dönüşmesin, script hatası olsun.
        ScriptRequestModel? spec;
        try
        {
            spec = json is null ? null : JsonSerializer.Deserialize<ScriptRequestModel>(json, Json);
        }
        catch (JsonException)
        {
            spec = null;
        }

        if (spec is null)
        {
            throw new JavaScriptException(L.T("script.send_invalid", "pm.sendRequest için geçersiz istek."));
        }

        var result = executor
            .ExecuteAsync(new ExecuteHttpRequest(spec.Method, spec.Url, spec.Headers, spec.Body), ct)
            .GetAwaiter()
            .GetResult();
        return JsonSerializer.Serialize(result, Json);
    }

    private static Prepared<Acornima.Ast.Script> Library(string name) =>
        Prepared.GetOrAdd(name, static n =>
        {
            var assembly = Assembly.GetExecutingAssembly();
            if (n == "sandbox.js")
            {
                // Sandbox, Sandbox/*.js parçalarının ada göre birleşimidir; tek kaynak "sandbox.js" adıyla hazırlanır.
                const string prefix = "Apivator.Scripting.Sandbox.";
                var parts = assembly.GetManifestResourceNames()
                    .Where(r => r.StartsWith(prefix, StringComparison.Ordinal))
                    .Order(StringComparer.Ordinal)
                    .Select(r =>
                    {
                        using var partStream = assembly.GetManifestResourceStream(r)!;
                        using var partReader = new StreamReader(partStream);
                        return partReader.ReadToEnd();
                    })
                    .ToList();
                if (parts.Count == 0)
                {
                    throw new InvalidOperationException($"Gömülü script bulunamadı: {prefix}*");
                }

                return Engine.PrepareScript(string.Join("\n", parts), n);
            }

            var resource = $"Apivator.Scripting.Libraries.{n}";
            using var stream = assembly.GetManifestResourceStream(resource)
                ?? throw new InvalidOperationException($"Gömülü script bulunamadı: {resource}");
            using var reader = new StreamReader(stream);
            return Engine.PrepareScript(reader.ReadToEnd(), n);
        });

    private static bool IsScriptError(Exception ex) =>
        ex is JavaScriptException or JintException or TimeoutException or Acornima.ParseErrorException or InvalidOperationException;

    /// <summary>
    /// Hata kütüphane ya da sandbox kodunun içinde atıldıysa (ör. require), satır numarası kullanıcının script'indeki
    /// çağrı yerinden alınır.
    /// </summary>
    private static int UserLine(JavaScriptException js, string? source)
    {
        if (source is null || js.Location.SourceFile == source)
        {
            return js.Location.Start.Line;
        }

        var match = Regex.Match(js.JavaScriptStackTrace ?? string.Empty, Regex.Escape(source) + @":(\d+)");
        return match.Success ? int.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture) : js.Location.Start.Line;
    }

    private static string Describe(Exception ex, string? source = null) => ex switch
    {
        JavaScriptException js => UserLine(js, source) is > 0 and var line ? L.T("script.line", "satır {line}: {error}", ("line", line), ("error", js.Error)) : js.Error.ToString(),
        Acornima.ParseErrorException parse => L.T("script.syntax", "sözdizimi hatası, satır {line}: {error}", ("line", parse.LineNumber), ("error", parse.Description)),
        TimeoutException => L.T("script.timeout", "script süre sınırını aştı."),
        MemoryLimitExceededException => L.T("script.memory", "script bellek sınırını aştı."),
        RecursionDepthOverflowException => L.T("script.recursion", "çok derin özyineleme."),
        StatementsCountOverflowException => L.T("script.statements", "script çok fazla komut çalıştırdı (sonsuz döngü?)."),
        _ => ex.Message,
    };

    private sealed record SandboxOutput(
        ScriptRequestModel? Request,
        OutputVariables? Variables,
        Dictionary<string, string>? Local,
        List<TestResultDto>? Tests,
        List<ConsoleEntryDto>? Console,
        NextRequestDto? NextRequest,
        bool Skip);

    private sealed record OutputVariables(
        Dictionary<string, string>? Environment,
        Dictionary<string, string>? Collection,
        Dictionary<string, string>? Globals);
}
