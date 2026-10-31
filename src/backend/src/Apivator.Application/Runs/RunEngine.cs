using System.Runtime.CompilerServices;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Apivator.Domain.Collections;
using Apivator.Domain.Runs;
using Apivator.Domain.Variables;

namespace Apivator.Application.Runs;

/// <summary>Çalıştırılacak collection'ın, veritabanından bağımsız hâli (sunucu ve masaüstü ajanı aynı motoru kullanır).</summary>
public sealed record RunSourceDto(
    Guid CollectionId,
    string Name,
    RequestAuth Auth,
    ScriptSet Scripts,
    IReadOnlyList<Variable> Variables,
    IReadOnlyList<RunFolderSource> Folders,
    IReadOnlyList<RunRequestSource> Requests);

/// <summary>Listeler ağaçtaki oluşturulma sırasındadır; aynı SortOrder'da bu sıra korunur.</summary>
public sealed record RunFolderSource(Guid Id, Guid? ParentFolderId, string Name, int SortOrder, RequestAuth Auth, ScriptSet Scripts)
    : IFolderSettings;

public sealed record RunRequestSource(Guid Id, Guid? FolderId, string Name, int SortOrder, RequestDefinition Definition);

/// <summary>Çalıştırmanın sonucu; motor bitince doldurur.</summary>
public sealed class RunOutcome
{
    public string Name { get; internal set; } = string.Empty;

    public int Iterations { get; internal set; }

    public RunStatus Status { get; internal set; } = RunStatus.Completed;

    public List<RunResultEntry> Results { get; } = [];

    public ExecutionVariables? Variables { get; internal set; }

    public string? StopReason { get; internal set; }
}

public static class RunLimits
{
    public const int MaxIterations = 1000;
    public const int MaxDelayMs = 60_000;
    public const int MaxDataRows = 10_000;

    /// <summary>setNextRequest döngülerine karşı bir çalıştırmadaki toplam istek sınırı.</summary>
    public const int MaxSteps = 10_000;

    public static Error? Validate(StartRunRequest request)
    {
        if (request.Iterations is < 1 or > MaxIterations)
        {
            return Error.Validation("validation", L.T("run.iterations_range", "İterasyon sayısı 1 ile {max} arasında olmalı.", ("max", MaxIterations)));
        }

        if (request.DelayMs is < 0 or > MaxDelayMs)
        {
            return Error.Validation("validation", L.T("run.delay_range", "Gecikme 0 ile {max} ms arasında olmalı.", ("max", MaxDelayMs)));
        }

        return request.Data is { Count: > MaxDataRows }
            ? Error.Validation("validation", L.T("run.data_rows_max", "Veri dosyası en fazla {max} satır olabilir.", ("max", MaxDataRows)))
            : null;
    }
}

/// <summary>
/// Collection runner'ın çalıştırma motoru: istekleri ağaç sırasıyla, iterasyonlar ve setNextRequest ile yürütür,
/// her sonucu olay olarak üretir. Veritabanına dokunmaz; raporu çağıran kaydeder.
/// </summary>
public sealed class RunEngine(IRequestPipeline pipeline)
{
    public async IAsyncEnumerable<RunEvent> RunAsync(
        RunSourceDto source,
        StartRunRequest request,
        RunOutcome outcome,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var folders = source.Folders.GroupBy(f => f.Id).ToDictionary(g => g.Key, g => g.First());
        var ordered = Order(request.FolderId, source.Folders, source.Requests);
        if (request.RequestIds is { Count: > 0 } selected)
        {
            var set = selected.ToHashSet();
            ordered = ordered.Where(r => set.Contains(r.Id)).ToList();
        }

        var data = request.Data ?? [];
        var iterations = data.Count > 0 ? Math.Min(request.Iterations, data.Count) : request.Iterations;
        outcome.Iterations = iterations;
        outcome.Name = request.FolderId is { } fid && folders.TryGetValue(fid, out var runFolder) ? $"{source.Name} / {runFolder.Name}" : source.Name;

        yield return new RunEvent("start")
        {
            Iterations = iterations,
            Requests = ordered.Select(r => new RunRequestInfo(r.Id, r.Name, r.Definition.Method)).ToList(),
        };

        var variables = new ExecutionVariables
        {
            Environment = request.Variables?.Environment is null ? null : new(request.Variables.Environment),
            Collection = new(request.Variables?.Collection ?? source.Variables.Where(v => v.Enabled).GroupBy(v => v.Key).ToDictionary(g => g.Key, g => g.Last().Value)),
            Globals = request.Variables?.Globals is null ? null : new(request.Variables.Globals),
            EnvironmentName = request.Variables?.EnvironmentName,
        };

        var steps = 0;
        var byName = ordered.GroupBy(r => r.Name, StringComparer.Ordinal).ToDictionary(g => g.Key, g => ordered.IndexOf(g.First()), StringComparer.Ordinal);

        for (var iteration = 0; iteration < iterations && outcome.StopReason is null; iteration++)
        {
            var index = 0;
            while (index < ordered.Count)
            {
                if (ct.IsCancellationRequested)
                {
                    Stop(outcome, RunStatus.Stopped, L.T("run.stopped", "Çalıştırma durduruldu."));
                    break;
                }

                if (++steps > RunLimits.MaxSteps)
                {
                    Stop(outcome, RunStatus.Failed, L.T("run.max_steps", "Bir çalıştırmada en fazla {max} istek gönderilebilir (setNextRequest döngüsü?).", ("max", RunLimits.MaxSteps)));
                    break;
                }

                var item = ordered[index];
                var executed = await ExecuteOneAsync(item, source, folders, variables, data.Count > 0 ? data[iteration] : null, iteration, iterations, request.OAuth2Tokens, ct);
                if (executed is null)
                {
                    Stop(outcome, RunStatus.Stopped, L.T("run.stopped", "Çalıştırma durduruldu."));
                    break;
                }

                var (entry, response) = executed.Value;
                outcome.Results.Add(entry);
                if (response.Variables is { } changed)
                {
                    variables = variables with
                    {
                        Environment = changed.Environment ?? variables.Environment,
                        Collection = changed.Collection ?? variables.Collection,
                        Globals = changed.Globals ?? variables.Globals,
                    };
                }

                yield return new RunEvent("result") { Result = entry, Console = response.Console.Count > 0 ? response.Console : null };

                if (response.NextRequest is { } next)
                {
                    if (next.Value is null)
                    {
                        break; // setNextRequest(null): bu iterasyon biter.
                    }

                    if (!byName.TryGetValue(next.Value, out index))
                    {
                        yield return new RunEvent("warning") { Message = L.T("run.next_request_missing", "setNextRequest: \"{name}\" adlı istek bu çalıştırmada yok; iterasyon bitti.", ("name", next.Value)) };
                        break;
                    }
                }
                else
                {
                    index++;
                }

                if (request.DelayMs > 0 && (index < ordered.Count || iteration + 1 < iterations))
                {
                    try
                    {
                        await Task.Delay(request.DelayMs, ct);
                    }
                    catch (OperationCanceledException)
                    {
                        // Döngünün başında durdurma olarak işlenir.
                    }
                }
            }
        }

        outcome.Variables = variables;
    }

