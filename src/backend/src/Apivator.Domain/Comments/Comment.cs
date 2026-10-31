using System.Text.Json.Serialization;
using Apivator.Domain.Common;

namespace Apivator.Domain.Comments;

[JsonConverter(typeof(JsonStringEnumConverter<CommentTarget>))]
public enum CommentTarget
{
    Request,
    Collection,
    MergeRequest,
}

/// <summary>
/// İstek ya da collection üzerinde yorum. Tek seviye yanıt (ParentId) desteklenir; kök yorum "çözüldü" olarak
/// işaretlenebilir. Bahsetmeler gövdede <c>@[Ad](kullanıcı-id)</c> biçiminde saklanır.
/// </summary>
public sealed class Comment : Entity
{
    public const int BodyMaxLength = 4000;

    private Comment()
    {
        Body = string.Empty;
    }

    public Guid WorkspaceId { get; private set; }

    public CommentTarget TargetType { get; private set; }

    public Guid TargetId { get; private set; }

    public Guid? ParentId { get; private set; }

    public string Body { get; private set; }

    public Guid AuthorId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? EditedAt { get; private set; }

    public DateTimeOffset? ResolvedAt { get; private set; }

    public Guid? ResolvedById { get; private set; }

    public static Comment Create(Guid workspaceId, CommentTarget targetType, Guid targetId, Guid? parentId, string body, Guid authorId, DateTimeOffset now) => new()
    {
        WorkspaceId = workspaceId,
        TargetType = targetType,
        TargetId = targetId,
        ParentId = parentId,
        Body = Clean(body),
        AuthorId = authorId,
        CreatedAt = now,
    };

    public void Edit(string body, DateTimeOffset now)
    {
        Body = Clean(body);
        EditedAt = now;
    }

    public void SetResolved(bool resolved, Guid userId, DateTimeOffset now)
    {
        ResolvedAt = resolved ? now : null;
        ResolvedById = resolved ? userId : null;
    }

    private static string Clean(string body)
    {
        var trimmed = body?.Trim() ?? string.Empty;
        if (trimmed.Length == 0)
        {
            throw new ArgumentException("Yorum boş olamaz.", nameof(body));
        }

        return trimmed.Length > BodyMaxLength ? trimmed[..BodyMaxLength] : trimmed;
    }
}

[JsonConverter(typeof(JsonStringEnumConverter<NotificationKind>))]
public enum NotificationKind
{
    /// <summary>Bir yorumda sizden bahsedildi.</summary>
    Mention,

    /// <summary>Başlattığınız ya da yanıt verdiğiniz bir yoruma yanıt geldi.</summary>
    Reply,

    /// <summary>Düzenleyicisi olduğunuz bir collection'a merge isteği açıldı.</summary>
    MergeRequestOpened,

    /// <summary>Açtığınız merge isteği birleştirildi.</summary>
    MergeRequestMerged,

    /// <summary>Açtığınız merge isteği reddedildi.</summary>
    MergeRequestDeclined,

    /// <summary>Kaynak adresinden içe aktarılan collection'ın belgesi değişti (otomatik kontrol).</summary>
    SourceChanged,
}

/// <summary>Kişiye özel bildirim (uygulama içi; bahsetmelerde ayrıca e-posta gider).</summary>
public sealed class Notification : Entity
{
    public const int PreviewMaxLength = 200;

    private Notification()
    {
        TargetName = string.Empty;
        ActorName = string.Empty;
        Preview = string.Empty;
    }

    public Guid UserId { get; private set; }

    public NotificationKind Kind { get; private set; }

    public Guid WorkspaceId { get; private set; }

    /// <summary>Yorum bildirimlerinde yorum; merge isteği bildirimlerinde boş.</summary>
    public Guid? CommentId { get; private set; }

    public CommentTarget TargetType { get; private set; }

    public Guid TargetId { get; private set; }

    public string TargetName { get; private set; }

    public Guid ActorId { get; private set; }

    public string ActorName { get; private set; }

    public string Preview { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset? ReadAt { get; private set; }

    public static Notification Create(
        Guid userId,
        NotificationKind kind,
        Comment comment,
        string targetName,
        string actorName,
        string preview,
        DateTimeOffset now) => new()
        {
            UserId = userId,
            Kind = kind,
            WorkspaceId = comment.WorkspaceId,
            CommentId = comment.Id,
            TargetType = comment.TargetType,
            TargetId = comment.TargetId,
            TargetName = targetName.Length > 200 ? targetName[..200] : targetName,
            ActorId = comment.AuthorId,
            ActorName = actorName.Length > 200 ? actorName[..200] : actorName,
            Preview = preview.Length > PreviewMaxLength ? preview[..(PreviewMaxLength - 1)] + "…" : preview,
            CreatedAt = now,
        };

    /// <summary>Merge isteği olayı (açıldı, birleştirildi, reddedildi).</summary>
    public static Notification ForMergeRequest(
        Guid userId,
        NotificationKind kind,
        Guid workspaceId,
        Guid mergeRequestId,
        string title,
        Guid actorId,
        string actorName,
        string preview,
        DateTimeOffset now) => new()
        {
            UserId = userId,
            Kind = kind,
            WorkspaceId = workspaceId,
            TargetType = CommentTarget.MergeRequest,
            TargetId = mergeRequestId,
            TargetName = title.Length > 200 ? title[..200] : title,
            ActorId = actorId,
            ActorName = actorName.Length > 200 ? actorName[..200] : actorName,
            Preview = preview.Length > PreviewMaxLength ? preview[..(PreviewMaxLength - 1)] + "…" : preview,
            CreatedAt = now,
        };

    /// <summary>Kaynak belgede değişiklik bulundu; tıklanınca collection açılır.</summary>
    public static Notification ForSourceChange(
        Guid userId,
        Guid workspaceId,
        Guid collectionId,
        string collectionName,
        string preview,
        DateTimeOffset now) => new()
        {
            UserId = userId,
            Kind = NotificationKind.SourceChanged,
            WorkspaceId = workspaceId,
            TargetType = CommentTarget.Collection,
            TargetId = collectionId,
            TargetName = collectionName.Length > 200 ? collectionName[..200] : collectionName,
            ActorName = "Kaynak belge",
            Preview = preview.Length > PreviewMaxLength ? preview[..(PreviewMaxLength - 1)] + "…" : preview,
            CreatedAt = now,
        };

    public void MarkRead(DateTimeOffset now) => ReadAt ??= now;
}
