using System.Collections.Concurrent;
using StackExchange.Redis;

namespace Apivator.Api.Realtime;

/// <summary>
/// Bir isteğin ortak taslağına (Yjs belgesi) katılımın sonucu. <paramref name="First"/> true ise belgeyi kaydedilmiş
/// sürümden bu istemci tohumlar; false ise güncellemeleri uygulayıp (ya da tohumlayanı bekleyip) devam eder.
/// </summary>
public sealed record DocumentJoin(bool CanEdit, bool First, IReadOnlyList<string> Updates, long Generation);

/// <summary>
/// Belge başına sıralı Yjs güncelleme günlüğü. Sunucu içeriği çözmez: güncellemeleri olduğu gibi tutar, geç gelene
/// sırayla verir (istemci birleştirir). Son katılımcı çıkınca belge silinir.
/// </summary>
public interface IDocumentLog
{
    Task<(bool First, IReadOnlyList<byte[]> Updates, long Generation)> JoinAsync(Guid documentId, string connectionId);

    /// <summary>Günlüğün uzunluğunu döner; belge bayt sınırını aşacaksa -1 (eklenmez).</summary>
    Task<int> AppendAsync(Guid documentId, byte[] update);

    /// <summary>
    /// İlk <paramref name="count"/> kaydı tek bir birleşik güncellemeyle değiştirir; yalnızca nesil aynıysa
    /// (başka biri aynı anda sıkıştırmadıysa) uygulanır.
    /// </summary>
    Task<bool> CompactAsync(Guid documentId, int count, long generation, byte[] merged);

    /// <summary>Katılımcıyı çıkarır; kimse kalmadıysa belgeyi siler.</summary>
    Task LeaveAsync(Guid documentId, string connectionId);

    /// <summary>Katılımcının canlılık damgasını tazeler (çöken sunucunun katılımcıları süresi dolunca düşer).</summary>
    Task RefreshAsync(Guid documentId, string connectionId);
}

public sealed class MemoryDocumentLog : IDocumentLog
{
    private sealed class State
    {
        public readonly List<byte[]> Updates = [];
        public readonly HashSet<string> Members = [];
        public long Generation;
        public long Bytes;
        public bool SeedClaimed;
        public bool Removed;
    }

    private readonly ConcurrentDictionary<Guid, State> _documents = new();

    public Task<(bool First, IReadOnlyList<byte[]> Updates, long Generation)> JoinAsync(Guid documentId, string connectionId)
    {
        while (true)
        {
            var state = _documents.GetOrAdd(documentId, _ => new State());
            lock (state)
            {
                if (state.Removed)
                {
                    // Aynı anda son katılımcı çıkıp belgeyi sildi: yeni belgeyle yeniden dene.
                    continue;
                }

                state.Members.Add(connectionId);
                var first = !state.SeedClaimed;
                state.SeedClaimed = true;
                return Task.FromResult<(bool, IReadOnlyList<byte[]>, long)>((first, [.. state.Updates], state.Generation));
            }
        }
    }

    public Task<int> AppendAsync(Guid documentId, byte[] update)
    {
        while (true)
        {
            var state = _documents.GetOrAdd(documentId, _ => new State());
            lock (state)
            {
                if (state.Removed)
                {
                    continue;
                }

                if (state.Bytes + update.Length > CollabDocuments.MaxDocumentBytes)
                {
                    return Task.FromResult(-1);
                }

                state.Bytes += update.Length;
                state.Updates.Add(update);
                return Task.FromResult(state.Updates.Count);
            }
        }
    }

    public Task<bool> CompactAsync(Guid documentId, int count, long generation, byte[] merged)
    {
        if (!_documents.TryGetValue(documentId, out var state))
        {
            return Task.FromResult(false);
        }

        lock (state)
        {
            if (state.Generation != generation || count < 1 || count > state.Updates.Count)
            {
                return Task.FromResult(false);
            }

            state.Updates.RemoveRange(0, count);
            state.Updates.Insert(0, merged);
            state.Bytes = state.Updates.Sum(u => (long)u.Length);
            state.Generation++;
            return Task.FromResult(true);
        }
    }

