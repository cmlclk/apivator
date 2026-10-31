using Apivator.Application.Abstractions;
using Apivator.Application.Collections;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Environments;
using Apivator.Application.Workspaces;
using Apivator.Domain.Activity;
using Apivator.Domain.Collections;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Activity;

public sealed record ActivityDto(
    Guid Id,
    ChangeTarget TargetType,
    Guid TargetId,
    Guid? CollectionId,
    string TargetName,
    ChangeAction Action,
    string? Detail,
    Guid? UserId,
    string UserName,
    int? Version,
    DateTimeOffset CreatedAt,
    /// <summary>Silinen istek geri getirilebilir mi (anlık görüntüsü var).</summary>
    bool Restorable);

public sealed record ActivityPage(IReadOnlyList<ActivityDto> Items, DateTimeOffset? NextBefore);

public sealed record VersionDto<TSnapshot>(
    Guid Id,
    ChangeAction Action,
    string? Detail,
    Guid? UserId,
    string UserName,
    int? Version,
    DateTimeOffset CreatedAt,
    TSnapshot? Snapshot)
    where TSnapshot : class;

/// <summary><paramref name="Version"/> şu anki sürümdür; arada başkası kaydettiyse 409 döner.</summary>
public sealed record RestoreVersionRequest(Guid ChangeId, int Version);

public interface IActivityService
{
    Task<Result<ActivityPage>> FeedAsync(Guid workspaceId, DateTimeOffset? before, int limit, Guid userId, CancellationToken ct = default);

    Task<Result<IReadOnlyList<VersionDto<RequestSnapshot>>>> RequestHistoryAsync(Guid requestId, Guid userId, CancellationToken ct = default);

    Task<Result<ApiRequestDto>> RestoreRequestAsync(Guid requestId, RestoreVersionRequest request, Guid userId, CancellationToken ct = default);

    /// <summary>Silinmiş bir isteği son hâliyle geri getirir (collection'ı duruyorsa).</summary>
    Task<Result<ApiRequestDto>> RestoreDeletedRequestAsync(Guid changeId, Guid userId, CancellationToken ct = default);

    Task<Result<IReadOnlyList<VersionDto<EnvironmentSnapshot>>>> EnvironmentHistoryAsync(Guid environmentId, Guid userId, CancellationToken ct = default);

    Task<Result<EnvironmentDto>> RestoreEnvironmentAsync(Guid environmentId, RestoreVersionRequest request, Guid userId, CancellationToken ct = default);
}

internal sealed class ActivityService(IApplicationDbContext db, IWorkspaceAccess access, ChangeLogScope scope, TimeProvider clock) : IActivityService
{
    private const int HistoryLimit = ChangeLogEntry.MaxSnapshotsPerTarget;

    private static Error RequestNotFound => Error.NotFound("request.not_found", L.T("request.not_found", "İstek bulunamadı."));
    private static Error EnvironmentNotFound => Error.NotFound("environment.not_found", L.T("environment.not_found", "Environment bulunamadı."));
    private static Error VersionNotFound => Error.NotFound("change.not_found", L.T("change.not_found", "Bu sürüm bulunamadı (çok eski sürümler saklanmaz)."));
    private static Error Stale => Error.Conflict("version.conflict", L.T("version.conflict", "Bu kayıt siz bakarken değişti. Sayfayı yenileyip tekrar deneyin."));

    public async Task<Result<ActivityPage>> FeedAsync(Guid workspaceId, DateTimeOffset? before, int limit, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        limit = Math.Clamp(limit, 1, 100);
        var rows = await db.ChangeLog.AsNoTracking()
            .Where(e => e.WorkspaceId == workspaceId && !e.Quiet && (before == null || e.CreatedAt < before))
            .OrderByDescending(e => e.CreatedAt)
            .Take(limit + 1)
            .Select(e => new ActivityDto(
                e.Id, e.TargetType, e.TargetId, e.CollectionId, e.TargetName, e.Action, e.Detail, e.UserId, e.UserName, e.Version, e.CreatedAt,
                e.TargetType == ChangeTarget.Request && e.Action == ChangeAction.Deleted && e.Snapshot != null))
            .ToListAsync(ct);

        var more = rows.Count > limit;
        var items = more ? rows[..limit] : rows;
        return new ActivityPage(items, more ? items[^1].CreatedAt : null);
    }

    public async Task<Result<IReadOnlyList<VersionDto<RequestSnapshot>>>> RequestHistoryAsync(Guid requestId, Guid userId, CancellationToken ct = default)
    {
        var (request, error) = await RequestAsync(requestId, userId, WorkspaceRole.Viewer, ct);
        if (error is not null)
        {
            return error;
        }

        return Result<IReadOnlyList<VersionDto<RequestSnapshot>>>.Success(await HistoryAsync<RequestSnapshot>(request!.Id, ct));
    }

