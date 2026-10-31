using System.Text;
using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Application.Audit;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Audit;
using Apivator.Domain.Organizations;
using Apivator.Infrastructure.Email;
using Apivator.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Identity;

internal sealed class SecurityService(
    UserManager<ApplicationUser> users,
    AppDbContext db,
    TwoFactor twoFactor,
    SecurityLog log,
    IAuditLog audit,
    IOrganizationAccess organizations,
    IEmailSender email,
    IMemoryCache cache,
    IOptions<AppOptions> appOptions,
    TimeProvider clock,
    ILogger<SecurityService> logger) : ISecurityService
{
    private const int EventLimit = 100;

    private static Error UserNotFound => Error.NotFound("user.not_found", L.T("identity.user_not_found", "Kullanıcı bulunamadı."));
    private static Error InvalidCode => Field("code", L.T("security.invalid_code", "Kod hatalı ya da süresi dolmuş. Uygulamadaki güncel kodu girin."));

    public async Task<Result<TwoFactorStatusDto>> StatusAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        return user is null ? UserNotFound : await StatusAsync(user, ct);
    }

    public async Task<Result<TwoFactorSetupDto>> BeginSetupAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        if (user is null)
        {
            return UserNotFound;
        }

        if (user.TwoFactorEnabled)
        {
            return Error.Conflict("2fa.already_enabled", L.T("2fa.already_enabled", "İki adımlı doğrulama zaten açık."));
        }

        // Yarım kalmış kurulumun anahtarı yeniden gösterilir (sayfa yenilenince ya da istek iki kez gelince
        // uygulamaya eklenen anahtarla sunucudaki ayrışmasın).
        var secret = twoFactor.Secret(user);
        if (secret is null)
        {
            secret = Totp.NewSecret();
            user.AuthenticatorKey = twoFactor.ProtectKey(secret);
            user.LastTotpStep = null;
            await users.UpdateAsync(user);
        }

        return new TwoFactorSetupDto(secret, Totp.Uri(secret, user.Email!, TwoFactor.Issuer));
    }

    public async Task<Result<RecoveryCodesDto>> EnableAsync(Guid userId, TwoFactorCodeRequest request, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        if (user is null)
        {
            return UserNotFound;
        }

        if (user.TwoFactorEnabled)
        {
            return Error.Conflict("2fa.already_enabled", L.T("2fa.already_enabled", "İki adımlı doğrulama zaten açık."));
        }

        if (user.AuthenticatorKey is null)
        {
            return Error.Validation("2fa.not_started", L.T("2fa.not_started", "Önce kurulumu başlatın."));
        }

        if (twoFactor.Verify(user, request.Code, allowRecovery: false) == TwoFactor.Outcome.Invalid)
        {
            return InvalidCode;
        }

        var (codes, hashes) = TwoFactor.NewRecoveryCodes();
        user.RecoveryCodeHashes = hashes;
        user.TwoFactorEnabledAt = clock.GetUtcNow();
        log.Add(user.Id, SecurityEventKind.TwoFactorEnabled);
        await users.SetTwoFactorEnabledAsync(user, true); // güvenlik damgası da yenilenir
        await NotifyAsync(EmailTemplates.TwoFactorChanged(user.Email!, user.DisplayName, enabled: true, SecurityLink), ct);
        return new RecoveryCodesDto(codes);
    }

    public async Task<Result> DisableAsync(Guid userId, DisableTwoFactorRequest request, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        if (user is null)
        {
            return UserNotFound;
        }

        if (!user.TwoFactorEnabled)
        {
            return Result.Success();
        }

        var requiredBy = await RequiredByAsync(user.Id, ct);
        if (requiredBy.Count > 0)
        {
            return Error.Validation(
                "2fa.required_by_organization",
                L.T("2fa.required_by_organization", "{names} organizasyonu iki adımlı doğrulamayı zorunlu kılıyor; kapatılamaz.", ("names", string.Join(", ", requiredBy))));
        }

        if (await users.IsLockedOutAsync(user))
        {
            return Error.Locked("auth.locked_out", L.T("identity.locked_out", "Çok fazla hatalı deneme. Lütfen birkaç dakika sonra tekrar deneyin."));
        }

        if (string.IsNullOrEmpty(request.Password) || !await users.CheckPasswordAsync(user, request.Password))
        {
            await users.AccessFailedAsync(user);
            return Field("password", L.T("account.password_wrong", "Şifre hatalı."));
        }

        if (twoFactor.Verify(user, request.Code, allowRecovery: true) == TwoFactor.Outcome.Invalid)
        {
            await users.AccessFailedAsync(user);
            return InvalidCode;
        }

        user.AuthenticatorKey = null;
        user.LastTotpStep = null;
        user.RecoveryCodeHashes = [];
        user.TwoFactorEnabledAt = null;
        log.Add(user.Id, SecurityEventKind.TwoFactorDisabled);
        await users.ResetAccessFailedCountAsync(user);
        await users.SetTwoFactorEnabledAsync(user, false);
        await NotifyAsync(EmailTemplates.TwoFactorChanged(user.Email!, user.DisplayName, enabled: false, SecurityLink), ct);
        return Result.Success();
    }

    public async Task<Result<RecoveryCodesDto>> RegenerateRecoveryCodesAsync(Guid userId, TwoFactorCodeRequest request, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        if (user is null)
        {
            return UserNotFound;
        }

        if (!user.TwoFactorEnabled)
        {
            return Error.Validation("2fa.not_enabled", L.T("2fa.not_enabled", "İki adımlı doğrulama açık değil."));
        }

        if (await users.IsLockedOutAsync(user))
        {
            return Error.Locked("auth.locked_out", L.T("identity.locked_out", "Çok fazla hatalı deneme. Lütfen birkaç dakika sonra tekrar deneyin."));
        }

        if (twoFactor.Verify(user, request.Code, allowRecovery: false) == TwoFactor.Outcome.Invalid)
        {
            await users.AccessFailedAsync(user);
            return InvalidCode;
        }

        var (codes, hashes) = TwoFactor.NewRecoveryCodes();
        user.RecoveryCodeHashes = hashes;
        log.Add(user.Id, SecurityEventKind.RecoveryCodesRegenerated);
        await users.UpdateAsync(user);
        return new RecoveryCodesDto(codes);
    }

    public async Task<IReadOnlyList<SecurityEventDto>> EventsAsync(Guid userId, CancellationToken ct = default) =>
        await db.SecurityEvents.AsNoTracking()
            .Where(e => e.UserId == userId)
            .OrderByDescending(e => e.CreatedAt)
            .Take(EventLimit)
            .Select(e => new SecurityEventDto(e.Kind, e.CreatedAt, e.Device, e.IpAddress, e.ActorName, e.Detail))
            .ToListAsync(ct);

    public async Task<Result> RevokeMemberSessionsAsync(Guid organizationId, Guid memberId, Guid userId, CancellationToken ct = default)
    {
        var target = await MemberTargetAsync(organizationId, memberId, userId, ct);
        if (!target.IsSuccess)
        {
            return target.Error!;
        }

        var (organization, member, admin) = target.Value;
        var now = clock.GetUtcNow();
        var query = db.RefreshTokens.Where(t => t.UserId == member.Id && t.RevokedAt == null);
        var sessions = await query.Select(t => t.SessionId).Distinct().ToListAsync(ct);
        await query.ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, (DateTimeOffset?)now), ct);
        cache.Forget(sessions);

        log.Add(member.Id, SecurityEventKind.SessionsRevokedByAdmin, actorId: admin.Id, actorName: admin.DisplayName, detail: organization.Name);
        await audit.RecordAsync(
            organization.Id, AuditActions.MemberSessionsRevoked, "member", member.Id, member.DisplayName,
            new Dictionary<string, string?> { ["email"] = member.Email, ["sessions"] = sessions.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) },
            ct: ct);
        await db.SaveChangesAsync(ct);
        await NotifyAsync(
            EmailTemplates.SessionsRevokedByAdmin(member.Email!, member.DisplayName, admin.DisplayName, organization.Name, appOptions.Value.PublicUrl.TrimEnd('/') + "/login"),
            ct);
        return Result.Success();
    }

    public async Task<Result> SendMemberPasswordResetAsync(Guid organizationId, Guid memberId, Guid userId, CancellationToken ct = default)
    {
        var target = await MemberTargetAsync(organizationId, memberId, userId, ct);
        if (!target.IsSuccess)
        {
            return target.Error!;
        }

        var (organization, member, admin) = target.Value;
        var token = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(await users.GeneratePasswordResetTokenAsync(member)));
        var link = QueryHelpers.AddQueryString(
            appOptions.Value.PublicUrl.TrimEnd('/') + "/reset-password",
            new Dictionary<string, string?> { ["email"] = member.Email, ["token"] = token });

        log.Add(member.Id, SecurityEventKind.PasswordResetSentByAdmin, actorId: admin.Id, actorName: admin.DisplayName, detail: organization.Name);
        await audit.RecordAsync(
            organization.Id, AuditActions.MemberPasswordResetSent, "member", member.Id, member.DisplayName,
            new Dictionary<string, string?> { ["email"] = member.Email },
            ct: ct);
        await db.SaveChangesAsync(ct);
        await NotifyAsync(EmailTemplates.ResetPasswordByAdmin(member.Email!, member.DisplayName, admin.DisplayName, organization.Name, link), ct);
        return Result.Success();
    }

    public async Task<Result> SetOrganizationSecurityAsync(Guid organizationId, OrganizationSecurityRequest request, Guid userId, CancellationToken ct = default)
    {
        var found = await organizations.RequireAsync(organizationId, userId, OrganizationRole.Admin, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        var organization = found.Value;
        if (organization.IsPersonal)
        {
            return Error.Validation("organization.personal", L.T("security.organization_personal", "Kişisel organizasyonda bu ayar kullanılamaz."));
        }

        if (request.RequireTwoFactor && !organization.RequireTwoFactor)
        {
            var admin = await FindAsync(userId);
            if (admin is not { TwoFactorEnabled: true })
            {
                return Error.Validation(
                    "2fa.admin_not_enabled",
                    L.T("2fa.admin_not_enabled", "Zorunlu kılmadan önce kendi hesabınızda iki adımlı doğrulamayı açın (yoksa organizasyona erişiminizi kaybedersiniz)."));
            }
        }

        organization.SetTwoFactorRequirement(request.RequireTwoFactor);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    internal async Task<TwoFactorStatusDto> StatusAsync(ApplicationUser user, CancellationToken ct) =>
        new(user.TwoFactorEnabled, user.TwoFactorEnabledAt, user.RecoveryCodeHashes.Count, await RequiredByAsync(user.Id, ct));

    private async Task<List<string>> RequiredByAsync(Guid userId, CancellationToken ct) =>
        await (from m in db.OrganizationMembers.AsNoTracking()
               join o in db.Organizations.AsNoTracking() on m.OrganizationId equals o.Id
               where m.UserId == userId && o.RequireTwoFactor
               orderby o.Name
               select o.Name).ToListAsync(ct);

    /// <summary>Yönetici işlemi hedefi: üye olmalı, kendisi olmamalı; sahibe yalnızca sahip dokunabilir.</summary>
    private async Task<Result<(Organization Organization, ApplicationUser Member, ApplicationUser Admin)>> MemberTargetAsync(
        Guid organizationId,
        Guid memberId,
        Guid userId,
        CancellationToken ct)
    {
        var found = await organizations.RequireAsync(organizationId, userId, OrganizationRole.Admin, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        var organization = found.Value;
        var role = organization.RoleOf(memberId);
        if (role is null)
        {
            return Error.NotFound("organization.member_not_found", L.T("security.member_not_found", "Üye bulunamadı."));
        }

        if (memberId == userId)
        {
            return Error.Validation("organization.self", L.T("security.use_own_settings", "Kendi hesabınız için Hesap ayarları > Güvenlik sayfasını kullanın."));
        }

        if (role == OrganizationRole.Owner && organization.OwnerId != userId)
        {
            return Error.Forbidden("organization.forbidden", L.T("security.owner_only", "Organizasyon sahibi için bu işlemi yalnızca sahip yapabilir."));
        }

        var member = await FindAsync(memberId);
        var admin = await FindAsync(userId);
        if (member is null || admin is null)
        {
            return Error.NotFound("organization.member_not_found", L.T("security.member_not_found", "Üye bulunamadı."));
        }

        return (organization, member, admin);
    }

    private string SecurityLink => appOptions.Value.PublicUrl.TrimEnd('/') + "/account?tab=security";

    private async Task<ApplicationUser?> FindAsync(Guid userId)
    {
        var user = await users.FindByIdAsync(userId.ToString());
        return user is null || user.DeletedAt is not null ? null : user;
    }

    private async Task NotifyAsync(EmailMessage message, CancellationToken ct)
    {
        try
        {
            await email.SendAsync(message, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Güvenlik e-postası gönderilemedi: {Subject}", message.Subject);
        }
    }

    private static Error Field(string field, string message) =>
        Error.Validation("validation", message, new Dictionary<string, string[]> { [field] = [message] });
}
