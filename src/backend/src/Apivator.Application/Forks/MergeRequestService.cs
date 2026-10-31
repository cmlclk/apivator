using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Comments;
using Apivator.Domain.Forks;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Forks;

public interface IMergeRequestService
{
    /// <summary>Fork'taki değişiklikler için istek açar (fork'ta düzenleyici, kaynağı görebilen).</summary>
    Task<Result<MergeRequestDto>> CreateAsync(Guid forkId, CreateMergeRequestBody body, Guid userId, CancellationToken ct = default);

    /// <summary>Workspace'teki (kaynak collection'ları bu workspace'te olan) istekler; <paramref name="status"/> boşsa hepsi.</summary>
    Task<Result<IReadOnlyList<MergeRequestDto>>> ListAsync(Guid workspaceId, MergeRequestStatus? status, Guid userId, CancellationToken ct = default);

    Task<Result<MergeRequestDetailDto>> GetAsync(Guid id, Guid userId, CancellationToken ct = default);

    Task<Result<MergeRequestDto>> EditAsync(Guid id, EditMergeRequestBody body, Guid userId, CancellationToken ct = default);

    /// <summary>Onay verir ya da geri alır (kaynakta düzenleyici; açan kişi kendi isteğini onaylayamaz).</summary>
    Task<Result<MergeRequestDto>> ToggleApprovalAsync(Guid id, Guid userId, CancellationToken ct = default);

    /// <summary>Fork'taki değişiklikleri kaynağa uygular. Çakışma varsa önce fork güncellenmelidir.</summary>
    Task<Result<MergeRequestDto>> MergeAsync(Guid id, Guid userId, CancellationToken ct = default);

    Task<Result<MergeRequestDto>> DeclineAsync(Guid id, Guid userId, CancellationToken ct = default);

    Task<Result<MergeRequestDto>> CloseAsync(Guid id, Guid userId, CancellationToken ct = default);
}

