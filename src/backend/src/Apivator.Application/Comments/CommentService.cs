using System.Text.RegularExpressions;
using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Comments;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Comments;

public sealed record CommentDto(
    Guid Id,
    Guid? ParentId,
    string Body,
    Guid AuthorId,
    string AuthorName,
    DateTimeOffset CreatedAt,
    DateTimeOffset? EditedAt,
    DateTimeOffset? ResolvedAt,
    string? ResolvedByName,
    bool CanEdit,
    bool CanDelete);

public sealed record CreateCommentRequest(CommentTarget TargetType, Guid TargetId, string Body, Guid? ParentId = null);

public sealed record EditCommentRequest(string Body);

public sealed record ResolveCommentRequest(bool Resolved);

/// <summary>Bahsetme listesinde gösterilen kişi (workspace'e erişimi olanlar).</summary>
public sealed record PersonDto(Guid UserId, string DisplayName, string Email);

/// <summary>Çözülmemiş başlıklardaki yorum sayısı (hedef başına).</summary>
public sealed record CommentCountDto(CommentTarget TargetType, Guid TargetId, int Open);

public sealed record NotificationDto(
    Guid Id,
    NotificationKind Kind,
    Guid WorkspaceId,
    Guid? CommentId,
    CommentTarget TargetType,
    Guid TargetId,
    string TargetName,
    string ActorName,
    string Preview,
    DateTimeOffset CreatedAt,
    bool Read);

public sealed record NotificationsDto(IReadOnlyList<NotificationDto> Items, int Unread);

public sealed record MarkNotificationsReadRequest(IReadOnlyList<Guid>? Ids);

public interface ICommentService
{
    Task<Result<IReadOnlyList<CommentDto>>> ListAsync(CommentTarget targetType, Guid targetId, Guid userId, CancellationToken ct = default);

