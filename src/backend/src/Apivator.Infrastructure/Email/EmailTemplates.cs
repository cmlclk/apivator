using System.Net;
using Apivator.Application.Abstractions;
using Apivator.Application.Common.Localization;

namespace Apivator.Infrastructure.Email;

/// <summary>
/// E-posta şablonları. Metinler <see cref="Lang.Current"/> diliyle üretilir: hesap e-postalarında isteğin dili,
/// bildirim e-postalarında (bahsetme, merge isteği, monitör, davet) çağıranın <c>Lang.Use</c> ile seçtiği dil.
/// </summary>
internal static class EmailTemplates
{
    public static EmailMessage ConfirmEmail(string to, string displayName, string link) =>
        Build(
            to,
            L.T("email.confirm.subject", "Apivator hesabınızı doğrulayın"),
            displayName,
            L.T("email.confirm.intro", "Apivator'a hoş geldiniz! Hesabınızı doğrulamak için aşağıdaki bağlantıya tıklayın."),
            L.T("email.confirm.action", "E-postamı doğrula"),
            link);

    public static EmailMessage ResetPassword(string to, string displayName, string link) =>
        Build(
            to,
            L.T("email.reset.subject", "Apivator şifre sıfırlama"),
            displayName,
            L.T("email.reset.intro", "Şifrenizi sıfırlamak için bir istek aldık. Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz."),
            L.T("email.reset.action", "Şifremi sıfırla"),
            link);

    public static EmailMessage Invitation(InvitationEmail invitation, string link) =>
        Build(
            invitation.To,
            L.T("email.invitation.subject", "{inviter} sizi Apivator'da {organization} organizasyonuna davet etti", ("inviter", invitation.InvitedBy), ("organization", invitation.OrganizationName)),
            invitation.To,
            invitation.WorkspaceName is null
                ? L.T("email.invitation.intro", "{inviter} sizi {organization} organizasyonuna davet etti. Davet 7 gün geçerlidir.", ("inviter", invitation.InvitedBy), ("organization", invitation.OrganizationName))
                : L.T("email.invitation.intro_workspace", "{inviter} sizi {organization} organizasyonuna ve \"{workspace}\" workspace'ine davet etti. Davet 7 gün geçerlidir.", ("inviter", invitation.InvitedBy), ("organization", invitation.OrganizationName), ("workspace", invitation.WorkspaceName)),
            L.T("email.invitation.action", "Daveti kabul et"),
            link);

    public static EmailMessage Mention(MentionEmail mention, string link) =>
        Build(
            mention.To,
            L.T("email.mention.subject", "{actor} bir yorumda sizden bahsetti: {target}", ("actor", mention.ActorName), ("target", mention.TargetName)),
            mention.RecipientName,
            L.T("email.mention.intro", "{actor}, \"{target}\" üzerindeki bir yorumda sizden bahsetti: \"{preview}\"", ("actor", mention.ActorName), ("target", mention.TargetName), ("preview", mention.Preview)),
            L.T("email.mention.action", "Yorumu aç"),
            link);

    public static EmailMessage ConfirmEmailChange(string to, string displayName, string link) =>
        Build(
            to,
            L.T("email.email_change.subject", "Apivator e-posta adresinizi doğrulayın"),
            displayName,
            L.T("email.email_change.intro", "Apivator hesabınızın e-posta adresini bu adresle değiştirmek istediniz. Değişikliği tamamlamak için aşağıdaki bağlantıya tıklayın. Doğrulayana kadar eski adresiniz geçerli kalır."),
            L.T("email.email_change.action", "Yeni adresimi doğrula"),
            link);

    public static EmailMessage EmailChanged(string to, string displayName, string newEmail, string link) =>
        Build(
            to,
            L.T("email.email_changed.subject", "Apivator hesabınızın e-posta adresi değişti"),
            displayName,
            L.T("email.email_changed.intro", "Hesabınızın e-posta adresi {email} olarak değiştirildi. Bu değişikliği siz yapmadıysanız hemen şifrenizi sıfırlayın ve yöneticinize haber verin.", ("email", newEmail)),
            L.T("email.reset.action", "Şifremi sıfırla"),
            link);

    public static EmailMessage PasswordChanged(string to, string displayName, string link) =>
        Build(
            to,
            L.T("email.password_changed.subject", "Apivator şifreniz değişti"),
            displayName,
            L.T("email.password_changed.intro", "Hesabınızın şifresi değiştirildi ve diğer cihazlardaki oturumlar kapatıldı. Bu değişikliği siz yapmadıysanız hemen şifrenizi sıfırlayın."),
            L.T("email.reset.action", "Şifremi sıfırla"),
            link);

