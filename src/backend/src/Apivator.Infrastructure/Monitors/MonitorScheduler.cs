using Apivator.Application.Monitors;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Monitors;

/// <summary>
/// Zamanı gelen monitörleri çalıştırır. Birden fazla API örneği varsa her biri veritabanından iş "kapar"
/// (FOR UPDATE SKIP LOCKED); aynı monitör iki kez çalışmaz. Kilit, sunucu çökerse belirli bir süre sonra
/// kendiliğinden düşer ve monitör bir sonraki taramada yeniden çalışır.
/// </summary>
internal sealed class MonitorScheduler(
    IServiceScopeFactory scopes,
    IOptions<MonitorOptions> options,
    TimeProvider clock,
    ILogger<MonitorScheduler> logger) : BackgroundService, IMonitorScheduler
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = options.Value;
        if (!settings.SchedulerEnabled)
        {
            logger.LogInformation("Monitör zamanlayıcısı kapalı (Monitors:SchedulerEnabled=false).");
            return;
        }

        var poll = TimeSpan.FromSeconds(Math.Max(1, settings.PollSeconds));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunDueAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Monitör taraması başarısız.");
            }

            try
            {
                await Task.Delay(poll, clock, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>Zamanı gelenleri kapar ve paralel çalıştırır (en fazla MaxConcurrent). Testler doğrudan çağırır.</summary>
    public async Task<int> RunDueAsync(CancellationToken ct = default)
    {
        var settings = options.Value;
        var claimed = await ClaimAsync(Math.Max(1, settings.MaxConcurrent), TimeSpan.FromMinutes(settings.RunTimeoutMinutes + 5), ct);
        await Task.WhenAll(claimed.Select(id => RunOneAsync(id, ct)));
        return claimed.Count;
    }

    private async Task<List<Guid>> ClaimAsync(int limit, TimeSpan lockFor, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var now = clock.GetUtcNow();
        var lockedUntil = now + lockFor;
        return await db.Database.SqlQuery<Guid>($"""
            UPDATE collection_monitors SET locked_until = {lockedUntil}
            WHERE id IN (
                SELECT id FROM collection_monitors
                WHERE enabled AND next_run_at <= {now} AND (locked_until IS NULL OR locked_until < {now})
                ORDER BY next_run_at
                LIMIT {limit}
                FOR UPDATE SKIP LOCKED)
            RETURNING id AS "Value"
            """).ToListAsync(ct);
    }

    private async Task RunOneAsync(Guid monitorId, CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var executor = scope.ServiceProvider.GetRequiredService<IMonitorExecutor>();
            var result = await executor.ExecuteAsync(monitorId, scheduled: true, ct);
            if (!result.IsSuccess)
            {
                logger.LogWarning("Monitör {MonitorId} çalıştırılamadı: {Message}", monitorId, result.Error!.Message);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Kilit süresi dolunca bir sonraki taramada yeniden denenir.
            logger.LogError(ex, "Monitör {MonitorId} çalıştırılırken hata.", monitorId);
        }
    }
}
