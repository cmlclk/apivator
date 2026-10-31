using Apivator.Application.History;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.History;

/// <summary>
/// Saklama süresi (<c>History:ResponseRetentionDays</c>) dolan geçmiş yanıt gövdelerini günde bir siler; geçmiş
/// kaydı kalır. Parça parça siler; birden fazla API örneğinde aynı anda çalışması zararsızdır.
/// </summary>
internal sealed class HistoryResponseRetention(
    IServiceScopeFactory scopes,
    IOptions<HistoryOptions> options,
    TimeProvider clock,
    ILogger<HistoryResponseRetention> logger) : BackgroundService
{
    private const int Batch = 2000;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var wait = TimeSpan.FromMinutes(2);
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
                logger.LogError(ex, "Eski geçmiş yanıtları silinemedi.");
            }

            wait = TimeSpan.FromHours(24);
        }
    }

    public async Task<int> PurgeAsync(CancellationToken ct)
    {
        if (options.Value.ResponseRetentionDays <= 0)
        {
            return 0;
        }

        var cutoff = clock.GetUtcNow().AddDays(-options.Value.ResponseRetentionDays);
        var total = 0;
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        int deleted;
        do
        {
            var ids = await db.History
                .Where(h => h.ExecutedAt < cutoff && db.HistoryResponses.Any(r => r.HistoryEntryId == h.Id))
                .Select(h => h.Id)
                .Take(Batch)
                .ToListAsync(ct);
            deleted = ids.Count == 0 ? 0 : await db.HistoryResponses.Where(r => ids.Contains(r.HistoryEntryId)).ExecuteDeleteAsync(ct);
            total += deleted;
        }
        while (deleted == Batch);

        return total;
    }
}
