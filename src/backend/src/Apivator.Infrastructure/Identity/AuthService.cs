using System.Text;
using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Application.Auth;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Onboarding;
using Apivator.Infrastructure.Email;
using Apivator.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Identity;

internal sealed class AuthService(
    UserManager<ApplicationUser> users,
    AppDbContext db,
    TokenService tokens,
    IPersonalSpaceProvisioner provisioner,
    IEmailSender email,
    IMemoryCache cache,
    TwoFactor twoFactor,
    SecurityLog log,
    Sso.SsoPolicy sso,
    IOptions<AppOptions> appOptions,
    TimeProvider clock,
    ILogger<AuthService> logger) : IAuthService
{
    private static Error LockedOut =>
        Error.Locked("auth.locked_out", L.T("identity.locked_out", "Çok fazla hatalı deneme. Lütfen birkaç dakika sonra tekrar deneyin."));

    private static Error InvalidCredentials =>
        Error.Unauthorized("auth.invalid_credentials", L.T("auth.invalid_credentials", "E-posta veya şifre hatalı."));

    private static Error InvalidRefreshToken =>
        Error.Unauthorized("auth.invalid_refresh_token", L.T("auth.invalid_refresh_token", "Oturum süresi doldu, lütfen tekrar giriş yapın."));

    public async Task<Result<AuthResult>> RegisterAsync(RegisterRequest request, ClientInfo client, CancellationToken cancellationToken = default)
    {
        if (AuthValidator.Validate(request) is { } validationError)
        {
            return validationError;
        }

        var emailAddress = request.Email.Trim();
        if (await sso.RegistrationErrorAsync(emailAddress, cancellationToken) is { } ssoRequired)
        {
            return ssoRequired;
        }

        if (await users.FindByEmailAsync(emailAddress) is not null)
        {
            return Error.Conflict("auth.email_taken", L.T("identity.email_taken", "Bu e-posta adresiyle kayıtlı bir hesap var."));
        }

        var user = new ApplicationUser
        {
            Id = Guid.CreateVersion7(),
            UserName = emailAddress,
            Email = emailAddress,
            DisplayName = request.DisplayName.Trim(),
            CreatedAt = clock.GetUtcNow(),
        };

        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var created = await users.CreateAsync(user, request.Password);
        if (!created.Succeeded)
        {
            return ToValidationError(created);
        }

        provisioner.Provision(user.Id, user.DisplayName);
        await log.LoginSucceededAsync(user, client, cancellationToken); // bilinen ilk cihaz
        var result = await IssueTokensAsync(user, client, cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        await SendConfirmationEmailAsync(user, cancellationToken);
        return result;
    }

    public async Task<Result<LoginOutcome>> LoginAsync(LoginRequest request, ClientInfo client, CancellationToken cancellationToken = default)
    {
        if (AuthValidator.Validate(request) is { } validationError)
        {
            return validationError;
        }

        var user = await users.FindByEmailAsync(request.Email.Trim());
        if (user is null || user.DeletedAt is not null)
        {
            return InvalidCredentials;
        }

        if (await users.IsLockedOutAsync(user))
        {
            log.Add(user.Id, SecurityEventKind.LoginFailed, client, detail: "Hesap geçici olarak kilitli");
            await db.SaveChangesAsync(cancellationToken);
            return LockedOut;
        }

        if (!await users.CheckPasswordAsync(user, request.Password))
        {
            await FailAsync(user, client, "Şifre hatalı", cancellationToken);
            return InvalidCredentials;
        }

        // Şifre doğrulandıktan sonra söylenir: yoksa SSO'lu alan adlarındaki hesapların varlığı sızardı.
        if (await sso.PasswordLoginErrorAsync(user.Email, user.Id, cancellationToken) is { } ssoRequired)
        {
            return ssoRequired;
        }

        if (user.TwoFactorEnabled)
        {
            // Hatalı deneme sayacı ikinci adım tamamlanınca sıfırlanır.
            return new LoginOutcome(null, new TwoFactorChallengeDto(true, twoFactor.CreateChallenge(user), clock.GetUtcNow() + TwoFactor.ChallengeLifetime));
        }

        await users.ResetAccessFailedCountAsync(user);
        await log.LoginSucceededAsync(user, client, cancellationToken);
        var issued = await IssueTokensAsync(user, client, cancellationToken);
        return new LoginOutcome(issued.Value, null);
    }

    public async Task<Result<AuthResult>> LoginTwoFactorAsync(TwoFactorLoginRequest request, ClientInfo client, CancellationToken cancellationToken = default)
    {
        var expired = Error.Unauthorized("auth.challenge_expired", L.T("auth.challenge_expired", "Giriş adımının süresi doldu; e-posta ve şifrenizle tekrar giriş yapın."));
        if (twoFactor.ReadChallenge(request.ChallengeToken) is not { } challenge)
        {
            return expired;
        }

        var user = await users.FindByIdAsync(challenge.UserId.ToString());
        if (user is null || user.DeletedAt is not null || !user.TwoFactorEnabled || user.SecurityStamp != challenge.Stamp)
        {
            return expired;
        }

        if (await users.IsLockedOutAsync(user))
        {
            return LockedOut;
        }

        var outcome = twoFactor.Verify(user, request.Code, allowRecovery: true);
        if (outcome == TwoFactor.Outcome.Invalid)
        {
            await FailAsync(user, client, "İki adımlı doğrulama kodu hatalı", cancellationToken);
            return Error.Unauthorized("auth.invalid_code", L.T("auth.invalid_code", "Kod hatalı ya da süresi dolmuş."));
        }

        if (outcome == TwoFactor.Outcome.RecoveryCode)
        {
            log.Add(user.Id, SecurityEventKind.RecoveryCodeUsed, client, detail: $"{user.RecoveryCodeHashes.Count} yedek kod kaldı");
        }

        await users.ResetAccessFailedCountAsync(user); // kullanıcıyı (TOTP adımı, yedek kodlar) da kaydeder
        await log.LoginSucceededAsync(user, client, cancellationToken);
        return await IssueTokensAsync(user, client, cancellationToken);
    }

    /// <summary>Kimliği dışarıda (SSO) doğrulanmış kullanıcı için oturum açar; iki adımlı doğrulama kimlik sağlayıcıdadır.</summary>
    internal async Task<Result<AuthResult>> SignInExternalAsync(ApplicationUser user, ClientInfo client, CancellationToken cancellationToken)
    {
        await log.LoginSucceededAsync(user, client, cancellationToken);
        return await IssueTokensAsync(user, client, cancellationToken);
    }

    /// <summary>Hatalı deneme: kilitlenmeye sayılır ve güvenlik geçmişine yazılır.</summary>
    private async Task FailAsync(ApplicationUser user, ClientInfo client, string reason, CancellationToken ct)
    {
        await users.AccessFailedAsync(user);
        var locked = await users.IsLockedOutAsync(user);
        log.Add(user.Id, locked ? SecurityEventKind.LockedOut : SecurityEventKind.LoginFailed, client, detail: reason);
        await db.SaveChangesAsync(ct);
    }

    public async Task<Result<AuthResult>> RefreshAsync(string refreshToken, ClientInfo client, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(refreshToken))
        {
            return InvalidRefreshToken;
        }

        var now = clock.GetUtcNow();
        var hash = TokenService.Hash(refreshToken);
        var stored = await db.RefreshTokens.SingleOrDefaultAsync(t => t.TokenHash == hash, cancellationToken);

        if (stored is null)
        {
            return InvalidRefreshToken;
        }

        // Yalnızca rotasyonla değiştirilmiş bir token'ın tekrar kullanımı hırsızlık işaretidir; çıkış ya da
        // "oturumu kapat" ile iptal edilmiş token'lar sadece reddedilir.
        if (stored is { RevokedAt: not null, ReplacedById: not null })
        {
            // İptal edilmiş token tekrar kullanıldı: çalınmış olabilir, tüm oturumları kapat.
            logger.LogWarning("Refresh token yeniden kullanımı tespit edildi. Kullanıcı {UserId} için tüm oturumlar kapatılıyor.", stored.UserId);
            await RevokeAllAsync(stored.UserId, now, cancellationToken);
            return InvalidRefreshToken;
        }

        if (!stored.IsActive(now))
        {
            return InvalidRefreshToken;
        }

        var user = await users.FindByIdAsync(stored.UserId.ToString());
        if (user is null || user.DeletedAt is not null)
        {
            return InvalidRefreshToken;
        }

        var result = await IssueTokensAsync(user, client, cancellationToken, replacing: stored);
        return result;
    }

    public async Task LogoutAsync(string refreshToken, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(refreshToken))
        {
            return;
        }

        var hash = TokenService.Hash(refreshToken);
        var stored = await db.RefreshTokens.SingleOrDefaultAsync(t => t.TokenHash == hash, cancellationToken);
        if (stored is { RevokedAt: null })
        {
            stored.RevokedAt = clock.GetUtcNow();
            await db.SaveChangesAsync(cancellationToken);
            cache.Forget([stored.SessionId]);
        }
    }

    public async Task<Result<UserDto>> GetUserAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var user = await users.FindByIdAsync(userId.ToString());
        return user is null ? Error.NotFound("user.not_found", L.T("identity.user_not_found", "Kullanıcı bulunamadı.")) : await ToDtoAsync(user, cancellationToken);
    }

    public async Task<Result> ConfirmEmailAsync(ConfirmEmailRequest request, CancellationToken cancellationToken = default)
    {
        var user = await users.FindByIdAsync(request.UserId.ToString());
        if (user is null || DecodeToken(request.Token) is not { } token)
        {
            return Error.Validation("auth.invalid_token", L.T("auth.invalid_token", "Doğrulama linki geçersiz veya süresi dolmuş."));
        }

        if (user.EmailConfirmed)
        {
            return Result.Success();
        }

        var confirmed = await users.ConfirmEmailAsync(user, token);
        return confirmed.Succeeded
            ? Result.Success()
            : Error.Validation("auth.invalid_token", L.T("auth.invalid_token", "Doğrulama linki geçersiz veya süresi dolmuş."));
    }

    public async Task<Result> ResendConfirmationAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var user = await users.FindByIdAsync(userId.ToString());
        if (user is null)
        {
            return Error.NotFound("user.not_found", L.T("identity.user_not_found", "Kullanıcı bulunamadı."));
        }

        if (!user.EmailConfirmed)
        {
            await SendConfirmationEmailAsync(user, cancellationToken);
        }

        return Result.Success();
    }

    public async Task ForgotPasswordAsync(ForgotPasswordRequest request, CancellationToken cancellationToken = default)
    {
        if (!AuthValidator.IsValidEmail(request.Email))
        {
            return;
        }

        var user = await users.FindByEmailAsync(request.Email.Trim());
        if (user is null || user.DeletedAt is not null)
        {
            return;
        }

        var token = EncodeToken(await users.GeneratePasswordResetTokenAsync(user));
        var link = BuildLink("/reset-password", ("email", user.Email!), ("token", token));
        await SendSafelyAsync(EmailTemplates.ResetPassword(user.Email!, user.DisplayName, link), cancellationToken);
    }

    public async Task<Result> ResetPasswordAsync(ResetPasswordRequest request, CancellationToken cancellationToken = default)
    {
        var invalid = Error.Validation("auth.invalid_token", L.T("auth.invalid_reset_token", "Şifre sıfırlama linki geçersiz veya süresi dolmuş."));

        var user = string.IsNullOrWhiteSpace(request.Email) ? null : await users.FindByEmailAsync(request.Email.Trim());
        if (user is null || DecodeToken(request.Token) is not { } token)
        {
            return invalid;
        }

        if (user.DeletedAt is not null)
        {
            return invalid;
        }

        var reset = await users.ResetPasswordAsync(user, token, request.NewPassword);
        if (!reset.Succeeded)
        {
            return reset.Errors.Any(e => e.Code == "InvalidToken") ? invalid : ToValidationError(reset);
        }

        // Şifre değişince açık oturumlar kapatılır.
        await RevokeAllAsync(user.Id, clock.GetUtcNow(), cancellationToken);
        log.Add(user.Id, SecurityEventKind.PasswordReset);
        await db.SaveChangesAsync(cancellationToken);
        return Result.Success();
    }

    private async Task<Result<AuthResult>> IssueTokensAsync(
        ApplicationUser user,
        ClientInfo client,
        CancellationToken cancellationToken,
        RefreshToken? replacing = null)
    {
        var now = clock.GetUtcNow();
        var sessionId = replacing?.SessionId ?? Guid.CreateVersion7();
        var (accessToken, accessExpiresAt) = tokens.CreateAccessToken(user, sessionId);
        var (refreshToken, refreshHash, refreshExpiresAt) = tokens.CreateRefreshToken();

        // Yenilemede cihaz bilgisi son kullanımdan alınır (IP değişmiş olabilir); bilinmiyorsa öncekiler korunur.
        var entity = new RefreshToken
        {
            UserId = user.Id,
            SessionId = sessionId,
            SessionStartedAt = replacing?.SessionStartedAt ?? now,
            TokenHash = refreshHash,
            CreatedAt = now,
            ExpiresAt = refreshExpiresAt,
            UserAgent = Truncate(client.UserAgent, RefreshToken.UserAgentMaxLength) ?? replacing?.UserAgent,
            IpAddress = Truncate(client.IpAddress, RefreshToken.IpAddressMaxLength) ?? replacing?.IpAddress,
            App = client.App is null ? replacing?.App ?? DeviceLabel.Web : DeviceLabel.NormalizeApp(client.App),
        };
        db.RefreshTokens.Add(entity);

        if (replacing is not null)
        {
            replacing.RevokedAt = now;
            replacing.ReplacedById = entity.Id;
        }

        await db.SaveChangesAsync(cancellationToken);

        return new AuthResult(accessToken, accessExpiresAt, refreshToken, refreshExpiresAt, await ToDtoAsync(user, cancellationToken));
    }

    private async Task RevokeAllAsync(Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var sessions = await db.RefreshTokens.Where(t => t.UserId == userId && t.RevokedAt == null).Select(t => t.SessionId).ToListAsync(cancellationToken);
        await db.RefreshTokens
            .Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, (DateTimeOffset?)now), cancellationToken);
        cache.Forget(sessions);
    }

    private async Task SendConfirmationEmailAsync(ApplicationUser user, CancellationToken cancellationToken)
    {
        var token = EncodeToken(await users.GenerateEmailConfirmationTokenAsync(user));
        var link = BuildLink("/confirm-email", ("userId", user.Id.ToString()), ("token", token));
        await SendSafelyAsync(EmailTemplates.ConfirmEmail(user.Email!, user.DisplayName, link), cancellationToken);
    }

    /// <summary>E-posta sunucusu hatası kayıt veya şifre sıfırlama isteğini başarısız yapmamalı.</summary>
    private async Task SendSafelyAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        try
        {
            await email.SendAsync(message, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "E-posta gönderilemedi: {Subject}", message.Subject);
        }
    }

    private string BuildLink(string path, params (string Key, string Value)[] query)
    {
        var baseUrl = appOptions.Value.PublicUrl.TrimEnd('/') + path;
        return QueryHelpers.AddQueryString(baseUrl, query.ToDictionary(q => q.Key, q => (string?)q.Value));
    }

    private static string EncodeToken(string token) => WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(token));

    private static string? DecodeToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return null;
        }

        try
        {
            return Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(token));
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static string? Truncate(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Length > max ? value[..max] : value;

    private async Task<UserDto> ToDtoAsync(ApplicationUser user, CancellationToken ct)
    {
        var requiredBy = await (from m in db.OrganizationMembers.AsNoTracking()
                                join o in db.Organizations.AsNoTracking() on m.OrganizationId equals o.Id
                                where m.UserId == user.Id && o.RequireTwoFactor
                                orderby o.Name
                                select o.Name).ToListAsync(ct);
        return new(user.Id, user.Email!, user.DisplayName, user.EmailConfirmed, user.AvatarVersion, user.TwoFactorEnabled, requiredBy);
    }

    private static Error ToValidationError(IdentityResult result)
    {
        var details = result.Errors
            .GroupBy(e => e.Code.StartsWith("Password", StringComparison.Ordinal) ? "password" : "email")
            .ToDictionary(g => g.Key, g => g.Select(e => e.Description).ToArray());

        return Error.Validation("validation", L.T("identity.invalid_input", "Gönderilen bilgiler geçersiz."), details);
    }
}
