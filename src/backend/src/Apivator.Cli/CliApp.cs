using System.Text.Json;
using Apivator.Application;
using Apivator.Application.Abstractions;
using Apivator.Application.Collections;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Apivator.Application.Import;
using Apivator.Application.Runs;
using Apivator.Cli.Reporters;
using Apivator.Domain.Runs;
using Apivator.Domain.Variables;
using Apivator.Infrastructure;
using Apivator.Infrastructure.Execution;
using Apivator.Infrastructure.Execution.Local;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Apivator.Cli;

/// <summary>CLI'ın kimliği: OAuth token önbelleği bu sabit kimlikle anahtarlanır.</summary>
internal sealed class CliUser : ICurrentUser
{
    public Guid? Id { get; } = new("00000000-0000-0000-0000-0000000c1100");
}

/// <summary>Terminal: çıktı, hata akışı ve renk tercihi (testlerde yakalanır).</summary>
internal sealed record CliConsole(TextWriter Out, TextWriter Error, bool Color, Func<string, string?> Environment, string? SystemLanguage = null)
{
    public static CliConsole System() => new(
        global::System.Console.Out,
        global::System.Console.Error,
        !global::System.Console.IsOutputRedirected && string.IsNullOrEmpty(global::System.Environment.GetEnvironmentVariable("NO_COLOR")),
        global::System.Environment.GetEnvironmentVariable,
        global::System.Globalization.CultureInfo.CurrentUICulture.Name);
}

internal static class CliApp
{
    public const int Success = 0;
    public const int Failed = 1;
    public const int UsageError = 2;

    /// <param name="serverHandler">Testlerde sunucuya giden istekler için.</param>
    public static async Task<int> RunAsync(string[] args, CliConsole console, CancellationToken ct, HttpMessageHandler? serverHandler = null)
    {
        // Dil, ayrıştırma hataları ve yardım da o dilde çıksın diye en başta belirlenir.
        using var language = Lang.Use(CliOptions.ResolveLanguage(args, console.Environment, console.SystemLanguage));
        try
        {
            var (command, values, positional) = CliOptions.Parse(args);
            if (CliOptions.RawLang(args) is { } lang && Lang.Match(lang) is null)
            {
                throw new UsageException(L.T("cli.error.unsupported_lang", "Desteklenmeyen dil: {lang} (tr, en)", ("lang", lang)));
            }

            if (values.ContainsKey("no-color"))
            {
                console = console with { Color = false };
            }

            switch (command)
            {
                case "help":
                    console.Out.WriteLine(CliOptions.Usage());
                    return Success;
                case "version":
                    console.Out.WriteLine(typeof(CliApp).Assembly.GetName().Version?.ToString(3));
                    return Success;
                case "list":
                    return await ListAsync(values, console, serverHandler, ct);
                case "run":
                    return await RunCollectionAsync(CliOptions.ToRun(values, positional, console.Environment), console, serverHandler, ct);
                default:
                    throw new UsageException(L.T("cli.error.unknown_command", "Bilinmeyen komut: {command}. Yardım için: apivator --help", ("command", command)));
            }
        }
        catch (UsageException ex)
        {
            console.Error.WriteLine(L.T("cli.error.prefix", "Hata: {message}", ("message", ex.Message)));
            return UsageError;
        }
        catch (ServerException ex)
        {
            console.Error.WriteLine(L.T("cli.error.prefix", "Hata: {message}", ("message", ex.Message)));
            return UsageError;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            console.Error.WriteLine(L.T("cli.stopped", "Durduruldu."));
            return Failed;
        }
    }

    private static async Task<int> ListAsync(Dictionary<string, List<string>> values, CliConsole console, HttpMessageHandler? handler, CancellationToken ct)
    {
        string? One(string name) => values.TryGetValue(name, out var list) ? list[^1] : null;
        using var server = Connect(One("server") ?? console.Environment("APIVATOR_SERVER"), One("api-key") ?? console.Environment("APIVATOR_API_KEY"), handler)
            ?? throw new UsageException(L.T("cli.error.server_required", "Sunucu ve API anahtarı gerekli: --server ve --api-key (ya da APIVATOR_SERVER, APIVATOR_API_KEY)."));
        var workspaces = await server.WorkspacesAsync(ct);
        foreach (var workspace in Filter(workspaces, One("workspace")))
        {
            console.Out.WriteLine($"{workspace.Name} ({workspace.OrganizationName})  {workspace.Id}");
            foreach (var collection in await server.CollectionsAsync(workspace.Id, ct))
            {
                console.Out.WriteLine($"  {collection.Name}  {collection.Id}  " + L.T("cli.list.requests", "({n} istek)", ("n", collection.Requests.Count)));
            }
        }

        return Success;
    }

