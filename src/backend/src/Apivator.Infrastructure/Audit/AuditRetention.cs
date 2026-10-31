using Apivator.Application.Audit;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Audit;

/// <summary>
/// Saklama süresi (<c>Audit:RetentionDays</c>) dolan denetim kayıtlarını günde bir siler; tabloyu uzun süre
/// kilitlememek için parça parça. Birden fazla API örneğinde aynı anda çalışması zararsızdır.
/// </summary>
internal sealed class AuditRetention(IServiceScopeFactory scopes, IOptions<AuditOptions> options, TimeProvider clock, ILogger<AuditRetention> logger)
    : BackgroundService
{
    private const int Batch = 5000;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Açılışı yavaşlatmasın diye ilk tur biraz sonra.
        var wait = TimeSpan.FromMinutes(1);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(wait, clock, stoppingToken);
                await PurgeAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Eski denetim kayıtları silinemedi.");
            }

            wait = TimeSpan.FromHours(24);
        }
    }

    public async Task<int> PurgeAsync(CancellationToken ct)
    {
        if (options.Value.RetentionDays <= 0)
        {
            return 0;
        }

        var cutoff = clock.GetUtcNow().AddDays(-options.Value.RetentionDays);
        var total = 0;
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        int deleted;
        do
        {
            var ids = await db.AuditEntries.Where(e => e.CreatedAt < cutoff).OrderBy(e => e.CreatedAt).Select(e => e.Id).Take(Batch).ToListAsync(ct);
            deleted = ids.Count == 0 ? 0 : await db.AuditEntries.Where(e => ids.Contains(e.Id)).ExecuteDeleteAsync(ct);
            total += deleted;
        }
        while (deleted == Batch);

        return total;
    }
}
