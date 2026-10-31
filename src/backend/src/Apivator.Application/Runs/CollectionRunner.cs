using System.Runtime.CompilerServices;
using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Runs;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Runs;

public interface ICollectionRunner
{
    /// <summary>Çalıştırmayı doğrular; hata yoksa null döner ve <see cref="RunAsync"/> çağrılabilir.</summary>
    Task<Error?> ValidateAsync(StartRunRequest request, Guid userId, CancellationToken ct = default);

    /// <summary>İstekleri sırayla çalıştırır, her sonucu olay olarak üretir; iptal edilirse rapor "Stopped" kaydedilir.</summary>
    IAsyncEnumerable<RunEvent> RunAsync(StartRunRequest request, Guid userId, CancellationToken ct = default);
}

/// <summary>Sunucuda çalıştırma: collection veritabanından yüklenir, motor çalışır, rapor kaydedilir.</summary>
internal sealed class CollectionRunner(
    IApplicationDbContext db,
    RunSourceLoader loader,
    RunEngine engine,
    IUserDirectory users,
    TimeProvider clock) : ICollectionRunner
{
    public async Task<Error?> ValidateAsync(StartRunRequest request, Guid userId, CancellationToken ct = default) =>
        RunLimits.Validate(request) ?? (await loader.CheckAccessAsync(request.CollectionId, request.FolderId, userId, ct)).Error;

    public IAsyncEnumerable<RunEvent> RunAsync(StartRunRequest request, Guid userId, CancellationToken ct = default) =>
        RunAsync(request, userId, RunOrigin.Server, null, ct);

    /// <summary>Monitörler de aynı yolu kullanır; rapor kaynağıyla (ve monitörüyle) kaydedilir.</summary>
    internal async IAsyncEnumerable<RunEvent> RunAsync(
        StartRunRequest request,
        Guid userId,
        RunOrigin origin,
        Guid? monitorId,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var collection = await db.Collections.AsNoTracking().FirstAsync(c => c.Id == request.CollectionId, ct);
        var source = await loader.LoadAsync(collection, ct);
        var outcome = new RunOutcome();
        CollectionRun? run = null;

        await foreach (var item in engine.RunAsync(source, request, outcome, ct).WithCancellation(CancellationToken.None))
        {
            if (item.Type == "start")
            {
                run = CollectionRun.Create(
                    collection.WorkspaceId, collection.Id, request.FolderId, userId, outcome.Name,
                    request.Variables?.EnvironmentName, outcome.Iterations, request.DelayMs, clock.GetUtcNow(), origin, monitorId);
                yield return item with { RunId = run.Id };
            }
            else
            {
                yield return item;
            }
        }

        run!.Finish(outcome.Status, outcome.Results, clock.GetUtcNow());
        db.Runs.Add(run);
        await db.SaveChangesAsync(CancellationToken.None);

        var names = await users.DisplayNamesAsync([userId], CancellationToken.None);
        yield return new RunEvent("done")
        {
            RunId = run.Id,
            Summary = RunService.ToSummary(run, names.GetValueOrDefault(userId, string.Empty)),
            Variables = outcome.Variables,
            Message = outcome.StopReason,
        };
    }
}

/// <summary>Collection'ı (klasörleri ve istek tanımlarıyla) çalıştırma motorunun beklediği biçimde yükler.</summary>
internal sealed class RunSourceLoader(IApplicationDbContext db, IWorkspaceAccess access)
{
    private static Error CollectionNotFound => Error.NotFound("collection.not_found", L.T("collection.not_found", "Collection bulunamadı."));

    /// <summary>Viewer yetkisi ve (verildiyse) klasörün bu collection'a ait olması.</summary>
    public async Task<Result<Collection>> CheckAccessAsync(Guid collectionId, Guid? folderId, Guid userId, CancellationToken ct)
    {
        var collection = await db.Collections.AsNoTracking().FirstOrDefaultAsync(c => c.Id == collectionId, ct);
        if (collection is null)
        {
            return CollectionNotFound;
        }

        var denied = await access.RequireAsync(collection.WorkspaceId, userId, WorkspaceRole.Viewer, ct);
        if (denied is not null)
        {
            return denied == WorkspaceAccess.NotFound ? CollectionNotFound : denied;
        }

        if (folderId is { } id && !await db.Folders.AnyAsync(f => f.Id == id && f.CollectionId == collection.Id, ct))
        {
            return Error.NotFound("folder.not_found", L.T("folder.not_found", "Klasör bulunamadı."));
        }

        return collection;
    }

    public async Task<RunSourceDto> LoadAsync(Collection collection, CancellationToken ct)
    {
        var folders = await db.Folders.AsNoTracking()
            .Where(f => f.CollectionId == collection.Id)
            .OrderBy(f => f.CreatedAt)
            .Select(f => new RunFolderSource(f.Id, f.ParentFolderId, f.Name, f.SortOrder, f.Auth, f.Scripts))
            .ToListAsync(ct);
        var requests = await db.Requests.AsNoTracking()
            .Where(r => r.CollectionId == collection.Id)
            .OrderBy(r => r.CreatedAt)
            .Select(r => new RunRequestSource(r.Id, r.FolderId, r.Name, r.SortOrder, r.Definition))
            .ToListAsync(ct);
        return new RunSourceDto(collection.Id, collection.Name, collection.Auth, collection.Scripts, collection.Variables, folders, requests);
    }
}