    Task<Result<CommentDto>> CreateAsync(CreateCommentRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<CommentDto>> EditAsync(Guid commentId, EditCommentRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> DeleteAsync(Guid commentId, Guid userId, CancellationToken ct = default);

    Task<Result> ResolveAsync(Guid commentId, ResolveCommentRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<IReadOnlyList<CommentCountDto>>> CountsAsync(Guid workspaceId, Guid userId, CancellationToken ct = default);

    Task<Result<IReadOnlyList<PersonDto>>> PeopleAsync(Guid workspaceId, Guid userId, CancellationToken ct = default);

    Task<NotificationsDto> NotificationsAsync(Guid userId, CancellationToken ct = default);

    Task MarkReadAsync(MarkNotificationsReadRequest request, Guid userId, CancellationToken ct = default);
}

internal sealed partial class CommentService(
    IApplicationDbContext db,
    IWorkspaceAccess access,
    IUserDirectory users,
    IMentionMailer mailer,
    TimeProvider clock) : ICommentService
{
    private const int NotificationLimit = 50;

    private static Error TargetNotFound => Error.NotFound("comment.target_not_found", L.T("comment.target_not_found", "Yorum yapılacak kayıt bulunamadı."));
    private static Error CommentNotFound => Error.NotFound("comment.not_found", L.T("comment.not_found", "Yorum bulunamadı."));

    /// <summary>Bahsetme biçimi: <c>@[Ayşe Yılmaz](0193…)</c>.</summary>
    [GeneratedRegex(@"@\[(?<name>[^\]\r\n]{1,100})\]\((?<id>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)")]
    private static partial Regex MentionPattern();

    public static IReadOnlySet<Guid> Mentions(string body) =>
        MentionPattern().Matches(body).Select(m => Guid.Parse(m.Groups["id"].Value)).ToHashSet();

    /// <summary>Bildirim ve e-posta önizlemesi: bahsetmeler yalnızca adla gösterilir.</summary>
    public static string Plain(string body) =>
        MentionPattern().Replace(body, m => "@" + m.Groups["name"].Value).ReplaceLineEndings(" ");

    public async Task<Result<IReadOnlyList<CommentDto>>> ListAsync(CommentTarget targetType, Guid targetId, Guid userId, CancellationToken ct = default)
    {
        var target = await TargetAsync(targetType, targetId, ct);
        if (target is null || await access.RoleAsync(target.Value.WorkspaceId, userId, ct) is not { } role)
        {
            return TargetNotFound;
        }

        var comments = await db.Comments.AsNoTracking()
            .Where(c => c.TargetId == targetId)
            .OrderBy(c => c.CreatedAt)
            .ToListAsync(ct);
        var names = await users.UsersAsync(comments.Select(c => c.AuthorId).Concat(comments.Where(c => c.ResolvedById != null).Select(c => c.ResolvedById!.Value)), ct);
        return comments.Select(c => ToDto(c, names, userId, role)).ToList();
    }

    public async Task<Result<CommentDto>> CreateAsync(CreateCommentRequest request, Guid userId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.Body))
        {
            return Error.Validation("validation", L.T("comment.empty", "Yorum boş olamaz."));
        }

        if (request.Body.Length > Comment.BodyMaxLength)
        {
            return Error.Validation("validation", L.T("comment.max_length", "Yorum en fazla {max:N0} karakter olabilir.", ("max", Comment.BodyMaxLength)));
        }

        var target = await TargetAsync(request.TargetType, request.TargetId, ct);
        // Görüntüleyiciler de yorum yazabilir: yorum, kayıtları değiştirmez.
        if (target is null || await access.RoleAsync(target.Value.WorkspaceId, userId, ct) is not { } role)
        {
            return TargetNotFound;
        }

        Comment? root = null;
        if (request.ParentId is { } parentId)
        {
            root = await db.Comments.FirstOrDefaultAsync(c => c.Id == parentId && c.TargetId == request.TargetId, ct);
            if (root is null)
            {
                return CommentNotFound;
            }

            // Tek seviye: yanıta yanıt, başlığın köküne bağlanır.
            if (root.ParentId is { } rootId)
            {
                root = await db.Comments.FirstAsync(c => c.Id == rootId, ct);
            }

            if (root.ResolvedAt is not null)
            {
                // Çözülmüş başlığa yanıt onu yeniden açar.
                root.SetResolved(false, userId, clock.GetUtcNow());
            }
        }

        var now = clock.GetUtcNow();
        var comment = Comment.Create(target.Value.WorkspaceId, request.TargetType, request.TargetId, root?.Id, request.Body, userId, now);
        db.Comments.Add(comment);
        await NotifyAsync(comment, root, target.Value.Name, Mentions(comment.Body), userId, ct);
        await db.SaveChangesAsync(ct);

        var names = await users.UsersAsync([userId], ct);
        return ToDto(comment, names, userId, role);
    }

    public async Task<Result<CommentDto>> EditAsync(Guid commentId, EditCommentRequest request, Guid userId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.Body) || request.Body.Length > Comment.BodyMaxLength)
        {
            return Error.Validation("validation", L.T("comment.length_range", "Yorum 1–{max:N0} karakter olmalı.", ("max", Comment.BodyMaxLength)));
        }

        var comment = await db.Comments.FirstOrDefaultAsync(c => c.Id == commentId, ct);
        if (comment is null || await access.RoleAsync(comment.WorkspaceId, userId, ct) is not { } role)
        {
            return CommentNotFound;
        }

        if (comment.AuthorId != userId)
        {
            return Error.Forbidden("comment.forbidden", L.T("comment.edit_forbidden", "Yalnızca kendi yorumunuzu düzenleyebilirsiniz."));
        }

        var before = Mentions(comment.Body);
        comment.Edit(request.Body, clock.GetUtcNow());
        var added = Mentions(comment.Body).Except(before).ToHashSet();
        if (added.Count > 0 && await TargetAsync(comment.TargetType, comment.TargetId, ct) is { } target)
        {
            await NotifyAsync(comment, root: null, target.Name, added, userId, ct);
        }

