using System.Text.Json.Serialization;
using Apivator.Domain.Common;

namespace Apivator.Domain.Runs;

[JsonConverter(typeof(JsonStringEnumConverter<RunStatus>))]
public enum RunStatus
{
    Completed,
    Stopped,
    Failed,
}

/// <summary>Çalıştırmanın nerede yürütüldüğü: sunucuda, masaüstü uygulamasında ya da komut satırında (CI).</summary>
[JsonConverter(typeof(JsonStringEnumConverter<RunOrigin>))]
public enum RunOrigin
{
    Server,
    Desktop,
    Cli,
    Monitor,
}

public sealed record RunTestResult(string Name, string Status, string? Error);

/// <summary>Bir iterasyonda bir isteğin sonucu. <paramref name="Skipped"/>: pre-request script'i isteği atladı.</summary>
public sealed record RunResultEntry(
    int Iteration,
    Guid RequestId,
    string Name,
    string Method,
    string Url,
    int? Status,
    double TimeMs,
    long Size,
    string? Error,
    IReadOnlyList<RunTestResult> Tests,
    bool Skipped = false);

/// <summary>
/// Collection runner'ın bir çalıştırmasının raporu. Sonuçlar tek bir jsonb kolonda saklanır (en fazla
/// <see cref="MaxResults"/>); özet alanlar listeleme için ayrı kolonlardadır.
/// </summary>
public sealed class CollectionRun : Entity
{
    public const int MaxResults = 5000;

    private CollectionRun()
    {
        Name = string.Empty;
        Results = [];
    }

    public Guid WorkspaceId { get; private set; }

    public Guid CollectionId { get; private set; }

    public Guid? FolderId { get; private set; }

    public Guid UserId { get; private set; }

    /// <summary>Çalıştırılan collection (ya da klasör) adı; sonradan silinse de raporda kalır.</summary>
    public string Name { get; private set; }

    public string? EnvironmentName { get; private set; }

    public int Iterations { get; private set; }

    public int DelayMs { get; private set; }

    public RunStatus Status { get; private set; }

    public RunOrigin Origin { get; private set; } = RunOrigin.Server;

    /// <summary>Zamanlanmış bir monitörün çalıştırmasıysa o monitör.</summary>
    public Guid? MonitorId { get; private set; }

    public DateTimeOffset StartedAt { get; private set; }

    public DateTimeOffset FinishedAt { get; private set; }

    public int TotalRequests { get; private set; }

    /// <summary>Yanıt alınamayan ya da 4xx/5xx dönen istekler.</summary>
    public int FailedRequests { get; private set; }

    /// <summary>Hiç yanıt alınamayan (bağlantı, zaman aşımı, script hatası) istekler.</summary>
    public int RequestErrors { get; private set; }

    public int TestsPassed { get; private set; }

    public int TestsFailed { get; private set; }

    public int TestsSkipped { get; private set; }

    public double TotalTimeMs { get; private set; }

    public IReadOnlyList<RunResultEntry> Results { get; private set; }

    public static CollectionRun Create(
        Guid workspaceId,
        Guid collectionId,
        Guid? folderId,
        Guid userId,
        string name,
        string? environmentName,
        int iterations,
        int delayMs,
        DateTimeOffset startedAt,
        RunOrigin origin = RunOrigin.Server,
        Guid? monitorId = null) => new()
        {
            Origin = origin,
            MonitorId = monitorId,
            WorkspaceId = workspaceId,
            CollectionId = collectionId,
            FolderId = folderId,
            UserId = userId,
            Name = name,
            EnvironmentName = environmentName,
            Iterations = iterations,
            DelayMs = delayMs,
            StartedAt = startedAt,
            FinishedAt = startedAt,
        };

    public void MoveTo(Guid workspaceId) => WorkspaceId = workspaceId;

    /// <summary>Monitör açısından başarılı mı: çalıştırma tamamlandı, hata alan istek ve kalan test yok.</summary>
    public bool Healthy => Status == RunStatus.Completed && TestsFailed == 0 && RequestErrors == 0;

    public void Finish(RunStatus status, IReadOnlyList<RunResultEntry> results, DateTimeOffset finishedAt)
    {
        Status = status;
        FinishedAt = finishedAt;
        TotalRequests = results.Count;
        FailedRequests = results.Count(r => r.Error is not null || r.Status is null or >= 400);
        RequestErrors = results.Count(r => r.Error is not null);
        TestsPassed = results.Sum(r => r.Tests.Count(t => t.Status == "passed"));
        TestsFailed = results.Sum(r => r.Tests.Count(t => t.Status == "failed"));
        TestsSkipped = results.Sum(r => r.Tests.Count(t => t.Status == "skipped"));
        TotalTimeMs = results.Sum(r => r.TimeMs);
        Results = results.Take(MaxResults).ToList();
    }
}
