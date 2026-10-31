using Microsoft.Extensions.Caching.Memory;

namespace Apivator.Infrastructure.Identity;

/// <summary>
/// "Oturum açık mı?" sonucunun kısa süreli önbelleği (access token doğrulamasında her istekte veritabanına gidilmesin).
/// Oturum bu sunucuda kapatılınca kayıt hemen silinir; birden çok sunucuda en geç <see cref="Duration"/> sonra geçerlidir.
/// </summary>
internal static class SessionCache
{
    public static readonly TimeSpan Duration = TimeSpan.FromSeconds(30);

    public static string Key(Guid sessionId) => $"session-active:{sessionId}";

    public static void Forget(this IMemoryCache cache, IEnumerable<Guid> sessionIds)
    {
        foreach (var id in sessionIds)
        {
            cache.Remove(Key(id));
        }
    }
}
