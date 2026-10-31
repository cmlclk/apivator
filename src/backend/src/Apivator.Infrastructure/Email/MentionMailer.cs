using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Application.Common.Localization;
using Apivator.Domain.Comments;
using Apivator.Infrastructure.Identity;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Email;

internal sealed class MentionMailer(IEmailSender email, IUserDirectory users, IApplicationDbContext db, IOptions<AppOptions> app, ILogger<MentionMailer> logger) : IMentionMailer
{
    public async Task SendAsync(MentionEmail mention, CancellationToken ct = default)
    {
        if (!await users.EmailAllowedAsync(mention.To, EmailTopic.Mention, ct))
        {
            return;
        }

        var target = mention.TargetType switch
        {
            CommentTarget.Request => "request",
            CommentTarget.MergeRequest => "mergeRequest",
            _ => "collection",
        };
        var link = $"{app.Value.PublicUrl.TrimEnd('/')}/?workspace={mention.WorkspaceId}&{target}={mention.TargetId}&comments=1";
        try
        {
            using var _ = Lang.Use(await NotificationLanguage.RecipientAsync(users, db, mention.To, mention.WorkspaceId, ct));
            await email.SendAsync(EmailTemplates.Mention(mention, link), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Uygulama içi bildirim yine de oluştu; e-posta yalnızca ek kanal.
            logger.LogWarning(ex, "Bahsetme e-postası gönderilemedi: {Email}", mention.To);
        }
    }
}
