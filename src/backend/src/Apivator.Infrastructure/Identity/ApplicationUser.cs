using Apivator.Application.Account;
using Microsoft.AspNetCore.Identity;

namespace Apivator.Infrastructure.Identity;

public sealed class ApplicationUser : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>Doğrulama bekleyen yeni e-posta; doğrulanana kadar <see cref="IdentityUser{TKey}.Email"/> geçerlidir.</summary>
    public string? PendingEmail { get; set; }

    /// <summary>Profil görselinin sürümü (önbellek için adrese eklenir); görsel yoksa null.</summary>
    public long? AvatarVersion { get; set; }

    /// <summary>Cihazlar arası ortak tercihler (JSON kolonu).</summary>
    public UserPreferences Preferences { get; set; } = new();

    /// <summary>
    /// Hesap silindiğinde kişisel veriler temizlenir, kayıt "Silinmiş kullanıcı" olarak kalır; böylece başkalarının
    /// workspace'lerindeki collection ve değişiklik kayıtları bozulmaz.
    /// </summary>
    public DateTimeOffset? DeletedAt { get; set; }

    /// <summary>
    /// TOTP gizli anahtarı (Data Protection ile şifreli). Kurulum başlayınca yazılır; iki adımlı doğrulama
    /// <see cref="IdentityUser{TKey}.TwoFactorEnabled"/> ile açılır.
    /// </summary>
    public string? AuthenticatorKey { get; set; }

    /// <summary>Son kabul edilen TOTP zaman adımı; aynı kod ikinci kez kullanılamaz.</summary>
    public long? LastTotpStep { get; set; }

    /// <summary>Kullanılmamış yedek kodların SHA-256 özetleri.</summary>
    public List<string> RecoveryCodeHashes { get; set; } = [];

    public DateTimeOffset? TwoFactorEnabledAt { get; set; }
}
