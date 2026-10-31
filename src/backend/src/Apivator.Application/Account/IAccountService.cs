using Apivator.Application.Common;

namespace Apivator.Application.Account;

/// <summary>Kullanıcının kendi hesabıyla ilgili işlemler (profil, e-posta, şifre, oturumlar, tercihler, silme).</summary>
public interface IAccountService
{
    Task<Result<ProfileDto>> GetProfileAsync(Guid userId, CancellationToken ct = default);

    Task<Result<ProfileDto>> UpdateProfileAsync(Guid userId, UpdateProfileRequest request, CancellationToken ct = default);

    Task<Result<long>> SetAvatarAsync(Guid userId, string? contentType, byte[] data, CancellationToken ct = default);

    Task<Result> RemoveAvatarAsync(Guid userId, CancellationToken ct = default);

    Task<AvatarFile?> GetAvatarAsync(Guid userId, CancellationToken ct = default);

    /// <summary>Yeni adrese doğrulama bağlantısı gönderir; doğrulanana kadar eski adres geçerlidir.</summary>
    Task<Result> RequestEmailChangeAsync(Guid userId, ChangeEmailRequest request, CancellationToken ct = default);

    Task<Result> CancelEmailChangeAsync(Guid userId, CancellationToken ct = default);

    /// <summary>E-postadaki bağlantıyla çağrılır (oturum gerekmez). Eski adrese bildirim gider.</summary>
    Task<Result> ConfirmEmailChangeAsync(ConfirmEmailChangeRequest request, CancellationToken ct = default);

    /// <summary>Mevcut şifreyle değiştirir; <paramref name="currentSessionId"/> dışındaki oturumlar kapanır.</summary>
    Task<Result> ChangePasswordAsync(Guid userId, Guid? currentSessionId, ChangePasswordRequest request, CancellationToken ct = default);

    Task<IReadOnlyList<SessionDto>> ListSessionsAsync(Guid userId, Guid? currentSessionId, CancellationToken ct = default);

    Task<Result> RevokeSessionAsync(Guid userId, Guid sessionId, CancellationToken ct = default);

    /// <summary>Bu oturum dışındaki tüm oturumları kapatır; kapatılan oturum sayısını döner.</summary>
    Task<int> RevokeOtherSessionsAsync(Guid userId, Guid? currentSessionId, CancellationToken ct = default);

    /// <summary>Oturum hâlâ açık mı (access token'daki "sid" için; kısa süreli önbellekle).</summary>
    Task<bool> IsSessionActiveAsync(Guid sessionId, CancellationToken ct = default);

    Task<Result<PreferencesDto>> GetPreferencesAsync(Guid userId, CancellationToken ct = default);

    Task<Result<PreferencesDto>> UpdatePreferencesAsync(Guid userId, PreferencesDto request, CancellationToken ct = default);

    /// <summary>Kişisel workspace verisi (Postman formatında) ve hesap bilgileri tek ZIP arşivi olarak.</summary>
    Task<Result<AccountExportFile>> ExportAsync(Guid userId, CancellationToken ct = default);

    Task<Result<AccountDeletionCheckDto>> CheckDeletionAsync(Guid userId, CancellationToken ct = default);

    /// <summary>Şifreyi doğrular ve silme onayı bağlantısını e-postayla gönderir.</summary>
    Task<Result> RequestDeletionAsync(Guid userId, DeleteAccountRequest request, CancellationToken ct = default);

    /// <summary>E-postadaki bağlantıyla çağrılır; hesabı siler (kişisel veriler temizlenir).</summary>
    Task<Result> ConfirmDeletionAsync(ConfirmAccountDeletionRequest request, CancellationToken ct = default);
}