    private static void Stop(RunOutcome outcome, RunStatus status, string reason)
    {
        outcome.Status = status;
        outcome.StopReason = reason;
    }

    private async Task<(RunResultEntry Entry, ExecuteHttpResponse Response)?> ExecuteOneAsync(
        RunRequestSource item,
        RunSourceDto source,
        IReadOnlyDictionary<Guid, RunFolderSource> folders,
        ExecutionVariables variables,
        Dictionary<string, string>? data,
        int iteration,
        int iterations,
        IReadOnlyDictionary<string, string>? tokens,
        CancellationToken ct)
    {
        var definition = item.Definition;
        var auth = AuthInheritance.Resolve(definition.Auth, item.FolderId, folders, source.Auth);
        if (auth.Type == AuthType.OAuth2 && tokens is not null && tokens.TryGetValue(auth.OAuth2Fingerprint, out var token))
        {
            auth = auth with { OAuth2AccessToken = token };
        }

        var (pre, post) = AuthInheritance.ScriptChain(source.Scripts, item.FolderId, folders, definition.Scripts);
        var execute = new ExecuteHttpRequest(
            definition.Method,
            definition.Url,
            definition.Headers,
            definition.Body,
            Auth: auth,
            PreRequestScripts: pre,
            PostResponseScripts: post,
            Variables: variables with { Data = data },
            Info: new ExecutionInfo(item.Name, item.Id.ToString(), iteration, iterations));

        ExecuteHttpResponse response;
        try
        {
            response = await pipeline.RunAsync(execute, ct);
        }
        catch (OperationCanceledException)
        {
            return null;
        }

        var entry = new RunResultEntry(
            iteration,
            item.Id,
            item.Name,
            response.Request?.Method ?? definition.Method,
            response.Request?.Url ?? definition.Url,
            response.Status,
            response.TimeMs,
            response.Size,
            response.Error?.Message,
            response.Tests.Select(t => new RunTestResult(t.Name, t.Status, t.Error)).ToList(),
            response.Skipped);
        return (entry, response);
    }

    /// <summary>Ağaçtaki görünüm sırası: her düzeyde önce klasörler (içleriyle), sonra istekler.</summary>
    private static List<RunRequestSource> Order(Guid? rootFolderId, IReadOnlyList<RunFolderSource> folders, IReadOnlyList<RunRequestSource> requests)
    {
        var result = new List<RunRequestSource>();

        void Visit(Guid? parentId, int depth)
        {
            if (depth > 50)
            {
                return;
            }

            // OrderBy kararlıdır: aynı SortOrder'da listedeki (oluşturulma) sıra korunur.
            foreach (var folder in folders.Where(f => f.ParentFolderId == parentId).OrderBy(f => f.SortOrder))
            {
                Visit(folder.Id, depth + 1);
            }

            // WebSocket ve SSE istekleri koşuya girmez (Postman'deki gibi); yalnızca HTTP istekleri çalışır.
            result.AddRange(requests.Where(r => r.FolderId == parentId && r.Definition.Kind == RequestKind.Http).OrderBy(r => r.SortOrder));
        }

        Visit(rootFolderId, 0);
        return result;
    }
}
