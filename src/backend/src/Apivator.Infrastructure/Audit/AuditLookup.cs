using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Application.Common.Localization;
using Apivator.Domain.Audit;
using Apivator.Domain.Collections;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;
using Apivator.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Infrastructure.Audit;

/// <summary>
/// İşlemi yapanı (oturumdaki kullanıcı, API anahtarı, istemci) olay anındaki hâliyle çözer. İstek başına bir kez
/// hesaplanır. Veritabanı bağlamı parametre olarak alınır: interceptor DbContext'i enjekte edemez (döngü olur).
/// </summary>
internal sealed class AuditActorSource(ICurrentUser user, ICurrentClient client)
{
    private AuditActor? _cached;

    /// <summary>Oturumsuz akışlarda (SSO dönüşü) işlemi yapanı belirtir; bu istekteki sonraki kayıtlar ona yazılır.</summary>
    public void Use(AuditActor actor) => _cached = actor;

    public async Task<AuditActor> CurrentAsync(DbContext db, CancellationToken ct)
    {
        if (_cached is not null)
        {
            return _cached;
        }

        // Oturum yoksa önbelleğe alınmaz: aynı istekte sonradan Use ile kişi belirtilebilir.
        if (user.Id is not { } id)
        {
            return AuditActor.System;
        }

        var profile = await db.Set<ApplicationUser>().AsNoTracking()
            .Where(u => u.Id == id)
            .Select(u => new { u.DisplayName, u.Email })
            .FirstOrDefaultAsync(ct);
        var info = client.Info;
        var device = info.UserAgent is null && info.App is null ? null : DeviceLabel.Describe(info.UserAgent, info.App);
        return _cached = new AuditActor(id, profile?.DisplayName ?? user.DisplayName, profile?.Email, user.ApiKeyId, info.IpAddress, device);
    }
}

/// <summary>
/// Olaylardaki kimlikleri (organizasyon, workspace, collection, takım, kişi) adlarına ve organizasyonlarına çevirir.
/// Önce değişiklik izleyicisine (aynı kaydetmede eklenenler dahil), yoksa veritabanına bakar; kaydetme başına önbellekli.
/// </summary>
internal sealed class AuditLookup(DbContext db, CancellationToken ct)
{
    private readonly Dictionary<Guid, (bool IsPersonal, string Name)?> _organizations = [];
    private readonly Dictionary<Guid, (Guid OrganizationId, string Name)?> _workspaces = [];
    private readonly Dictionary<Guid, (Guid WorkspaceId, string Name)?> _collections = [];
    private readonly Dictionary<Guid, (Guid OrganizationId, string Name)?> _teams = [];
    private readonly Dictionary<Guid, (string Name, string? Email)> _users = [];

    public async Task<bool> IsAuditedAsync(Guid organizationId) =>
        await OrganizationAsync(organizationId) is { IsPersonal: false };

    public async Task<(bool IsPersonal, string Name)?> OrganizationAsync(Guid id)
    {
        if (!_organizations.TryGetValue(id, out var value))
        {
            value = Tracked<Organization>(id) is { } o
                ? (o.IsPersonal, o.Name)
                : await db.Set<Organization>().AsNoTracking().Where(o => o.Id == id)
                    .Select(o => new { o.IsPersonal, o.Name }).FirstOrDefaultAsync(ct) is { } o2 ? (o2.IsPersonal, o2.Name) : null;
            _organizations[id] = value;
        }

        return value;
    }

    public async Task<(Guid OrganizationId, string Name)?> WorkspaceAsync(Guid id)
    {
        if (!_workspaces.TryGetValue(id, out var value))
        {
            value = Tracked<Workspace>(id) is { } w
                ? (w.OrganizationId, w.Name)
                : await db.Set<Workspace>().AsNoTracking().Where(w => w.Id == id)
                    .Select(w => new { w.OrganizationId, w.Name }).FirstOrDefaultAsync(ct) is { } w2 ? (w2.OrganizationId, w2.Name) : null;
            _workspaces[id] = value;
        }

        return value;
    }

    public async Task<(Guid WorkspaceId, string Name)?> CollectionAsync(Guid id)
    {
        if (!_collections.TryGetValue(id, out var value))
        {
            value = Tracked<Collection>(id) is { } c
                ? (c.WorkspaceId, c.Name)
                : await db.Set<Collection>().AsNoTracking().Where(c => c.Id == id)
                    .Select(c => new { c.WorkspaceId, c.Name }).FirstOrDefaultAsync(ct) is { } c2 ? (c2.WorkspaceId, c2.Name) : null;
            _collections[id] = value;
        }

        return value;
    }

    public async Task<(Guid OrganizationId, string Name)?> TeamAsync(Guid id)
    {
        if (!_teams.TryGetValue(id, out var value))
        {
            value = Tracked<Team>(id) is { } t
                ? (t.OrganizationId, t.Name)
                : await db.Set<Team>().AsNoTracking().Where(t => t.Id == id)
                    .Select(t => new { t.OrganizationId, t.Name }).FirstOrDefaultAsync(ct) is { } t2 ? (t2.OrganizationId, t2.Name) : null;
            _teams[id] = value;
        }

        return value;
    }

    public async Task<(string Name, string? Email)> UserAsync(Guid id)
    {
        if (!_users.TryGetValue(id, out var value))
        {
            var row = await db.Set<ApplicationUser>().AsNoTracking().Where(u => u.Id == id)
                .Select(u => new { u.DisplayName, u.Email }).FirstOrDefaultAsync(ct);
            value = row is null ? (L.T("audit.unknown_user", "Bilinmeyen kullanıcı"), null) : (row.DisplayName, row.Email);
            _users[id] = value;
        }

        return value;
    }

    /// <summary>"Ayşe Yılmaz (ayse@firma.com)" — dışa aktarmada kişiyi adı aynı olanlardan ayırmak için.</summary>
    public async Task<string> UserLabelAsync(Guid id)
    {
        var (name, email) = await UserAsync(id);
        return email is null ? name : $"{name} ({email})";
    }

    /// <summary>Kullanıcının üye olduğu, denetlenen (kişisel olmayan) organizasyonlar.</summary>
    public async Task<List<Guid>> OrganizationsOfAsync(Guid userId) =>
        await (from m in db.Set<OrganizationMember>().AsNoTracking()
               join o in db.Set<Organization>().AsNoTracking() on m.OrganizationId equals o.Id
               where m.UserId == userId && !o.IsPersonal
               select o.Id).ToListAsync(ct);

    private T? Tracked<T>(Guid id)
        where T : Domain.Common.Entity =>
        db.ChangeTracker.Entries<T>().Select(e => e.Entity).FirstOrDefault(e => e.Id == id);
}
