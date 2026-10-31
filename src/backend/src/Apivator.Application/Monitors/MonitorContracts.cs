using Apivator.Domain.Monitors;
using Apivator.Domain.Runs;

namespace Apivator.Application.Monitors;

public sealed class MonitorOptions
{
    public const string SectionName = "Monitors";

    /// <summary>Zamanlayıcı kapatılabilir (ör. yalnızca bir API örneği çalıştırsın isteniyorsa diğerlerinde).</summary>
    public bool SchedulerEnabled { get; set; } = true;

    /// <summary>Zamanı gelen monitörlerin ne sıklıkla arandığı.</summary>
    public int PollSeconds { get; set; } = 15;

    /// <summary>Bir sunucunun aynı anda çalıştırdığı en fazla monitör.</summary>
    public int MaxConcurrent { get; set; } = 4;

    /// <summary>İki çalıştırma arasındaki en kısa süre.</summary>
    public int MinIntervalMinutes { get; set; } = 5;

    /// <summary>Bir çalıştırmanın en uzun süresi; aşılırsa durdurulur ve başarısız sayılır.</summary>
    public int RunTimeoutMinutes { get; set; } = 10;

    /// <summary>Monitör çalıştırma raporlarının saklanma süresi.</summary>
    public int RetentionDays { get; set; } = 30;
}

public sealed record MonitorDto(
    Guid Id,
    Guid WorkspaceId,
    Guid CollectionId,
    string CollectionName,
    Guid? EnvironmentId,
    string Name,
    string Schedule,
    string TimeZone,
    bool Enabled,
    IReadOnlyList<string> NotifyEmails,
    string? WebhookUrl,
    WebhookKind WebhookKind,
    MonitorNotifyMode NotifyMode,
    Guid CreatedById,
    string CreatedByName,
    DateTimeOffset? NextRunAt,
    DateTimeOffset? LastRunAt,
    Guid? LastRunId,
    MonitorHealth? Health,
    int ConsecutiveFailures,
    string? LastError,
    DateTimeOffset CreatedAt);

/// <summary>Monitör ayarları (oluşturma ve güncelleme).</summary>
public sealed record MonitorSettings(
    string Name,
    Guid? EnvironmentId,
    string Schedule,
    string? TimeZone,
    IReadOnlyList<string>? NotifyEmails = null,
    string? WebhookUrl = null,
    WebhookKind WebhookKind = WebhookKind.Generic,
    MonitorNotifyMode NotifyMode = MonitorNotifyMode.Changes,
    bool Enabled = true);

public sealed record CreateMonitorRequest(Guid CollectionId, MonitorSettings Settings);

/// <summary>Monitör geçmişinde bir çalıştırma (grafik ve liste için).</summary>
public sealed record MonitorRunPointDto(
    Guid Id,
    DateTimeOffset StartedAt,
    DateTimeOffset FinishedAt,
    RunOrigin Origin,
    RunStatus Status,
    bool Healthy,
    int TotalRequests,
    int RequestErrors,
    int TestsPassed,
    int TestsFailed,
    double TotalTimeMs);

/// <summary>Bildirimde gösterilen başarısız istek.</summary>
public sealed record MonitorFailure(string RequestName, string Method, string Url, int? Status, string? Error, IReadOnlyList<string> FailedTests);

/// <summary>Başarısızlık ya da düzelme bildirimi.</summary>
public sealed record MonitorAlert(
    Guid MonitorId,
    string MonitorName,
    Guid WorkspaceId,
    string CollectionName,
    string? EnvironmentName,
    bool Recovered,
    Guid RunId,
    DateTimeOffset StartedAt,
    int TotalRequests,
    int TestsPassed,
    int TestsFailed,
    int ConsecutiveFailures,
    IReadOnlyList<MonitorFailure> Failures,
    string? Reason = null);

/// <summary>Bildirimi gönderilecek kanallar.</summary>
public sealed record MonitorChannels(IReadOnlyList<string> Emails, string? WebhookUrl, WebhookKind WebhookKind);

/// <summary>E-posta ve webhook gönderimi (altyapı katmanında). Hatalar loglanır, fırlatılmaz.</summary>
public interface IMonitorNotifier
{
    Task NotifyAsync(MonitorAlert alert, MonitorChannels channels, CancellationToken ct = default);
}

/// <summary>Zamanı gelen monitörleri bir kez tarayıp çalıştırır (arka plan servisi düzenli çağırır).</summary>
public interface IMonitorScheduler
{
    Task<int> RunDueAsync(CancellationToken ct = default);
}