    private static async Task<int> RunCollectionAsync(RunOptions options, CliConsole console, HttpMessageHandler? handler, CancellationToken ct)
    {
        // Dosya yolu verildiyse dosyadan; yoksa sunucudan.
        var fromFile = File.Exists(options.Collection);
        using var server = fromFile ? null : Connect(options.Server, options.ApiKey, handler)
            ?? throw new UsageException(L.T("cli.error.not_a_file", "\"{path}\" bir dosya değil. Sunucudaki bir collection'ı çalıştırmak için --server ve --api-key verin (ya da APIVATOR_SERVER, APIVATOR_API_KEY).", ("path", options.Collection)));

        RunSourceDto source;
        Guid? workspaceId = null;
        string? environmentName = null;
        Dictionary<string, string>? environment = null;
        Dictionary<string, string>? globals = null;
        var warnings = new List<string>();

        if (server is null)
        {
            var (fileSource, fileWarnings) = PostmanFiles.ReadCollection(ReadJson(options.Collection));
            source = fileSource;
            warnings.AddRange(fileWarnings);
            if (options.Environment is { } envFile)
            {
                var file = ReadVariables(envFile, "environment");
                environmentName = file.Name;
                environment = ToDictionary(file.Variables);
            }
        }
        else
        {
            var (collection, workspace) = await FindCollectionAsync(server, options.Collection, options.Workspace, ct);
            workspaceId = workspace;
            source = await server.RunSourceAsync(collection.Id, ct);
            if (options.Environment is { } env)
            {
                if (File.Exists(env))
                {
                    var file = ReadVariables(env, "environment");
                    environmentName = file.Name;
                    environment = ToDictionary(file.Variables);
                }
                else
                {
                    var environments = await server.EnvironmentsAsync(workspace, ct);
                    var match = environments.Where(e => e.Id.ToString().Equals(env, StringComparison.OrdinalIgnoreCase) || e.Name.Equals(env, StringComparison.OrdinalIgnoreCase)).ToList();
                    var found = match.Count == 1 ? match[0] : throw new UsageException(match.Count == 0
                        ? L.T("cli.error.environment_not_found", "Environment bulunamadı: {name}. Bu workspace'tekiler: {available}", ("name", env), ("available", string.Join(", ", environments.Select(e => e.Name))))
                        : L.T("cli.error.environment_ambiguous", "\"{name}\" adında birden fazla environment var; kimliğini verin.", ("name", env)));
                    environmentName = found.Name;
                    environment = ToDictionary(found.Variables);
                }
            }

            globals = ToDictionary((await server.GlobalsAsync(workspace, ct)).Variables);
        }

        if (options.Globals is { } globalsFile)
        {
            globals = ToDictionary(ReadVariables(globalsFile, "globals").Variables);
        }

        if (options.EnvVars.Count > 0)
        {
            environment ??= [];
            foreach (var (key, value) in options.EnvVars)
            {
                environment[key] = value;
            }
        }

        if (options.GlobalVars.Count > 0)
        {
            globals ??= [];
            foreach (var (key, value) in options.GlobalVars)
            {
                globals[key] = value;
            }
        }

        List<Dictionary<string, string>>? data = null;
        if (options.IterationData is { } dataFile)
        {
            try
            {
                data = DataFiles.Parse(dataFile, await File.ReadAllTextAsync(Existing(dataFile, L.T("cli.kind.data", "veri")), ct));
            }
            catch (DataFileException ex)
            {
                throw new UsageException(L.T("cli.error.data_unreadable", "Veri dosyası okunamadı ({path}): {message}", ("path", dataFile), ("message", ex.Message)));
            }
        }

        Guid? folderId = null;
        if (options.Folder is { } folderName)
        {
            folderId = source.Folders.FirstOrDefault(f => f.Name.Equals(folderName, StringComparison.OrdinalIgnoreCase))?.Id
                ?? throw new UsageException(L.T("cli.error.folder_not_found", "Klasör bulunamadı: {name}", ("name", folderName)));
        }

        var run = new StartRunRequest(
            source.CollectionId,
            folderId,
            Iterations: options.Iterations ?? data?.Count ?? 1,
            DelayMs: options.DelayMs,
            Data: data,
            Variables: new ExecutionVariables { Environment = environment, Globals = globals, EnvironmentName = environmentName });
        if (RunLimits.Validate(run) is { } invalid)
        {
            throw new UsageException(invalid.Message);
        }

        await using var services = BuildServices(options);
        var reporter = options.Reporters.Contains("cli") ? new CliReporter(console.Out, console.Color, options.Verbose) : null;
        foreach (var warning in warnings)
        {
            reporter?.Warning(warning);
        }

        using var bail = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var startedAt = DateTimeOffset.UtcNow;
        var outcome = new RunOutcome();
        await using (var scope = services.CreateAsyncScope())
        {
            var engine = scope.ServiceProvider.GetRequiredService<RunEngine>();
            await foreach (var item in engine.RunAsync(source, run, outcome, bail.Token).WithCancellation(CancellationToken.None))
            {
                switch (item.Type)
                {
                    case "start":
                        reporter?.Start(outcome.Name, environmentName, item.Iterations ?? 1, item.Requests?.Count ?? 0);
                        break;
                    case "result" when item.Result is { } result:
                        reporter?.Result(result, item.Console);
                        if (options.Bail && RunReport.Failed(result))
                        {
                            await bail.CancelAsync();
                        }

                        break;
                    case "warning" when item.Message is { } message:
                        reporter?.Warning(message);
                        break;
                }
            }
        }

        ct.ThrowIfCancellationRequested();
        var stopReason = options.Bail && bail.IsCancellationRequested ? L.T("cli.bail_stopped", "--bail: ilk başarısızlıkta durduruldu.") : outcome.StopReason;
        var report = new RunReport(outcome.Name, environmentName, outcome.Iterations, outcome.Status, stopReason, startedAt, DateTimeOffset.UtcNow, outcome.Results);
        reporter?.Summary(report);
        WriteFiles(options, report, console);

        if (server is not null && !options.NoReport)
        {
            try
            {
                await server.ReportAsync(
                    new RunReportRequest(source.CollectionId, folderId, outcome.Name, environmentName, report.Iterations, options.DelayMs, report.Status, report.StartedAt, report.FinishedAt, report.Results, RunOrigin.Cli),
                    ct);
                console.Out.WriteLine(L.T("cli.report_saved", "Rapor sunucuya kaydedildi; Apivator'da runner geçmişinde \"CLI'dan\" etiketiyle görünür."));
            }
            catch (ServerException ex)
            {
                // Çalıştırmanın sonucu (çıkış kodu) rapordan bağımsızdır.
                console.Error.WriteLine(L.T("cli.warning.report_not_saved", "Uyarı: rapor sunucuya kaydedilemedi: {message}", ("message", ex.Message)));
            }
        }

        return report.Succeeded || options.SuppressExitCode ? Success : Failed;
    }

