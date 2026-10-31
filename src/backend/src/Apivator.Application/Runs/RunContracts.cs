using Apivator.Application.Execution;
using Apivator.Domain.Runs;

namespace Apivator.Application.Runs;

/// <summary>
/// Runner'ı başlatır. <paramref name="RequestIds"/> boşsa collection'daki (ya da klasördeki) tüm istekler ağaç
/// sırasıyla çalışır; doluysa yalnızca seçilenler, yine ağaç sırasıyla. <paramref name="Data"/> verilirse her
/// iterasyon bir satırı kullanır (pm.iterationData) ve iterasyon sayısı en fazla satır sayısı kadardır.
/// <paramref name="OAuth2Tokens"/>: tarayıcıda alınmış (authorization code) token'lar, ayar parmak izine göre.
/// </summary>
public sealed record StartRunRequest(
    Guid CollectionId,
    Guid? FolderId = null,
    IReadOnlyList<Guid>? RequestIds = null,
    int Iterations = 1,
    int DelayMs = 0,
    IReadOnlyList<Dictionary<string, string>>? Data = null,
    ExecutionVariables? Variables = null,
    IReadOnlyDictionary<string, string>? OAuth2Tokens = null);

public sealed record RunRequestInfo(Guid Id, string Name, string Method);

/// <summary>Akıştaki olay: "start", "result" ya da "done". Gerekmeyen alanlar boş bırakılır.</summary>
public sealed record RunEvent(string Type)
{
    public Guid? RunId { get; init; }

    public int? Iterations { get; init; }

    public IReadOnlyList<RunRequestInfo>? Requests { get; init; }

    public RunResultEntry? Result { get; init; }

    /// <summary>Konsol çıktısı (yalnızca canlı akışta; rapora yazılmaz).</summary>
    public IReadOnlyList<ConsoleEntryDto>? Console { get; init; }

    public RunSummaryDto? Summary { get; init; }

    /// <summary>Çalıştırma sonundaki değişken değerleri; istemci isterse güncel değerlere yazar.</summary>
    public ExecutionVariables? Variables { get; init; }

    public string? Message { get; init; }

    /// <summary>Masaüstü ajanında çalıştırma bitince: sunucuya kaydedilecek rapor.</summary>
    public LocalRunReport? Report { get; init; }
}

/// <summary>Ajanın ürettiği rapor içeriği (istemci bunu <see cref="RunReportRequest"/> ile sunucuya gönderir).</summary>
public sealed record LocalRunReport(
    string Name,
    int Iterations,
    RunStatus Status,
    DateTimeOffset StartedAt,
    DateTimeOffset FinishedAt,
    IReadOnlyList<RunResultEntry> Results);

/// <summary>Masaüstünde yürütülen bir çalıştırmanın raporunu kaydetme isteği.</summary>
public sealed record RunReportRequest(
    Guid CollectionId,
    Guid? FolderId,
    string Name,
    string? EnvironmentName,
    int Iterations,
    int DelayMs,
    RunStatus Status,
    DateTimeOffset StartedAt,
    DateTimeOffset FinishedAt,
    IReadOnlyList<RunResultEntry> Results,
    RunOrigin Origin = RunOrigin.Desktop);

/// <summary>Masaüstü ajanına verilecek çalıştırma: istek + collection'ın kaynağı.</summary>
public sealed record LocalRunRequest(StartRunRequest Run, RunSourceDto Source);

public sealed record RunSummaryDto(
    Guid Id,
    Guid CollectionId,
    Guid? FolderId,
    string Name,
    string? EnvironmentName,
    string UserName,
    int Iterations,
    RunStatus Status,
    RunOrigin Origin,
    DateTimeOffset StartedAt,
    DateTimeOffset FinishedAt,
    int TotalRequests,
    int FailedRequests,
    int TestsPassed,
    int TestsFailed,
    int TestsSkipped,
    double TotalTimeMs);

public sealed record RunDetailDto(RunSummaryDto Summary, int DelayMs, IReadOnlyList<RunResultEntry> Results);
