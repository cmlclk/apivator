using System.Collections.Concurrent;
using System.Text.Json;
using StackExchange.Redis;

namespace Apivator.Api.Realtime;

/// <summary>Bir workspace'te çevrimiçi olan kişi ve açık tuttuğu kayıtlı istekler.</summary>
public sealed record PresenceUser(Guid UserId, string DisplayName, IReadOnlyList<Guid> RequestIds);

public sealed record PresenceSnapshot(Guid WorkspaceId, IReadOnlyList<PresenceUser> Users);

/// <summary>
/// Bağlantı başına kim, hangi workspace'te, hangi istekte. Bu sunucunun bağlantıları bellekte tutulur (erişim
/// kaldırma gibi işler onlar üzerinden yapılır). Redis verilmişse her bağlantının durumu ayrıca workspace başına bir
/// Redis hash'ine yazılır ve çevrimiçi listesi oradan okunur; böylece birden fazla API sunucusunda herkes herkesi
/// görür. Sunucu çökerse kayıtları <see cref="StaleAfter"/> sonra listeden düşer (her sunucu düzenli tazeler).
/// </summary>
public sealed class PresenceTracker(IConnectionMultiplexer? redis, TimeProvider clock)
{
    /// <summary>Tazelenmeyen bağlantı bu süreden sonra çevrimdışı sayılır.</summary>
    public static readonly TimeSpan StaleAfter = TimeSpan.FromSeconds(90);

    public static readonly TimeSpan RefreshEvery = TimeSpan.FromSeconds(30);

    private sealed record Entry(Guid UserId, string DisplayName, Guid? WorkspaceId, Guid? RequestId);

    private sealed record Shared(Guid UserId, string Name, Guid? RequestId, long Seen);

    private readonly ConcurrentDictionary<string, Entry> _connections = new(StringComparer.Ordinal);

    public bool Distributed => redis is not null;

    public void Connect(string connectionId, Guid userId, string displayName) =>
        _connections[connectionId] = new Entry(userId, displayName, null, null);

    /// <summary>Bağlantının workspace'ini değiştirir; önceki workspace'i döner (ona da yayın gerekir).</summary>
    public async Task<Guid?> JoinAsync(string connectionId, Guid workspaceId)
    {
        Guid? previous = null;
        var entry = _connections.AddOrUpdate(
            connectionId,
            _ => throw new InvalidOperationException("Bağlantı bulunamadı."),
            (_, e) =>
            {
                previous = e.WorkspaceId;
                return e with { WorkspaceId = workspaceId, RequestId = null };
            });
        await PublishAsync(connectionId, entry, previous);
        return previous == workspaceId ? null : previous;
    }

    public async Task<Guid?> ViewAsync(string connectionId, Guid? requestId)
    {
        // Eşzamanlı Join/Disconnect'in yazdığı kayıt ezilmesin: değişmemiş kayıt üzerinde atomik güncellenir.
        while (_connections.TryGetValue(connectionId, out var entry))
        {
            var updated = entry with { RequestId = requestId };
            if (_connections.TryUpdate(connectionId, updated, entry))
            {
                await PublishAsync(connectionId, updated, entry.WorkspaceId);
                return entry.WorkspaceId;
            }
        }

        return null;
    }

    public async Task<Guid?> DisconnectAsync(string connectionId)
    {
        if (!_connections.TryRemove(connectionId, out var entry))
        {
            return null;
        }

        await PublishAsync(connectionId, null, entry.WorkspaceId);
        return entry.WorkspaceId;
    }

    /// <summary>Erişimi kalkan bağlantıyı workspace'ten çıkarır.</summary>
    public async Task LeaveAsync(string connectionId)
    {
        if (_connections.TryGetValue(connectionId, out var entry))
        {
            _connections[connectionId] = entry with { WorkspaceId = null, RequestId = null };
            await PublishAsync(connectionId, null, entry.WorkspaceId);
        }
    }

    /// <summary>Bu sunucuda bir workspace'e bağlı tüm bağlantılar (bağlantı, kullanıcı, workspace).</summary>
    public IReadOnlyList<(string ConnectionId, Guid UserId, Guid WorkspaceId)> Joined() =>
        [.. _connections.Where(c => c.Value.WorkspaceId is not null).Select(c => (c.Key, c.Value.UserId, c.Value.WorkspaceId!.Value))];