    public Task LeaveAsync(Guid documentId, string connectionId)
    {
        if (_documents.TryGetValue(documentId, out var state))
        {
            lock (state)
            {
                state.Members.Remove(connectionId);
                if (state.Members.Count == 0)
                {
                    state.Removed = true;
                    _documents.TryRemove(documentId, out _);
                }
                else if (state.Updates.Count == 0)
                {
                    // Tohumlayan hiçbir şey göndermeden ayrıldı: bir sonraki katılan tohumlasın.
                    state.SeedClaimed = false;
                }
            }
        }

        return Task.CompletedTask;
    }

    public Task RefreshAsync(Guid documentId, string connectionId) => Task.CompletedTask;
}

/// <summary>
/// Redis'li uygulama: günlük bir liste, katılımcılar bir küme; birden fazla API sunucusunda aynı belge paylaşılır.
/// Sunucu çökerse kalan kayıtlar <see cref="Lifetime"/> sonra kendiliğinden silinir.
/// </summary>
public sealed class RedisDocumentLog(IConnectionMultiplexer redis) : IDocumentLog
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromHours(2);

    // Tüm işlemler Lua ile atomiktir: yarışan katılım/ayrılma tohumu iki kez verip içeriği çoğaltmaz.
    private const string JoinScript = """
        redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', tonumber(ARGV[3]) - tonumber(ARGV[4]))
        if redis.call('ZCARD', KEYS[3]) == 0 then redis.call('DEL', KEYS[1], KEYS[2], KEYS[4], KEYS[5]) end
        redis.call('ZADD', KEYS[3], ARGV[3], ARGV[1])
        local claimed = redis.call('SET', KEYS[4], '1', 'EX', ARGV[2], 'NX')
        local result = { claimed and 1 or 0, tonumber(redis.call('GET', KEYS[2]) or '0') }
        for _, update in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do result[#result + 1] = update end
        for i = 1, 5 do redis.call('EXPIRE', KEYS[i], ARGV[2]) end
        return result
        """;

    private const string AppendScript = """
        local total = tonumber(redis.call('GET', KEYS[5]) or '0') + string.len(ARGV[1])
        if total > tonumber(ARGV[2]) then return -1 end
        redis.call('SET', KEYS[5], total, 'EX', ARGV[3])
        local length = redis.call('RPUSH', KEYS[1], ARGV[1])
        for i = 1, 5 do redis.call('EXPIRE', KEYS[i], ARGV[3]) end
        return length
        """;

    private const string CompactScript = """
        if tonumber(redis.call('GET', KEYS[2]) or '0') ~= tonumber(ARGV[2]) then return 0 end
        if redis.call('LLEN', KEYS[1]) < tonumber(ARGV[1]) then return 0 end
        redis.call('LTRIM', KEYS[1], tonumber(ARGV[1]), -1)
        redis.call('LPUSH', KEYS[1], ARGV[3])
        redis.call('INCR', KEYS[2])
        local total = 0
        for _, update in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do total = total + string.len(update) end
        redis.call('SET', KEYS[5], total, 'EX', ARGV[4])
        return 1
        """;

    private const string LeaveScript = """
        redis.call('ZREM', KEYS[3], ARGV[1])
        redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', tonumber(ARGV[2]) - tonumber(ARGV[3]))
        if redis.call('ZCARD', KEYS[3]) == 0 then
            redis.call('DEL', KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5])
        elseif redis.call('LLEN', KEYS[1]) == 0 then
            redis.call('DEL', KEYS[4])
        end
        return 1
        """;

    private const string RefreshScript = """
        redis.call('ZADD', KEYS[3], 'XX', ARGV[2], ARGV[1])
        for i = 1, 5 do redis.call('EXPIRE', KEYS[i], ARGV[3]) end
        return 1
        """;

    /// <summary>Canlılık damgası bu süre tazelenmezse katılımcı düşmüş sayılır.</summary>
    public static readonly TimeSpan StaleAfter = TimeSpan.FromSeconds(90);

    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    // Anahtarlar aynı {belge} etiketini taşır: Redis Cluster'da aynı yuvaya düşerler (Lua için gerekli).
    private static RedisKey[] Keys(Guid id) =>
    [
        $"apivator:doc:{{{id:N}}}:log",
        $"apivator:doc:{{{id:N}}}:gen",
        $"apivator:doc:{{{id:N}}}:members",
        $"apivator:doc:{{{id:N}}}:seed",
        $"apivator:doc:{{{id:N}}}:bytes",
    ];

    private static int Seconds => (int)Lifetime.TotalSeconds;

    public async Task<(bool First, IReadOnlyList<byte[]> Updates, long Generation)> JoinAsync(Guid documentId, string connectionId)
    {
        var result = (RedisResult[])(await redis.GetDatabase().ScriptEvaluateAsync(JoinScript, Keys(documentId), [connectionId, Seconds, Now, (int)StaleAfter.TotalSeconds]))!;
        var updates = result.Skip(2).Select(r => (byte[])r!).ToList();
        return ((int)result[0] == 1, updates, (long)result[1]);
    }

    public async Task<int> AppendAsync(Guid documentId, byte[] update) =>
        (int)await redis.GetDatabase().ScriptEvaluateAsync(AppendScript, Keys(documentId), [update, CollabDocuments.MaxDocumentBytes, Seconds]);

    public async Task<bool> CompactAsync(Guid documentId, int count, long generation, byte[] merged) =>
        (int)await redis.GetDatabase().ScriptEvaluateAsync(CompactScript, Keys(documentId), [count, generation, merged, Seconds]) == 1;

    public async Task LeaveAsync(Guid documentId, string connectionId) =>
        await redis.GetDatabase().ScriptEvaluateAsync(LeaveScript, Keys(documentId), [connectionId, Now, (int)StaleAfter.TotalSeconds]);

    public async Task RefreshAsync(Guid documentId, string connectionId) =>
        await redis.GetDatabase().ScriptEvaluateAsync(RefreshScript, Keys(documentId), [connectionId, Now, Seconds]);
}

