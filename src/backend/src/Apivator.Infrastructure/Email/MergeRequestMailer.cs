using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Application.Common.Localization;
using Apivator.Infrastructure.Identity;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Email;

internal sealed class MergeRequestMailer(IEmailSender email, IUserDirectory users, IApplicationDbContext db, IOptions<AppOptions> app, ILogger<MergeRequestMailer> logger) : IMergeRequestMailer
{
    public async Task SendAsync(MergeRequestEmail mail, CancellationToken ct = default)
    {
        if (!await users.EmailAllowedAsync(mail.To, EmailTopic.MergeRequest, ct))
        {
            return;
        }

        var link = $"{app.Value.PublicUrl.TrimEnd('/')}/?workspace={mail.WorkspaceId}&mergeRequest={mail.MergeRequestId}";
        try
        {
            using var _ = Lang.Use(await NotificationLanguage.RecipientAsync(users, db, mail.To, mail.WorkspaceId, ct));
            await email.SendAsync(EmailTemplates.MergeRequest(mail, link), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Uygulama içi bildirim yine de oluştu; e-posta yalnızca ek kanal.
            logger.LogWarning(ex, "Birleştirme isteği e-postası gönderilemedi: {Email}", mail.To);
        }
    }
}
