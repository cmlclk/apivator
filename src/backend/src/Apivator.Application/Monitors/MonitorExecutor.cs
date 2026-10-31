using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Apivator.Application.Runs;
using Apivator.Application.Workspaces;
using Apivator.Domain.Monitors;
using Apivator.Domain.Runs;
using Apivator.Domain.Variables;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Apivator.Application.Monitors;

/// <summary>Bir monitörü çalıştırır: raporu kaydeder, durumunu günceller, gerekirse bildirim gönderir.</summary>
public interface IMonitorExecutor
{
    /// <summary>
    /// <paramref name="scheduled"/> ise bir sonraki çalıştırma zamanı ilerletilir; elle çalıştırmada zamanlama
    /// değişmez. Çalıştırılamazsa (erişim kalmadı, collection yok) monitör durdurulur ve hata döner.
    /// </summary>
    Task<Result<MonitorRunPointDto>> ExecuteAsync(Guid monitorId, bool scheduled, CancellationToken ct = default);
}

internal sealed class MonitorExecutor(
    IApplicationDbContext db,
    CollectionRunner runner,
    IWorkspaceAccess access,
    IMonitorNotifier notifier,
    IUserDirectory users,
    IOptions<MonitorOptions> options,
    TimeProvider clock) : IMonitorExecutor
{
    private const int MaxFailuresInAlert = 10;

    public async Task<Result<MonitorRunPointDto>> ExecuteAsync(Guid monitorId, bool scheduled, CancellationToken ct = default)
    {
        var monitor = await db.Monitors.FirstOrDefaultAsync(m => m.Id == monitorId, ct);
        if (monitor is null)
        {
            return Error.NotFound("monitor.not_found", L.T("monitor.not_found", "Monitör bulunamadı."));
        }

        // Zamanlanmış çalıştırmada istek bağlamı yok: metinler monitörü oluşturan kişinin dilinde üretilir.
        using var language = scheduled ? Lang.Use(await users.PreferredLanguageAsync(monitor.CreatedById, ct)) : null;

        var settings = options.Value;
        var collection = await db.Collections.AsNoTracking().FirstOrDefaultAsync(c => c.Id == monitor.CollectionId, ct);
        var role = await access.RoleAsync(monitor.WorkspaceId, monitor.CreatedById, ct);
        if (collection is null || role is null)
        {
            var reason = collection is null
                ? L.T("monitor.suspended_collection_deleted", "Collection silindiği için monitör durduruldu.")
                : L.T("monitor.suspended_no_access", "Monitörü oluşturan kişinin bu workspace'e erişimi kalmadığı için monitör durduruldu. Bir üye yeniden açarsa onun adına çalışır.");
            monitor.Suspend(reason, clock.GetUtcNow());
            await db.SaveChangesAsync(CancellationToken.None);
            await notifier.NotifyAsync(
                new MonitorAlert(monitor.Id, monitor.Name, monitor.WorkspaceId, collection?.Name ?? string.Empty, null, false, Guid.Empty, clock.GetUtcNow(), 0, 0, 0, monitor.ConsecutiveFailures, [], reason),
                await ChannelsAsync(monitor, ct),
                CancellationToken.None);
            return Error.Validation("monitor.suspended", reason);
        }

        var (variables, environmentName) = await VariablesAsync(monitor, ct);
        var request = new StartRunRequest(monitor.CollectionId, Variables: variables with { EnvironmentName = environmentName });

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromMinutes(Math.Max(1, settings.RunTimeoutMinutes)));
        Guid? runId = null;
        await foreach (var item in runner.RunAsync(request, monitor.CreatedById, scheduled ? RunOrigin.Monitor : RunOrigin.Server, monitor.Id, timeout.Token))
        {
            if (item.Type == "done")
            {
                runId = item.RunId;
            }
        }

        var run = await db.Runs.AsNoTracking().FirstAsync(r => r.Id == runId, CancellationToken.None);
        var now = clock.GetUtcNow();
        var next = scheduled ? NextRun(monitor, now) : monitor.NextRunAt;
        var previous = monitor.RecordRun(run.Id, run.Healthy, run.FinishedAt, next);

        var cutoff = now.AddDays(-Math.Max(1, settings.RetentionDays));
        await db.Runs.Where(r => r.MonitorId == monitor.Id && r.StartedAt < cutoff).ExecuteDeleteAsync(CancellationToken.None);
        await db.SaveChangesAsync(CancellationToken.None);

        var failed = !run.Healthy;
        var shouldNotify = failed
            ? monitor.NotifyMode == MonitorNotifyMode.EveryFailure || previous != MonitorHealth.Failing
            : previous == MonitorHealth.Failing;
        if (shouldNotify)
        {
            await notifier.NotifyAsync(Alert(monitor, collection.Name, run, recovered: !failed), await ChannelsAsync(monitor, ct), CancellationToken.None);
        }

        return MonitorService.ToPoint(run);
    }

    /// <summary>Zamanı geçmiş bir sonraki çalıştırma için; ifade artık geçersizse monitör zamanlanmaz.</summary>
    private static DateTimeOffset? NextRun(CollectionMonitor monitor, DateTimeOffset now) =>
        MonitorSchedule.Parse(monitor.Schedule, monitor.TimeZone, TimeSpan.Zero, now).Schedule?.Next(now);

    /// <summary>
    /// Monitör sunucuda çalıştığı için kimsenin "güncel değeri" yoktur: environment ve globals'ın paylaşılan
    /// başlangıç değerleri kullanılır (gizli değerler dahil). Collection değişkenlerini motor kendisi yükler.
    /// </summary>
    private async Task<(ExecutionVariables Variables, string? EnvironmentName)> VariablesAsync(CollectionMonitor monitor, CancellationToken ct)
    {
        static Dictionary<string, string> ToMap(IEnumerable<Variable> variables) =>
            variables.Where(v => v.Enabled).GroupBy(v => v.Key).ToDictionary(g => g.Key, g => g.Last().Value);

        var globals = await db.Workspaces.AsNoTracking().Where(w => w.Id == monitor.WorkspaceId).Select(w => w.Globals).FirstOrDefaultAsync(ct) ?? [];
        var environment = monitor.EnvironmentId is { } envId
            ? await db.Environments.AsNoTracking().FirstOrDefaultAsync(e => e.Id == envId && e.WorkspaceId == monitor.WorkspaceId, ct)
            : null;
        return (new ExecutionVariables { Environment = environment is null ? null : ToMap(environment.Variables), Globals = ToMap(globals) }, environment?.Name);
    }

    private static MonitorAlert Alert(CollectionMonitor monitor, string collectionName, CollectionRun run, bool recovered) => new(
        monitor.Id,
        monitor.Name,
        monitor.WorkspaceId,
        collectionName,
        run.EnvironmentName,
        recovered,
        run.Id,
        run.StartedAt,
        run.TotalRequests,
        run.TestsPassed,
        run.TestsFailed,
        monitor.ConsecutiveFailures,
        recovered
            ? []
            : run.Results
                .Where(r => r.Error is not null || r.Tests.Any(t => t.Status == "failed"))
                .Take(MaxFailuresInAlert)
                .Select(r => new MonitorFailure(r.Name, r.Method, r.Url, r.Status, r.Error, r.Tests.Where(t => t.Status == "failed").Select(t => t.Error is null ? t.Name : $"{t.Name}: {t.Error}").ToList()))
                .ToList(),
        run.Status == RunStatus.Completed ? null : L.T("monitor.run_incomplete", "Çalıştırma tamamlanamadı (süre aşımı ya da durdurma)."));

    /// <summary>Adres verilmemişse bildirim monitörü oluşturan kişiye gider.</summary>
    private async Task<MonitorChannels> ChannelsAsync(CollectionMonitor monitor, CancellationToken ct)
    {
        var emails = monitor.NotifyEmails;
        if (emails.Count == 0)
        {
            var creator = (await users.UsersAsync([monitor.CreatedById], ct)).GetValueOrDefault(monitor.CreatedById);
            emails = creator is null ? [] : [creator.Email];
        }

        return new MonitorChannels(emails, monitor.WebhookUrl, monitor.WebhookKind);
    }
}
