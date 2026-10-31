using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Domain.Collections;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Workspaces;

public interface IWorkspaceAccess
{
    /// <summary>
    /// Kullanıcının workspace'te en az <paramref name="minimum"/> rolü yoksa hata döner. Üye olmayana
    /// "bulunamadı" denir; böylece başkasının workspace'inin varlığı sızdırılmaz.
    /// </summary>
    Task<Error?> RequireAsync(Guid workspaceId, Guid userId, WorkspaceRole minimum, CancellationToken cancellationToken = default);

    /// <summary>Kullanıcının workspace'teki etkin rolü; erişimi yoksa null.</summary>
    Task<WorkspaceRole?> RoleAsync(Guid workspaceId, Guid userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Collection'daki etkin rol (collection rolleri ve kısıtlama hesaba katılır, bkz. <see cref="CollectionAccessEntry.Effective"/>);
    /// collection yoksa ya da workspace'e erişim yoksa null.
    /// </summary>
    Task<WorkspaceRole?> CollectionRoleAsync(Guid collectionId, Guid userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Collection'da en az <paramref name="minimum"/> rolü ister. Workspace'e erişimi olmayana "bulunamadı"
    /// (<see cref="WorkspaceAccess.NotFound"/>), rolü yetmeyene <see cref="WorkspaceAccess.CollectionForbidden"/> döner.
    /// </summary>
    Task<Error?> RequireCollectionAsync(Guid collectionId, Guid userId, WorkspaceRole minimum, CancellationToken cancellationToken = default);

    /// <summary>Workspace'teki tüm collection'larda kullanıcının etkin rolü (tek sorgu turu).</summary>
    Task<IReadOnlyDictionary<Guid, WorkspaceRole>> CollectionRolesAsync(Guid workspaceId, Guid userId, CancellationToken cancellationToken = default);
}

internal sealed class WorkspaceAccess(IApplicationDbContext db) : IWorkspaceAccess
{
    public static Error NotFound => Error.NotFound("workspace.not_found", L.T("workspace.not_found", "Workspace bulunamadı."));
    public static Error Forbidden => Error.Forbidden("workspace.forbidden", L.T("workspace.forbidden", "Bu işlem için yetkiniz yok."));
    public static Error CollectionForbidden => Error.Forbidden("collection.forbidden", L.T("collection.forbidden", "Bu collection'ı düzenleme yetkiniz yok; collection'da görüntüleyicisiniz."));

    public async Task<Error?> RequireAsync(Guid workspaceId, Guid userId, WorkspaceRole minimum, CancellationToken cancellationToken = default)
    {
        var role = await RoleAsync(workspaceId, userId, cancellationToken);
        return role is null ? NotFound : role < minimum ? Forbidden : null;
    }

    public async Task<WorkspaceRole?> RoleAsync(Guid workspaceId, Guid userId, CancellationToken cancellationToken = default) =>
        (await EffectiveRoles.ForUserAsync(db, userId, workspaceId, cancellationToken)).TryGetValue(workspaceId, out var role)
            ? role
            : null;

    public async Task<WorkspaceRole?> CollectionRoleAsync(Guid collectionId, Guid userId, CancellationToken cancellationToken = default)
    {
        var collection = await db.Collections.AsNoTracking()
            .Where(c => c.Id == collectionId)
            .Select(c => new { c.WorkspaceId, c.EditingRestricted })
            .FirstOrDefaultAsync(cancellationToken);
        if (collection is null)
        {
            return null;
        }

        var workspaceRole = await RoleAsync(collection.WorkspaceId, userId, cancellationToken);
        if (workspaceRole is null or WorkspaceRole.Admin)
        {
            return workspaceRole;
        }

        var entries = await EntriesAsync([collectionId], userId, cancellationToken);
        return Resolve(workspaceRole, collection.EditingRestricted, entries.Where(e => e.CollectionId == collectionId));
    }

    public async Task<Error?> RequireCollectionAsync(Guid collectionId, Guid userId, WorkspaceRole minimum, CancellationToken cancellationToken = default)
    {
        var role = await CollectionRoleAsync(collectionId, userId, cancellationToken);
        if (role is null)
        {
            return NotFound;
        }

        if (role >= minimum)
        {
            return null;
        }

        // Workspace rolü de yetmiyorsa genel mesaj; yalnızca collection'da kısıtlıysa collection'a özel mesaj.
        var collection = await db.Collections.AsNoTracking().Where(c => c.Id == collectionId).Select(c => c.WorkspaceId).FirstAsync(cancellationToken);
        return await RoleAsync(collection, userId, cancellationToken) >= minimum ? CollectionForbidden : Forbidden;
    }

    public async Task<IReadOnlyDictionary<Guid, WorkspaceRole>> CollectionRolesAsync(Guid workspaceId, Guid userId, CancellationToken cancellationToken = default)
    {
        var workspaceRole = await RoleAsync(workspaceId, userId, cancellationToken);
        if (workspaceRole is null)
        {
            return new Dictionary<Guid, WorkspaceRole>();
        }

        var collections = await db.Collections.AsNoTracking()
            .Where(c => c.WorkspaceId == workspaceId)
            .Select(c => new { c.Id, c.EditingRestricted })
            .ToListAsync(cancellationToken);
        if (workspaceRole == WorkspaceRole.Admin)
        {
            return collections.ToDictionary(c => c.Id, _ => WorkspaceRole.Admin);
        }

        var entries = (await EntriesAsync(collections.Select(c => c.Id).ToList(), userId, cancellationToken)).ToLookup(e => e.CollectionId);
        return collections.ToDictionary(c => c.Id, c => Resolve(workspaceRole, c.EditingRestricted, entries[c.Id])!.Value);
    }

    private sealed record EntryRow(Guid CollectionId, bool IsUser, WorkspaceRole Role);

    /// <summary>Kullanıcıya doğrudan ya da takımları üzerinden uygulanan collection kayıtları.</summary>
    private async Task<List<EntryRow>> EntriesAsync(List<Guid> collectionIds, Guid userId, CancellationToken ct)
    {
        var teamIds = db.TeamMembers.Where(m => m.UserId == userId).Select(m => m.TeamId);
        return await db.CollectionAccess.AsNoTracking()
            .Where(e => collectionIds.Contains(e.CollectionId) && (e.UserId == userId || (e.TeamId != null && teamIds.Contains(e.TeamId.Value))))
            .Select(e => new EntryRow(e.CollectionId, e.UserId != null, e.Role))
            .ToListAsync(ct);
    }

    private static WorkspaceRole? Resolve(WorkspaceRole? workspaceRole, bool restricted, IEnumerable<EntryRow> entries)
    {
        var list = entries.ToList();
        WorkspaceRole? direct = list.FirstOrDefault(e => e.IsUser) is { } user ? user.Role : null;
        return CollectionAccessEntry.Effective(workspaceRole, restricted, direct, list.Where(e => !e.IsUser).Select(e => e.Role));
    }
}

/// <summary>
/// Organizasyon iki adımlı doğrulamayı zorunlu kılmışsa ve kullanıcınınki kapalıysa o organizasyonun workspace'leri
/// hiç yokmuş gibi davranılır (liste, erişim, API anahtarı).
/// Etkin rol = doğrudan üyelik, takımlar üzerinden gelen roller ve organizasyon yöneticiliğinin en yükseği.
/// Organizasyon sahibi ve yöneticileri takım workspace'lerinde Admin sayılır. Yalnızca kullanıcının üyesi olduğu
/// organizasyonlardaki workspace'ler dikkate alınır.
/// </summary>
internal static class EffectiveRoles
{
    public static async Task<Dictionary<Guid, WorkspaceRole>> ForUserAsync(IApplicationDbContext db, Guid userId, Guid? onlyWorkspace, CancellationToken ct)
    {
        var memberships = await (
                from m in db.OrganizationMembers.AsNoTracking()
                join o in db.Organizations.AsNoTracking() on m.OrganizationId equals o.Id
                where m.UserId == userId
                select new { m.OrganizationId, m.Role, o.RequireTwoFactor })
            .ToListAsync(ct);

        // İki adımlı doğrulamayı zorunlu kılan organizasyonların workspace'leri, kullanıcı 2FA'yı açana kadar yok sayılır
        // (SSO zorunluysa kimlik sağlayıcıya bırakılır, bkz. TwoFactorRequirement).
        var unmet = await TwoFactorRequirement.UnmetAsync(db, userId, memberships.Where(m => m.RequireTwoFactor).Select(m => m.OrganizationId).ToList(), ct);
        memberships.RemoveAll(m => unmet.Contains(m.OrganizationId));

        var organizations = memberships.ToDictionary(m => m.OrganizationId, m => m.Role);
        var organizationIds = organizations.Keys.ToList();

        var workspaces = await db.Workspaces.AsNoTracking()
            .Where(w => organizationIds.Contains(w.OrganizationId) && (onlyWorkspace == null || w.Id == onlyWorkspace))
            .Select(w => new { w.Id, w.OrganizationId, w.Type })
            .ToListAsync(ct);
        var workspaceIds = workspaces.Select(w => w.Id).ToList();

        var direct = await db.WorkspaceMembers.AsNoTracking()
            .Where(m => m.UserId == userId && workspaceIds.Contains(m.WorkspaceId))
            .Select(m => new { m.WorkspaceId, m.Role })
            .ToListAsync(ct);
        var viaTeams = await (
                from wt in db.WorkspaceTeams.AsNoTracking()
                join tm in db.TeamMembers.AsNoTracking() on wt.TeamId equals tm.TeamId
                where tm.UserId == userId && workspaceIds.Contains(wt.WorkspaceId)
                select new { wt.WorkspaceId, wt.Role })
            .ToListAsync(ct);

        var result = new Dictionary<Guid, WorkspaceRole>();
        void Raise(Guid workspaceId, WorkspaceRole role)
        {
            if (!result.TryGetValue(workspaceId, out var current) || current < role)
            {
                result[workspaceId] = role;
            }
        }

        foreach (var m in direct)
        {
            Raise(m.WorkspaceId, m.Role);
        }

        foreach (var t in viaTeams)
        {
            Raise(t.WorkspaceId, t.Role);
        }

        foreach (var w in workspaces.Where(w => w.Type == WorkspaceType.Team && organizations[w.OrganizationId] >= OrganizationRole.Admin))
        {
            Raise(w.Id, WorkspaceRole.Admin);
        }

        return result;
    }
}

public interface IOrganizationAccess
{
    /// <summary>Üye değilse "bulunamadı", rolü yetmiyorsa "yetkiniz yok".</summary>
    Task<Result<Organization>> RequireAsync(Guid organizationId, Guid userId, OrganizationRole minimum, CancellationToken ct = default);
}

internal sealed class OrganizationAccess(IApplicationDbContext db) : IOrganizationAccess
{
    public static Error NotFound => Error.NotFound("organization.not_found", L.T("organization.not_found", "Organizasyon bulunamadı."));

    public async Task<Result<Organization>> RequireAsync(Guid organizationId, Guid userId, OrganizationRole minimum, CancellationToken ct = default)
    {
        var organization = await db.Organizations.Include(o => o.Members).FirstOrDefaultAsync(o => o.Id == organizationId, ct);
        var role = organization?.RoleOf(userId);
        if (organization is null || role is null)
        {
            return NotFound;
        }

        if (role < minimum)
        {
            return Error.Forbidden("organization.forbidden", L.T("organization.forbidden", "Bu işlem için organizasyon yöneticisi olmalısınız."));
        }

        // 2FA zorunlu organizasyonda yönetim işlemleri için yöneticinin de 2FA'sı açık olmalı (ayarı kapatmak dahil).
        if (minimum >= OrganizationRole.Admin && organization.RequireTwoFactor
            && (await TwoFactorRequirement.UnmetAsync(db, userId, [organization.Id], ct)).Count > 0)
        {
            return Error.Forbidden(
                "organization.two_factor_required",
                L.T("organization.two_factor_required", "Bu organizasyon iki adımlı doğrulama istiyor; yönetim işlemleri için önce hesabınızda açın."));
        }

        return organization;
    }
}
