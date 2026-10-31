using Apivator.Application.Audit;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Sso;
using Apivator.Application.Workspaces;
using Apivator.Domain.Audit;
using Apivator.Domain.Organizations;
using Apivator.Infrastructure.Identity;
using Apivator.Infrastructure.Persistence;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Sso;

internal sealed class SsoAdminService(
    AppDbContext db,
    IOrganizationAccess organizations,
    OidcClient oidc,
    IDomainVerifier verifier,
    IDataProtectionProvider protection,
    IAuditLog audit,
    Microsoft.Extensions.Caching.Memory.IMemoryCache cache,
    IOptions<SsoOptions> options,
    IOptions<AppOptions> app,
    TimeProvider clock) : ISsoAdminService
{
    /// <summary>Client secret'ları koruyan Data Protection amacı (giriş servisi de aynısını kullanır).</summary>
    internal const string SecretPurpose = "Apivator.Sso.ClientSecret";

    private static Error DomainNotFound => Error.NotFound("sso.domain_not_found", L.T("sso.domain_not_found", "Alan adı bulunamadı."));

    public static string RedirectUri(AppOptions app) => app.PublicUrl.TrimEnd('/') + "/api/auth/sso/callback";

    public static string RecordName(string domain) => "_apivator." + domain;

    public async Task<Result<SsoSettingsDto>> GetAsync(Guid organizationId, Guid userId, CancellationToken ct = default)
    {
        var found = await RequireAsync(organizationId, userId, OrganizationRole.Admin, ct);
        return found.IsSuccess ? ToDto(await FindAsync(organizationId, ct)) : found.Error!;
    }

    public async Task<Result<SsoSettingsDto>> UpdateAsync(Guid organizationId, UpdateSsoRequest request, Guid userId, CancellationToken ct = default)
    {
        var found = await RequireAsync(organizationId, userId, OrganizationRole.Owner, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        if (string.IsNullOrWhiteSpace(request.Authority) || request.Authority.Length > OrganizationSso.AuthorityMaxLength)
        {
            return Field("authority", L.T("sso.authority_required", "Issuer adresi zorunlu (en fazla 500 karakter)."));
        }

        if (oidc.ValidateAuthority(request.Authority) is { } invalidAuthority)
        {
            return Field("authority", invalidAuthority);
        }

        if (string.IsNullOrWhiteSpace(request.ClientId) || request.ClientId.Length > OrganizationSso.ClientIdMaxLength)
        {
            return Field("clientId", L.T("sso.client_id_required", "Client ID zorunlu (en fazla 300 karakter)."));
        }

        if (request.DefaultRole == OrganizationRole.Owner)
        {
            return Field("defaultRole", L.T("sso.default_role_owner", "Yeni üyelere sahip rolü verilemez."));
        }

        // Kaydetmeden önce sağlayıcıya ulaşılabildiği görülür; yazım hatası girişte değil burada fark edilir.
        try
        {
            await oidc.DiscoverAsync(request.Authority.Trim().TrimEnd('/'), ct);
        }
        catch (OidcException ex)
        {
            return Field("authority", ex.Message);
        }

        var sso = await FindAsync(organizationId, ct);
        var now = clock.GetUtcNow();
        if (sso is null)
        {
            sso = OrganizationSso.Create(organizationId, now);
            db.OrganizationSso.Add(sso);
        }

        var keep = request.ClientSecret is null;
        var secret = string.IsNullOrEmpty(request.ClientSecret) ? null : protection.CreateProtector(SecretPurpose).Protect(request.ClientSecret.Trim());
        sso.Configure(request.Authority, request.ClientId, secret, keep, request.AutoProvision, request.DefaultRole, now);

        await RecordAsync(found.Value, AuditActions.SsoConfigured, new()
        {
            ["authority"] = sso.Authority,
            ["client_id"] = sso.ClientId,
            ["client_secret"] = keep ? null : secret is null ? "kaldırıldı" : "değiştirildi",
            ["auto_provision"] = sso.AutoProvision ? "true" : "false",
            ["default_role"] = sso.DefaultRole.ToString(),
        }, ct);
        await db.SaveChangesAsync(ct);
        return ToDto(sso);
    }

    public async Task<Result<SsoSettingsDto>> SetStateAsync(Guid organizationId, SsoStateRequest request, Guid userId, CancellationToken ct = default)
    {
        var found = await RequireAsync(organizationId, userId, OrganizationRole.Owner, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        var sso = await FindAsync(organizationId, ct);
        if (sso is null || string.IsNullOrEmpty(sso.ClientId))
        {
            return Error.Validation("sso.not_configured", L.T("sso.not_configured", "Önce kimlik sağlayıcı bilgilerini kaydedin."));
        }

        if (request.Enabled && !sso.HasVerifiedDomain)
        {
            return Error.Validation("sso.no_verified_domain", L.T("sso.no_verified_domain", "SSO'yu açmadan önce en az bir alan adını doğrulayın."));
        }

        var (wasEnabled, wasEnforced) = (sso.Enabled, sso.Enforced);
        sso.SetState(request.Enabled, request.Enforced, clock.GetUtcNow());
        if (wasEnabled != sso.Enabled)
        {
            await RecordAsync(found.Value, sso.Enabled ? AuditActions.SsoEnabled : AuditActions.SsoDisabled, [], ct);
        }

        var revoked = 0;
        if (wasEnforced != sso.Enforced)
        {
            // Zorunluluk açılınca şifreyle açılmış oturumlar da kapanır; kapsamdakiler yalnızca SSO ile döner.
            revoked = sso.Enforced ? await RevokeDomainSessionsAsync(sso, found.Value.OwnerId, ct) : 0;
            await RecordAsync(
                found.Value,
                sso.Enforced ? AuditActions.SsoEnforced : AuditActions.SsoUnenforced,
                new() { ["sessions_revoked"] = sso.Enforced ? revoked.ToString(System.Globalization.CultureInfo.InvariantCulture) : null },
                ct);
        }

        await db.SaveChangesAsync(ct);
        return ToDto(sso);
    }

    public async Task<Result<SsoSettingsDto>> AddDomainAsync(Guid organizationId, AddSsoDomainRequest request, Guid userId, CancellationToken ct = default)
    {
        var found = await RequireAsync(organizationId, userId, OrganizationRole.Owner, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        string domain;
        try
        {
            domain = SsoDomain.Normalize(request.Domain);
        }
        catch (ArgumentException ex)
        {
            return Field("domain", ex.Message.Split(" (Parameter", 2)[0]);
        }

        if (await db.SsoDomains.AnyAsync(d => d.Domain == domain && d.VerifiedAt != null, ct))
        {
            return Error.Conflict("sso.domain_taken", L.T("sso.domain_taken", "Bu alan adı başka bir organizasyon tarafından doğrulanmış."));
        }

        var now = clock.GetUtcNow();
        var sso = await FindAsync(organizationId, ct);
        if (sso is null)
        {
            sso = OrganizationSso.Create(organizationId, now);
            db.OrganizationSso.Add(sso);
        }

        try
        {
            var added = sso.AddDomain(domain, now);
            db.SsoDomains.Add(added);
            if (!options.Value.RequireDomainVerification)
            {
                added.MarkVerified(now);
            }
        }
        catch (InvalidOperationException ex)
        {
            return Field("domain", ex.Message);
        }

        await RecordAsync(found.Value, AuditActions.SsoDomainAdded, new() { ["domain"] = domain }, ct);
        await db.SaveChangesAsync(ct);
        return ToDto(sso);
    }

    public async Task<Result<SsoSettingsDto>> VerifyDomainAsync(Guid organizationId, Guid domainId, Guid userId, CancellationToken ct = default)
    {
        var found = await RequireAsync(organizationId, userId, OrganizationRole.Owner, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        var sso = await FindAsync(organizationId, ct);
        var domain = sso?.Domains.FirstOrDefault(d => d.Id == domainId);
        if (sso is null || domain is null)
        {
            return DomainNotFound;
        }

        if (domain.VerifiedAt is null)
        {
            if (await db.SsoDomains.AnyAsync(d => d.Domain == domain.Domain && d.VerifiedAt != null && d.Id != domain.Id, ct))
            {
                return Error.Conflict("sso.domain_taken", L.T("sso.domain_taken", "Bu alan adı başka bir organizasyon tarafından doğrulanmış."));
            }

            if (await verifier.LookupAsync(RecordName(domain.Domain), domain.RecordValue, ct) != TxtLookup.Found)
            {
                return Error.Validation(
                    "sso.domain_unverified",
                    L.T("sso.domain_unverified", "DNS'te {name} adında, değeri \"{value}\" olan TXT kaydı bulunamadı. Kayıt yeni eklendiyse yayılması birkaç dakika sürebilir.", ("name", RecordName(domain.Domain)), ("value", domain.RecordValue)));
            }

            domain.MarkVerified(clock.GetUtcNow());
            await RecordAsync(found.Value, AuditActions.SsoDomainVerified, new() { ["domain"] = domain.Domain }, ct);
            await db.SaveChangesAsync(ct);
        }

        return ToDto(sso);
    }

    public async Task<Result<SsoSettingsDto>> RemoveDomainAsync(Guid organizationId, Guid domainId, Guid userId, CancellationToken ct = default)
    {
        var found = await RequireAsync(organizationId, userId, OrganizationRole.Owner, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        var sso = await FindAsync(organizationId, ct);
        var domain = sso?.Domains.FirstOrDefault(d => d.Id == domainId);
        if (sso is null || domain is null)
        {
            return DomainNotFound;
        }

        var wasEnabled = sso.Enabled;
        sso.RemoveDomain(domainId, clock.GetUtcNow());
        db.SsoDomains.Remove(domain);
        await RecordAsync(found.Value, AuditActions.SsoDomainRemoved, new() { ["domain"] = domain.Domain }, ct);
        if (wasEnabled && !sso.Enabled)
        {
            await RecordAsync(found.Value, AuditActions.SsoDisabled, new() { ["reason"] = "doğrulanmış alan adı kalmadı" }, ct);
        }

        await db.SaveChangesAsync(ct);
        return ToDto(sso);
    }

    private async Task<Result<Organization>> RequireAsync(Guid organizationId, Guid userId, OrganizationRole minimum, CancellationToken ct)
    {
        var found = await organizations.RequireAsync(organizationId, userId, minimum == OrganizationRole.Owner ? OrganizationRole.Admin : minimum, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        if (found.Value.IsPersonal)
        {
            return Error.Validation("organization.personal", L.T("sso.organization_personal", "Kişisel organizasyonda SSO kullanılamaz."));
        }

        return minimum == OrganizationRole.Owner && found.Value.OwnerId != userId
            ? Error.Forbidden("sso.owner_only", L.T("sso.owner_only", "SSO ayarlarını yalnızca organizasyon sahibi değiştirebilir."))
            : found.Value;
    }

    /// <summary>Doğrulanmış alan adlarındaki (sahip hariç) kullanıcıların açık oturumlarını kapatır.</summary>
    private async Task<int> RevokeDomainSessionsAsync(OrganizationSso sso, Guid ownerId, CancellationToken ct)
    {
        var suffixes = sso.Domains.Where(d => d.VerifiedAt is not null).Select(d => "@" + d.Domain.ToUpperInvariant()).ToList();
        var userIds = new List<Guid>();
        foreach (var suffix in suffixes)
        {
            userIds.AddRange(await db.Users.Where(u => u.Id != ownerId && u.NormalizedEmail!.EndsWith(suffix)).Select(u => u.Id).ToListAsync(ct));
        }

        if (userIds.Count == 0)
        {
            return 0;
        }

        var now = clock.GetUtcNow();
        var open = db.RefreshTokens.Where(t => userIds.Contains(t.UserId) && t.RevokedAt == null);
        var sessions = await open.Select(t => t.SessionId).Distinct().ToListAsync(ct);
        await open.ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, (DateTimeOffset?)now), ct);
        cache.Forget(sessions);
        return sessions.Count;
    }

    private Task<OrganizationSso?> FindAsync(Guid organizationId, CancellationToken ct) =>
        db.OrganizationSso.Include(s => s.Domains).FirstOrDefaultAsync(s => s.OrganizationId == organizationId, ct);

    private Task RecordAsync(Organization organization, string action, Dictionary<string, string?> data, CancellationToken ct) =>
        audit.RecordAsync(organization.Id, action, "sso", organization.Id, organization.Name, data, ct: ct);

    private SsoSettingsDto ToDto(OrganizationSso? sso) => new(
        sso is not null && !string.IsNullOrEmpty(sso.ClientId),
        sso?.Enabled ?? false,
        sso?.Enforced ?? false,
        string.IsNullOrEmpty(sso?.Authority) ? null : sso.Authority,
        string.IsNullOrEmpty(sso?.ClientId) ? null : sso.ClientId,
        sso?.ProtectedClientSecret is not null,
        sso?.AutoProvision ?? true,
        sso?.DefaultRole ?? OrganizationRole.Member,
        RedirectUri(app.Value),
        (sso?.Domains ?? [])
            .OrderBy(d => d.Domain, StringComparer.Ordinal)
            .Select(d => new SsoDomainDto(d.Id, d.Domain, d.VerifiedAt is not null, d.VerifiedAt, RecordName(d.Domain), d.RecordValue))
            .ToList());

    private static Error Field(string field, string message) =>
        Error.Validation("validation", message, new Dictionary<string, string[]> { [field] = [message] });
}
