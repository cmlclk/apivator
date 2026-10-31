using Apivator.Application.Account;
using Apivator.Application.Auth;
using Apivator.Application.Common;
using Apivator.Domain.Organizations;

namespace Apivator.Application.Sso;

public sealed class SsoOptions
{
    public const string SectionName = "Sso";

    /// <summary>
    /// false ise alan adları DNS kaydı aranmadan, ekleyen sahip tarafından doğrulanmış sayılır. Yalnızca tek şirketin
    /// kullandığı kendi sunucunuzda kapatın; çok kiracılı kurulumda açık kalmalı (yoksa başkasının alan adı sahiplenilir).
    /// </summary>
    public bool RequireDomainVerification { get; set; } = true;

    /// <summary>Issuer adresi http olabilir mi (yalnızca geliştirme/test; üretimde https zorunlu).</summary>
    public bool AllowInsecureAuthority { get; set; }

    public int LoginTimeoutMinutes { get; set; } = 10;
}

/// <param name="RecordName">TXT kaydının adı (ör. _apivator.firma.com).</param>
public sealed record SsoDomainDto(Guid Id, string Domain, bool Verified, DateTimeOffset? VerifiedAt, string RecordName, string RecordValue);

/// <param name="RedirectUri">Kimlik sağlayıcıda kayıtlı olması gereken dönüş adresi.</param>
public sealed record SsoSettingsDto(
    bool Configured,
    bool Enabled,
    bool Enforced,
    string? Authority,
    string? ClientId,
    bool HasClientSecret,
    bool AutoProvision,
    OrganizationRole DefaultRole,
    string RedirectUri,
    IReadOnlyList<SsoDomainDto> Domains);

/// <param name="ClientSecret">null ise mevcut secret korunur; boş dize secret'ı siler (public client / PKCE).</param>
public sealed record UpdateSsoRequest(string Authority, string ClientId, string? ClientSecret, bool AutoProvision = true, OrganizationRole DefaultRole = OrganizationRole.Member);

public sealed record SsoStateRequest(bool Enabled, bool Enforced);

public sealed record AddSsoDomainRequest(string Domain);

/// <summary>Organizasyon sahibi/yöneticisi için SSO ayarları.</summary>
public interface ISsoAdminService
{
    Task<Result<SsoSettingsDto>> GetAsync(Guid organizationId, Guid userId, CancellationToken ct = default);

    /// <summary>Issuer'ın OIDC keşif belgesi çekilerek doğrulanır; hatalıysa kaydedilmez.</summary>
    Task<Result<SsoSettingsDto>> UpdateAsync(Guid organizationId, UpdateSsoRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<SsoSettingsDto>> SetStateAsync(Guid organizationId, SsoStateRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<SsoSettingsDto>> AddDomainAsync(Guid organizationId, AddSsoDomainRequest request, Guid userId, CancellationToken ct = default);

    /// <summary>DNS TXT kaydını kontrol eder.</summary>
    Task<Result<SsoSettingsDto>> VerifyDomainAsync(Guid organizationId, Guid domainId, Guid userId, CancellationToken ct = default);

    Task<Result<SsoSettingsDto>> RemoveDomainAsync(Guid organizationId, Guid domainId, Guid userId, CancellationToken ct = default);
}

/// <param name="Enforced">Bu adresle şifreyle giriş kapalı.</param>
public sealed record SsoDiscoveryDto(bool Available, bool Enforced, string? OrganizationName);

/// <param name="CodeChallenge">
/// base64url(SHA-256(codeVerifier)). Verifier istemcide kalır ve <see cref="SsoExchangeRequest"/> ile verilir; böylece
/// giriş kodu yalnızca akışı başlatan tarayıcıda/uygulamada oturuma çevrilebilir.
/// </param>
/// <param name="ReturnUrl">Yalnızca masaüstü: yerel ajanın dönüş adresi (http://127.0.0.1:{port}/…).</param>
/// <param name="State">Masaüstü: ajanın beklediği state; dönüşte aynen geri verilir.</param>
public sealed record SsoStartRequest(string Email, string CodeChallenge, string? ReturnUrl = null, string? State = null);

public sealed record SsoStartDto(string AuthorizationUrl);

public sealed record SsoExchangeRequest(string Code, string CodeVerifier);

/// <summary>E-postadaki bağlantıyla mevcut hesabın SSO kimliğine bağlanması.</summary>
public sealed record SsoLinkConfirmRequest(string Token);

/// <summary>SSO ile giriş: keşif, kimlik sağlayıcıya yönlendirme, dönüş ve oturuma çevirme.</summary>
public interface ISsoLoginService
{
    Task<SsoDiscoveryDto> DiscoverAsync(string email, CancellationToken ct = default);

    Task<Result<SsoStartDto>> StartAsync(SsoStartRequest request, CancellationToken ct = default);

    /// <summary>
    /// Kimlik sağlayıcıdan dönüş. Her durumda tarayıcının yönlendirileceği adresi döner: başarıda tek kullanımlık
    /// giriş koduyla, hatada okunur bir hata koduyla (web'de /sso/callback, masaüstünde ajanın adresi).
    /// </summary>
    Task<string> CallbackAsync(string? code, string? state, string? error, ClientInfo client, CancellationToken ct = default);

    /// <summary>Tek kullanımlık giriş kodunu (60 sn) akışı başlatan istemcinin verifier'ıyla oturuma çevirir.</summary>
    Task<Result<AuthResult>> ExchangeAsync(SsoExchangeRequest request, ClientInfo client, CancellationToken ct = default);

    /// <summary>
    /// Aynı e-postalı mevcut hesabı SSO kimliğine bağlar (e-postadaki bağlantı, 1 saat, tek kullanımlık). Oturum açmaz;
    /// kişi ardından SSO ile girer.
    /// </summary>
    Task<Result> ConfirmLinkAsync(string token, ClientInfo client, CancellationToken ct = default);
}
