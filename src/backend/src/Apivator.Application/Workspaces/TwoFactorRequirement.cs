using Apivator.Application.Abstractions;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Workspaces;

/// <summary>
/// Organizasyonların iki adımlı doğrulama zorunluluğunu kullanıcının karşılayıp karşılamadığı. SSO'yu zorunlu kılan
/// organizasyonda, alan adı o organizasyonca doğrulanmış (ve yalnızca SSO ile girebilen) üyeler için ikinci adım
/// kimlik sağlayıcıya bırakılır. Sahip şifreyle de girebildiği için muaf değildir.
/// </summary>
internal static class TwoFactorRequirement
{
    /// <summary><paramref name="requiring"/> içinden kullanıcının zorunluluğu karşılamadığı organizasyonlar.</summary>
    public static async Task<HashSet<Guid>> UnmetAsync(IApplicationDbContext db, Guid userId, IReadOnlyCollection<Guid> requiring, CancellationToken ct)
    {
        if (requiring.Count == 0)
        {
            return [];
        }

        var user = await db.UserTwoFactor.Where(u => u.UserId == userId).Select(u => new { u.Enabled, u.Email }).FirstOrDefaultAsync(ct);
        if (user is null || user.Enabled)
        {
            return user is null ? [.. requiring] : [];
        }

        var at = user.Email?.LastIndexOf('@') ?? -1;
        var domain = at < 0 ? null : user.Email![(at + 1)..].ToLowerInvariant();
        var waived = domain is null
            ? []
            : await (from s in db.OrganizationSso.AsNoTracking()
                     join o in db.Organizations.AsNoTracking() on s.OrganizationId equals o.Id
                     where requiring.Contains(s.OrganizationId) && s.Enabled && s.Enforced && o.OwnerId != userId
                           && s.Domains.Any(d => d.Domain == domain && d.VerifiedAt != null)
                     select s.OrganizationId).ToListAsync(ct);
        if (waived.Count > 0)
        {
            // Yalnızca o organizasyonun kimlik sağlayıcısına bağlı (en az bir kez SSO ile girmiş) kullanıcılar muaf;
            // SSO'dan önce şifreyle açılmış ve hiç SSO kullanmamış hesap muaf değildir.
            var linked = new HashSet<Guid>();
            foreach (var organizationId in waived)
            {
                var prefix = $"oidc:{organizationId:N}:";
                if (await db.UserLogins.AnyAsync(l => l.UserId == userId && l.LoginProvider.StartsWith(prefix), ct))
                {
                    linked.Add(organizationId);
                }
            }

            waived = [.. linked];
        }

        return requiring.Except(waived).ToHashSet();
    }
}
