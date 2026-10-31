using System.Security.Cryptography;
using System.Text;
using Apivator.Application.Account;
using Apivator.Application.Audit;
using Apivator.Application.Auth;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Sso;
using Apivator.Domain.Audit;
using Apivator.Infrastructure.Email;
using Apivator.Infrastructure.Identity;
using Apivator.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Sso;

/// <summary>
/// SSO ile giriş (OIDC authorization code + PKCE). Kimlik sağlayıcı sunucuya döner; sunucu kimliği doğrular, hesabı
/// bulur ya da açar (<see cref="SsoAccounts"/>) ve istemciye 60 saniyelik tek kullanımlık bir kod verir. Kod, akışı
/// başlatan istemcinin verifier'ıyla oturuma çevrilir (login CSRF'e karşı). Web (cookie) ve masaüstü (yerel ajan,
/// RFC 8252) aynı akışı kullanır; token adres çubuğunda görünmez.
/// </summary>
internal sealed class SsoLoginService(
    AppDbContext db,
    UserManager<ApplicationUser> users,
    AuthService auth,
    SsoPolicy policy,
    SsoAccounts accounts,
    OidcClient oidc,
    IAuditLog audit,
    Application.Abstractions.IEmailSender email,
    IDataProtectionProvider protection,
    IOptions<SsoOptions> options,
    IOptions<AppOptions> app,
    TimeProvider clock,
    ILogger<SsoLoginService> logger) : ISsoLoginService
{
    private const string VerifierPurpose = "Apivator.Sso.CodeVerifier";

    private static Error NotAvailable => Error.Validation("sso.not_available", L.T("sso.not_available", "Bu e-posta adresi için tek oturum açma (SSO) tanımlı değil."));

    private static Error InvalidCode => Error.Unauthorized("sso.invalid_code", L.T("sso.invalid_code", "Giriş bağlantısının süresi doldu ya da bu tarayıcıda başlatılmadı; tekrar deneyin."));

    public async Task<SsoDiscoveryDto> DiscoverAsync(string email, CancellationToken ct = default) =>
        await policy.ForEmailAsync(email, ct) is { } found
            ? new SsoDiscoveryDto(true, found.Sso.Enforced, found.Organization.Name)
            : new SsoDiscoveryDto(false, false, null);

    public async Task<Result<SsoStartDto>> StartAsync(SsoStartRequest request, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || request.Email.Length > 256)
        {
            return NotAvailable;
        }

        if (request.CodeChallenge is not { Length: 43 } challenge || !challenge.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
        {
            return Error.Validation("sso.code_challenge", L.T("sso.code_challenge", "codeChallenge, istemcide üretilen verifier'ın SHA-256 özeti (base64url, 43 karakter) olmalı."));
        }

        if (request.ReturnUrl is not null && !IsLoopback(request.ReturnUrl))
        {
            return Error.Validation("sso.return_url", L.T("sso.return_url", "Dönüş adresi yalnızca bu bilgisayardaki uygulama (http://127.0.0.1) olabilir."));
        }

        if (await policy.ForEmailAsync(request.Email, ct) is not { } found)
        {
            return NotAvailable;
        }

        string authorizationEndpoint;
        try
        {
            authorizationEndpoint = (await oidc.DiscoverAsync(found.Sso.Authority, ct)).AuthorizationEndpoint;
        }
        catch (OidcException ex)
        {
            logger.LogWarning(ex, "SSO keşif belgesi alınamadı: {Organization}", found.Organization.Id);
            return Error.Validation("sso.provider_unreachable", L.T("sso.provider_unreachable", "Kimlik sağlayıcıya şu anda ulaşılamıyor. Yöneticinize haber verin."));
        }

        var state = Token();
        var nonce = Token();
        var verifier = Token() + Token();
        var now = clock.GetUtcNow();
        await db.SsoLoginTickets.Where(t => t.ExpiresAt < now).ExecuteDeleteAsync(ct);
        db.SsoLoginTickets.Add(new SsoLoginTicket
        {
            StateHash = SsoAccounts.Hash(state),
            OrganizationId = found.Organization.Id,
            ProtectedCodeVerifier = protection.CreateProtector(VerifierPurpose).Protect(verifier),
            Nonce = nonce,
            ClientChallenge = challenge,
            ReturnUrl = request.ReturnUrl,
            ClientState = request.State is { Length: <= 200 } s ? s : null,
            ExpiresAt = now.AddMinutes(Math.Max(1, options.Value.LoginTimeoutMinutes)),
        });
        await db.SaveChangesAsync(ct);

        var url = QueryHelpers.AddQueryString(authorizationEndpoint, new Dictionary<string, string?>
        {
            ["response_type"] = "code",
            ["client_id"] = found.Sso.ClientId,
            ["redirect_uri"] = SsoAdminService.RedirectUri(app.Value),
            ["scope"] = "openid email profile",
            ["state"] = state,
            ["nonce"] = nonce,
            ["code_challenge"] = Challenge(verifier),
            ["code_challenge_method"] = "S256",
            ["login_hint"] = request.Email.Trim(),
        });
        return new SsoStartDto(url);
    }

    public async Task<string> CallbackAsync(string? code, string? state, string? error, ClientInfo client, CancellationToken ct = default)
    {
        SsoLoginTicket? ticket = null;
        if (!string.IsNullOrEmpty(state) && state.Length <= 200)
        {
            var hash = SsoAccounts.Hash(state);
            ticket = await db.SsoLoginTickets.AsNoTracking().FirstOrDefaultAsync(t => t.StateHash == hash, ct);
        }

        // State tek kullanımlıktır: silmeyi başaran istek devam eder (aynı anda gelen ikinci dönüş 0 satır siler).
        if (ticket is null || await db.SsoLoginTickets.Where(t => t.Id == ticket.Id).ExecuteDeleteAsync(ct) == 0 || ticket.ExpiresAt < clock.GetUtcNow())
        {
            return Redirect(null, null, "expired");
        }

        var actor = Actor(client);
        if (!string.IsNullOrEmpty(error) || string.IsNullOrEmpty(code))
        {
            return await FailAsync(ticket, actor, error == "access_denied" ? "denied" : "provider_error", null, ct);
        }

        var sso = await db.OrganizationSso.AsNoTracking().Include(s => s.Domains).FirstOrDefaultAsync(s => s.OrganizationId == ticket.OrganizationId && s.Enabled, ct);
        var organization = await db.Organizations.Include(o => o.Members).FirstOrDefaultAsync(o => o.Id == ticket.OrganizationId, ct);
        if (sso is null || organization is null)
        {
            return Redirect(ticket, null, "not_available");
        }

        OidcIdentity identity;
        try
        {
            var secret = sso.ProtectedClientSecret is null ? null : protection.CreateProtector(SsoAdminService.SecretPurpose).Unprotect(sso.ProtectedClientSecret);
            var verifier = protection.CreateProtector(VerifierPurpose).Unprotect(ticket.ProtectedCodeVerifier);
            identity = await oidc.RedeemAsync(sso.Authority, sso.ClientId, secret, code, verifier, SsoAdminService.RedirectUri(app.Value), ticket.Nonce, ct);
        }
        catch (Exception ex) when (ex is OidcException or CryptographicException)
        {
            logger.LogWarning(ex, "SSO dönüşü doğrulanamadı: {Organization}", organization.Id);
            var reason = ex is OidcException { Code: "sso.no_email" or "sso.email_unverified" } oidcError ? oidcError.Code[4..] : "invalid_response";
            return await FailAsync(ticket, actor, reason, null, ct);
        }

        // Asıl güvenlik sınırı: kimlik sağlayıcı yalnızca organizasyonun doğruladığı alan adlarındaki hesaplara girebilir.
        if (!sso.CoversEmail(identity.Email))
        {
            return await FailAsync(ticket, actor, "domain_mismatch", identity.Email, ct);
        }

        switch (await accounts.ResolveAsync(identity, sso, organization, actor, ct))
        {
            case SsoAccountOutcome.SignedIn(var user):
                var loginCode = Token();
                db.SsoLoginCodes.Add(new SsoLoginCode
                {
                    CodeHash = SsoAccounts.Hash(loginCode),
                    UserId = user.Id,
                    OrganizationId = organization.Id,
                    ClientChallenge = ticket.ClientChallenge,
                    ExpiresAt = clock.GetUtcNow() + SsoLoginCode.Lifetime,
                });
                await audit.RecordAsync(
                    organization.Id, AuditActions.SsoLogin, "member", user.Id, user.DisplayName, new Dictionary<string, string?> { ["email"] = user.Email },
                    actor with { UserId = user.Id, Name = user.DisplayName, Email = user.Email }, ct);
                await db.SaveChangesAsync(ct);
                return Redirect(ticket, loginCode, null);

            case SsoAccountOutcome.LinkRequired(var existing, var token):
                var link = QueryHelpers.AddQueryString(app.Value.PublicUrl.TrimEnd('/') + "/sso/link", "token", token);
                await audit.RecordAsync(
                    organization.Id, AuditActions.SsoLinkRequested, "member", existing.Id, existing.DisplayName, new Dictionary<string, string?> { ["email"] = existing.Email }, actor, ct);
                await db.SaveChangesAsync(ct);
                try
                {
                    var idpUser = identity.Name is null ? identity.Email : $"{identity.Name} <{identity.Email}>";
                    await email.SendAsync(EmailTemplates.ConfirmSsoLink(existing.Email!, existing.DisplayName, organization.Name, idpUser, actor.IpAddress, clock.GetUtcNow(), link), ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError(ex, "SSO bağlama e-postası gönderilemedi.");
                }

                return Redirect(ticket, null, "link_sent");

            case SsoAccountOutcome.Rejected(var reason):
                return await FailAsync(ticket, actor, reason, identity.Email, ct);

            default:
                return Redirect(ticket, null, "login_failed");
        }
    }

    public async Task<Result<AuthResult>> ExchangeAsync(SsoExchangeRequest request, ClientInfo client, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.Code) || request.Code.Length > 200 || string.IsNullOrEmpty(request.CodeVerifier) || request.CodeVerifier.Length is < 43 or > 128)
        {
            return InvalidCode;
        }

        var hash = SsoAccounts.Hash(request.Code);
        var now = clock.GetUtcNow();

        // Tek kullanımlık: silme başarılıysa kod bu isteğe aittir. Yanlış verifier da kodu yakar (deneme yapılamaz).
        var entry = await db.SsoLoginCodes.AsNoTracking().FirstOrDefaultAsync(c => c.CodeHash == hash, ct);
        if (entry is null || await db.SsoLoginCodes.Where(c => c.Id == entry.Id).ExecuteDeleteAsync(ct) == 0
            || entry.ExpiresAt < now
            || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Challenge(request.CodeVerifier)), Encoding.ASCII.GetBytes(entry.ClientChallenge)))
        {
            return InvalidCode;
        }

        await db.SsoLoginCodes.Where(c => c.ExpiresAt < now).ExecuteDeleteAsync(ct);
        var user = await users.FindByIdAsync(entry.UserId.ToString());
        if (user is null || user.DeletedAt is not null || await users.IsLockedOutAsync(user))
        {
            return InvalidCode;
        }

        return await auth.SignInExternalAsync(user, client, ct);
    }

    public async Task<Result> ConfirmLinkAsync(string token, ClientInfo client, CancellationToken ct = default)
    {
        var user = await accounts.ConfirmLinkAsync(token, Actor(client), ct);
        return user is null
            ? Error.Validation("sso.invalid_link", L.T("sso.invalid_link", "Bağlantının süresi dolmuş ya da kullanılmış. SSO ile yeniden giriş yapmayı deneyin."))
            : Result.Success();
    }

    /// <summary>Başarısız denemeyi (IP ile) denetim kaydına yazar ve istemciyi hata koduyla yönlendirir.</summary>
    private async Task<string> FailAsync(SsoLoginTicket ticket, AuditActor actor, string reason, string? emailAddress, CancellationToken ct)
    {
        await audit.RecordAsync(
            ticket.OrganizationId, AuditActions.SsoLoginFailed, "sso", null, emailAddress ?? "—",
            new Dictionary<string, string?> { ["reason"] = reason, ["email"] = emailAddress }, actor, ct);
        await db.SaveChangesAsync(ct);
        return Redirect(ticket, null, reason);
    }

    private static AuditActor Actor(ClientInfo client) =>
        new(null, "Bilinmeyen (SSO)", null, null, client.IpAddress, client.UserAgent is null && client.App is null ? null : DeviceLabel.Describe(client.UserAgent, client.App));

    /// <summary>Web: {PublicUrl}/sso/callback; masaüstü: ajanın adresi (+ ajanın state'i).</summary>
    private string Redirect(SsoLoginTicket? ticket, string? code, string? error)
    {
        var query = new Dictionary<string, string?> { ["code"] = code, ["error"] = error is null ? null : "sso_" + error };
        var target = ticket?.ReturnUrl ?? app.Value.PublicUrl.TrimEnd('/') + "/sso/callback";
        if (ticket?.ReturnUrl is not null)
        {
            query["state"] = ticket.ClientState;
        }

        return QueryHelpers.AddQueryString(target, query.Where(p => p.Value is not null).ToDictionary(p => p.Key, p => p.Value));
    }

    private static bool IsLoopback(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttp && uri.IsLoopback
        && (uri.Host == "127.0.0.1" || uri.Host == "localhost" || uri.Host == "[::1]") && string.IsNullOrEmpty(uri.Query) && string.IsNullOrEmpty(uri.Fragment);

    private static string Challenge(string verifier) => WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));

    private static string Token() => WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
}