    private static void WriteFiles(RunOptions options, RunReport report, CliConsole console)
    {
        void Write(string name, string path, Action<RunReport, string> write)
        {
            write(report, path);
            console.Out.WriteLine(L.T("cli.report_written", "{name} raporu: {path}", ("name", name), ("path", Path.GetFullPath(path))));
        }

        if (options.Reporters.Contains("junit"))
        {
            Write("JUnit", options.JUnitPath ?? "apivator-report.xml", FileReporters.WriteJUnit);
        }

        if (options.Reporters.Contains("json"))
        {
            Write("JSON", options.JsonPath ?? "apivator-report.json", FileReporters.WriteJson);
        }

        if (options.Reporters.Contains("html"))
        {
            Write("HTML", options.HtmlPath ?? "apivator-report.html", FileReporters.WriteHtml);
        }
    }

    private static ServiceProvider BuildServices(RunOptions options)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                // CLI kullanıcının makinesinde/CI ajanında çalışır; amaç iç ağdaki API'leri test etmek.
                ["Proxy:AllowPrivateNetworks"] = "true",
                ["Proxy:TimeoutSeconds"] = ((options.TimeoutMs ?? 30_000 + 999) / 1000).ToString(global::System.Globalization.CultureInfo.InvariantCulture),
                ["Proxy:SslErrorHint"] = "cli",
            })
            .Build();

        var services = new ServiceCollection();
        services.AddLogging(logging => logging.SetMinimumLevel(LogLevel.Warning));
        services.AddSingleton<IConfiguration>(configuration);

        var network = new LocalHttpClientSource();
        var errors = network.Apply(new NetworkSettings { VerifySsl = !options.Insecure, CaCertificatePaths = options.CaCertificates });
        if (errors.Count > 0)
        {
            network.Dispose();
            throw new UsageException(string.Join(" ", errors));
        }

        services.AddSingleton(network);
        services.AddSingleton<IExecutionHttpClientSource>(network);
        services.AddExecutionServices();
        services.AddRequestExecution(configuration);
        services.AddSingleton<ICurrentUser, CliUser>();
        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
    }

    private static ServerClient? Connect(string? server, string? apiKey, HttpMessageHandler? handler)
    {
        if (string.IsNullOrWhiteSpace(server) && string.IsNullOrWhiteSpace(apiKey))
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(server) || string.IsNullOrWhiteSpace(apiKey))
        {
            throw new UsageException(L.T("cli.error.server_and_key", "Sunucu için hem --server hem --api-key gerekli (ya da APIVATOR_SERVER ve APIVATOR_API_KEY)."));
        }

        return new ServerClient(server, apiKey, handler);
    }

    private static List<Application.Workspaces.WorkspaceDto> Filter(List<Application.Workspaces.WorkspaceDto> workspaces, string? filter)
    {
        if (filter is null)
        {
            return workspaces;
        }

        var match = workspaces.Where(w => w.Id.ToString().Equals(filter, StringComparison.OrdinalIgnoreCase) || w.Name.Equals(filter, StringComparison.OrdinalIgnoreCase)).ToList();
        return match.Count > 0 ? match : throw new UsageException(L.T("cli.error.workspace_not_found", "Workspace bulunamadı: {name}", ("name", filter)));
    }

    /// <summary>Kimlik ya da ad ile; ad birden fazla workspace'te varsa --workspace istenir.</summary>
    private static async Task<(CollectionTreeDto Collection, Guid WorkspaceId)> FindCollectionAsync(ServerClient server, string key, string? workspace, CancellationToken ct)
    {
        var candidates = new List<(CollectionTreeDto, Guid, string)>();
        foreach (var w in Filter(await server.WorkspacesAsync(ct), workspace))
        {
            foreach (var c in await server.CollectionsAsync(w.Id, ct))
            {
                if (c.Id.ToString().Equals(key, StringComparison.OrdinalIgnoreCase) || c.Name.Equals(key, StringComparison.OrdinalIgnoreCase))
                {
                    candidates.Add((c, w.Id, w.Name));
                }
            }
        }

        return candidates.Count switch
        {
            1 => (candidates[0].Item1, candidates[0].Item2),
            0 => throw new UsageException(L.T("cli.error.collection_not_found", "Collection bulunamadı: \"{name}\". Erişebildikleriniz için: apivator list", ("name", key))),
            _ => throw new UsageException(L.T("cli.error.collection_ambiguous", "\"{name}\" adında birden fazla collection var ({workspaces}). --workspace verin ya da kimliğini kullanın.", ("name", key), ("workspaces", string.Join(", ", candidates.Select(c => c.Item3))))),
        };
    }

    private static VariableFile ReadVariables(string path, string kind)
    {
        try
        {
            return PostmanFiles.ReadVariables(ReadJson(path));
        }
        catch (FormatException ex)
        {
            throw new UsageException(L.T("cli.error.file_unreadable", "{kind} dosyası okunamadı ({path}): {message}", ("kind", kind), ("path", path), ("message", ex.Message)));
        }
    }

    private static JsonElement ReadJson(string path)
    {
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(Existing(path, L.T("cli.kind.file", "dosya"))));
            return document.RootElement.Clone();
        }
        catch (JsonException ex)
        {
            throw new UsageException(L.T("cli.error.invalid_json", "{path} geçerli bir JSON değil: {message}", ("path", path), ("message", ex.Message)));
        }
        catch (FormatException ex)
        {
            throw new UsageException(ex.Message);
        }
    }

    private static string Existing(string path, string kind) =>
        File.Exists(path) ? path : throw new UsageException(L.T("cli.error.not_found", "{kind} bulunamadı: {path}", ("kind", kind), ("path", path)));

    private static Dictionary<string, string> ToDictionary(IReadOnlyList<Variable> variables) =>
        variables.Where(v => v.Enabled).GroupBy(v => v.Key).ToDictionary(g => g.Key, g => g.Last().Value);
}