    public async Task<Result<ApiRequestDto>> RestoreRequestAsync(Guid requestId, RestoreVersionRequest body, Guid userId, CancellationToken ct = default)
    {
        var (request, error) = await RequestAsync(requestId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        var entry = await db.ChangeLog.AsNoTracking().FirstOrDefaultAsync(e => e.Id == body.ChangeId && e.TargetId == requestId, ct);
        if (Snapshots.Read<RequestSnapshot>(entry?.Snapshot) is not { } snapshot)
        {
            return VersionNotFound;
        }

        if (request!.Version != body.Version)
        {
            return Stale;
        }

        scope.Restoring = true;
        scope.RestoredFromVersion = entry!.Version;
        request.Update(snapshot.Name, snapshot.Definition, userId, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return ToDto(request);
    }

    public async Task<Result<ApiRequestDto>> RestoreDeletedRequestAsync(Guid changeId, Guid userId, CancellationToken ct = default)
    {
        var entry = await db.ChangeLog.AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == changeId && e.TargetType == ChangeTarget.Request && e.Action == ChangeAction.Deleted, ct);
        if (entry is null || await access.RoleAsync(entry.WorkspaceId, userId, ct) is null)
        {
            return VersionNotFound;
        }

        if (Snapshots.Read<RequestSnapshot>(entry.Snapshot) is not { } snapshot)
        {
            return VersionNotFound;
        }

        var collection = await db.Collections.FirstOrDefaultAsync(c => c.Id == snapshot.CollectionId, ct);
        if (collection is null)
        {
            return Error.NotFound("collection.not_found", L.T("activity.restore_collection_deleted", "İsteğin bulunduğu collection da silinmiş; istek geri getirilemez."));
        }

        if (await access.RequireCollectionAsync(collection.Id, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        if (await db.Requests.AnyAsync(r => r.Id == entry.TargetId, ct))
        {
            return Error.Conflict("request.exists", L.T("request.exists", "Bu istek zaten geri getirilmiş."));
        }

        // Klasör de silindiyse collection'ın köküne konur.
        var folderId = snapshot.FolderId is { } f && await db.Folders.AnyAsync(x => x.Id == f && x.CollectionId == collection.Id, ct) ? f : (Guid?)null;
        var sortOrder = (await db.Requests.Where(r => r.CollectionId == collection.Id && r.FolderId == folderId).MaxAsync(r => (int?)r.SortOrder, ct) ?? -1) + 1;

        scope.Restoring = true;
        scope.RestoredFromVersion = entry.Version;
        var restored = ApiRequest.Create(collection.Id, folderId, snapshot.Name, snapshot.Definition, sortOrder, userId, clock.GetUtcNow());
        restored.Restore(entry.TargetId);
        db.Requests.Add(restored);
        await db.SaveChangesAsync(ct);
        return ToDto(restored);
    }

    public async Task<Result<IReadOnlyList<VersionDto<EnvironmentSnapshot>>>> EnvironmentHistoryAsync(Guid environmentId, Guid userId, CancellationToken ct = default)
    {
        var environment = await db.Environments.AsNoTracking().FirstOrDefaultAsync(e => e.Id == environmentId, ct);
        if (environment is null || await access.RoleAsync(environment.WorkspaceId, userId, ct) is null)
        {
            return EnvironmentNotFound;
        }

        return Result<IReadOnlyList<VersionDto<EnvironmentSnapshot>>>.Success(await HistoryAsync<EnvironmentSnapshot>(environmentId, ct));
    }

    public async Task<Result<EnvironmentDto>> RestoreEnvironmentAsync(Guid environmentId, RestoreVersionRequest body, Guid userId, CancellationToken ct = default)
    {
        var environment = await db.Environments.FirstOrDefaultAsync(e => e.Id == environmentId, ct);
        if (environment is null)
        {
            return EnvironmentNotFound;
        }

        if (await access.RequireAsync(environment.WorkspaceId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied == WorkspaceAccess.NotFound ? EnvironmentNotFound : denied;
        }

        var entry = await db.ChangeLog.AsNoTracking().FirstOrDefaultAsync(e => e.Id == body.ChangeId && e.TargetId == environmentId, ct);
        if (Snapshots.Read<EnvironmentSnapshot>(entry?.Snapshot) is not { } snapshot)
        {
            return VersionNotFound;
        }

        if (environment.Version != body.Version)
        {
            return Stale;
        }

        scope.Restoring = true;
        scope.RestoredFromVersion = entry!.Version;
        environment.Update(snapshot.Name, snapshot.Variables, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return new EnvironmentDto(environment.Id, environment.WorkspaceId, environment.Name, environment.Variables, environment.Version, environment.UpdatedAt);
    }

    private async Task<List<VersionDto<T>>> HistoryAsync<T>(Guid targetId, CancellationToken ct)
        where T : class
    {
        var rows = await db.ChangeLog.AsNoTracking()
            .Where(e => e.TargetId == targetId)
            .OrderByDescending(e => e.CreatedAt)
            .Take(HistoryLimit)
            .ToListAsync(ct);
        return rows
            .Select(e => new VersionDto<T>(e.Id, e.Action, e.Detail, e.UserId, e.UserName, e.Version, e.CreatedAt, Snapshots.Read<T>(e.Snapshot)))
            .ToList();
    }

    private async Task<(ApiRequest? Request, Error? Error)> RequestAsync(Guid requestId, Guid userId, WorkspaceRole minimum, CancellationToken ct)
    {
        var request = await db.Requests.FirstOrDefaultAsync(r => r.Id == requestId, ct);
        if (request is null)
        {
            return (null, RequestNotFound);
        }

        return await access.RequireCollectionAsync(request.CollectionId, userId, minimum, ct) switch
        {
            null => (request, null),
            var denied when denied == WorkspaceAccess.NotFound => (null, RequestNotFound),
            var denied => (null, denied),
        };
    }

    private static ApiRequestDto ToDto(ApiRequest r) => new(r.Id, r.CollectionId, r.FolderId, r.Name, r.Definition, r.Version, r.UpdatedAt);
}
