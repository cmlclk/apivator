using System.Collections.Concurrent;

namespace Apivator.Agent;

/// <summary>
/// Masaüstünde OAuth authorization code akışı (RFC 8252): giriş sistem tarayıcısında açılır, sağlayıcı
/// http://127.0.0.1:{port}/oauth/callback adresine döner, uygulama sonucu buradan alır.
/// </summary>
internal sealed class OAuthCallbacks(TimeProvider time)
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);
    private readonly ConcurrentDictionary<string, Entry> _entries = new(StringComparer.Ordinal);

    public sealed record Outcome(string? Code, string? Error, string? ErrorDescription);

    private sealed record Entry(DateTimeOffset ExpiresAt, Outcome? Outcome);

    /// <summary>Uygulama, tarayıcıyı açmadan önce beklediği state'i kaydeder; tanınmayan state'ler reddedilir.</summary>
    public void Expect(string state)
    {
        Sweep();
        _entries[state] = new Entry(time.GetUtcNow() + Lifetime, null);
    }

    /// <summary>Sağlayıcıdan dönüş. Bilinmeyen ya da zaten tamamlanmış state için false.</summary>
    public bool Complete(string state, Outcome outcome)
    {
        if (!_entries.TryGetValue(state, out var entry) || entry.Outcome is not null || entry.ExpiresAt < time.GetUtcNow())
        {
            return false;
        }

        return _entries.TryUpdate(state, entry with { Outcome = outcome }, entry);
    }

    /// <summary>Sonuç geldiyse bir kez döner ve silinir; gelmediyse null (bekleniyor).</summary>
    public (bool Known, Outcome? Outcome) Take(string state)
    {
        if (!_entries.TryGetValue(state, out var entry) || entry.ExpiresAt < time.GetUtcNow())
        {
            return (false, null);
        }

        if (entry.Outcome is null)
        {
            return (true, null);
        }

        _entries.TryRemove(state, out _);
        return (true, entry.Outcome);
    }

    private void Sweep()
    {
        var now = time.GetUtcNow();
        foreach (var (key, entry) in _entries)
        {
            if (entry.ExpiresAt < now)
            {
                _entries.TryRemove(key, out _);
            }
        }
    }
}
