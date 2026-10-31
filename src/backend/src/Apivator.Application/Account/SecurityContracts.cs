using System.Text.Json.Serialization;
using Apivator.Application.Auth;
using Apivator.Application.Common;

namespace Apivator.Application.Account;

[JsonConverter(typeof(JsonStringEnumConverter<SecurityEventKind>))]
public enum SecurityEventKind
{
    LoginSucceeded,
    LoginFailed,
    LockedOut,
    PasswordChanged,
    PasswordReset,
    EmailChanged,
    TwoFactorEnabled,
    TwoFactorDisabled,
    RecoveryCodesRegenerated,
    RecoveryCodeUsed,
    SessionsRevokedByAdmin,
    PasswordResetSentByAdmin,
}

/// <summary>İsteği yapan istemci (tarayıcı, masaüstü, CLI); güvenlik geçmişine yazılır.</summary>
public interface ICurrentClient
{
    ClientInfo Info { get; }
}

public sealed record SecurityEventDto(
    SecurityEventKind Kind,
    DateTimeOffset CreatedAt,
    string? Device,
    string? IpAddress,
    string? ActorName,
    string? Detail);

/// <param name="RecoveryCodesLeft">Kullanılmamış yedek kod sayısı.</param>
/// <param name="RequiredBy">İki adımlı doğrulamayı zorunlu kılan organizasyonlar.</param>
public sealed record TwoFactorStatusDto(bool Enabled, DateTimeOffset? EnabledAt, int RecoveryCodesLeft, IReadOnlyList<string> RequiredBy);

/// <param name="Secret">Authenticator uygulamasına elle girilecek anahtar (Base32).</param>
/// <param name="OtpAuthUri">QR kodun içeriği (otpauth://totp/…).</param>
public sealed record TwoFactorSetupDto(string Secret, string OtpAuthUri);

public sealed record TwoFactorCodeRequest(string Code);

/// <param name="Code">Authenticator kodu ya da yedek kod.</param>
public sealed record DisableTwoFactorRequest(string Password, string Code);

public sealed record RecoveryCodesDto(IReadOnlyList<string> Codes);

/// <summary>Şifre doğru, ikinci adım bekleniyor.</summary>
public sealed record TwoFactorChallengeDto(bool TwoFactorRequired, string ChallengeToken, DateTimeOffset ExpiresAt);

/// <summary>Giriş sonucu: ya oturum (Auth) ya da ikinci adım (Challenge).</summary>
public sealed record LoginOutcome(AuthResult? Auth, TwoFactorChallengeDto? Challenge);

/// <param name="Code">Authenticator kodu ya da yedek kod ("xxxxx-xxxxx").</param>
public sealed record TwoFactorLoginRequest(string ChallengeToken, string Code);

public sealed record OrganizationSecurityRequest(bool RequireTwoFactor);

public interface ISecurityService
{
    Task<Result<TwoFactorStatusDto>> StatusAsync(Guid userId, CancellationToken ct = default);

    /// <summary>Yeni gizli anahtar üretir (açık iki adımlı doğrulama varken yapılamaz).</summary>
    Task<Result<TwoFactorSetupDto>> BeginSetupAsync(Guid userId, CancellationToken ct = default);

    /// <summary>Authenticator kodu doğruysa açar ve yedek kodları (bir kez) döner.</summary>
    Task<Result<RecoveryCodesDto>> EnableAsync(Guid userId, TwoFactorCodeRequest request, CancellationToken ct = default);

    Task<Result> DisableAsync(Guid userId, DisableTwoFactorRequest request, CancellationToken ct = default);

    Task<Result<RecoveryCodesDto>> RegenerateRecoveryCodesAsync(Guid userId, TwoFactorCodeRequest request, CancellationToken ct = default);

    Task<IReadOnlyList<SecurityEventDto>> EventsAsync(Guid userId, CancellationToken ct = default);

    /// <summary>Organizasyon yöneticisi: üyenin tüm oturumlarını kapatır.</summary>
    Task<Result> RevokeMemberSessionsAsync(Guid organizationId, Guid memberId, Guid userId, CancellationToken ct = default);

    /// <summary>Organizasyon yöneticisi: üyeye şifre sıfırlama bağlantısı gönderir.</summary>
    Task<Result> SendMemberPasswordResetAsync(Guid organizationId, Guid memberId, Guid userId, CancellationToken ct = default);

    /// <summary>Zorunlu kılmak için yöneticinin kendi iki adımlı doğrulaması açık olmalı.</summary>
    Task<Result> SetOrganizationSecurityAsync(Guid organizationId, OrganizationSecurityRequest request, Guid userId, CancellationToken ct = default);
}
