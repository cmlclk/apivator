using System.IO.Compression;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Unicode;
using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Application.Audit;
using Apivator.Application.Auth;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Import;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;
using Apivator.Domain.Workspaces;
using Apivator.Infrastructure.Email;
using Apivator.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Identity;

internal sealed partial class AccountService(
    UserManager<ApplicationUser> users,
    AppDbContext db,
    IOrganizationService organizations,
    IWorkspaceService workspaces,
    IWorkspaceAccess access,
    IImportService exporter,
    IEmailSender email,
    IMemoryCache cache,
    SecurityLog log,
    IAuditLog audit,
    Sso.SsoPolicy sso,
    IOptions<AppOptions> appOptions,
    TimeProvider clock,
    ILogger<AccountService> logger) : IAccountService
{
    private const int AvatarMaxBytes = AccountLimits.AvatarMaxBytes;
    public const string DeletedDisplayName = "Silinmiş kullanıcı";

    private const string DeleteAccountPurpose = "DeleteAccount";

    private static Error UserNotFound => Error.NotFound("user.not_found", L.T("identity.user_not_found", "Kullanıcı bulunamadı."));

    private static readonly JsonSerializerOptions ExportJson = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
    };

    public async Task<Result<ProfileDto>> GetProfileAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        return user is null ? UserNotFound : await ToProfileAsync(user, ct);
    }

    public async Task<Result<ProfileDto>> UpdateProfileAsync(Guid userId, UpdateProfileRequest request, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        if (user is null)
        {
            return UserNotFound;
        }

        var name = request.DisplayName?.Trim() ?? string.Empty;
        if (name.Length == 0 || name.Length > AuthValidator.DisplayNameMaxLength)
        {
            return Field("displayName", L.T("account.display_name_length", "Ad soyad 1–{max} karakter olmalı.", ("max", AuthValidator.DisplayNameMaxLength)));
        }

        user.DisplayName = name;
        await users.UpdateAsync(user);
        return await ToProfileAsync(user, ct);
    }

    public async Task<Result<long>> SetAvatarAsync(Guid userId, string? contentType, byte[] data, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        if (user is null)
        {
            return UserNotFound;
        }

        if (data.Length == 0 || data.Length > AvatarMaxBytes)
        {
            return Error.Validation("avatar.size", L.T("avatar.size", "Görsel en fazla {max} KB olabilir.", ("max", AvatarMaxBytes / 1024)));
        }

        // İçerik türü başlığa değil dosyanın kendisine göre belirlenir (yalnızca PNG, JPEG, WebP).
        var detected = DetectImageType(data);
        if (detected is null || (contentType is not null && !contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)))
        {
            return Error.Validation("avatar.type", L.T("avatar.type", "Yalnızca PNG, JPEG ya da WebP görsel yüklenebilir."));
        }

        var now = clock.GetUtcNow();
        var avatar = await db.UserAvatars.FirstOrDefaultAsync(a => a.UserId == userId, ct);
        if (avatar is null)
        {
            avatar = new UserAvatar { UserId = userId };
            db.UserAvatars.Add(avatar);
        }

        avatar.ContentType = detected;
        avatar.Data = data;
        avatar.UpdatedAt = now;
        user.AvatarVersion = now.ToUnixTimeMilliseconds();
        await db.SaveChangesAsync(ct);
        return user.AvatarVersion.Value;
    }

    public async Task<Result> RemoveAvatarAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        if (user is null)
        {
            return UserNotFound;
        }

        await db.UserAvatars.Where(a => a.UserId == userId).ExecuteDeleteAsync(ct);
        user.AvatarVersion = null;
        await users.UpdateAsync(user);
        return Result.Success();
    }

    public async Task<AvatarFile?> GetAvatarAsync(Guid userId, CancellationToken ct = default)
    {
        var avatar = await db.UserAvatars.AsNoTracking().FirstOrDefaultAsync(a => a.UserId == userId, ct);
        return avatar is null ? null : new AvatarFile(avatar.ContentType, avatar.Data, avatar.UpdatedAt.ToUnixTimeMilliseconds());
    }

    public async Task<Result> RequestEmailChangeAsync(Guid userId, ChangeEmailRequest request, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        if (user is null)
        {
            return UserNotFound;
        }

        // Adres kimlik sağlayıcıdan gelir; başka alan adına geçip şifreyle girmek SSO zorunluluğunu atlatırdı.
        if (await sso.EnforcingOrganizationAsync(user.Email, user.Id, ct) is { } managedBy)
        {
            return Error.Forbidden("account.sso_managed", L.T("account.sso_managed", "E-posta adresiniz {provider} kimlik sağlayıcısı (SSO) tarafından yönetiliyor; buradan değiştirilemez.", ("provider", managedBy)));
        }

        if (!AuthValidator.IsValidEmail(request.NewEmail))
        {
            return Field("newEmail", L.T("account.invalid_email", "Geçerli bir e-posta adresi girin."));
        }

        if (await CheckPasswordAsync(user, request.Password) is { } wrongPassword)
        {
            return wrongPassword;
        }

        var newEmail = request.NewEmail.Trim();
        if (string.Equals(newEmail, user.Email, StringComparison.OrdinalIgnoreCase))
        {
            return Field("newEmail", L.T("account.same_email", "Bu zaten hesabınızın e-posta adresi."));
        }

        if (await users.FindByEmailAsync(newEmail) is { } other && other.Id != user.Id)
        {
            return Error.Conflict("auth.email_taken", L.T("identity.email_taken", "Bu e-posta adresiyle kayıtlı bir hesap var."));
        }

        user.PendingEmail = newEmail;
        await users.UpdateAsync(user);

        var token = EncodeToken(await users.GenerateChangeEmailTokenAsync(user, newEmail));
        var link = BuildLink("/confirm-email-change", ("userId", user.Id.ToString()), ("email", newEmail), ("token", token));
        await SendSafelyAsync(EmailTemplates.ConfirmEmailChange(newEmail, user.DisplayName, link), ct);
        return Result.Success();
    }

    public async Task<Result> CancelEmailChangeAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        if (user is null)
        {
            return UserNotFound;
        }

        if (user.PendingEmail is not null)
        {
            user.PendingEmail = null;
            // Gönderilmiş doğrulama bağlantısı da geçersiz olur.
            await users.UpdateSecurityStampAsync(user);
        }

        return Result.Success();
    }

    public async Task<Result> ConfirmEmailChangeAsync(ConfirmEmailChangeRequest request, CancellationToken ct = default)
    {
        var invalid = Error.Validation("auth.invalid_token", L.T("account.invalid_email_change_token", "Doğrulama bağlantısı geçersiz, süresi dolmuş ya da değişiklik iptal edilmiş."));

        var user = await FindAsync(request.UserId);
        if (user is null || DecodeToken(request.Token) is not { } token || string.IsNullOrWhiteSpace(request.Email))
        {
            return invalid;
        }

        var newEmail = request.Email.Trim();
        if (string.Equals(user.Email, newEmail, StringComparison.OrdinalIgnoreCase) && user.PendingEmail is null)
        {
            // Bağlantı ikinci kez açıldı: değişiklik zaten yapılmış.
            return Result.Success();
        }

        if (!string.Equals(user.PendingEmail, newEmail, StringComparison.OrdinalIgnoreCase))
        {
            return invalid;
        }

        if (await users.FindByEmailAsync(newEmail) is { } other && other.Id != user.Id)
        {
            return Error.Conflict("auth.email_taken", L.T("identity.email_taken", "Bu e-posta adresiyle kayıtlı bir hesap var."));
        }

        var oldEmail = user.Email!;
        await using var transaction = await db.Database.BeginTransactionAsync(ct);

        var changed = await users.ChangeEmailAsync(user, newEmail, token);
        if (!changed.Succeeded)
        {
            return invalid;
        }

        // Kullanıcı adı e-postayla aynı tutulur (giriş e-postayla yapılır).
        user.PendingEmail = null;
        var renamed = await users.SetUserNameAsync(user, newEmail);
        if (!renamed.Succeeded)
        {
            return invalid;
        }

        log.Add(user.Id, SecurityEventKind.EmailChanged, detail: $"{oldEmail} → {newEmail}");
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        var resetLink = BuildLink("/forgot-password", ("email", oldEmail));
        await SendSafelyAsync(EmailTemplates.EmailChanged(oldEmail, user.DisplayName, newEmail, resetLink), ct);
        return Result.Success();
    }

    public async Task<Result> ChangePasswordAsync(Guid userId, Guid? currentSessionId, ChangePasswordRequest request, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        if (user is null)
        {
            return UserNotFound;
        }

        if (string.IsNullOrEmpty(request.CurrentPassword))
        {
            return Field("currentPassword", L.T("account.current_password_required", "Mevcut şifrenizi girin."));
        }

        if (string.IsNullOrEmpty(request.NewPassword))
        {
            return Field("newPassword", L.T("account.new_password_required", "Yeni şifre zorunludur."));
        }

        if (await users.IsLockedOutAsync(user))
        {
            return Error.Locked("auth.locked_out", L.T("identity.locked_out", "Çok fazla hatalı deneme. Lütfen birkaç dakika sonra tekrar deneyin."));
        }

        var changed = await users.ChangePasswordAsync(user, request.CurrentPassword, request.NewPassword);
        if (!changed.Succeeded)
        {
            if (changed.Errors.Any(e => e.Code == nameof(IdentityErrorDescriber.PasswordMismatch)))
            {
                await users.AccessFailedAsync(user);
                return Field("currentPassword", L.T("account.current_password_wrong", "Mevcut şifre hatalı."));
            }

            return Error.Validation(
                "validation",
                L.T("identity.invalid_input", "Gönderilen bilgiler geçersiz."),
                new Dictionary<string, string[]> { ["newPassword"] = changed.Errors.Select(e => e.Description).ToArray() });
        }

        await RevokeOtherSessionsAsync(userId, currentSessionId, ct);
        log.Add(userId, SecurityEventKind.PasswordChanged);
        await db.SaveChangesAsync(ct);
        await SendSafelyAsync(EmailTemplates.PasswordChanged(user.Email!, user.DisplayName, BuildLink("/forgot-password", ("email", user.Email!))), ct);
        return Result.Success();
    }

    public async Task<IReadOnlyList<SessionDto>> ListSessionsAsync(Guid userId, Guid? currentSessionId, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var tokens = await db.RefreshTokens.AsNoTracking()
            .Where(t => t.UserId == userId && t.RevokedAt == null && t.ExpiresAt > now)
            .ToListAsync(ct);

        // Rotasyon sırasında aynı oturumun iki token'ı kısa süre etkin görünebilir; en yenisi alınır.
        return tokens
            .GroupBy(t => t.SessionId)
            .Select(g => g.MaxBy(t => t.CreatedAt)!)
            .Select(t => new SessionDto(
                t.SessionId,
                DeviceLabel.Describe(t.UserAgent, t.App),
                DeviceLabel.NormalizeApp(t.App),
                t.IpAddress,
                t.SessionStartedAt,
                t.CreatedAt,
                t.SessionId == currentSessionId))
            .OrderByDescending(s => s.Current)
            .ThenByDescending(s => s.LastUsedAt)
            .ToList();
    }

    public async Task<Result> RevokeSessionAsync(Guid userId, Guid sessionId, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var revoked = await db.RefreshTokens
            .Where(t => t.UserId == userId && t.SessionId == sessionId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, (DateTimeOffset?)now), ct);
        cache.Remove(SessionCache.Key(sessionId));
        return revoked == 0 ? Error.NotFound("session.not_found", L.T("session.not_found", "Oturum bulunamadı ya da zaten kapatılmış.")) : Result.Success();
    }

    public async Task<int> RevokeOtherSessionsAsync(Guid userId, Guid? currentSessionId, CancellationToken ct = default)
    {
        var now = clock.GetUtcNow();
        var query = db.RefreshTokens.Where(t => t.UserId == userId && t.RevokedAt == null && t.SessionId != currentSessionId);
        var sessions = await query.Select(t => t.SessionId).Distinct().ToListAsync(ct);
        await query.ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, (DateTimeOffset?)now), ct);
        foreach (var id in sessions)
        {
            cache.Remove(SessionCache.Key(id));
        }

        return sessions.Count;
    }

    public async Task<bool> IsSessionActiveAsync(Guid sessionId, CancellationToken ct = default)
    {
        if (cache.TryGetValue(SessionCache.Key(sessionId), out bool active))
        {
            return active;
        }

        var now = clock.GetUtcNow();
        active = await db.RefreshTokens.AsNoTracking().AnyAsync(t => t.SessionId == sessionId && t.RevokedAt == null && t.ExpiresAt > now, ct);
        cache.Set(SessionCache.Key(sessionId), active, SessionCache.Duration);
        return active;
    }

    public async Task<Result<PreferencesDto>> GetPreferencesAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        return user is null ? UserNotFound : ToDto(user.Preferences);
    }

    public async Task<Result<PreferencesDto>> UpdatePreferencesAsync(Guid userId, PreferencesDto request, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        if (user is null)
        {
            return UserNotFound;
        }

        if (!UserPreferences.Themes.Contains(request.Theme))
        {
            return Field("theme", L.T("account.theme_invalid", "Tema \"system\", \"light\" ya da \"dark\" olmalı."));
        }

        if (request.Language is { } language && !UserPreferences.Languages.Contains(language))
        {
            return Field("language", L.T("account.language_invalid", "Dil \"tr\" ya da \"en\" olmalı."));
        }

        if (request.DefaultWorkspaceId is { } workspaceId && await access.RoleAsync(workspaceId, userId, ct) is null)
        {
            return Field("defaultWorkspaceId", L.T("account.workspace_no_access", "Bu workspace'e erişiminiz yok."));
        }

        user.Preferences = new UserPreferences
        {
            Theme = request.Theme,
            DefaultWorkspaceId = request.DefaultWorkspaceId,
            EmailMentions = request.EmailMentions,
            EmailMergeRequests = request.EmailMergeRequests,
            EmailMonitorAlerts = request.EmailMonitorAlerts,
            Language = request.Language,
            SaveHistoryResponses = request.SaveHistoryResponses,
        };
        await users.UpdateAsync(user);

        // Saklama kapatılınca önceden saklanan yanıt gövdeleri de silinir.
        if (!request.SaveHistoryResponses)
        {
            await db.HistoryResponses
                .Where(r => db.History.Any(h => h.Id == r.HistoryEntryId && h.UserId == userId))
                .ExecuteDeleteAsync(ct);
        }

        return ToDto(user.Preferences);
    }

    public async Task<Result<AccountExportFile>> ExportAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        if (user is null)
        {
            return UserNotFound;
        }

        var personal = await (
                from w in db.Workspaces.AsNoTracking()
                join o in db.Organizations.AsNoTracking() on w.OrganizationId equals o.Id
                where o.IsPersonal && o.OwnerId == userId
                select w.Id)
            .ToListAsync(ct);
        var collectionIds = await db.Collections.AsNoTracking()
            .Where(c => personal.Contains(c.WorkspaceId))
            .OrderBy(c => c.Name)
            .Select(c => c.Id)
            .ToListAsync(ct);
        var environmentIds = await db.Environments.AsNoTracking()
            .Where(e => personal.Contains(e.WorkspaceId))
            .OrderBy(e => e.Name)
            .Select(e => e.Id)
            .ToListAsync(ct);

        var profile = await ToProfileAsync(user, ct);
        var account = new
        {
            profile.Id,
            profile.Email,
            profile.DisplayName,
            profile.CreatedAt,
            ExportedAt = clock.GetUtcNow(),
            Preferences = ToDto(user.Preferences),
            Sessions = await ListSessionsAsync(userId, null, ct),
            ApiKeys = await db.ApiKeys.AsNoTracking()
                .Where(k => k.UserId == userId && k.RevokedAt == null)
                .Select(k => new { k.Name, k.Prefix, k.CreatedAt, k.ExpiresAt, k.LastUsedAt })
                .ToListAsync(ct),
            profile.Organizations,
        };

        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            await WriteAsync(zip, "hesap.json", JsonSerializer.Serialize(account, ExportJson), ct);
            await WriteAsync(zip, L.T("account.export_readme_file", "BENIOKU.txt"), Readme(user, collectionIds.Count, environmentIds.Count), ct);

            foreach (var id in collectionIds)
            {
                if ((await exporter.ExportCollectionAsync(id, userId, ct)) is { IsSuccess: true } file)
                {
                    await WriteAsync(zip, UniqueName(used, "collections/", file.Value.FileName), Serialize(file.Value.Content), ct);
                }
            }

            foreach (var id in environmentIds)
            {
                if ((await exporter.ExportEnvironmentAsync(id, userId, ct)) is { IsSuccess: true } file)
                {
                    await WriteAsync(zip, UniqueName(used, "environments/", file.Value.FileName), Serialize(file.Value.Content), ct);
                }
            }
        }

        var date = clock.GetUtcNow().ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        return new AccountExportFile($"apivator-hesap-{date}.zip", buffer.ToArray());
    }

    public async Task<Result<AccountDeletionCheckDto>> CheckDeletionAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        return user is null ? UserNotFound : await DeletionCheckAsync(userId, ct);
    }

    public async Task<Result> RequestDeletionAsync(Guid userId, DeleteAccountRequest request, CancellationToken ct = default)
    {
        var user = await FindAsync(userId);
        if (user is null)
        {
            return UserNotFound;
        }

        if (await CheckPasswordAsync(user, request.Password) is { } wrongPassword)
        {
            return wrongPassword;
        }

        if (MustTransferError(await DeletionCheckAsync(userId, ct)) is { } blocked)
        {
            return blocked;
        }

        var token = EncodeToken(await users.GenerateUserTokenAsync(user, TokenOptions.DefaultProvider, DeleteAccountPurpose));
        var link = BuildLink("/delete-account", ("userId", user.Id.ToString()), ("token", token));
        await SendSafelyAsync(EmailTemplates.ConfirmAccountDeletion(user.Email!, user.DisplayName, link), ct);
        return Result.Success();
    }

    public async Task<Result> ConfirmDeletionAsync(ConfirmAccountDeletionRequest request, CancellationToken ct = default)
    {
        var invalid = Error.Validation("auth.invalid_token", L.T("account.invalid_delete_token", "Silme bağlantısı geçersiz ya da süresi dolmuş."));
        var user = await FindAsync(request.UserId);
        if (user is null || DecodeToken(request.Token) is not { } token
            || !await users.VerifyUserTokenAsync(user, TokenOptions.DefaultProvider, DeleteAccountPurpose, token))
        {
            return invalid;
        }

        var check = await DeletionCheckAsync(user.Id, ct);
        if (MustTransferError(check) is { } blocked)
        {
            return blocked;
        }

        var userId = user.Id;
        var oldEmail = user.Email!;
        var displayName = user.DisplayName;
        var sessions = await db.RefreshTokens.Where(t => t.UserId == userId).Select(t => t.SessionId).Distinct().ToListAsync(ct);

        await using (var transaction = await db.Database.BeginTransactionAsync(ct))
        {
            // Sahibi olunan kişisel organizasyon ve başka üyesi olmayan organizasyonlar workspace'leriyle birlikte silinir.
            var owned = check.WillDelete.Select(o => o.Id).ToList();
            owned.AddRange(await db.Organizations.Where(o => o.IsPersonal && o.OwnerId == userId).Select(o => o.Id).ToListAsync(ct));
            await db.Organizations.Where(o => owned.Contains(o.Id)).ExecuteDeleteAsync(ct);

            // Üyelikler aşağıda toplu silindiği için (değişiklik izleyicisi görmez) kalan organizasyonların denetim kaydına elle yazılır.
            var actor = new Domain.Audit.AuditActor(userId, displayName, oldEmail);
            foreach (var organizationId in await db.OrganizationMembers.Where(m => m.UserId == userId).Select(m => m.OrganizationId).ToListAsync(ct))
            {
                await audit.RecordAsync(
                    organizationId, Domain.Audit.AuditActions.MemberAccountDeleted, "member", userId, displayName,
                    new Dictionary<string, string?> { ["email"] = oldEmail }, actor, ct);
            }


            // Üyelikler ve kişisel kayıtlar. Ekip workspace'lerinde oluşturduğu collection'lar ve yorumlar kalır;
            // yazar "Silinmiş kullanıcı" olarak görünür.
            await db.OrganizationMembers.Where(m => m.UserId == userId).ExecuteDeleteAsync(ct);
            await db.TeamMembers.Where(m => m.UserId == userId).ExecuteDeleteAsync(ct);
            await db.WorkspaceMembers.Where(m => m.UserId == userId).ExecuteDeleteAsync(ct);
            await db.CollectionAccess.Where(e => e.UserId == userId).ExecuteDeleteAsync(ct);
            await db.Notifications.Where(n => n.UserId == userId).ExecuteDeleteAsync(ct);
            await db.History.Where(h => h.UserId == userId).ExecuteDeleteAsync(ct);
            await db.ApiKeys.Where(k => k.UserId == userId).ExecuteDeleteAsync(ct);
            await db.RefreshTokens.Where(t => t.UserId == userId).ExecuteDeleteAsync(ct);
            await db.UserAvatars.Where(a => a.UserId == userId).ExecuteDeleteAsync(ct);
            await db.SecurityEvents.Where(e => e.UserId == userId).ExecuteDeleteAsync(ct);
            var invitedEmail = Domain.Organizations.Invitation.NormalizeEmail(oldEmail);
            await db.Invitations
                .Where(i => i.AcceptedAt == null && (i.InvitedById == userId || i.Email == invitedEmail))
                .ExecuteDeleteAsync(ct);

            var anonymous = $"deleted-{userId:N}@deleted.invalid";
            user.Email = anonymous;
            user.NormalizedEmail = anonymous.ToUpperInvariant();
            user.UserName = anonymous;
            user.NormalizedUserName = anonymous.ToUpperInvariant();
            user.EmailConfirmed = false;
            user.PendingEmail = null;
            user.PhoneNumber = null;
            user.PasswordHash = null;
            user.DisplayName = DeletedDisplayName;
            user.AvatarVersion = null;
            user.Preferences = new UserPreferences();
            user.TwoFactorEnabled = false;
            user.AuthenticatorKey = null;
            user.RecoveryCodeHashes = [];
            user.TwoFactorEnabledAt = null;
            user.LockoutEnabled = true;
            user.LockoutEnd = DateTimeOffset.MaxValue;
            user.SecurityStamp = Guid.NewGuid().ToString("N");
            user.DeletedAt = clock.GetUtcNow();
            await db.SaveChangesAsync(ct);

            await transaction.CommitAsync(ct);
        }

        foreach (var id in sessions)
        {
            cache.Remove(SessionCache.Key(id));
        }

        LogDeleted(logger, userId);
        await SendSafelyAsync(EmailTemplates.AccountDeleted(oldEmail, displayName), ct);
        return Result.Success();
    }

    [LoggerMessage(EventId = 20, Level = LogLevel.Information, Message = "Kullanıcı {UserId} hesabını sildi.")]
    private static partial void LogDeleted(ILogger logger, Guid userId);

    private async Task<AccountDeletionCheckDto> DeletionCheckAsync(Guid userId, CancellationToken ct)
    {
        var owned = await db.Organizations.AsNoTracking()
            .Where(o => o.OwnerId == userId && !o.IsPersonal)
            .Select(o => new OrganizationRefDto(o.Id, o.Name, db.OrganizationMembers.Count(m => m.OrganizationId == o.Id)))
            .ToListAsync(ct);
        return new AccountDeletionCheckDto(
            owned.Where(o => o.MemberCount > 1).OrderBy(o => o.Name).ToList(),
            owned.Where(o => o.MemberCount <= 1).OrderBy(o => o.Name).ToList());
    }

    private static Error? MustTransferError(AccountDeletionCheckDto check) =>
        check.MustTransfer.Count == 0
            ? null
            : Error.Conflict(
                "account.owns_organizations",
                L.T("account.owns_organizations", "Önce şu organizasyonların sahipliğini başka bir üyeye devredin: {names}.", ("names", string.Join(", ", check.MustTransfer.Select(o => o.Name)))));

    private async Task<ProfileDto> ToProfileAsync(ApplicationUser user, CancellationToken ct)
    {
        var orgs = await organizations.ListAsync(user.Id, ct);
        var spaces = await workspaces.ListForUserAsync(user.Id, ct);
        var byOrg = spaces.GroupBy(w => w.OrganizationId).ToDictionary(g => g.Key, g => g.ToList());

        var list = orgs
            .OrderByDescending(o => o.IsPersonal)
            .ThenBy(o => o.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(o => new ProfileOrganizationDto(
                o.Id,
                o.Name,
                o.IsPersonal,
                o.Role,
                o.MemberCount,
                byOrg.GetValueOrDefault(o.Id, [])
                    .OrderBy(w => w.Type != WorkspaceType.Personal)
                    .ThenBy(w => w.Name, StringComparer.CurrentCultureIgnoreCase)
                    .Select(w => new ProfileWorkspaceDto(w.Id, w.Name, w.Type, w.Role))
                    .ToList()))
            .ToList();

        return new ProfileDto(user.Id, user.Email!, user.DisplayName, user.EmailConfirmed, user.PendingEmail, user.CreatedAt, user.AvatarVersion, list);
    }

    private async Task<ApplicationUser?> FindAsync(Guid userId)
    {
        var user = await users.FindByIdAsync(userId.ToString());
        return user is null || user.DeletedAt is not null ? null : user;
    }

    /// <summary>Hassas işlemlerde şifre doğrulaması; hatalı denemeler girişteki gibi kilitlenmeye sayılır.</summary>
    private async Task<Error?> CheckPasswordAsync(ApplicationUser user, string? password)
    {
        if (await users.IsLockedOutAsync(user))
        {
            return Error.Locked("auth.locked_out", L.T("identity.locked_out", "Çok fazla hatalı deneme. Lütfen birkaç dakika sonra tekrar deneyin."));
        }

        if (string.IsNullOrEmpty(password) || !await users.CheckPasswordAsync(user, password))
        {
            await users.AccessFailedAsync(user);
            return Field("password", L.T("account.password_wrong", "Şifre hatalı."));
        }

        await users.ResetAccessFailedCountAsync(user);
        return null;
    }

    private static PreferencesDto ToDto(UserPreferences p) =>
        new(p.Theme, p.DefaultWorkspaceId, p.EmailMentions, p.EmailMergeRequests, p.EmailMonitorAlerts, p.Language, p.SaveHistoryResponses);

    private static Error Field(string field, string message) =>
        Error.Validation("validation", message, new Dictionary<string, string[]> { [field] = [message] });

    /// <summary>Dosya imzasından görsel türü (uzantıya ya da başlığa güvenilmez).</summary>
    internal static string? DetectImageType(ReadOnlySpan<byte> data)
    {
        if (data.Length >= 8 && data[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }))
        {
            return "image/png";
        }

        if (data.Length >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF)
        {
            return "image/jpeg";
        }

        if (data.Length >= 12 && data[..4].SequenceEqual("RIFF"u8) && data[8..12].SequenceEqual("WEBP"u8))
        {
            return "image/webp";
        }

        return null;
    }

    private static string Serialize(JsonObject content) => content.ToJsonString(ExportJson);

    private static async Task WriteAsync(ZipArchive zip, string name, string content, CancellationToken ct)
    {
        var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
        await using var stream = await entry.OpenAsync(ct);
        await stream.WriteAsync(new UTF8Encoding(encoderShouldEmitUTF8Identifier: false).GetBytes(content), ct);
    }

    private static string UniqueName(HashSet<string> used, string folder, string fileName)
    {
        var safe = string.Concat(fileName.Select(c => Path.GetInvalidFileNameChars().Contains(c) || c is '/' or '\\' or ':' ? '_' : c)).Trim();
        if (safe.Length == 0)
        {
            safe = L.T("account.export_unnamed", "adsiz.json");
        }

        var candidate = folder + safe;
        for (var i = 2; !used.Add(candidate); i++)
        {
            var dot = safe.IndexOf('.', StringComparison.Ordinal);
            candidate = dot > 0 ? $"{folder}{safe[..dot]} ({i}){safe[dot..]}" : $"{folder}{safe} ({i})";
        }

        return candidate;
    }

    private static string Readme(ApplicationUser user, int collections, int environments) =>
        string.Join(
            "\n",
            L.T("account.export_readme.title", "Apivator hesap verisi — {name} <{email}>", ("name", user.DisplayName), ("email", user.Email)),
            string.Empty,
            L.T("account.export_readme.account", "hesap.json      Profil, tercihler, açık oturumlar, API anahtarları (yalnızca adları) ve üyelikler."),
            L.T("account.export_readme.collections", "collections/    Kişisel workspace'teki {count} collection (Postman Collection v2.1).", ("count", collections)),
            L.T("account.export_readme.environments", "environments/   Kişisel workspace'teki {count} environment (Postman Environment).", ("count", environments)),
            string.Empty,
            L.T("account.export_readme.import", "Collection ve environment dosyaları Apivator'a ya da Postman'e \"İçe aktar\" ile yüklenebilir."),
            L.T("account.export_readme.teams", "Takım workspace'lerindeki veriler organizasyona aittir; onları workspace içinden tek tek dışa aktarabilirsiniz."));

    private async Task SendSafelyAsync(EmailMessage message, CancellationToken ct)
    {
        try
        {
            await email.SendAsync(message, ct);
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
}
