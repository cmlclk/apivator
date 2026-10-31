using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Collections;

/// <summary>Ağaç düzenleme işlemleri: taşıma (sürükle-bırak) ve kopyalama.</summary>
public interface ICollectionTreeService
{
    Task<Result<ApiRequestDto>> MoveRequestAsync(Guid requestId, MoveApiRequestRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<FolderDto>> MoveFolderAsync(Guid folderId, MoveFolderRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<ApiRequestDto>> DuplicateRequestAsync(Guid requestId, Guid userId, CancellationToken ct = default);

    Task<Result<FolderDto>> DuplicateFolderAsync(Guid folderId, Guid userId, CancellationToken ct = default);

    /// <summary>Kopyayı aynı workspace'e ya da (hedef verilirse) başka bir workspace'e oluşturur.</summary>
    Task<Result<CollectionTreeDto>> DuplicateCollectionAsync(Guid collectionId, Guid userId, Guid? targetWorkspaceId = null, CancellationToken ct = default);

    /// <summary>Collection'ı başka bir workspace'e taşır; iki workspace'te de Editor olunmalı.</summary>
    Task<Result<CollectionTreeDto>> MoveCollectionAsync(Guid collectionId, Guid targetWorkspaceId, Guid userId, CancellationToken ct = default);
}

public sealed record CollectionTargetRequest(Guid WorkspaceId);

internal sealed class CollectionTreeService(IApplicationDbContext db, IWorkspaceAccess access, TimeProvider clock) : ICollectionTreeService
{
    private static Error CollectionNotFound => Error.NotFound("collection.not_found", L.T("collection.not_found", "Collection bulunamadı."));
    private static Error FolderNotFound => Error.NotFound("folder.not_found", L.T("folder.not_found", "Klasör bulunamadı."));
    private static Error RequestNotFound => Error.NotFound("request.not_found", L.T("request.not_found", "İstek bulunamadı."));

    public async Task<Result<ApiRequestDto>> MoveRequestAsync(Guid requestId, MoveApiRequestRequest request, Guid userId, CancellationToken ct = default)
    {
        var entity = await db.Requests.FirstOrDefaultAsync(r => r.Id == requestId, ct);
        if (entity is null)
        {
            return RequestNotFound;
        }

        var (source, sourceError) = await EditableCollectionAsync(entity.CollectionId, userId, ct);
        if (sourceError is not null)
        {
            return sourceError == CollectionNotFound ? RequestNotFound : sourceError;
        }

        var (target, targetError) = await TargetCollectionAsync(source!, request.CollectionId, userId, ct);
        if (targetError is not null)
        {
            return targetError;
        }

        if (request.FolderId is { } folderId && !await db.Folders.AnyAsync(f => f.Id == folderId && f.CollectionId == target!.Id, ct))
        {
            return FolderNotFound;
        }

        var siblings = await db.Requests
            .Where(r => r.CollectionId == target!.Id && r.FolderId == request.FolderId && r.Id != entity.Id)
            .OrderBy(r => r.SortOrder).ThenBy(r => r.CreatedAt)
            .ToListAsync(ct);
        var index = Math.Clamp(request.SortOrder, 0, siblings.Count);
        for (var i = 0; i < siblings.Count; i++)
        {
            siblings[i].SetSortOrder(i < index ? i : i + 1);
        }

        entity.MoveTo(target!.Id, request.FolderId, index);
        await db.SaveChangesAsync(ct);
        return ToDto(entity);
    }

    public async Task<Result<FolderDto>> MoveFolderAsync(Guid folderId, MoveFolderRequest request, Guid userId, CancellationToken ct = default)
    {
        var folder = await db.Folders.FirstOrDefaultAsync(f => f.Id == folderId, ct);
        if (folder is null)
        {
            return FolderNotFound;
        }

        var (source, sourceError) = await EditableCollectionAsync(folder.CollectionId, userId, ct);
        if (sourceError is not null)
        {
            return sourceError == CollectionNotFound ? FolderNotFound : sourceError;
        }

        var (target, targetError) = await TargetCollectionAsync(source!, request.CollectionId, userId, ct);
        if (targetError is not null)
        {
            return targetError;
        }

        var sourceFolders = await db.Folders.Where(f => f.CollectionId == source!.Id).ToListAsync(ct);
        var subtree = Subtree(sourceFolders, folder.Id);
        if (request.ParentFolderId is { } parentId)
        {
            if (subtree.Contains(parentId))
            {
                return Error.Validation("folder.invalid_move", L.T("folder.invalid_move", "Klasör kendi içine ya da alt klasörlerinden birine taşınamaz."));
            }

            if (!await db.Folders.AnyAsync(f => f.Id == parentId && f.CollectionId == target!.Id, ct))
            {
                return FolderNotFound;
            }
        }

        var siblings = await db.Folders
            .Where(f => f.CollectionId == target!.Id && f.ParentFolderId == request.ParentFolderId && f.Id != folder.Id)
            .OrderBy(f => f.SortOrder).ThenBy(f => f.CreatedAt)
            .ToListAsync(ct);
        var index = Math.Clamp(request.SortOrder, 0, siblings.Count);
        for (var i = 0; i < siblings.Count; i++)
        {
            siblings[i].SetSortOrder(i < index ? i : i + 1);
        }

        folder.MoveTo(target!.Id, request.ParentFolderId, index);

        if (target.Id != source!.Id)
        {
            // Alt klasörler ve içlerindeki istekler de yeni collection'a geçer.
            foreach (var child in sourceFolders.Where(f => f.Id != folder.Id && subtree.Contains(f.Id)))
            {
                child.ChangeCollection(target.Id);
            }

            var requests = await db.Requests.Where(r => r.FolderId != null && subtree.Contains(r.FolderId.Value)).ToListAsync(ct);
            foreach (var r in requests)
            {
                r.MoveTo(target.Id, r.FolderId, r.SortOrder);
            }
        }

        await db.SaveChangesAsync(ct);
        return ToDto(folder);
    }

    public async Task<Result<ApiRequestDto>> DuplicateRequestAsync(Guid requestId, Guid userId, CancellationToken ct = default)
    {
        var original = await db.Requests.AsNoTracking().FirstOrDefaultAsync(r => r.Id == requestId, ct);
        if (original is null)
        {
            return RequestNotFound;
        }

        var (_, error) = await EditableCollectionAsync(original.CollectionId, userId, ct);
        if (error is not null)
        {
            return error == CollectionNotFound ? RequestNotFound : error;
        }

        // Kopya, aslının hemen altına yerleşir.
        var later = await db.Requests
            .Where(r => r.CollectionId == original.CollectionId && r.FolderId == original.FolderId && r.SortOrder > original.SortOrder)
            .ToListAsync(ct);
        foreach (var r in later)
        {
            r.SetSortOrder(r.SortOrder + 1);
        }

        var now = clock.GetUtcNow();
        var copy = ApiRequest.Create(original.CollectionId, original.FolderId, CopyName(original.Name, ApiRequest.NameMaxLength), original.Definition, original.SortOrder + 1, userId, now);
        db.Requests.Add(copy);
        await CopyExamplesAsync(new Dictionary<Guid, Guid> { [original.Id] = copy.Id }, now, ct);
        await db.SaveChangesAsync(ct);
        return ToDto(copy);
    }

    public async Task<Result<FolderDto>> DuplicateFolderAsync(Guid folderId, Guid userId, CancellationToken ct = default)
    {
        var original = await db.Folders.AsNoTracking().FirstOrDefaultAsync(f => f.Id == folderId, ct);
        if (original is null)
        {
            return FolderNotFound;
        }

        var (_, error) = await EditableCollectionAsync(original.CollectionId, userId, ct);
        if (error is not null)
        {
            return error == CollectionNotFound ? FolderNotFound : error;
        }

        var later = await db.Folders
            .Where(f => f.CollectionId == original.CollectionId && f.ParentFolderId == original.ParentFolderId && f.SortOrder > original.SortOrder)
            .ToListAsync(ct);
        foreach (var f in later)
        {
            f.SetSortOrder(f.SortOrder + 1);
        }

        var folders = await db.Folders.AsNoTracking().Where(f => f.CollectionId == original.CollectionId).ToListAsync(ct);
        var subtree = Subtree(folders, original.Id);
        var requests = await db.Requests.AsNoTracking()
            .Where(r => r.FolderId != null && subtree.Contains(r.FolderId.Value))
            .ToListAsync(ct);

        var now = clock.GetUtcNow();
        var root = Folder.Create(original.CollectionId, original.ParentFolderId, CopyName(original.Name, Folder.NameMaxLength), original.SortOrder + 1, now);
        root.SetAuth(original.Auth);
        root.SetScripts(original.Scripts);
        root.Describe(original.Description);
        db.Folders.Add(root);
        await CloneAsync(folders.Where(f => subtree.Contains(f.Id)).ToList(), requests, original.CollectionId, new Dictionary<Guid, Guid> { [original.Id] = root.Id }, userId, now, ct);
        await db.SaveChangesAsync(ct);
        return ToDto(root);
    }

    public async Task<Result<CollectionTreeDto>> DuplicateCollectionAsync(Guid collectionId, Guid userId, Guid? targetWorkspaceId = null, CancellationToken ct = default)
    {
        Collection? original;
        if (targetWorkspaceId is { } target)
        {
            // Başka workspace'e kopya: kaynağı görmek yeter, hedefte düzenleme yetkisi gerekir.
            original = await db.Collections.AsNoTracking().FirstOrDefaultAsync(c => c.Id == collectionId, ct);
            if (original is null || await access.RequireAsync(original.WorkspaceId, userId, WorkspaceRole.Viewer, ct) is not null)
            {
                return CollectionNotFound;
            }

            if (await access.RequireAsync(target, userId, WorkspaceRole.Editor, ct) is { } denied)
            {
                return denied;
            }
        }
        else
        {
            var (editable, error) = await EditableCollectionAsync(collectionId, userId, ct);
            if (error is not null)
            {
                return error;
            }

            original = editable;
        }

        var now = clock.GetUtcNow();
        var copy = Collection.Create(
            targetWorkspaceId ?? original!.WorkspaceId,
            targetWorkspaceId is null ? CopyName(original!.Name, Collection.NameMaxLength) : original!.Name,
            userId,
            now);
        copy.SetAuth(original.Auth, now);
        copy.SetScripts(original.Scripts, now);
        copy.SetVariables(original.Variables, now);
        copy.Describe(original.Description, now);
        db.Collections.Add(copy);

        var folders = await db.Folders.AsNoTracking().Where(f => f.CollectionId == collectionId).ToListAsync(ct);
        var requests = await db.Requests.AsNoTracking().Where(r => r.CollectionId == collectionId).ToListAsync(ct);
        await CloneAsync(folders, requests, copy.Id, [], userId, now, ct);
        await db.SaveChangesAsync(ct);

        return new CollectionTreeDto(copy.Id, copy.WorkspaceId, copy.Name, copy.Description, copy.Auth, copy.Variables, copy.Scripts, [], [], []);
    }

    public async Task<Result<CollectionTreeDto>> MoveCollectionAsync(Guid collectionId, Guid targetWorkspaceId, Guid userId, CancellationToken ct = default)
    {
        var (collection, error) = await EditableCollectionAsync(collectionId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        if (collection!.WorkspaceId == targetWorkspaceId)
        {
            return Error.Validation("collection.same_workspace", L.T("collection.same_workspace", "Collection zaten bu workspace'te."));
        }

        if (await access.RequireAsync(targetWorkspaceId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        var now = clock.GetUtcNow();
        collection.MoveTo(targetWorkspaceId, now);
        // Collection rolleri eski workspace'in üyelerine göre verilmişti; yeni yerde workspace rolleri geçerli olur.
        collection.RestrictEditing(false, now);
        db.CollectionAccess.RemoveRange(await db.CollectionAccess.Where(e => e.CollectionId == collectionId).ToListAsync(ct));
        // Çalıştırma raporları collection'la birlikte gider; environment'lar ve geçmiş eski workspace'te kalır.
        foreach (var run in await db.Runs.Where(r => r.CollectionId == collectionId).ToListAsync(ct))
        {
            run.MoveTo(targetWorkspaceId);
        }

        // Mock'lar da collection'la gider; eski workspace'in environment'ı yeni yerde geçersiz olduğundan bırakılır.
        foreach (var mock in await db.MockServers.Where(m => m.CollectionId == collectionId).ToListAsync(ct))
        {
            mock.MoveTo(targetWorkspaceId, now);
        }

        // Yayınlanmış dokümanın environment'ı eski workspace'e ait; seçim temizlenir.
        foreach (var doc in await db.PublishedDocs.Where(d => d.CollectionId == collectionId && d.EnvironmentId != null).ToListAsync(ct))
        {
            doc.ClearEnvironment(now);
        }

        foreach (var monitor in await db.Monitors.Where(m => m.CollectionId == collectionId).ToListAsync(ct))
        {
            monitor.MoveTo(targetWorkspaceId, now);
        }

        await db.SaveChangesAsync(ct);
        return new CollectionTreeDto(collection.Id, collection.WorkspaceId, collection.Name, collection.Description, collection.Auth, collection.Variables, collection.Scripts, [], [], []);
    }

    /// <summary>
    /// Klasörleri (üstten alta), istekleri ve örnekleri hedef collection'a kopyalar. <paramref name="folderMap"/>
    /// önceden kopyalanmış klasörleri (ör. kopyanın kökü) içerir; o klasörler tekrar oluşturulmaz.
    /// </summary>
    private async Task CloneAsync(
        IReadOnlyList<Folder> folders,
        IReadOnlyList<ApiRequest> requests,
        Guid targetCollectionId,
        Dictionary<Guid, Guid> folderMap,
        Guid userId,
        DateTimeOffset now,
        CancellationToken ct)
    {
        var byId = folders.ToDictionary(f => f.Id);

        // Her klasörden önce üst klasörü kopyalanır; böylece yeni üst Id'si hazır olur.
        Guid Ensure(Folder folder)
        {
            if (folderMap.TryGetValue(folder.Id, out var existing))
            {
                return existing;
            }

            Guid? parent = null;
            if (folder.ParentFolderId is { } p)
            {
                parent = folderMap.TryGetValue(p, out var mappedParent) ? mappedParent
                    : byId.TryGetValue(p, out var parentFolder) ? Ensure(parentFolder)
                    : null;
            }

            var clone = Folder.Create(targetCollectionId, parent, folder.Name, folder.SortOrder, now);
            clone.SetAuth(folder.Auth);
            clone.SetScripts(folder.Scripts);
            clone.Describe(folder.Description);
            db.Folders.Add(clone);
            folderMap[folder.Id] = clone.Id;
            return clone.Id;
        }

        foreach (var folder in folders)
        {
            Ensure(folder);
        }

        var requestMap = new Dictionary<Guid, Guid>();
        foreach (var r in requests)
        {
            var folderId = r.FolderId is { } f && folderMap.TryGetValue(f, out var mapped) ? mapped : (Guid?)null;
            var clone = ApiRequest.Create(targetCollectionId, folderId, r.Name, r.Definition, r.SortOrder, userId, now);
            db.Requests.Add(clone);
            requestMap[r.Id] = clone.Id;
        }

        await CopyExamplesAsync(requestMap, now, ct);
    }

    private async Task CopyExamplesAsync(Dictionary<Guid, Guid> requestMap, DateTimeOffset now, CancellationToken ct)
    {
        var ids = requestMap.Keys.ToList();
        var examples = await db.Examples.AsNoTracking().Where(e => ids.Contains(e.RequestId)).ToListAsync(ct);
        foreach (var example in examples)
        {
            db.Examples.Add(example.CopyTo(requestMap[example.RequestId], now));
        }
    }

    private static HashSet<Guid> Subtree(IReadOnlyList<Folder> folders, Guid rootId)
    {
        var result = new HashSet<Guid> { rootId };
        var queue = new Queue<Guid>([rootId]);
        while (queue.TryDequeue(out var id))
        {
            foreach (var child in folders.Where(f => f.ParentFolderId == id))
            {
                if (result.Add(child.Id))
                {
                    queue.Enqueue(child.Id);
                }
            }
        }

        return result;
    }

    private static string CopyName(string name, int maxLength)
    {
        var suffix = L.T("collection.copy_suffix", " (kopya)");
        return (name.Length + suffix.Length > maxLength ? name[..(maxLength - suffix.Length)] : name) + suffix;
    }

    private async Task<(Collection? Collection, Error? Error)> EditableCollectionAsync(Guid collectionId, Guid userId, CancellationToken ct)
    {
        var collection = await db.Collections.FirstOrDefaultAsync(c => c.Id == collectionId, ct);
        if (collection is null)
        {
            return (null, CollectionNotFound);
        }

        var denied = await access.RequireCollectionAsync(collection.Id, userId, WorkspaceRole.Editor, ct);
        return denied is null ? (collection, null) : (null, denied == WorkspaceAccess.NotFound ? CollectionNotFound : denied);
    }

    /// <summary>Hedef collection aynı workspace'te olmalı; başka workspace'e taşıma Faz 3'te.</summary>
    private async Task<(Collection? Collection, Error? Error)> TargetCollectionAsync(Collection source, Guid? targetId, Guid userId, CancellationToken ct)
    {
        if (targetId is null || targetId == source.Id)
        {
            return (source, null);
        }

        var target = await db.Collections.FirstOrDefaultAsync(c => c.Id == targetId && c.WorkspaceId == source.WorkspaceId, ct);
        if (target is null)
        {
            return (null, CollectionNotFound);
        }

        // Taşınan öğe hedef collection'ı da değiştirir; orada da düzenleme yetkisi gerekir.
        var denied = await access.RequireCollectionAsync(target.Id, userId, WorkspaceRole.Editor, ct);
        return denied is null ? (target, null) : (null, denied);
    }

    private static FolderDto ToDto(Folder f) => new(f.Id, f.ParentFolderId, f.Name, f.SortOrder, f.Auth, f.Scripts, f.Description);

    private static ApiRequestDto ToDto(ApiRequest r) =>
        new(r.Id, r.CollectionId, r.FolderId, r.Name, r.Definition, r.Version, r.UpdatedAt);
}
