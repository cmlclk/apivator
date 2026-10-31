using System.Security.Cryptography;
using System.Text;
using Apivator.Application.Audit;
using Apivator.Application.Onboarding;
using Apivator.Domain.Audit;
using Apivator.Domain.Organizations;
using Apivator.Infrastructure.Identity;
using Apivator.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Apivator.Infrastructure.Sso;

/// <summary>SSO kimliğinin hangi Apivator hesabına karşılık geldiğine dair karar.</summary>
internal abstract record SsoAccountOutcome
{
    public sealed record SignedIn(ApplicationUser User) : SsoAccountOutcome;

    /// <summary>Aynı e-postalı doğrulanmış hesap var; bağlama e-postayla onaylanmalı.</summary>
    public sealed record LinkRequired(ApplicationUser User, string LinkToken) : SsoAccountOutcome;

    public sealed record Rejected(string Reason) : SsoAccountOutcome;
}

/// <summary>
/// SSO kimliğini hesaba eşler. Kurallar:
/// <list type="bullet">
/// <item>Bu sağlayıcıdaki kimlik (issuer + sub) daha önce bağlanmışsa o hesap.</item>
/// <item>Aynı e-postalı, e-postası doğrulanmış hesap varsa doğrudan girilmez: bağlama e-postayla onaylanır (IdP'nin
/// e-posta claim'i değiştirilebilir olabilir; ör. Entra'da kullanıcı adresini başkasınınki yapabilir).</item>
/// <item>E-postası hiç doğrulanmamış hesap (biri başkasının adresiyle önceden kayıt olmuş olabilir) devralınır ama
/// temizlenir: şifre, oturumlar, API anahtarları ve 2FA kaldırılır.</item>
/// <item>Hesap yoksa ve otomatik açma açıksa açılır; üye değilse otomatik eklemeyle üye yapılır.</item>
/// </list>
/// </summary>
internal sealed class SsoAccounts(
    AppDbContext db,
    UserManager<ApplicationUser> users,
    IPersonalSpaceProvisioner provisioner,
    IAuditLog audit,
    Audit.AuditActorSource actors,
    IMemoryCache cache,
    TimeProvider clock)
{
    /// <summary>Sağlayıcı anahtarı issuer'ı da içerir: issuer değişince eski kimlikler (sub'lar) yeniyle eşleşmez.</summary>
    public static string Provider(Guid organizationId, string issuer) =>
        $"oidc:{organizationId:N}:{Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(issuer.TrimEnd('/'))))[..16]}";

    public static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    public async Task<SsoAccountOutcome> ResolveAsync(OidcIdentity identity, OrganizationSso sso, Organization organization, AuditActor client, CancellationToken ct)
    {
        var provider = Provider(organization.Id, identity.Issuer);
        var user = await users.FindByLoginAsync(provider, identity.Subject);
        if (user is null && await users.FindByEmailAsync(identity.Email) is { } existing)
        {
            if (existing.DeletedAt is not null)
            {
                return new SsoAccountOutcome.Rejected("not_member");
            }

            if (existing.EmailConfirmed)
            {
                return new SsoAccountOutcome.LinkRequired(existing, await CreateLinkAsync(existing, organization, provider, identity.Subject, ct));
            }

            // Doğrulanmamış hesap kişiye ait olduğu kanıtlanmamış bir hesaptır; devralınmaz (içeriği saldırgan
            // tarafından hazırlanmış olabilir). Emekliye ayrılır ve aşağıda temiz bir hesap açılır.
            if (!sso.AutoProvision)
            {
                return new SsoAccountOutcome.Rejected("not_member");
            }

            await RetireAsync(existing, organization, client, ct);
        }

        if (user is not null && (user.DeletedAt is not null || await users.IsLockedOutAsync(user)))
        {
            return new SsoAccountOutcome.Rejected("not_member");
        }

        return await SignInAsync(user, identity, sso, organization, provider, client, ct) is { } signedIn
            ? new SsoAccountOutcome.SignedIn(signedIn)
            : new SsoAccountOutcome.Rejected("not_member");
    }

    /// <summary>
    /// E-postadaki bağlantıyla onaylanan bağlamayı tamamlar. Oturum açmaz: bağlantıyı tıklayan kişi yalnızca bağlamayı
    /// onaylar, girişi ardından SSO ile kendisi yapar (bağlantı e-postada başkasının eline geçse de hesaba girilmez).
    /// </summary>
    public async Task<ApplicationUser?> ConfirmLinkAsync(string token, AuditActor client, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 200)
        {
            return null;
        }

        var hash = Hash(token);
        var request = await db.SsoLinkRequests.AsNoTracking().FirstOrDefaultAsync(r => r.TokenHash == hash, ct);
        if (request is null || await db.SsoLinkRequests.Where(r => r.Id == request.Id).ExecuteDeleteAsync(ct) == 0 || request.ExpiresAt < clock.GetUtcNow())
        {
            return null;
        }

        var sso = await db.OrganizationSso.AsNoTracking().Include(s => s.Domains).FirstOrDefaultAsync(s => s.OrganizationId == request.OrganizationId && s.Enabled, ct);
        var organization = await db.Organizations.Include(o => o.Members).FirstOrDefaultAsync(o => o.Id == request.OrganizationId, ct);
        var user = await users.FindByIdAsync(request.UserId.ToString());
        if (sso is null || organization is null || user is null || user.DeletedAt is not null || !sso.CoversEmail(user.Email!))
        {
            return null;
        }

        // Kimlik bu arada başka hesaba bağlandıysa onaylanmaz.
        if (await users.FindByLoginAsync(request.LoginProvider, request.Subject) is { } other && other.Id != user.Id)
        {
            return null;
        }

        var identity = new OidcIdentity(string.Empty, request.Subject, user.Email!, user.DisplayName);
        return await SignInAsync(user, identity, sso, organization, request.LoginProvider, client with { UserId = user.Id, Name = user.DisplayName, Email = user.Email }, ct, linked: true);
    }

    private async Task<string> CreateLinkAsync(ApplicationUser user, Organization organization, string provider, string subject, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        await db.SsoLinkRequests.Where(r => r.ExpiresAt < now || (r.UserId == user.Id && r.OrganizationId == organization.Id)).ExecuteDeleteAsync(ct);
        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        db.SsoLinkRequests.Add(new SsoLinkRequest
        {
            TokenHash = Hash(token),
            UserId = user.Id,
            OrganizationId = organization.Id,
            LoginProvider = provider,
            Subject = subject,
            ExpiresAt = now + SsoLinkRequest.Lifetime,
        });
        await db.SaveChangesAsync(ct);
        return token;
    }

    /// <summary>
    /// E-postası hiç doğrulanmamış hesabı (biri başkasının adresiyle önceden açmış olabilir) emekliye ayırır: adres
    /// anonimleşir, oturum, API anahtarı ve üyelikleri silinir, kişisel organizasyonu kaldırılır, hesap kilitlenir.
    /// Adres serbest kalır; gerçek sahibi için temiz bir hesap açılır. Tek işlemde yapılır.
    /// </summary>
    private async Task RetireAsync(ApplicationUser user, Organization organization, AuditActor client, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var email = user.Email;
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var sessions = await db.RefreshTokens.Where(t => t.UserId == user.Id).Select(t => t.SessionId).Distinct().ToListAsync(ct);
        await db.RefreshTokens.Where(t => t.UserId == user.Id).ExecuteDeleteAsync(ct);
        await db.ApiKeys.Where(k => k.UserId == user.Id).ExecuteDeleteAsync(ct);
        await db.Organizations.Where(o => o.IsPersonal && o.OwnerId == user.Id).ExecuteDeleteAsync(ct);
        await db.OrganizationMembers.Where(m => m.UserId == user.Id && m.Role != OrganizationRole.Owner).ExecuteDeleteAsync(ct);
        await db.TeamMembers.Where(m => m.UserId == user.Id).ExecuteDeleteAsync(ct);
        await db.WorkspaceMembers.Where(m => m.UserId == user.Id).ExecuteDeleteAsync(ct);
        await db.CollectionAccess.Where(e => e.UserId == user.Id).ExecuteDeleteAsync(ct);
        await db.Invitations.Where(i => i.AcceptedAt == null && i.InvitedById == user.Id).ExecuteDeleteAsync(ct);

        var anonymous = $"retired-{user.Id:N}@deleted.invalid";
        user.Email = anonymous;
        user.NormalizedEmail = anonymous.ToUpperInvariant();
        user.UserName = anonymous;
        user.NormalizedUserName = anonymous.ToUpperInvariant();
        user.PasswordHash = null;
        user.TwoFactorEnabled = false;
        user.AuthenticatorKey = null;
        user.RecoveryCodeHashes = [];
        user.TwoFactorEnabledAt = null;
        user.LockoutEnabled = true;
        user.LockoutEnd = DateTimeOffset.MaxValue;
        user.SecurityStamp = Guid.NewGuid().ToString("N");
        user.DeletedAt = now;
        await users.UpdateAsync(user);

        await audit.RecordAsync(
            organization.Id, AuditActions.SsoUnverifiedAccountRetired, "member", user.Id, user.DisplayName,
            new Dictionary<string, string?> { ["email"] = email }, client, ct);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        cache.Forget(sessions);
    }

    private async Task<ApplicationUser?> SignInAsync(
        ApplicationUser? user,
        OidcIdentity identity,
        OrganizationSso sso,
        Organization organization,
        string provider,
        AuditActor client,
        CancellationToken ct,
        bool linked = false)
    {
        var now = clock.GetUtcNow();
        var created = false;
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        if (user is null)
        {
            if (!sso.AutoProvision)
            {
                return null;
            }

            user = new ApplicationUser
            {
                Id = Guid.CreateVersion7(),
                UserName = identity.Email,
                Email = identity.Email,
                EmailConfirmed = true, // kimlik sağlayıcı ve doğrulanmış alan adı garanti ediyor
                DisplayName = Clip(identity.Name ?? identity.Email[..identity.Email.IndexOf('@')], 100),
                CreatedAt = now,
            };
            if (!(await users.CreateAsync(user)).Succeeded)
            {
                return null;
            }

            provisioner.Provision(user.Id, user.DisplayName);
            created = true;
        }
        else
        {
            user.EmailConfirmed = true;
            await users.UpdateAsync(user);
        }

        // Bu istekte oturum yok; otomatik yazılan kayıtlar (ör. member.added) giriş yapan kişiye yazılsın.
        var actor = client with { UserId = user.Id, Name = user.DisplayName, Email = user.Email };
        actors.Use(actor);
        if ((await users.GetLoginsAsync(user)).All(l => l.LoginProvider != provider))
        {
            await users.AddLoginAsync(user, new UserLoginInfo(provider, identity.Subject, organization.Name));
        }

        if (organization.RoleOf(user.Id) is null)
        {
            if (!sso.AutoProvision)
            {
                return null;
            }

            organization.AddMember(user.Id, sso.DefaultRole, now);
        }

        if (created || linked)
        {
            await audit.RecordAsync(
                organization.Id, created ? AuditActions.SsoUserProvisioned : AuditActions.SsoAccountLinked, "member", user.Id, user.DisplayName,
                new Dictionary<string, string?> { ["email"] = user.Email }, actor, ct);
        }

        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);
        return user;
    }

    private static string Clip(string value, int max) => value.Length > max ? value[..max] : value;
}
