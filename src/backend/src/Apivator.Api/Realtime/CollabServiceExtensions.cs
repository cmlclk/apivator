using StackExchange.Redis;

namespace Apivator.Api.Realtime;

internal static class CollabServiceExtensions
{
    /// <summary>
    /// İsteklerin ortak (eşzamanlı) düzenlenmesi: Yjs güncelleme günlüğü. Redis tanımlıysa sunucular arasında
    /// paylaşılır, değilse bellekte tutulur.
    /// </summary>
    public static IServiceCollection AddCollaboration(this IServiceCollection services)
    {
        services.AddSingleton<IDocumentLog>(sp =>
            sp.GetService<IConnectionMultiplexer>() is { } redis ? new RedisDocumentLog(redis) : new MemoryDocumentLog());
        services.AddSingleton<CollabDocuments>();
        services.AddHostedService<CollabHeartbeat>();
        return services;
    }
}

/// <summary>Bu sunucunun belge katılımcılarının canlılık damgasını tazeler (çöken sunucu belgeyi sonsuza dek tutmasın).</summary>
internal sealed class CollabHeartbeat(CollabDocuments documents, IDocumentLog log, ILogger<CollabHeartbeat> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
                foreach (var (connectionId, _, documentId, _) in documents.All())
                {
                    await log.RefreshAsync(documentId, connectionId);
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (RedisException ex)
            {
                logger.LogWarning(ex, "Ortak taslak katılımcıları tazelenemedi.");
            }
        }
    }
}