internal sealed class MergeRequestService(
    IApplicationDbContext db,
    IWorkspaceAccess access,
    ForkService forks,
    ForkEngine engine,
    IUserDirectory users,
    IMergeRequestMailer mailer,
    TimeProvider clock) : IMergeRequestService
{
    private const int MaxNotified = 50;

    private static Error NotFound => Error.NotFound("merge_request.not_found", L.T("merge_request.not_found", "Merge isteği bulunamadı."));
    private static Error NotOpen => Error.Conflict("merge_request.closed", L.T("merge_request.closed", "Bu istek artık açık değil."));

    public async Task<Result<MergeRequestDto>> CreateAsync(Guid forkId, CreateMergeRequestBody body, Guid userId, CancellationToken ct = default)
    {
        var (fork, error) = await forks.LoadAsync(forkId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        if (string.IsNullOrWhiteSpace(body.Title))
        {
            return Error.Validation("validation", L.T("merge_request.title_required", "Başlık boş olamaz."));
        }

        if (await db.MergeRequests.AnyAsync(m => m.ForkId == forkId && m.Status == MergeRequestStatus.Open, ct))
        {
            return Error.Conflict("merge_request.exists", L.T("merge_request.exists", "Bu fork için zaten açık bir merge isteği var; yeni değişiklikler ona eklenir."));
        }

        var (source, forkSide, links) = await forks.SidesAsync(fork!, ct);
        if (!ForkEngine.Compare(source, forkSide, links).Any(c => c.ForkChange is not null))
        {
            return Error.Validation("merge_request.empty", L.T("merge_request.no_changes", "Fork'ta kaynağa göre değişiklik yok."));
        }

        var now = clock.GetUtcNow();
        var request = MergeRequest.Create(
            fork!.Id, fork.SourceCollectionId, fork.ForkCollectionId, source.Collection.WorkspaceId, body.Title, body.Description, userId, now);
        db.MergeRequests.Add(request);

        var actor = (await users.DisplayNamesAsync([userId], ct)).GetValueOrDefault(userId, string.Empty);
        var summary = $"{source.Collection.Name} ← {forkSide.Collection.Name}";
        var notified = new List<Guid>();
        foreach (var editor in await EditorsAsync(request.WorkspaceId, request.SourceCollectionId, ct))
        {
            if (editor != userId)
            {
                notified.Add(editor);
                db.Notifications.Add(Notification.ForMergeRequest(
                    editor, NotificationKind.MergeRequestOpened, request.WorkspaceId, request.Id, request.Title, userId, actor, summary, now));
            }
        }

        await db.SaveChangesAsync(ct);
        await EmailAsync(request, notified, MergeRequestEmailKind.Opened, actor, summary, ct);
        return await ToDtoAsync(request, userId, ct);
    }

    public async Task<Result<IReadOnlyList<MergeRequestDto>>> ListAsync(Guid workspaceId, MergeRequestStatus? status, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var requests = await db.MergeRequests.AsNoTracking()
            .Where(m => m.WorkspaceId == workspaceId && (status == null || m.Status == status))
            .OrderByDescending(m => m.UpdatedAt)
            .Take(200)
            .ToListAsync(ct);
        var result = new List<MergeRequestDto>();
        foreach (var request in requests)
        {
            result.Add(await ToDtoAsync(request, userId, ct));
        }

        return result;
    }

    public async Task<Result<MergeRequestDetailDto>> GetAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        var (request, error) = await LoadAsync(id, userId, WorkspaceRole.Viewer, ct);
        if (error is not null)
        {
            return error;
        }

        IReadOnlyList<ForkChangeDto> changes = [];
        var conflicts = 0;
        if (request!.Status == MergeRequestStatus.Open && request.ForkId is { } forkId
            && await db.Forks.AsNoTracking().FirstOrDefaultAsync(f => f.Id == forkId, ct) is { } fork)
        {
            var (source, forkSide, links) = await forks.SidesAsync(fork, ct);
            var all = ForkEngine.Compare(source, forkSide, links).Where(c => c.ForkChange is not null).ToList();
            changes = all.Select(c => c.ToDto()).ToList();
            conflicts = all.Count(c => c.Conflict);
        }

        return new MergeRequestDetailDto(await ToDtoAsync(request, userId, ct), changes, conflicts);
    }

    public async Task<Result<MergeRequestDto>> EditAsync(Guid id, EditMergeRequestBody body, Guid userId, CancellationToken ct = default)
    {
        var (request, error) = await LoadAsync(id, userId, WorkspaceRole.Viewer, ct);
        if (error is not null)
        {
            return error;
        }

        if (request!.AuthorId != userId)
        {
            return WorkspaceAccess.Forbidden;
        }

        if (string.IsNullOrWhiteSpace(body.Title))
        {
            return Error.Validation("validation", L.T("merge_request.title_required", "Başlık boş olamaz."));
        }

        request.Edit(body.Title, body.Description, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return await ToDtoAsync(request, userId, ct);
    }

    public async Task<Result<MergeRequestDto>> ToggleApprovalAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        var (request, error) = await LoadAsync(id, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        if (request!.Status != MergeRequestStatus.Open)
        {
            return NotOpen;
        }

        if (request.AuthorId == userId)
        {
            return Error.Validation("merge_request.own", L.T("merge_request.own", "Kendi isteğinizi onaylayamazsınız."));
        }

        request.ToggleApproval(userId, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return await ToDtoAsync(request, userId, ct);
    }

    public async Task<Result<MergeRequestDto>> MergeAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        var (request, error) = await LoadAsync(id, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        if (request!.Status != MergeRequestStatus.Open)
        {
            return NotOpen;
        }

        var fork = request.ForkId is { } forkId ? await db.Forks.FirstOrDefaultAsync(f => f.Id == forkId, ct) : null;
        if (fork is null)
        {
            return Error.Conflict("merge_request.no_fork", L.T("merge_request.no_fork", "Fork bağı kaldırılmış; istek birleştirilemez."));
        }

        var (source, forkSide, links) = await forks.SidesAsync(fork, ct);
        var now = clock.GetUtcNow();
        var (applied, unresolved) = await engine.ApplyAsync(fork, forkSide, source, links, null, userId, now, ct);
        if (unresolved.Count > 0)
        {
            return Error.Conflict(
                "merge_request.conflicts",
                L.T("merge_request.conflicts", "{count} öğe kaynakta da değişmiş. Fork'un sahibi önce kaynaktaki değişiklikleri fork'a çekip çakışmaları çözmeli.", ("count", unresolved.Count)));
        }

        if (applied.Count == 0)
        {
            return Error.Validation("merge_request.empty", L.T("merge_request.nothing_to_merge", "Birleştirilecek değişiklik kalmamış."));
        }

        request.MarkMerged(applied.Select(c => new MergedChange(c.Kind, c.Name, c.ForkChange!.Value)).ToList(), userId, now);
        var summaryText = L.T("merge_request.merged_summary", "{count} değişiklik birleştirildi", ("count", applied.Count));
        var actorName = await NotifyAuthorAsync(request, NotificationKind.MergeRequestMerged, userId, summaryText, now, ct);
        await db.SaveChangesAsync(ct);
        if (actorName is not null)
        {
            await EmailAsync(request, [request.AuthorId], MergeRequestEmailKind.Merged, actorName, summaryText, ct);
        }

        return await ToDtoAsync(request, userId, ct);
    }

    public async Task<Result<MergeRequestDto>> DeclineAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        var (request, error) = await LoadAsync(id, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        if (request!.Status != MergeRequestStatus.Open)
        {
            return NotOpen;
        }

        var now = clock.GetUtcNow();
        request.Decline(userId, now);
        var declinedBy = await NotifyAuthorAsync(request, NotificationKind.MergeRequestDeclined, userId, L.T("merge_request.declined_summary", "İstek reddedildi"), now, ct);
        await db.SaveChangesAsync(ct);
        if (declinedBy is not null)
        {
            await EmailAsync(request, [request.AuthorId], MergeRequestEmailKind.Declined, declinedBy, string.Empty, ct);
        }

        return await ToDtoAsync(request, userId, ct);
    }

    public async Task<Result<MergeRequestDto>> CloseAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        var (request, error) = await LoadAsync(id, userId, WorkspaceRole.Viewer, ct);
        if (error is not null)
        {
            return error;
        }

        if (request!.AuthorId != userId)
        {
            return WorkspaceAccess.Forbidden;
        }

        if (request.Status != MergeRequestStatus.Open)
        {
            return NotOpen;
        }

        request.Close(userId, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return await ToDtoAsync(request, userId, ct);
    }

    /// <summary>Yazara uygulama içi bildirim ekler; bildirildiyse işlemi yapanın adını döner (e-posta için).</summary>
    private async Task<string?> NotifyAuthorAsync(MergeRequest request, NotificationKind kind, Guid actorId, string preview, DateTimeOffset now, CancellationToken ct)
    {
        if (request.AuthorId == actorId || await access.RoleAsync(request.WorkspaceId, request.AuthorId, ct) is null)
        {
            return null;
        }

        var actor = (await users.DisplayNamesAsync([actorId], ct)).GetValueOrDefault(actorId, string.Empty);
        db.Notifications.Add(Notification.ForMergeRequest(
            request.AuthorId, kind, request.WorkspaceId, request.Id, request.Title, actorId, actor, preview, now));
        return actor;
    }

    /// <summary>Kaydedildikten sonra e-posta (alıcının tercihi kapalıysa mailer göndermez).</summary>
    private async Task EmailAsync(MergeRequest request, List<Guid> recipients, MergeRequestEmailKind kind, string actor, string summary, CancellationToken ct)
    {
        if (recipients.Count == 0)
        {
            return;
        }

        foreach (var user in (await users.UsersAsync(recipients, ct)).Values)
        {
            await mailer.SendAsync(
                new MergeRequestEmail(user.Email, user.DisplayName, kind, actor, request.Title, summary, request.WorkspaceId, request.Id), ct);
        }
    }

    /// <summary>
    /// Kaynak collection'ı düzenleyebilen kişiler: workspace düzenleyicileri ve yöneticileri (doğrudan, takım ya da
    /// organizasyon yöneticiliğiyle) ile collection'da Editor rolü verilenler; collection'da görüntüleyiciye
    /// indirilenler çıkarılır.
    /// </summary>
    private async Task<IReadOnlyList<Guid>> EditorsAsync(Guid workspaceId, Guid collectionId, CancellationToken ct)
    {
        var workspace = await db.Workspaces.AsNoTracking().FirstAsync(w => w.Id == workspaceId, ct);
        var candidates = await db.WorkspaceMembers.AsNoTracking()
            .Where(m => m.WorkspaceId == workspaceId && m.Role >= WorkspaceRole.Editor).Select(m => m.UserId).ToListAsync(ct);
        candidates.AddRange(await (
                from wt in db.WorkspaceTeams.AsNoTracking()
                join tm in db.TeamMembers.AsNoTracking() on wt.TeamId equals tm.TeamId
                where wt.WorkspaceId == workspaceId && wt.Role >= WorkspaceRole.Editor
                select tm.UserId)
            .ToListAsync(ct));
        if (workspace.Type == WorkspaceType.Team)
        {
            candidates.AddRange(await db.OrganizationMembers.AsNoTracking()
                .Where(m => m.OrganizationId == workspace.OrganizationId && m.Role >= OrganizationRole.Admin)
                .Select(m => m.UserId).ToListAsync(ct));
        }

        candidates.AddRange(await db.CollectionAccess.AsNoTracking()
            .Where(e => e.CollectionId == collectionId && e.Role >= WorkspaceRole.Editor && e.UserId != null)
            .Select(e => e.UserId!.Value).ToListAsync(ct));
        candidates.AddRange(await (
                from e in db.CollectionAccess.AsNoTracking()
                join tm in db.TeamMembers.AsNoTracking() on e.TeamId equals tm.TeamId
                where e.CollectionId == collectionId && e.Role >= WorkspaceRole.Editor
                select tm.UserId)
            .ToListAsync(ct));

        var result = new List<Guid>();
        foreach (var id in candidates.Distinct().Take(MaxNotified * 2))
        {
            if (await access.CollectionRoleAsync(collectionId, id, ct) >= WorkspaceRole.Editor)
            {
                result.Add(id);
            }
        }

        return result.Take(MaxNotified).ToList();
    }

    private async Task<(MergeRequest? Request, Error? Error)> LoadAsync(Guid id, Guid userId, WorkspaceRole minimum, CancellationToken ct)
    {
        var request = await db.MergeRequests.FirstOrDefaultAsync(m => m.Id == id, ct);
        if (request is null)
        {
            return (null, NotFound);
        }

        // Onay, birleştirme ve red kaynak collection'ı düzenleme yetkisi ister (collection rolü geçerli).
        var denied = minimum > WorkspaceRole.Viewer
            ? await access.RequireCollectionAsync(request.SourceCollectionId, userId, minimum, ct)
            : await access.RequireAsync(request.WorkspaceId, userId, minimum, ct);
        return denied is null ? (request, null) : (null, denied == WorkspaceAccess.NotFound ? NotFound : denied);
    }

    private async Task<MergeRequestDto> ToDtoAsync(MergeRequest m, Guid userId, CancellationToken ct)
    {
        var people = new[] { m.AuthorId }.Concat(m.Approvals.Select(a => a.UserId)).Concat(m.ClosedById is { } closedBy ? [closedBy] : []).Distinct();
        var names = await users.DisplayNamesAsync(people, ct);
        var sourceName = await db.Collections.AsNoTracking().Where(c => c.Id == m.SourceCollectionId).Select(c => c.Name).FirstOrDefaultAsync(ct) ?? string.Empty;
        var forkCollection = await (
                from c in db.Collections.AsNoTracking()
                join w in db.Workspaces.AsNoTracking() on c.WorkspaceId equals w.Id
                where c.Id == m.ForkCollectionId
                select new { c.Name, WorkspaceName = w.Name })
            .FirstOrDefaultAsync(ct);
        var role = await access.CollectionRoleAsync(m.SourceCollectionId, userId, ct) ?? await access.RoleAsync(m.WorkspaceId, userId, ct);
        var open = m.Status == MergeRequestStatus.Open;
        return new MergeRequestDto(
            m.Id, m.ForkId, m.WorkspaceId, m.SourceCollectionId, sourceName, m.ForkCollectionId, forkCollection?.Name, forkCollection?.WorkspaceName,
            m.Title, m.Description, m.Status, m.AuthorId, names.GetValueOrDefault(m.AuthorId, L.T("comment.deleted_user", "Silinmiş kullanıcı")),
            m.Approvals.Select(a => new MergeApprovalDto(a.UserId, names.GetValueOrDefault(a.UserId, string.Empty), a.At)).ToList(),
            m.MergedChanges, m.CreatedAt, m.UpdatedAt, m.ClosedAt, m.ClosedById is { } closer ? names.GetValueOrDefault(closer) : null,
            CanMerge: open && m.ForkId is not null && role >= WorkspaceRole.Editor,
            CanClose: open && m.AuthorId == userId);
    }
}
