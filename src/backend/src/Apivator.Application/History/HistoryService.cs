using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.History;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.History;

public interface IHistoryService
{
    Task<Result<IReadOnlyList<HistoryEntryDto>>> ListAsync(Guid workspaceId, Guid userId, DateTimeOffset? before, int limit, CancellationToken ct = default);

    /// <summary>Kaydın saklanan yanıt gövdesi (yalnızca kendi kaydı).</summary>
    Task<Result<HistoryResponseDto>> GetResponseAsync(Guid entryId, Guid userId, CancellationToken ct = default);

    Task<Result<HistoryEntryDto>> RecordAsync(Guid workspaceId, RecordHistoryRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> DeleteAsync(Guid entryId, Guid userId, CancellationToken ct = default);

    Task<Result> ClearAsync(Guid workspaceId, Guid userId, CancellationToken ct = default);
}

internal sealed class HistoryService(IApplicationDbContext db, IWorkspaceAccess access, IUserDirectory users, TimeProvider clock) : IHistoryService
{
    public async Task<Result<IReadOnlyList<HistoryEntryDto>>> ListAsync(Guid workspaceId, Guid userId, DateTimeOffset? before, int limit, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var query = db.History.AsNoTracking().Where(h => h.UserId == userId && h.WorkspaceId == workspaceId);
        if (before is { } cursor)
        {
            query = query.Where(h => h.ExecutedAt < cursor);
        }

        var entries = await query
            .OrderByDescending(h => h.ExecutedAt)
            .Take(Math.Clamp(limit, 1, 200))
            .Select(h => new { Entry = h, HasResponse = db.HistoryResponses.Any(r => r.HistoryEntryId == h.Id) })
            .ToListAsync(ct);
        return entries.Select(e => ToDto(e.Entry, e.HasResponse)).ToList();
    }

    public async Task<Result<HistoryResponseDto>> GetResponseAsync(Guid entryId, Guid userId, CancellationToken ct = default)
    {
        var response = await db.HistoryResponses.AsNoTracking()
            .Where(r => r.HistoryEntryId == entryId && db.History.Any(h => h.Id == entryId && h.UserId == userId))
            .Select(r => new HistoryResponseDto(r.Body, r.ContentType, r.Truncated))
            .FirstOrDefaultAsync(ct);
        return response is null
            ? Error.NotFound("history.response_not_found", L.T("history.response_not_found", "Bu kayıt için saklanan yanıt yok."))
            : response;
    }

    public async Task<Result<HistoryEntryDto>> RecordAsync(Guid workspaceId, RecordHistoryRequest request, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        if (request.Definition is null)
        {
            return Error.Validation("validation", L.T("request.definition_required", "İstek tanımı zorunludur."));
        }

        var entry = HistoryEntry.Create(userId, workspaceId, request.RequestId, request.Definition, request.Status, request.TimeMs, request.Size, clock.GetUtcNow());
        db.History.Add(entry);

        // Yanıt gövdesi yalnızca kullanıcı tercihi açıksa saklanır; istemci yanlışlıkla gönderse de yazılmaz.
        var saved = false;
        if (request.Response is { Body: { Length: > 0 } body } response && await users.SavesHistoryResponsesAsync(userId, ct))
        {
            db.HistoryResponses.Add(HistoryResponse.Create(entry.Id, body, response.ContentType, response.Truncated));
            saved = true;
        }

        await db.SaveChangesAsync(ct);

        // Kullanıcı başına en yeni 500 kayıt tutulur.
        var cutoff = await db.History
            .Where(h => h.UserId == userId && h.WorkspaceId == workspaceId)
            .OrderByDescending(h => h.ExecutedAt)
            .Skip(HistoryEntry.MaxEntriesPerUser)
            .Select(h => (DateTimeOffset?)h.ExecutedAt)
            .FirstOrDefaultAsync(ct);
        if (cutoff is { } oldest)
        {
            await db.History
                .Where(h => h.UserId == userId && h.WorkspaceId == workspaceId && h.ExecutedAt <= oldest)
                .ExecuteDeleteAsync(ct);
        }

        return ToDto(entry, saved);
    }

    public async Task<Result> DeleteAsync(Guid entryId, Guid userId, CancellationToken ct = default)
    {
        var deleted = await db.History.Where(h => h.Id == entryId && h.UserId == userId).ExecuteDeleteAsync(ct);
        return deleted == 0 ? Error.NotFound("history.not_found", L.T("history.not_found", "Geçmiş kaydı bulunamadı.")) : Result.Success();
    }

    public async Task<Result> ClearAsync(Guid workspaceId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        await db.History.Where(h => h.UserId == userId && h.WorkspaceId == workspaceId).ExecuteDeleteAsync(ct);
        return Result.Success();
    }

    private static HistoryEntryDto ToDto(HistoryEntry h, bool hasResponse) =>
        new(h.Id, h.RequestId, h.Method, h.Url, h.Definition, h.Status, h.TimeMs, h.Size, h.ExecutedAt, hasResponse);
}