/// <summary>
/// Bağlantıların hangi belgelere hangi yetkiyle katıldığı (bu sunucuda) ve günlük işlemleri. Hub her çağrıda yeniden
/// oluşturulduğu için durum burada tutulur.
/// </summary>
public sealed class CollabDocuments(IDocumentLog log)
{
    public const int MaxUpdateBytes = 1_000_000;
    public const int MaxLogEntries = 20_000;
    public const int MaxAwarenessBytes = 16_000;
    public const long MaxDocumentBytes = 8_000_000;

    /// <summary>Yetki bu süreden eskiyse yazmadan önce yeniden denetlenir (başka sunucudaki iptaller için).</summary>
    public static TimeSpan RecheckAfter { get; set; } = TimeSpan.FromSeconds(30);

    private const int MaxWritesPerWindow = 300;
    private const int MaxAwarenessPerWindow = 200;
    private static readonly TimeSpan RateWindow = TimeSpan.FromSeconds(10);

    private sealed record Membership(Guid UserId, bool CanEdit, DateTimeOffset CheckedAt);

    private readonly ConcurrentDictionary<string, (DateTimeOffset Start, int Count)> _writes = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, (DateTimeOffset Start, int Count)> _awareness = new(StringComparer.Ordinal);

    private readonly ConcurrentDictionary<string, ConcurrentDictionary<Guid, Membership>> _joined = new(StringComparer.Ordinal);