        await db.SaveChangesAsync(ct);
        var names = await users.UsersAsync([comment.AuthorId, .. comment.ResolvedById is { } r ? new[] { r } : []], ct);
        return ToDto(comment, names, userId, role);
    }

    public async Task<Result> DeleteAsync(Guid commentId, Guid userId, CancellationToken ct = default)
    {
        var comment = await db.Comments.FirstOrDefaultAsync(c => c.Id == commentId, ct);
        if (comment is null || await access.RoleAsync(comment.WorkspaceId, userId, ct) is not { } role)
        {
            return CommentNotFound;
        }

        if (comment.AuthorId != userId && role != WorkspaceRole.Admin)
        {
            return Error.Forbidden("comment.forbidden", L.T("comment.delete_forbidden", "Başkasının yorumunu yalnızca workspace yöneticisi silebilir."));
        }

        // Kök silinirse yanıtları da gider (veritabanında cascade).
        db.Comments.Remove(comment);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result> ResolveAsync(Guid commentId, ResolveCommentRequest request, Guid userId, CancellationToken ct = default)
    {
        var comment = await db.Comments.FirstOrDefaultAsync(c => c.Id == commentId, ct);
        if (comment is null || await access.RoleAsync(comment.WorkspaceId, userId, ct) is not { } role)
        {
            return CommentNotFound;
        }

        if (comment.ParentId is not null)
        {
            return Error.Validation("comment.not_thread", L.T("comment.not_thread", "Yalnızca başlığın ilk yorumu çözüldü olarak işaretlenebilir."));
        }

        if (comment.AuthorId != userId && role == WorkspaceRole.Viewer)
        {
            return WorkspaceAccess.Forbidden;
        }

        comment.SetResolved(request.Resolved, userId, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<IReadOnlyList<CommentCountDto>>> CountsAsync(Guid workspaceId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var rows = await db.Comments.AsNoTracking()
            .Where(c => c.WorkspaceId == workspaceId)
            .Select(c => new { c.Id, c.ParentId, c.TargetType, c.TargetId, Resolved = c.ResolvedAt != null })
            .ToListAsync(ct);
        var resolvedRoots = rows.Where(r => r.ParentId == null && r.Resolved).Select(r => r.Id).ToHashSet();
        return rows
            .Where(r => !resolvedRoots.Contains(r.ParentId ?? r.Id))
            .GroupBy(r => (r.TargetType, r.TargetId))
            .Select(g => new CommentCountDto(g.Key.TargetType, g.Key.TargetId, g.Count()))
            .ToList();
    }

    public async Task<Result<IReadOnlyList<PersonDto>>> PeopleAsync(Guid workspaceId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var organizationId = await db.Workspaces.Where(w => w.Id == workspaceId).Select(w => w.OrganizationId).FirstAsync(ct);
        var memberIds = await db.OrganizationMembers.AsNoTracking()
            .Where(m => m.OrganizationId == organizationId)
            .Select(m => m.UserId)
            .ToListAsync(ct);

        var people = new List<Guid>();
        foreach (var id in memberIds)
        {
            if (await access.RoleAsync(workspaceId, id, ct) is not null)
            {
                people.Add(id);
            }
        }

        var names = await users.UsersAsync(people, ct);
        return names.Values
            .Select(u => new PersonDto(u.Id, u.DisplayName, u.Email))
            .OrderBy(p => p.DisplayName, StringComparer.CurrentCulture)
            .ToList();
    }

    public async Task<NotificationsDto> NotificationsAsync(Guid userId, CancellationToken ct = default)
    {
        var visible = (await EffectiveRoles.ForUserAsync(db, userId, null, ct)).Keys.ToList();
        var query = db.Notifications.AsNoTracking().Where(n => n.UserId == userId && visible.Contains(n.WorkspaceId));
        var items = await query
            .OrderByDescending(n => n.CreatedAt)
            .Take(NotificationLimit)
            .Select(n => new NotificationDto(
                n.Id, n.Kind, n.WorkspaceId, n.CommentId, n.TargetType, n.TargetId, n.TargetName, n.ActorName, n.Preview, n.CreatedAt, n.ReadAt != null))
            .ToListAsync(ct);
        var unread = await query.CountAsync(n => n.ReadAt == null, ct);
        return new NotificationsDto(items, unread);
    }

    public async Task MarkReadAsync(MarkNotificationsReadRequest request, Guid userId, CancellationToken ct = default)
    {
        var ids = request.Ids;
        var unread = await db.Notifications
            .Where(n => n.UserId == userId && n.ReadAt == null && (ids == null || ids.Contains(n.Id)))
            .ToListAsync(ct);
        var now = clock.GetUtcNow();
        foreach (var n in unread)
        {
            n.MarkRead(now);
        }

        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Bahsedilenlere (erişimi varsa) bahsetme bildirimi ve e-posta; yanıtta başlığa katılmış diğerlerine yanıt
    /// bildirimi. Yazan kişi kendine bildirim almaz.
    /// </summary>
    private async Task NotifyAsync(Comment comment, Comment? root, string targetName, IReadOnlySet<Guid> mentioned, Guid actorId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var preview = Plain(comment.Body);
        var actor = (await users.UsersAsync([actorId], ct)).GetValueOrDefault(actorId)?.DisplayName ?? L.T("comment.someone", "Biri");

        var mentionTargets = new List<Guid>();
        foreach (var id in mentioned.Where(id => id != actorId))
        {
            if (await access.RoleAsync(comment.WorkspaceId, id, ct) is not null)
            {
                mentionTargets.Add(id);
                db.Notifications.Add(Notification.Create(id, NotificationKind.Mention, comment, targetName, actor, preview, now));
            }
        }

        if (root is not null)
        {
            var participants = await db.Comments.AsNoTracking()
                .Where(c => c.Id == root.Id || c.ParentId == root.Id)
                .Select(c => c.AuthorId)
                .Distinct()
                .ToListAsync(ct);
            foreach (var id in participants.Where(id => id != actorId && !mentionTargets.Contains(id)))
            {
                if (await access.RoleAsync(comment.WorkspaceId, id, ct) is not null)
                {
                    db.Notifications.Add(Notification.Create(id, NotificationKind.Reply, comment, targetName, actor, preview, now));
                }
            }
        }

        if (mentionTargets.Count > 0)
        {
            foreach (var user in (await users.UsersAsync(mentionTargets, ct)).Values)
            {
                await mailer.SendAsync(
                    new MentionEmail(user.Email, user.DisplayName, actor, targetName, comment.WorkspaceId, comment.TargetType, comment.TargetId,
                        preview.Length > 300 ? preview[..300] + "…" : preview),
                    ct);
            }
        }
    }

    private async Task<(Guid WorkspaceId, string Name)?> TargetAsync(CommentTarget type, Guid id, CancellationToken ct)
    {
        if (type == CommentTarget.MergeRequest)
        {
            var mergeRequest = await db.MergeRequests.AsNoTracking().Where(m => m.Id == id).Select(m => new { m.WorkspaceId, m.Title }).FirstOrDefaultAsync(ct);
            return mergeRequest is null ? null : (mergeRequest.WorkspaceId, mergeRequest.Title);
        }

        if (type == CommentTarget.Collection)
        {
            var collection = await db.Collections.AsNoTracking().Where(c => c.Id == id).Select(c => new { c.WorkspaceId, c.Name }).FirstOrDefaultAsync(ct);
            return collection is null ? null : (collection.WorkspaceId, collection.Name);
        }

        var request = await (
            from r in db.Requests.AsNoTracking()
            join c in db.Collections.AsNoTracking() on r.CollectionId equals c.Id
            where r.Id == id
            select new { c.WorkspaceId, r.Name }).FirstOrDefaultAsync(ct);
        return request is null ? null : (request.WorkspaceId, request.Name);
    }

    private static CommentDto ToDto(Comment c, IReadOnlyDictionary<Guid, UserSummary> names, Guid userId, WorkspaceRole role) => new(
        c.Id,
        c.ParentId,
        c.Body,
        c.AuthorId,
        names.GetValueOrDefault(c.AuthorId)?.DisplayName ?? L.T("comment.deleted_user", "Silinmiş kullanıcı"),
        c.CreatedAt,
        c.EditedAt,
        c.ResolvedAt,
        c.ResolvedById is { } r ? names.GetValueOrDefault(r)?.DisplayName : null,
        CanEdit: c.AuthorId == userId,
        CanDelete: c.AuthorId == userId || role == WorkspaceRole.Admin);
}
