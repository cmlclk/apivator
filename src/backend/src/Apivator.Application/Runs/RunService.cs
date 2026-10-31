using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Runs;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Runs;

public interface IRunService
{
    Task<Result<IReadOnlyList<RunSummaryDto>>> ListAsync(Guid workspaceId, Guid? collectionId, Guid userId, int limit, CancellationToken ct = default);

    Task<Result<RunDetailDto>> GetAsync(Guid runId, Guid userId, CancellationToken ct = default);

    Task<Result> DeleteAsync(Guid runId, Guid userId, CancellationToken ct = default);

    /// <summary>Masaüstünde yerel çalıştırma için collection'ın tamamı (istek tanımlarıyla).</summary>
    Task<Result<RunSourceDto>> GetSourceAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    /// <summary>Masaüstünde yürütülen çalıştırmanın raporunu kaydeder.</summary>
    Task<Result<RunSummaryDto>> ReportAsync(RunReportRequest request, Guid userId, CancellationToken ct = default);
}

/// <summary>Run raporları workspace üyelerince görülür; silmeyi çalıştıran kişi ya da Editor yapabilir.</summary>
internal sealed class RunService(IApplicationDbContext db, IWorkspaceAccess access, IUserDirectory users, RunSourceLoader loader) : IRunService
{
    private static Error RunNotFound => Error.NotFound("run.not_found", L.T("run.not_found", "Çalıştırma raporu bulunamadı."));

    public async Task<Result<IReadOnlyList<RunSummaryDto>>> ListAsync(Guid workspaceId, Guid? collectionId, Guid userId, int limit, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var query = db.Runs.AsNoTracking().Where(r => r.WorkspaceId == workspaceId);
        if (collectionId is { } id)
        {
            query = query.Where(r => r.CollectionId == id);
        }

        var runs = await query
            .OrderByDescending(r => r.StartedAt)
            .Take(Math.Clamp(limit, 1, 200))
            .Select(r => new
            {
                r.Id,
                r.CollectionId,
                r.FolderId,
                r.Name,
                r.EnvironmentName,
                r.Iterations,
                r.Status,
                r.Origin,
                r.StartedAt,
                r.FinishedAt,
                r.TotalRequests,
                r.FailedRequests,
                r.TestsPassed,
                r.TestsFailed,
                r.TestsSkipped,
                r.TotalTimeMs,
                r.UserId,
            })
            .ToListAsync(ct);
        var names = await users.DisplayNamesAsync(runs.Select(r => r.UserId), ct);

        return runs.Select(r => new RunSummaryDto(
            r.Id, r.CollectionId, r.FolderId, r.Name, r.EnvironmentName, names.GetValueOrDefault(r.UserId, string.Empty), r.Iterations,
            r.Status, r.Origin, r.StartedAt, r.FinishedAt, r.TotalRequests, r.FailedRequests, r.TestsPassed,
            r.TestsFailed, r.TestsSkipped, r.TotalTimeMs)).ToList();
    }

    public async Task<Result<RunDetailDto>> GetAsync(Guid runId, Guid userId, CancellationToken ct = default)
    {
        var run = await db.Runs.AsNoTracking().FirstOrDefaultAsync(r => r.Id == runId, ct);
        if (run is null || await access.RequireAsync(run.WorkspaceId, userId, WorkspaceRole.Viewer, ct) is not null)
        {
            return RunNotFound;
        }

        var names = await users.DisplayNamesAsync([run.UserId], ct);
        return new RunDetailDto(ToSummary(run, names.GetValueOrDefault(run.UserId, string.Empty)), run.DelayMs, run.Results);
    }

    public async Task<Result> DeleteAsync(Guid runId, Guid userId, CancellationToken ct = default)
    {
        var run = await db.Runs.FirstOrDefaultAsync(r => r.Id == runId, ct);
        if (run is null || await access.RequireAsync(run.WorkspaceId, userId, WorkspaceRole.Viewer, ct) is not null)
        {
            return RunNotFound;
        }

        if (run.UserId != userId && await access.RequireAsync(run.WorkspaceId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        db.Runs.Remove(run);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<RunSourceDto>> GetSourceAsync(Guid collectionId, Guid userId, CancellationToken ct = default)
    {
        var checkedAccess = await loader.CheckAccessAsync(collectionId, null, userId, ct);
        return checkedAccess.IsSuccess ? await loader.LoadAsync(checkedAccess.Value, ct) : checkedAccess.Error!;
    }

    public async Task<Result<RunSummaryDto>> ReportAsync(RunReportRequest request, Guid userId, CancellationToken ct = default)
    {
        if (request.Iterations is < 1 or > RunLimits.MaxIterations
            || request.DelayMs is < 0 or > RunLimits.MaxDelayMs
            || request.Results is null
            || request.Results.Count > RunLimits.MaxSteps
            || request.FinishedAt < request.StartedAt)
        {
            return Error.Validation("validation", L.T("run.report_invalid", "Çalıştırma raporu geçersiz."));
        }

        var checkedAccess = await loader.CheckAccessAsync(request.CollectionId, request.FolderId, userId, ct);
        if (!checkedAccess.IsSuccess)
        {
            return checkedAccess.Error!;
        }

        var collection = checkedAccess.Value;
        var name = string.IsNullOrWhiteSpace(request.Name) ? collection.Name : request.Name.Trim();
        var run = CollectionRun.Create(
            collection.WorkspaceId,
            collection.Id,
            request.FolderId,
            userId,
            name.Length > 250 ? name[..250] : name,
            request.EnvironmentName is { Length: > 120 } env ? env[..120] : request.EnvironmentName,
            request.Iterations,
            request.DelayMs,
            request.StartedAt,
            // Sunucuda yürütülmüş gibi gösterilemez: rapor ya masaüstünden ya da CLI'dan gelir.
            request.Origin == RunOrigin.Cli ? RunOrigin.Cli : RunOrigin.Desktop);
        run.Finish(request.Status, request.Results, request.FinishedAt);
        db.Runs.Add(run);
        await db.SaveChangesAsync(ct);

        var names = await users.DisplayNamesAsync([userId], ct);
        return ToSummary(run, names.GetValueOrDefault(userId, string.Empty));
    }

    internal static RunSummaryDto ToSummary(CollectionRun r, string userName) => new(
        r.Id, r.CollectionId, r.FolderId, r.Name, r.EnvironmentName, userName, r.Iterations, r.Status, r.Origin, r.StartedAt, r.FinishedAt,
        r.TotalRequests, r.FailedRequests, r.TestsPassed, r.TestsFailed, r.TestsSkipped, r.TotalTimeMs);
}