    public Guid? WorkspaceOf(string connectionId) =>
        _connections.TryGetValue(connectionId, out var entry) ? entry.WorkspaceId : null;

    public async Task<PresenceSnapshot> SnapshotAsync(Guid workspaceId)
    {
        IEnumerable<Entry> entries = _connections.Values.Where(e => e.WorkspaceId == workspaceId);
        if (redis is not null && redis.IsConnected)
        {
            try
            {
                entries = await ReadSharedAsync(redis.GetDatabase(), workspaceId);
            }
            catch (RedisException)
            {
                // Yalnızca bu sunucunun bağlantıları gösterilir.
            }
        }

        return new PresenceSnapshot(
            workspaceId,
            [.. entries
                .GroupBy(e => e.UserId)
                .Select(g => new PresenceUser(
                    g.Key,
                    g.First().DisplayName,
                    [.. g.Where(e => e.RequestId is not null).Select(e => e.RequestId!.Value).Distinct()]))
                .OrderBy(u => u.DisplayName, StringComparer.CurrentCulture)]);
    }

    /// <summary>Tüm sunuculardaki bağlantılar; süresi geçmiş (tazelenmemiş) kayıtlar silinir.</summary>
    private async Task<List<Entry>> ReadSharedAsync(IDatabase db, Guid workspaceId)
    {
        var key = Key(workspaceId);
        var cutoff = (clock.GetUtcNow() - StaleAfter).ToUnixTimeSeconds();
        var shared = new List<Entry>();
        var stale = new List<RedisValue>();
        foreach (var field in await db.HashGetAllAsync(key))
        {
            var value = Read(field.Value);
            if (value is null || value.Seen < cutoff)
            {
                stale.Add(field.Name);
                continue;
            }

            shared.Add(new Entry(value.UserId, value.Name, workspaceId, value.RequestId));
        }

        if (stale.Count > 0)
        {
            await db.HashDeleteAsync(key, [.. stale], CommandFlags.FireAndForget);
        }

        return shared;
    }

    /// <summary>Bu sunucunun tüm bağlantılarını Redis'te tazeler (sunucunun canlı olduğunu gösterir).</summary>
    public async Task RefreshAsync()
    {
        // Bağlantı başına sırayla beklemek yerine tüm yazımlar birlikte başlatılır (tek ağ turu).
        await Task.WhenAll(_connections
            .Where(c => c.Value.WorkspaceId is not null)
            .Select(c => PublishAsync(c.Key, c.Value, null)));
    }

    /// <summary>Bağlantının güncel hâlini yazar; önceki workspace'ten (farklıysa) siler.</summary>
    private async Task PublishAsync(string connectionId, Entry? current, Guid? previousWorkspace)
    {
        // Redis erişilemezse canlı kanal çalışmaya devam eder (liste geçici olarak eksik kalır; tazelemede düzelir).
        if (redis is null || !redis.IsConnected)
        {
            return;
        }

        var db = redis.GetDatabase();
        try
        {
            if (previousWorkspace is { } previous && previous != current?.WorkspaceId)
            {
                await db.HashDeleteAsync(Key(previous), connectionId);
            }

            if (current?.WorkspaceId is { } workspaceId)
            {
                var key = Key(workspaceId);
                var value = JsonSerializer.Serialize(new Shared(current.UserId, current.DisplayName, current.RequestId, clock.GetUtcNow().ToUnixTimeSeconds()));
                await db.HashSetAsync(key, connectionId, value);
                await db.KeyExpireAsync(key, StaleAfter * 2);
            }
        }
        catch (RedisException)
        {
        }
    }

    private static RedisKey Key(Guid workspaceId) => $"apivator:presence:{workspaceId:N}";

    private static Shared? Read(RedisValue value)
    {
        try
        {
            return value.HasValue ? JsonSerializer.Deserialize<Shared>(value.ToString()) : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>Redis varsa bu sunucunun presence kayıtlarını düzenli tazeler.</summary>
internal sealed class PresenceRefresher(PresenceTracker presence, TimeProvider clock, ILogger<PresenceRefresher> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!presence.Distributed)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(PresenceTracker.RefreshEvery, clock, stoppingToken);
                await presence.RefreshAsync();
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (RedisException ex)
            {
                logger.LogWarning(ex, "Presence Redis'te tazelenemedi.");
            }
        }
    }
}
