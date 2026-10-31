using Apivator.Application.Import;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Import;

public sealed class SourceCheckOptions
{
    public const string SectionName = "SourceChecks";

    /// <summary>false ise otomatik kontrol yapılmaz (testler zamanlayıcıyı kendileri tetikler).</summary>
    public bool SchedulerEnabled { get; set; } = true;

    public int PollSeconds { get; set; } = 60;

    public int MaxConcurrent { get; set; } = 4;
}

/// <summary>
/// Otomatik kontrolü açık kaynak belgelerini zamanı gelince yeniden çeker. Monitör zamanlayıcısı gibi birden
/// fazla API örneğinde iş veritabanından kapılır (FOR UPDATE SKIP LOCKED).
/// </summary>
internal sealed class SourceCheckScheduler(
    IServiceScopeFactory scopes,
    IOptions<SourceCheckOptions> options,
    TimeProvider clock,
    ILogger<SourceCheckScheduler> logger) : BackgroundService, ISourceCheckScheduler
{
    private static readonly TimeSpan LockFor = TimeSpan.FromMinutes(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.SchedulerEnabled)
        {
            return;
        }

        var poll = TimeSpan.FromSeconds(Math.Max(5, options.Value.PollSeconds));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunDueAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Kaynak belge kontrolü taraması başarısız.");
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

    public async Task<int> RunDueAsync(CancellationToken ct = default)
    {
        List<Guid> claimed;
        await using (var scope = scopes.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var now = clock.GetUtcNow();
            var lockedUntil = now + LockFor;
            var limit = Math.Max(1, options.Value.MaxConcurrent);
            if (db.Database.IsSqlite())
            {
                // Tek süreç (yerel mod): satır kilidi yok; IMMEDIATE işlem aynı süreçteki eşzamanlı taramaları sıraya koyar.
                await using var tx = await db.Database.BeginTransactionAsync(ct);
                claimed = await db.CollectionSources
                    .Where(e => e.CheckIntervalHours != null && e.NextCheckAt <= now && (e.LockedUntil == null || e.LockedUntil < now))
                    .OrderBy(e => e.NextCheckAt).Take(limit).Select(e => e.Id).ToListAsync(ct);
                await db.CollectionSources.Where(e => claimed.Contains(e.Id))
                    .ExecuteUpdateAsync(u => u.SetProperty(e => e.LockedUntil, lockedUntil), ct);
                await tx.CommitAsync(ct);
            }
            else
            {
                claimed = await db.Database.SqlQuery<Guid>($"""
                    UPDATE collection_sources SET locked_until = {lockedUntil}
                    WHERE id IN (
                        SELECT id FROM collection_sources
                        WHERE check_interval_hours IS NOT NULL AND next_check_at <= {now}
                          AND (locked_until IS NULL OR locked_until < {now})
                        ORDER BY next_check_at
                        LIMIT {limit}
                        FOR UPDATE SKIP LOCKED)
                    RETURNING id AS "Value"
                    """).ToListAsync(ct);
            }
        }

        await Task.WhenAll(claimed.Select(id => CheckOneAsync(id, ct)));
        return claimed.Count;
    }

    private async Task CheckOneAsync(Guid sourceId, CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<ISourceChecker>().CheckAsync(sourceId, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Kilit süresi dolunca bir sonraki taramada yeniden denenir.
            logger.LogError(ex, "Kaynak belge {SourceId} kontrol edilirken hata.", sourceId);
        }
    }
}