    public static EmailMessage NewDeviceLogin(string to, string displayName, string device, string? ipAddress, DateTimeOffset at, string link) =>
        Build(
            to,
            L.T("email.new_device.subject", "Apivator hesabınıza yeni bir cihazdan giriş yapıldı"),
            displayName,
            ipAddress is null
                ? L.T("email.new_device.intro", "Hesabınıza {time} itibarıyla {device} üzerinden giriş yapıldı. Bu siz değilseniz hemen şifrenizi değiştirin ve diğer oturumları kapatın.", ("time", Stamp(at)), ("device", device))
                : L.T("email.new_device.intro_ip", "Hesabınıza {time} itibarıyla {device} üzerinden giriş yapıldı (IP: {ip}). Bu siz değilseniz hemen şifrenizi değiştirin ve diğer oturumları kapatın.", ("time", Stamp(at)), ("device", device), ("ip", ipAddress)),
            L.T("email.security.action", "Güvenlik ayarlarını aç"),
            link);

    public static EmailMessage TwoFactorChanged(string to, string displayName, bool enabled, string link) =>
        Build(
            to,
            enabled
                ? L.T("email.two_factor.on_subject", "Apivator iki adımlı doğrulama açıldı")
                : L.T("email.two_factor.off_subject", "Apivator iki adımlı doğrulama kapatıldı"),
            displayName,
            enabled
                ? L.T("email.two_factor.on_intro", "Hesabınızda iki adımlı doğrulama açıldı. Yedek kodlarınızı güvenli bir yerde saklayın.")
                : L.T("email.two_factor.off_intro", "Hesabınızda iki adımlı doğrulama kapatıldı. Bu değişikliği siz yapmadıysanız hemen şifrenizi değiştirin."),
            L.T("email.security.action", "Güvenlik ayarlarını aç"),
            link);

    public static EmailMessage SessionsRevokedByAdmin(string to, string displayName, string adminName, string organization, string link) =>
        Build(
            to,
            L.T("email.sessions_revoked.subject", "Apivator oturumlarınız kapatıldı"),
            displayName,
            L.T("email.sessions_revoked.intro", "{organization} organizasyonunun yöneticisi {admin}, hesabınızın tüm oturumlarını kapattı. Devam etmek için tekrar giriş yapın.", ("organization", organization), ("admin", adminName)),
            L.T("email.sessions_revoked.action", "Giriş yap"),
            link);

    public static EmailMessage ConfirmSsoLink(string to, string displayName, string organization, string idpUser, string? ipAddress, DateTimeOffset at, string link) =>
        Build(
            to,
            L.T("email.sso_link.subject", "Apivator hesabınızı SSO'ya bağlayın"),
            displayName,
            ipAddress is null
                ? L.T("email.sso_link.intro", "{organization} kimlik sağlayıcısında \"{idpUser}\" olarak oturum açan biri, {time} tarihinde bu Apivator hesabına SSO ile girmek istedi. Bu siz değilseniz bağlantıyı AÇMAYIN; onaylarsanız o kimlik sağlayıcı hesabı bu hesaba girebilir. Sizseniz bağlantıyla onaylayın, ardından \"SSO ile giriş yap\" ile girin. Bağlantı 1 saat geçerlidir.", ("organization", organization), ("idpUser", idpUser), ("time", Stamp(at)))
                : L.T("email.sso_link.intro_ip", "{organization} kimlik sağlayıcısında \"{idpUser}\" olarak oturum açan biri, {time} tarihinde {ip} adresinden bu Apivator hesabına SSO ile girmek istedi. Bu siz değilseniz bağlantıyı AÇMAYIN; onaylarsanız o kimlik sağlayıcı hesabı bu hesaba girebilir. Sizseniz bağlantıyla onaylayın, ardından \"SSO ile giriş yap\" ile girin. Bağlantı 1 saat geçerlidir.", ("organization", organization), ("idpUser", idpUser), ("time", Stamp(at)), ("ip", ipAddress)),
            L.T("email.sso_link.action", "Bu bendim, hesabımı bağla"),
            link);

    public static EmailMessage ResetPasswordByAdmin(string to, string displayName, string adminName, string organization, string link) =>
        Build(
            to,
            L.T("email.reset.subject", "Apivator şifre sıfırlama"),
            displayName,
            L.T("email.reset_by_admin.intro", "{organization} organizasyonunun yöneticisi {admin}, şifrenizi sıfırlamanız için bu bağlantıyı gönderdi.", ("organization", organization), ("admin", adminName)),
            L.T("email.reset.action", "Şifremi sıfırla"),
            link);

    public static EmailMessage ConfirmAccountDeletion(string to, string displayName, string link) =>
        Build(
            to,
            L.T("email.delete_confirm.subject", "Apivator hesabınızı silme onayı"),
            displayName,
            L.T("email.delete_confirm.intro", "Hesabınızı silmek istediniz. Onaylarsanız kişisel workspace'iniz ve verileriniz kalıcı olarak silinir, ekip workspace'lerinden çıkarılırsınız. Bağlantı 24 saat geçerlidir; bu isteği siz yapmadıysanız şifrenizi değiştirin."),
            L.T("email.delete_confirm.action", "Hesabımı kalıcı olarak sil"),
            link);

    public static EmailMessage AccountDeleted(string to, string displayName) =>
        Notice(
            to,
            L.T("email.deleted.subject", "Apivator hesabınız silindi"),
            displayName,
            L.T("email.deleted.intro", "Apivator hesabınız ve kişisel verileriniz silindi. Bizi kullandığınız için teşekkür ederiz."));

