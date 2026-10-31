namespace Apivator.Application.Account;

/// <summary>Sunucuda saklanan, cihazlar arası ortak kullanıcı tercihleri.</summary>
public sealed class UserPreferences
{
    public static readonly IReadOnlyList<string> Themes = ["system", "light", "dark"];

    /// <summary>Arayüz dilleri (Faz 8). Yeni dil eklenince buraya da yazılır.</summary>
    public static readonly IReadOnlyList<string> Languages = ["tr", "en"];

    /// <summary>"system", "light" ya da "dark".</summary>
    public string Theme { get; set; } = "system";

    /// <summary>Uygulama açılışında seçilen workspace (yoksa son kullanılan ya da kişisel workspace).</summary>
    public Guid? DefaultWorkspaceId { get; set; }

    /// <summary>Arayüz dili ("tr", "en"); null ise istemci tarayıcı dilini kullanır.</summary>
    public string? Language { get; set; }

    public bool EmailMentions { get; set; } = true;

    public bool EmailMergeRequests { get; set; } = true;

    public bool EmailMonitorAlerts { get; set; } = true;

    /// <summary>Geçmişte yanıt gövdeleri de saklansın (9.3; varsayılan kapalı, yanıtlarda gizli bilgi olabilir).</summary>
    public bool SaveHistoryResponses { get; set; }

    public bool Allows(EmailTopic topic) => topic switch
    {
        EmailTopic.Mention => EmailMentions,
        EmailTopic.MergeRequest => EmailMergeRequests,
        EmailTopic.MonitorAlert => EmailMonitorAlerts,
        _ => true,
    };
}

/// <summary>Kullanıcının kapatabildiği bildirim e-postası türleri (hesap güvenliği e-postaları kapatılamaz).</summary>
public enum EmailTopic
{
    Mention,
    MergeRequest,
    MonitorAlert,
}
