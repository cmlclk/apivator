using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Forks;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Forks;

public interface IForkService
{
    /// <summary>Collection'ı hedef workspace'e fork'lar (kaynağı görmek, hedefte düzenleyebilmek yeter).</summary>
    Task<Result<ForkInfoDto>> CreateAsync(Guid sourceCollectionId, CreateForkRequest request, Guid userId, CancellationToken ct = default);

    /// <summary>Collection'ın fork bağları: kendisi bir fork'sa kaynağı, ayrıca görülebilen fork'ları.</summary>
    Task<Result<IReadOnlyList<ForkInfoDto>>> ForCollectionAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    /// <summary>Workspace'teki fork collection'ları (ağaçta işaretlemek için).</summary>
    Task<Result<IReadOnlyList<ForkInfoDto>>> ForWorkspaceAsync(Guid workspaceId, Guid userId, CancellationToken ct = default);

    Task<Result<ForkComparisonDto>> CompareAsync(Guid forkId, Guid userId, CancellationToken ct = default);

    /// <summary>Kaynaktaki değişiklikleri fork'a çeker; çakışmalar <see cref="PullRequestBody.Resolutions"/> ile çözülür.</summary>
    Task<Result<ForkComparisonDto>> PullAsync(Guid forkId, PullRequestBody body, Guid userId, CancellationToken ct = default);

    /// <summary>Bağı kaldırır; fork collection'ı bağımsız bir collection olarak kalır, açık merge istekleri kapanır.</summary>
    Task<Result> UnlinkAsync(Guid forkId, Guid userId, CancellationToken ct = default);
}

