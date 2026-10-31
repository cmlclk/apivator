using Apivator.Application.Abstractions;
using Apivator.Application.Activity;
using Apivator.Domain.Activity;
using Apivator.Domain.Collections;
using Apivator.Domain.Environments;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Apivator.Infrastructure.Activity;

/// <summary>
/// Collection, klasör, istek, örnek ve environment değişikliklerini aynı kaydetme içinde değişiklik kaydına
/// yazar. Servislerin unutamaması için değişiklik izleyicisinden çıkarılır; kayıt ve değişiklik birlikte
/// kaydedilir ya da hiçbiri kaydedilmez.
/// </summary>
internal sealed class ChangeLogInterceptor(ICurrentUser currentUser, ChangeLogScope scope, TimeProvider clock) : SaveChangesInterceptor
{
    // Bunlar tek başına değiştiyse kayda değmez (sıralama, zaman damgası, sürüm sayacı).
    private static readonly HashSet<string> Housekeeping = new(StringComparer.Ordinal)
    {
        nameof(ApiRequest.SortOrder),
        nameof(ApiRequest.UpdatedAt),
        nameof(ApiRequest.UpdatedById),
        nameof(ApiRequest.Version),
        nameof(ApiRequest.Method),
    };

    private static readonly HashSet<string> Location = new(StringComparer.Ordinal)
    {
        nameof(ApiRequest.CollectionId),
        nameof(ApiRequest.FolderId),
        nameof(Folder.ParentFolderId),
        nameof(Collection.WorkspaceId),
    };

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is { } context)
        {
            await RecordAsync(context, cancellationToken);
        }

        return result;
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        if (eventData.Context is { } context)
        {
            RecordAsync(context, CancellationToken.None).GetAwaiter().GetResult();
        }

        return result;
    }

    private async Task RecordAsync(DbContext context, CancellationToken ct)
    {
        context.ChangeTracker.DetectChanges();
        var entries = context.ChangeTracker.Entries()
            .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted
                && e.Entity is Collection or Folder or ApiRequest or ResponseExample or WorkspaceEnvironment)
            .ToList();
        if (entries.Count == 0)
        {
            return;
        }

        var workspaces = await WorkspaceLookupAsync(context, entries, ct);
        var now = clock.GetUtcNow();
        var userId = currentUser.Id;
        var userName = currentUser.DisplayName;

        // Aynı kaydetmede eklenen collection/klasörün içindekiler toplu işlemdir (içe aktarma, kopyalama).
        var addedCollections = entries.Where(e => e is { State: EntityState.Added, Entity: Collection }).Select(e => ((Collection)e.Entity).Id).ToHashSet();
        var addedFolders = entries.Where(e => e is { State: EntityState.Added, Entity: Folder }).Select(e => ((Folder)e.Entity).Id).ToHashSet();
        var addedRequests = entries.Where(e => e is { State: EntityState.Added, Entity: ApiRequest }).Select(e => ((ApiRequest)e.Entity).Id).ToHashSet();
        var bulk = entries.Count(e => e.State == EntityState.Added) > 1;

        var log = new List<ChangeLogEntry>();
        foreach (var entry in entries)
        {
            var action = ActionOf(entry, out var detail);
            if (action is null)
            {
                continue;
            }

            if (scope.Restoring && action is ChangeAction.Updated or ChangeAction.Created)
            {
                action = ChangeAction.Restored;
                detail = scope.RestoredFromVersion is { } v ? $"v{v}" : null;
            }

            switch (entry.Entity)
            {
                case ApiRequest r when workspaces.Collections.TryGetValue(r.CollectionId, out var workspaceId):
                    log.Add(ChangeLogEntry.Create(
                        workspaceId, ChangeTarget.Request, r.Id, r.CollectionId, r.Name, action.Value, detail, userId, userName, r.Version,
                        Snapshots.Write(new RequestSnapshot(r.Name, r.Definition, r.CollectionId, r.FolderId)),
                        quiet: action == ChangeAction.Created && bulk && (addedCollections.Contains(r.CollectionId) || (r.FolderId is { } folderId && addedFolders.Contains(folderId))),
                        now));
                    break;
                case Folder f when workspaces.Collections.TryGetValue(f.CollectionId, out var workspaceId):
                    log.Add(ChangeLogEntry.Create(
                        workspaceId, ChangeTarget.Folder, f.Id, f.CollectionId, f.Name, action.Value, detail, userId, userName, null, null,
                        quiet: action == ChangeAction.Created && bulk && (addedCollections.Contains(f.CollectionId) || (f.ParentFolderId is { } parentId && addedFolders.Contains(parentId))),
                        now));
                    break;
                case Collection c:
                    var snapshot = action is ChangeAction.Deleted or ChangeAction.Moved
                        ? null
                        : Snapshots.Write(new CollectionSnapshot(c.Name, c.Description, c.Auth, c.Variables, c.Scripts));
                    log.Add(ChangeLogEntry.Create(c.WorkspaceId, ChangeTarget.Collection, c.Id, c.Id, c.Name, action.Value, detail, userId, userName, null, snapshot, quiet: false, now));
                    if (action == ChangeAction.Moved && entry.Property(nameof(Collection.WorkspaceId)).OriginalValue is Guid from && from != c.WorkspaceId)
                    {
                        // Eski workspace'in akışında da görünür: collection oradan gitti.
                        log.Add(ChangeLogEntry.Create(from, ChangeTarget.Collection, c.Id, c.Id, c.Name, ChangeAction.Moved, "başka workspace'e", userId, userName, null, null, quiet: false, now));
                    }

                    break;
                case ResponseExample e when workspaces.Requests.TryGetValue(e.RequestId, out var location):
                    log.Add(ChangeLogEntry.Create(
                        location.WorkspaceId, ChangeTarget.Example, e.Id, location.CollectionId, e.Name, action.Value, detail, userId, userName, null, null,
                        quiet: action == ChangeAction.Created && bulk && addedRequests.Contains(e.RequestId),
                        now));
                    break;
                case WorkspaceEnvironment env:
                    log.Add(ChangeLogEntry.Create(
                        env.WorkspaceId, ChangeTarget.Environment, env.Id, null, env.Name, action.Value, detail, userId, userName, env.Version,
                        action == ChangeAction.Deleted ? null : Snapshots.Write(new EnvironmentSnapshot(env.Name, env.Variables)),
                        quiet: false,
                        now));
                    break;
            }
        }

        context.AddRange(log);
        await PruneAsync(context, log, ct);
    }

    private static ChangeAction? ActionOf(EntityEntry entry, out string? detail)
    {
        detail = null;
        switch (entry.State)
        {
            case EntityState.Added:
                return ChangeAction.Created;
            case EntityState.Deleted:
                return ChangeAction.Deleted;
        }

        var changed = entry.Properties.Where(p => p.IsModified && !Housekeeping.Contains(p.Metadata.Name)).Select(p => p.Metadata.Name).ToList();
        if (changed.Count == 0)
        {
            return null;
        }

        if (changed.Any(Location.Contains))
        {
            return ChangeAction.Moved;
        }

        if (changed is ["Name"])
        {
            detail = entry.Property("Name").OriginalValue as string;
            return ChangeAction.Renamed;
        }

        return ChangeAction.Updated;
    }

    private sealed record Lookup(Dictionary<Guid, Guid> Collections, Dictionary<Guid, (Guid WorkspaceId, Guid CollectionId)> Requests);

    /// <summary>İstek, klasör ve örneklerin hangi workspace'te olduğu (kaydetmeden önce; silinenler henüz yerinde).</summary>
    private static async Task<Lookup> WorkspaceLookupAsync(DbContext context, List<EntityEntry> entries, CancellationToken ct)
    {
        var collections = context.ChangeTracker.Entries<Collection>().ToDictionary(e => e.Entity.Id, e => e.Entity.WorkspaceId);
        var requests = context.ChangeTracker.Entries<ApiRequest>().ToDictionary(e => e.Entity.Id, e => e.Entity.CollectionId);

        var exampleRequestIds = entries.Select(e => e.Entity).OfType<ResponseExample>().Select(e => e.RequestId).Where(id => !requests.ContainsKey(id)).Distinct().ToList();
        if (exampleRequestIds.Count > 0)
        {
            foreach (var r in await context.Set<ApiRequest>().AsNoTracking().Where(r => exampleRequestIds.Contains(r.Id)).Select(r => new { r.Id, r.CollectionId }).ToListAsync(ct))
            {
                requests[r.Id] = r.CollectionId;
            }
        }

        var needed = entries.Select(e => e.Entity switch
            {
                ApiRequest r => r.CollectionId,
                Folder f => f.CollectionId,
                _ => Guid.Empty,
            })
            .Concat(requests.Values)
            .Where(id => id != Guid.Empty && !collections.ContainsKey(id))
            .Distinct()
            .ToList();
        if (needed.Count > 0)
        {
            foreach (var c in await context.Set<Collection>().AsNoTracking().Where(c => needed.Contains(c.Id)).Select(c => new { c.Id, c.WorkspaceId }).ToListAsync(ct))
            {
                collections[c.Id] = c.WorkspaceId;
            }
        }

        var located = requests
            .Where(r => collections.ContainsKey(r.Value))
            .ToDictionary(r => r.Key, r => (collections[r.Value], r.Value));
        return new Lookup(collections, located);
    }

    /// <summary>Sık kaydedilen bir isteğin geçmişi sınırsız büyümesin: hedef başına en yeni sürümler tutulur.</summary>
    private static async Task PruneAsync(DbContext context, List<ChangeLogEntry> log, CancellationToken ct)
    {
        foreach (var entry in log.Where(e => e.Version is { } v && v % 20 == 0))
        {
            var old = await context.Set<ChangeLogEntry>()
                .Where(e => e.TargetId == entry.TargetId)
                .OrderByDescending(e => e.CreatedAt)
                .Skip(ChangeLogEntry.MaxSnapshotsPerTarget - 1)
                .Select(e => e.Id)
                .ToListAsync(ct);
            if (old.Count > 0)
            {
                await context.Set<ChangeLogEntry>().Where(e => old.Contains(e.Id)).ExecuteDeleteAsync(ct);
            }
        }
    }
}