    public static EmailMessage MergeRequest(MergeRequestEmail mail, string link)
    {
        var (subject, intro) = mail.Kind switch
        {
            MergeRequestEmailKind.Opened => (
                L.T("email.merge.opened_subject", "{actor} bir merge isteği açtı: {title}", ("actor", mail.ActorName), ("title", mail.Title)),
                L.T("email.merge.opened_intro", "{actor}, \"{title}\" adlı merge isteğini açtı ({summary}).", ("actor", mail.ActorName), ("title", mail.Title), ("summary", mail.Summary))),
            MergeRequestEmailKind.Merged => (
                L.T("email.merge.merged_subject", "Merge isteğiniz birleştirildi: {title}", ("title", mail.Title)),
                L.T("email.merge.merged_intro", "{actor}, \"{title}\" adlı isteğinizi birleştirdi: {summary}.", ("actor", mail.ActorName), ("title", mail.Title), ("summary", mail.Summary))),
            _ => (
                L.T("email.merge.declined_subject", "Merge isteğiniz reddedildi: {title}", ("title", mail.Title)),
                L.T("email.merge.declined_intro", "{actor}, \"{title}\" adlı isteğinizi reddetti.", ("actor", mail.ActorName), ("title", mail.Title))),
        };
        return Build(mail.To, subject, mail.RecipientName, intro, L.T("email.merge.action", "İsteği aç"), link);
    }

    /// <summary>Monitör bildirimi: özet satırları ve (varsa) başarısız istekler listesi.</summary>
    public static EmailMessage MonitorAlert(string to, string subject, string headline, IReadOnlyList<string> lines, string link)
    {
        var action = L.T("email.monitor.action", "Monitörü aç");
        var items = string.Concat(lines.Select(l => $"<li style=\"margin:4px 0\">{WebUtility.HtmlEncode(l)}</li>"));
        var href = WebUtility.HtmlEncode(link);
        var html = $"""
            <div lang="{Lang.Current}" style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1f2328">
              <h2 style="margin:0 0 16px">{WebUtility.HtmlEncode(headline)}</h2>
              <ul style="line-height:1.5;padding-left:20px">{items}</ul>
              <p style="margin:24px 0"><a href="{href}" style="background:#e8590c;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">{WebUtility.HtmlEncode(action)}</a></p>
              <p style="font-size:13px;color:#57606a">{WebUtility.HtmlEncode(L.T("email.monitor.footer", "Bu e-postayı monitör ayarlarındaki bildirim adresleri nedeniyle alıyorsunuz."))}</p>
            </div>
            """;
        var text = $"{headline}\n\n{string.Join('\n', lines.Select(l => "- " + l))}\n\n{action}: {link}\n";
        return new EmailMessage(to, subject, html, text);
    }

    /// <summary>Güvenlik e-postalarındaki zaman: Türkçede TSİ, diğer dillerde UTC.</summary>
    private static string Stamp(DateTimeOffset at) =>
        Lang.Current == Lang.Default
            ? at.ToOffset(TimeSpan.FromHours(3)).ToString("dd.MM.yyyy HH:mm", Lang.Culture) + " (TSİ)"
            : at.ToUniversalTime().ToString("MMM d, yyyy HH:mm", Lang.Culture) + " UTC";

    private static string Greeting(string displayName) => L.T("email.greeting", "Merhaba {name},", ("name", displayName));

    private static EmailMessage Notice(string to, string subject, string displayName, string intro)
    {
        var html = $"""
            <div lang="{Lang.Current}" style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2328">
              <h2 style="margin:0 0 16px">{WebUtility.HtmlEncode(Greeting(displayName))}</h2>
              <p style="line-height:1.5">{WebUtility.HtmlEncode(intro)}</p>
            </div>
            """;
        return new EmailMessage(to, subject, html, $"{Greeting(displayName)}\n\n{intro}\n");
    }

    private static EmailMessage Build(string to, string subject, string displayName, string intro, string action, string link)
    {
        var href = WebUtility.HtmlEncode(link);

        var html = $"""
            <div lang="{Lang.Current}" style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2328">
              <h2 style="margin:0 0 16px">{WebUtility.HtmlEncode(Greeting(displayName))}</h2>
              <p style="line-height:1.5">{WebUtility.HtmlEncode(intro)}</p>
              <p style="margin:24px 0"><a href="{href}" style="background:#e8590c;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">{WebUtility.HtmlEncode(action)}</a></p>
              <p style="font-size:13px;color:#57606a">{WebUtility.HtmlEncode(L.T("email.fallback_link", "Buton çalışmazsa bu adresi tarayıcınıza yapıştırın:"))}<br><span style="word-break:break-all">{href}</span></p>
            </div>
            """;

        var text = $"{Greeting(displayName)}\n\n{intro}\n\n{action}: {link}\n";
        return new EmailMessage(to, subject, html, text);
    }
}
