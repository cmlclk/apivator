using Apivator.Application.Abstractions;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Infrastructure.Email;

/// <summary>
/// Bildirim e-postalarının dili: alıcının kayıtlı dili, yoksa workspace'in organizasyonunun varsayılan dili
/// (bulunamazsa Türkçe). Sonuç <c>Lang.Use</c> ile kullanılır.
/// </summary>
internal static class NotificationLanguage
{
    public static async Task<string?> OrganizationAsync(IApplicationDbContext db, Guid workspaceId, CancellationToken ct) =>
        await (from w in db.Workspaces.AsNoTracking()
               join o in db.Organizations.AsNoTracking() on w.OrganizationId equals o.Id
               where w.Id == workspaceId
               select o.DefaultLanguage).FirstOrDefaultAsync(ct);

    public static async Task<string?> RecipientAsync(IUserDirectory users, IApplicationDbContext db, string email, Guid workspaceId, CancellationToken ct) =>
        await users.PreferredLanguageByEmailAsync(email, ct) ?? await OrganizationAsync(db, workspaceId, ct);
}
