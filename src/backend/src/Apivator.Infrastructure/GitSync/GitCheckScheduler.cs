using Apivator.Application.GitSync;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.GitSync;

/// <summary>
/// Otomatik kontrolü açık Git bağlantılarında uzak dalı zamanı gelince kontrol eder (alınacak değişiklik sayısı
/// durumda görünür; hiçbir şey otomatik uygulanmaz). Birden fazla API örneğinde iş veritabanından kapılır
/// (FOR UPDATE SKIP LOCKED).
/// </summary>
internal sealed class GitCheckScheduler(
    IServiceScopeFactory scopes,
    IOptions<GitSyncOptions> options,
    TimeProvider clock,
    ILogger<GitCheckScheduler> logger) : BackgroundService
{
    private static readonly TimeSpan LockFor = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        SweepWorkDirectory();

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
                await Task.Delay(poll, clock, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Git kontrol taraması başarısız.");
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
                claimed = await db.GitSyncs
                    .Where(e => e.CheckIntervalHours != null && e.NextCheckAt <= now && (e.LockedUntil == null || e.LockedUntil < now))
                    .OrderBy(e => e.NextCheckAt).Take(limit).Select(e => e.Id).ToListAsync(ct);
                await db.GitSyncs.Where(e => claimed.Contains(e.Id))
                    .ExecuteUpdateAsync(u => u.SetProperty(e => e.LockedUntil, lockedUntil), ct);
                await tx.CommitAsync(ct);
            }
            else
            {
                claimed = await db.Database.SqlQuery<Guid>($"""
                    UPDATE collection_git_syncs SET locked_until = {lockedUntil}
                    WHERE id IN (
                        SELECT id FROM collection_git_syncs
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

    private async Task CheckOneAsync(Guid syncId, CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<IGitChecker>().CheckAsync(syncId, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Kilit süresi dolunca bir sonraki taramada yeniden denenir.
            logger.LogError(ex, "Git bağlantısı {SyncId} kontrol edilirken hata.", syncId);
        }
    }

    /// <summary>Çöken işlemlerden kalan (1 saatten eski) geçici dizinler açılışta silinir.</summary>
    private void SweepWorkDirectory()
    {
        var root = LibGitRemote.WorkRoot(options.Value.WorkDirectory);
        try
        {
            foreach (var dir in Directory.Exists(root) ? Directory.EnumerateDirectories(root) : [])
            {
                // Yalnızca eski olanlar: başka bir örnek/süreç aynı dizini şu an kullanıyor olabilir.
                if (Directory.GetLastWriteTimeUtc(dir) < DateTime.UtcNow.AddHours(-1))
                {
                    LibGitRemote.DeleteScratch(dir);
                }
            }
        }
        catch (IOException ex)
        {
            logger.LogWarning(ex, "Git geçici dizini temizlenemedi.");
        }
    }
}
