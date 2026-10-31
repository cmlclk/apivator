namespace Apivator.Infrastructure.Identity;

/// <summary>
/// Refresh token'ın yalnızca SHA-256 özeti saklanır. Her kullanımda yenisiyle değiştirilir (rotasyon);
/// iptal edilmiş bir token tekrar kullanılırsa kullanıcının tüm oturumları kapatılır.
/// Rotasyonla oluşan token'lar aynı <see cref="SessionId"/>'yi taşır: bir oturum = bir cihaz/tarayıcı girişi.
/// </summary>
public sealed class RefreshToken
{
    public const int UserAgentMaxLength = 512;
    public const int IpAddressMaxLength = 64;
    public const int AppMaxLength = 20;

    public Guid Id { get; set; } = Guid.CreateVersion7();

    public Guid UserId { get; set; }

    /// <summary>Oturum kimliği; access token'da "sid" claim'i olarak taşınır.</summary>
    public Guid SessionId { get; set; }

    /// <summary>Oturumun ilk açıldığı an (rotasyonda korunur).</summary>
    public DateTimeOffset SessionStartedAt { get; set; }

    public string TokenHash { get; set; } = string.Empty;

    /// <summary>Token'ın üretildiği an; rotasyonla oturumun son kullanımı olur.</summary>
    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }

    public DateTimeOffset? RevokedAt { get; set; }

    public Guid? ReplacedById { get; set; }

    public string? UserAgent { get; set; }

    public string? IpAddress { get; set; }

    /// <summary>İstemci türü: "web", "desktop" ya da "cli".</summary>
    public string? App { get; set; }

    public bool IsActive(DateTimeOffset now) => RevokedAt is null && ExpiresAt > now;
}
