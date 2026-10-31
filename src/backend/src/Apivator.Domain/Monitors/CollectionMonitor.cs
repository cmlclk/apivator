using System.Text.Json.Serialization;
using Apivator.Domain.Common;

namespace Apivator.Domain.Monitors;

/// <summary>Başarısızlık bildiriminin ne zaman gönderileceği.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<MonitorNotifyMode>))]
public enum MonitorNotifyMode
{
    /// <summary>Yalnızca durum değişince: ilk başarısızlıkta ve düzelince.</summary>
    Changes,

    /// <summary>Her başarısız çalıştırmada (ve düzelince).</summary>
    EveryFailure,
}

/// <summary>Webhook'a gönderilen içeriğin biçimi.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<WebhookKind>))]
public enum WebhookKind
{
    /// <summary>Ayrıntılı JSON (kendi sistemleriniz için).</summary>
    Generic,

    Slack,

    Teams,
}

[JsonConverter(typeof(JsonStringEnumConverter<MonitorHealth>))]
public enum MonitorHealth
{
    Healthy,
    Failing,
}

/// <summary>
/// Bir collection'ı (isteğe bağlı bir environment'la) zamanlanmış olarak sunucuda çalıştırır ve başarısızlıkta
/// e-posta ya da webhook ile haber verir. Çalıştırmalar oluşturan kişinin yetkisiyle yapılır; kişinin erişimi
/// kalmazsa monitör kendini durdurur.
/// </summary>
public sealed class CollectionMonitor : Entity
{
    public const int NameMaxLength = 120;
    public const int MaxPerWorkspace = 20;
    public const int MaxEmails = 10;
    public const int WebhookUrlMaxLength = 2048;
    public const int ScheduleMaxLength = 100;

    private CollectionMonitor()
    {
        Name = string.Empty;
        Schedule = string.Empty;
        TimeZone = string.Empty;
        NotifyEmails = [];
    }

    public Guid WorkspaceId { get; private set; }

    public Guid CollectionId { get; private set; }

    public Guid? EnvironmentId { get; private set; }

    public string Name { get; private set; }

    /// <summary>5 alanlı cron ifadesi (dakika saat gün ay haftanın-günü), <see cref="TimeZone"/>'a göre.</summary>
    public string Schedule { get; private set; }

    /// <summary>IANA saat dilimi (ör. Europe/Istanbul).</summary>
    public string TimeZone { get; private set; }

    public bool Enabled { get; private set; }

    /// <summary>Bildirim alacak adresler; boşsa oluşturan kişiye gider.</summary>
    public IReadOnlyList<string> NotifyEmails { get; private set; }

    public string? WebhookUrl { get; private set; }

    public WebhookKind WebhookKind { get; private set; }

    public MonitorNotifyMode NotifyMode { get; private set; }

    /// <summary>Çalıştırmalar bu kişinin yetkisiyle yapılır.</summary>
    public Guid CreatedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public DateTimeOffset? NextRunAt { get; private set; }

    public DateTimeOffset? LastRunAt { get; private set; }

    public Guid? LastRunId { get; private set; }

    public MonitorHealth? Health { get; private set; }

    public int ConsecutiveFailures { get; private set; }

    /// <summary>Son çalıştırılamama nedeni (ör. erişim kalmadı); çalıştırma başarılı olunca temizlenir.</summary>
    public string? LastError { get; private set; }

    /// <summary>Bir sunucu çalıştırırken diğerlerinin aynı monitörü almaması için.</summary>
    public DateTimeOffset? LockedUntil { get; private set; }

    public static CollectionMonitor Create(
        Guid workspaceId,
        Guid collectionId,
        Guid? environmentId,
        string name,
        string schedule,
        string timeZone,
        IReadOnlyList<string> notifyEmails,
        string? webhookUrl,
        WebhookKind webhookKind,
        MonitorNotifyMode notifyMode,
        DateTimeOffset? nextRunAt,
        Guid userId,
        DateTimeOffset now) => new()
        {
            WorkspaceId = workspaceId,
            CollectionId = collectionId,
            EnvironmentId = environmentId,
            Name = Names.Clean(name, NameMaxLength),
            Schedule = schedule.Trim(),
            TimeZone = timeZone,
            Enabled = true,
            NotifyEmails = notifyEmails,
            WebhookUrl = string.IsNullOrWhiteSpace(webhookUrl) ? null : webhookUrl.Trim(),
            WebhookKind = webhookKind,
            NotifyMode = notifyMode,
            NextRunAt = nextRunAt,
            CreatedById = userId,
            CreatedAt = now,
            UpdatedAt = now,
        };

    public void Update(
        string name,
        Guid? environmentId,
        string schedule,
        string timeZone,
        bool enabled,
        IReadOnlyList<string> notifyEmails,
        string? webhookUrl,
        WebhookKind webhookKind,
        MonitorNotifyMode notifyMode,
        DateTimeOffset? nextRunAt,
        DateTimeOffset now)
    {
        Name = Names.Clean(name, NameMaxLength);
        EnvironmentId = environmentId;
        Schedule = schedule.Trim();
        TimeZone = timeZone;
        if (enabled && !Enabled)
        {
            LastError = null;
        }

        Enabled = enabled;
        NotifyEmails = notifyEmails;
        WebhookUrl = string.IsNullOrWhiteSpace(webhookUrl) ? null : webhookUrl.Trim();
        WebhookKind = webhookKind;
        NotifyMode = notifyMode;
        NextRunAt = enabled ? nextRunAt : null;
        UpdatedAt = now;
    }

    /// <summary>Bir çalıştırmanın sonucunu işler. Önceki sağlık durumunu döner (bildirim kararı için).</summary>
    public MonitorHealth? RecordRun(Guid runId, bool healthy, DateTimeOffset finishedAt, DateTimeOffset? nextRunAt)
    {
        var previous = Health;
        LastRunAt = finishedAt;
        LastRunId = runId;
        Health = healthy ? MonitorHealth.Healthy : MonitorHealth.Failing;
        ConsecutiveFailures = healthy ? 0 : ConsecutiveFailures + 1;
        LastError = null;
        NextRunAt = Enabled ? nextRunAt : null;
        LockedUntil = null;
        return previous;
    }

    /// <summary>Çalıştırılamadı (ör. oluşturan kişinin erişimi kalmadı): monitör durur.</summary>
    public void Suspend(string reason, DateTimeOffset now)
    {
        Enabled = false;
        LastError = reason;
        NextRunAt = null;
        LockedUntil = null;
        UpdatedAt = now;
    }

    /// <summary>Durdurulmuş monitörü yeniden açan kişi sahibi olur; çalıştırmalar artık onun yetkisiyle yapılır.</summary>
    public void TakeOver(Guid userId) => CreatedById = userId;

    public void MoveTo(Guid workspaceId, DateTimeOffset now)
    {
        WorkspaceId = workspaceId;
        EnvironmentId = null;
        UpdatedAt = now;
    }
}
