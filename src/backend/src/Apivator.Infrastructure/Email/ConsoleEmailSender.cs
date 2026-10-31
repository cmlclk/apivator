using Apivator.Application.Abstractions;
using Microsoft.Extensions.Logging;

namespace Apivator.Infrastructure.Email;

/// <summary>
/// Geliştirme için: e-postayı göndermek yerine API konsoluna yazar. Doğrulama ve şifre sıfırlama
/// bağlantıları terminalden kopyalanabilir; SMTP sunucusu (Mailpit vb.) gerekmez.
/// </summary>
internal sealed class ConsoleEmailSender(ILogger<ConsoleEmailSender> logger) : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        logger.LogWarning(
            "\n===== E-POSTA (gönderilmedi, konsol modu) =====\nKime: {To}\nKonu: {Subject}\n\n{Body}\n===============================================",
            message.To,
            message.Subject,
            message.TextBody);
        return Task.CompletedTask;
    }
}