    public async Task<DocumentJoin> JoinAsync(string connectionId, Guid userId, Guid documentId, bool canEdit)
    {
        var (first, updates, generation) = await log.JoinAsync(documentId, connectionId);
        _joined.GetOrAdd(connectionId, _ => new ConcurrentDictionary<Guid, Membership>())[documentId] = new Membership(userId, canEdit, DateTimeOffset.UtcNow);
        return new DocumentJoin(canEdit, first, [.. updates.Select(Convert.ToBase64String)], generation);
    }

    /// <summary>Bağlantı çok sık güncelleme gönderiyorsa (taşma/DoS) false döner.</summary>
    public bool AllowWrite(string connectionId) => Allow(_writes, connectionId, MaxWritesPerWindow);

    /// <summary>İmleç mesajları için ayrı, daha geniş bir bütçe (saniyede ~20); güncellemelerin bütçesini tüketmez.</summary>
    public bool AllowAwareness(string connectionId) => Allow(_awareness, connectionId, MaxAwarenessPerWindow);

    private static bool Allow(ConcurrentDictionary<string, (DateTimeOffset Start, int Count)> buckets, string connectionId, int limit)
    {
        var now = DateTimeOffset.UtcNow;
        var window = buckets.AddOrUpdate(
            connectionId,
            _ => (now, 1),
            (_, w) => now - w.Start > RateWindow ? (now, 1) : (w.Start, w.Count + 1));
        return window.Count <= limit;
    }

    /// <summary>Yetki son denetlendiğinden beri <see cref="RecheckAfter"/> geçtiyse true.</summary>
    public bool NeedsRecheck(string connectionId, Guid documentId) =>
        _joined.TryGetValue(connectionId, out var docs) && docs.TryGetValue(documentId, out var member)
        && DateTimeOffset.UtcNow - member.CheckedAt > RecheckAfter;

    /// <summary>Bağlantı belgeye katıldıysa yetkisini döner (true: yazabilir).</summary>
    public bool? CanEdit(string connectionId, Guid documentId) =>
        _joined.TryGetValue(connectionId, out var docs) && docs.TryGetValue(documentId, out var member) ? member.CanEdit : null;

    public Task<int> AppendAsync(Guid documentId, byte[] update) => log.AppendAsync(documentId, update);

    public Task<bool> CompactAsync(Guid documentId, int count, long generation, byte[] merged) =>
        log.CompactAsync(documentId, count, generation, merged);

    public async Task LeaveAsync(string connectionId, Guid documentId)
    {
        if (_joined.TryGetValue(connectionId, out var docs) && docs.TryRemove(documentId, out _))
        {
            await log.LeaveAsync(documentId, connectionId);
        }
    }

    /// <summary>Bağlantı kapanınca katıldığı belgelerden çıkarır; çıkılan belgeler döner.</summary>
    public async Task<IReadOnlyList<Guid>> LeaveAllAsync(string connectionId)
    {
        _writes.TryRemove(connectionId, out _);
        _awareness.TryRemove(connectionId, out _);
        if (!_joined.TryRemove(connectionId, out var docs))
        {
            return [];
        }

        var ids = docs.Keys.ToList();
        foreach (var id in ids)
        {
            await log.LeaveAsync(id, connectionId);
        }

        return ids;
    }

    /// <summary>Bu sunucuda belgelere katılmış tüm bağlantılar (bağlantı, belge, yazma yetkisi).</summary>
    public IReadOnlyList<(string ConnectionId, Guid UserId, Guid DocumentId, bool CanEdit)> All() =>
        [.. _joined.SelectMany(c => c.Value.Select(d => (c.Key, d.Value.UserId, d.Key, d.Value.CanEdit)))];

    /// <summary>Yetkisi düşen (ör. düzenleyiciden görüntüleyiciye) bağlantının yazma hakkını günceller.</summary>
    public void SetCanEdit(string connectionId, Guid documentId, bool canEdit)
    {
        if (_joined.TryGetValue(connectionId, out var docs) && docs.TryGetValue(documentId, out var member))
        {
            docs[documentId] = member with { CanEdit = canEdit, CheckedAt = DateTimeOffset.UtcNow };
        }
    }
}