internal sealed class ForkService(
    IApplicationDbContext db,
    IWorkspaceAccess access,
    ForkEngine engine,
    IUserDirectory users,
    TimeProvider clock) : IForkService
{
    internal static Error ForkNotFound => Error.NotFound("fork.not_found", L.T("fork.not_found", "Fork bulunamadı."));
    private static Error CollectionNotFound => Error.NotFound("collection.not_found", L.T("collection.not_found", "Collection bulunamadı."));

    public async Task<Result<ForkInfoDto>> CreateAsync(Guid sourceCollectionId, CreateForkRequest request, Guid userId, CancellationToken ct = default)
    {
        var source = await db.Collections.AsNoTracking().FirstOrDefaultAsync(c => c.Id == sourceCollectionId, ct);
        if (source is null || await access.RequireAsync(source.WorkspaceId, userId, WorkspaceRole.Viewer, ct) is not null)
        {
            return CollectionNotFound;
        }

        if (await access.RequireAsync(request.TargetWorkspaceId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        var name = string.IsNullOrWhiteSpace(request.Name) ? $"{source.Name} (fork)" : request.Name.Trim();
        if (name.Length > Collection.NameMaxLength)
        {
            name = name[..Collection.NameMaxLength];
        }

        var now = clock.GetUtcNow();
        var copy = Collection.Create(request.TargetWorkspaceId, name, userId, now);
        copy.SetAuth(source.Auth, now);
        copy.SetScripts(source.Scripts, now);
        copy.SetVariables(source.Variables, now);
        copy.Describe(source.Description, now);
        db.Collections.Add(copy);

        var fork = CollectionFork.Create(copy.Id, source.Id, userId, now);
        db.Forks.Add(fork);

        var sourceSide = await ForkSide.LoadAsync(db, ForkEngine.SourceSide, source.Id, ct);
        var links = new List<ForkLink> { ForkLink.Create(Guid.CreateVersion7(), fork.Id, ForkItemKind.Collection, source.Id, copy.Id, new ForkSnapshot()) };

        // Klasörler üstten alta kopyalanır; her öğe kaynağıyla bağlanır.
        var folderMap = new Dictionary<Guid, Guid>();
        foreach (var folder in sourceSide.Folders.Values.OrderBy(f => sourceSide.Depth(f.Id)).ThenBy(f => f.SortOrder))
        {
            var parent = folder.ParentFolderId is { } p && folderMap.TryGetValue(p, out var mapped) ? mapped : (Guid?)null;
            var clone = Folder.Create(copy.Id, parent, folder.Name, folder.SortOrder, now);
            clone.SetAuth(folder.Auth);
            clone.SetScripts(folder.Scripts);
            clone.Describe(folder.Description);
            db.Folders.Add(clone);
            folderMap[folder.Id] = clone.Id;
            links.Add(ForkLink.Create(Guid.CreateVersion7(), fork.Id, ForkItemKind.Folder, folder.Id, clone.Id, new ForkSnapshot()));
        }

        foreach (var r in sourceSide.Requests.Values)
        {
            var folderId = r.FolderId is { } f && folderMap.TryGetValue(f, out var mapped) ? mapped : (Guid?)null;
            var clone = ApiRequest.Create(copy.Id, folderId, r.Name, r.Definition, r.SortOrder, userId, now);
            db.Requests.Add(clone);
            foreach (var example in sourceSide.Examples.GetValueOrDefault(r.Id, []))
            {
                db.Examples.Add(example.CopyTo(clone.Id, now));
            }

            links.Add(ForkLink.Create(Guid.CreateVersion7(), fork.Id, ForkItemKind.Request, r.Id, clone.Id, new ForkSnapshot()));
        }

        // Taban = kaynağın şimdiki hâli (üst klasörler bağlantı anahtarlarıyla).
        foreach (var link in links)
        {
            sourceSide.LinkOf[link.SourceItemId] = link.Id;
        }

        foreach (var link in links)
        {
            link.Rebase(sourceSide.Snapshot(link.Kind, link.SourceItemId)!);
            db.ForkLinks.Add(link);
        }

        await db.SaveChangesAsync(ct);
        return await InfoAsync(fork, userId, ct);
    }

    public async Task<Result<IReadOnlyList<ForkInfoDto>>> ForCollectionAsync(Guid collectionId, Guid userId, CancellationToken ct = default)
    {
        var collection = await db.Collections.AsNoTracking().FirstOrDefaultAsync(c => c.Id == collectionId, ct);
        if (collection is null || await access.RequireAsync(collection.WorkspaceId, userId, WorkspaceRole.Viewer, ct) is not null)
        {
            return CollectionNotFound;
        }

        var forks = await db.Forks.AsNoTracking()
            .Where(f => f.ForkCollectionId == collectionId || f.SourceCollectionId == collectionId)
            .OrderBy(f => f.CreatedAt)
            .ToListAsync(ct);
        var result = new List<ForkInfoDto>();
        foreach (var fork in forks)
        {
            var info = await InfoAsync(fork, userId, ct);
            // Başkalarının (görülemeyen workspace'lerdeki) fork'ları listelenmez.
            if (fork.ForkCollectionId == collectionId || info.ForkName is not null)
            {
                result.Add(info);
            }
        }

        return result;
    }

    public async Task<Result<IReadOnlyList<ForkInfoDto>>> ForWorkspaceAsync(Guid workspaceId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var forks = await db.Forks.AsNoTracking()
            .Join(db.Collections.AsNoTracking().Where(c => c.WorkspaceId == workspaceId), f => f.ForkCollectionId, c => c.Id, (f, _) => f)
            .ToListAsync(ct);
        var result = new List<ForkInfoDto>();
        foreach (var fork in forks)
        {
            result.Add(await InfoAsync(fork, userId, ct));
        }

        return result;
    }

    public async Task<Result<ForkComparisonDto>> CompareAsync(Guid forkId, Guid userId, CancellationToken ct = default)
    {
        var (fork, error) = await LoadAsync(forkId, userId, WorkspaceRole.Viewer, ct);
        if (error is not null)
        {
            return error;
        }

        var (source, forkSide, links) = await SidesAsync(fork!, ct);
        var changes = ForkEngine.Compare(source, forkSide, links);
        return new ForkComparisonDto(await InfoAsync(fork!, userId, ct), changes.Select(c => c.ToDto()).ToList());
    }

    public async Task<Result<ForkComparisonDto>> PullAsync(Guid forkId, PullRequestBody body, Guid userId, CancellationToken ct = default)
    {
        var (fork, error) = await LoadAsync(forkId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        var (source, forkSide, links) = await SidesAsync(fork!, ct);
        var now = clock.GetUtcNow();
        var (_, unresolved) = await engine.ApplyAsync(fork!, source, forkSide, links, body.Resolutions, userId, now, ct);
        if (unresolved.Count > 0)
        {
            return Error.Conflict(
                "fork.conflicts",
                L.T("fork.conflicts", "{count} öğe iki tarafta da farklı değiştirilmiş. Her biri için hangisinin kalacağını seçin.", ("count", unresolved.Count)));
        }

        fork!.MarkPulled(now);
        await db.SaveChangesAsync(ct);
        return await CompareAsync(forkId, userId, ct);
    }

    public async Task<Result> UnlinkAsync(Guid forkId, Guid userId, CancellationToken ct = default)
    {
        var fork = await db.Forks.FirstOrDefaultAsync(f => f.Id == forkId, ct);
        var forkWorkspace = fork is null ? null : await WorkspaceOfAsync(fork.ForkCollectionId, ct);
        if (fork is null || forkWorkspace is null || await access.RequireAsync(forkWorkspace.Value, userId, WorkspaceRole.Viewer, ct) is not null)
        {
            return ForkNotFound;
        }

        if (await access.RequireCollectionAsync(fork.ForkCollectionId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        var now = clock.GetUtcNow();
        foreach (var open in await db.MergeRequests.Where(m => m.ForkId == forkId && m.Status == MergeRequestStatus.Open).ToListAsync(ct))
        {
            open.Close(userId, now);
        }

        db.Forks.Remove(fork);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    /// <summary>Fork'u görmek için iki tarafı da görebilmek gerekir; değiştirmek (çekmek) için fork'ta <paramref name="forkRole"/>.</summary>
    internal async Task<(CollectionFork? Fork, Error? Error)> LoadAsync(Guid forkId, Guid userId, WorkspaceRole forkRole, CancellationToken ct)
    {
        var fork = await db.Forks.FirstOrDefaultAsync(f => f.Id == forkId, ct);
        if (fork is null)
        {
            return (null, ForkNotFound);
        }

        var forkWorkspace = await WorkspaceOfAsync(fork.ForkCollectionId, ct);
        var sourceWorkspace = await WorkspaceOfAsync(fork.SourceCollectionId, ct);
        if (forkWorkspace is null || sourceWorkspace is null
            || await access.CollectionRoleAsync(fork.ForkCollectionId, userId, ct) is not { } role
            || await access.RoleAsync(sourceWorkspace.Value, userId, ct) is null)
        {
            return (null, ForkNotFound);
        }

        // Fork'a çekme ve merge isteği açma fork collection'ını düzenlemeyi gerektirir (collection rolü geçerli).
        return role < forkRole
            ? (null, await access.RoleAsync(forkWorkspace.Value, userId, ct) >= forkRole ? WorkspaceAccess.CollectionForbidden : WorkspaceAccess.Forbidden)
            : (fork, null);
    }

    internal async Task<(ForkSide Source, ForkSide Fork, List<ForkLink> Links)> SidesAsync(CollectionFork fork, CancellationToken ct)
    {
        var source = await ForkSide.LoadAsync(db, ForkEngine.SourceSide, fork.SourceCollectionId, ct);
        var forkSide = await ForkSide.LoadAsync(db, ForkEngine.ForkSide, fork.ForkCollectionId, ct);
        var links = await db.ForkLinks.Where(l => l.ForkId == fork.Id).ToListAsync(ct);
        return (source, forkSide, links);
    }

    internal async Task<ForkInfoDto> InfoAsync(CollectionFork fork, Guid userId, CancellationToken ct)
    {
        var collectionIds = new[] { fork.ForkCollectionId, fork.SourceCollectionId };
        var collections = await (
                from c in db.Collections.AsNoTracking()
                join w in db.Workspaces.AsNoTracking() on c.WorkspaceId equals w.Id
                where collectionIds.Contains(c.Id)
                select new { c.Id, c.Name, c.WorkspaceId, WorkspaceName = w.Name })
            .ToDictionaryAsync(x => x.Id, ct);
        var visible = new Dictionary<Guid, bool>();
        foreach (var c in collections.Values)
        {
            visible[c.Id] = await access.RoleAsync(c.WorkspaceId, userId, ct) is not null;
        }

        var forkCollection = visible.GetValueOrDefault(fork.ForkCollectionId) ? collections[fork.ForkCollectionId] : null;
        var sourceCollection = visible.GetValueOrDefault(fork.SourceCollectionId) ? collections[fork.SourceCollectionId] : null;
        var names = await users.DisplayNamesAsync([fork.CreatedById], ct);
        return new ForkInfoDto(
            fork.Id, fork.ForkCollectionId, forkCollection?.Name, forkCollection?.WorkspaceId, forkCollection?.WorkspaceName,
            fork.SourceCollectionId, sourceCollection?.Name, sourceCollection?.WorkspaceId, sourceCollection?.WorkspaceName,
            names.GetValueOrDefault(fork.CreatedById, string.Empty), fork.CreatedAt, fork.LastPulledAt);
    }

    private Task<Guid?> WorkspaceOfAsync(Guid collectionId, CancellationToken ct) =>
        db.Collections.AsNoTracking().Where(c => c.Id == collectionId).Select(c => (Guid?)c.WorkspaceId).FirstOrDefaultAsync(ct);
}
