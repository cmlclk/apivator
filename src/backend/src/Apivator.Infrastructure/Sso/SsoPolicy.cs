using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Domain.Organizations;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Infrastructure.Sso;

/// <summary>E-posta adresinin alan adı bir organizasyonun SSO'sunda doğrulanmış mı, şifreyle giriş kapalı mı?</summary>
internal sealed class SsoPolicy(AppDbContext db)
{
    public static string? DomainOf(string? email)
    {
        var at = email?.LastIndexOf('@') ?? -1;
        return at < 0 ? null : email![(at + 1)..].Trim().TrimEnd('.').ToLowerInvariant();
    }

    /// <summary>Adresin alan adını doğrulamış ve SSO'su açık organizasyon (alan adı tek organizasyonda doğrulanabilir).</summary>
    public async Task<(OrganizationSso Sso, Organization Organization)?> ForEmailAsync(string? email, CancellationToken ct)
    {
        if (DomainOf(email) is not { Length: > 0 } domain)
        {
            return null;
        }

        var row = await (
                from d in db.SsoDomains.AsNoTracking()
                join s in db.OrganizationSso.AsNoTracking() on d.SsoId equals s.Id
                join o in db.Organizations.AsNoTracking() on s.OrganizationId equals o.Id
                where d.Domain == domain && d.VerifiedAt != null && s.Enabled
                select new { s.Id, Organization = o })
            .FirstOrDefaultAsync(ct);
        if (row is null)
        {
            return null;
        }

        var sso = await db.OrganizationSso.AsNoTracking().Include(s => s.Domains).FirstAsync(s => s.Id == row.Id, ct);
        return (sso, row.Organization);
    }

    /// <summary>
    /// SSO'su açık bir alan adında şifreyle yeni hesap açılamaz (zorunlu olmasa da): hesaplar IdP üzerinden açılır.
    /// Yoksa biri başkasının adresiyle önceden hesap açıp sonradan o kişinin SSO kimliğine bağlanmayı bekleyebilirdi.
    /// </summary>
    public async Task<Error?> RegistrationErrorAsync(string? email, CancellationToken ct) =>
        await ForEmailAsync(email, ct) is { } found
            ? Error.Forbidden("auth.sso_required", L.T("auth.sso_required_registration", "{organization} bu alan adı için tek oturum açma (SSO) kullanıyor. Hesabınızı \"SSO ile giriş yap\" ile açın.", ("organization", found.Organization.Name)))
            : null;

    /// <summary>Zorunlu SSO kapsamındaki (sahip olmayan) kullanıcı mı? E-posta değiştirmek onu kapsam dışına çıkarırdı.</summary>
    public async Task<string?> EnforcingOrganizationAsync(string? email, Guid userId, CancellationToken ct) =>
        await ForEmailAsync(email, ct) is { } found && found.Sso.Enforced && found.Organization.OwnerId != userId ? found.Organization.Name : null;

    /// <summary>
    /// Şifreyle giriş ve kayıt kapalıysa hata döner: alan adı SSO'su zorunlu bir organizasyona aittir. O organizasyonun
    /// sahibi, kimlik sağlayıcı arızasında kilitli kalmasın diye şifreyle girebilir.
    /// </summary>
    public async Task<Error?> PasswordLoginErrorAsync(string? email, Guid? userId, CancellationToken ct) =>
        await ForEmailAsync(email, ct) is { } found && found.Sso.Enforced && found.Organization.OwnerId != userId
            ? Error.Forbidden(
                "auth.sso_required",
                L.T("auth.sso_required_login", "{organization} bu e-posta adresi için tek oturum açmayı (SSO) zorunlu kılıyor. \"SSO ile giriş yap\" seçeneğini kullanın.", ("organization", found.Organization.Name)))
            : null;
}
