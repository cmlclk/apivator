using Apivator.Application.Abstractions;
using Apivator.Application.Common.Localization;
using Apivator.Infrastructure.Identity;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Email;

internal sealed class InvitationSender(IEmailSender email, IOptions<AppOptions> app, ILogger<InvitationSender> logger) : IInvitationSender
{
    public async Task SendAsync(InvitationEmail invitation, CancellationToken ct = default)
    {
        var link = $"{app.Value.PublicUrl.TrimEnd('/')}/invite?token={Uri.EscapeDataString(invitation.Token)}";
        try
        {
            // Hesabı olmayan davetliye daveti gönderenin seçtiği dil (yoksa organizasyonun varsayılan dili) kullanılır.
            using var _ = Lang.Use(invitation.Language);
            await email.SendAsync(EmailTemplates.Invitation(invitation, link), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Davet kaydı durur; yönetici "yeniden gönder" diyebilir.
            logger.LogWarning(ex, "Davet e-postası gönderilemedi: {Email}", invitation.To);
        }
    }
}
