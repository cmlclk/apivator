using System.Security.Cryptography;
using System.Text;
using Apivator.Domain.Common;

namespace Apivator.Domain.Access;

/// <summary>
/// Kişisel API anahtarı: komut satırı aracı ve CI bununla sunucuya bağlanır. Anahtarın kendisi yalnızca
/// oluşturulurken bir kez gösterilir; veritabanında SHA-256 özeti saklanır.
/// </summary>
public sealed class ApiKey : Entity
{
    public const string TokenPrefix = "apv_";
    public const int NameMaxLength = 100;
    public const int MaxActivePerUser = 20;

    private ApiKey()
    {
        Name = string.Empty;
        Prefix = string.Empty;
        Hash = string.Empty;
    }

    public Guid UserId { get; private set; }

    public string Name { get; private set; }

    /// <summary>Listede tanımak için anahtarın başı ("apv_Xy12Ab").</summary>
    public string Prefix { get; private set; }

    public string Hash { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? ExpiresAt { get; private set; }

    public DateTimeOffset? LastUsedAt { get; private set; }

    public DateTimeOffset? RevokedAt { get; private set; }

    /// <summary>Yeni anahtar ve (bir kez gösterilecek) gizli değeri.</summary>
    public static (ApiKey Key, string Secret) Create(Guid userId, string name, DateTimeOffset? expiresAt, DateTimeOffset now)
    {
        var secret = TokenPrefix + Base64Url(RandomNumberGenerator.GetBytes(32));
        var key = new ApiKey
        {
            UserId = userId,
            Name = Names.Clean(name, NameMaxLength),
            Prefix = secret[..(TokenPrefix.Length + 6)],
            Hash = HashOf(secret),
            CreatedAt = now,
            ExpiresAt = expiresAt,
        };
        return (key, secret);
    }

    public static string HashOf(string secret) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(secret)));

    public bool IsActive(DateTimeOffset now) => RevokedAt is null && (ExpiresAt is null || ExpiresAt > now);

    public void Revoke(DateTimeOffset now) => RevokedAt ??= now;

    public void MarkUsed(DateTimeOffset now) => LastUsedAt = now;

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
