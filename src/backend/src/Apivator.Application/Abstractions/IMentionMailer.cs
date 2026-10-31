using Apivator.Domain.Comments;

namespace Apivator.Application.Abstractions;

public sealed record MentionEmail(
    string To,
    string RecipientName,
    string ActorName,
    string TargetName,
    Guid WorkspaceId,
    CommentTarget TargetType,
    Guid TargetId,
    string Preview);

/// <summary>Yorumda bahsedilen kişiye e-posta (bağlantı yorumun açık olduğu ekrana gider).</summary>
public interface IMentionMailer
{
    Task SendAsync(MentionEmail mention, CancellationToken ct = default);
}
