using Apivator.Application.Execution;
using Apivator.Domain.Runs;

namespace Apivator.Cli.Reporters;

/// <summary>Bir CLI çalıştırmasının sonucu; tüm raporlayıcılar bunu yazar.</summary>
internal sealed record RunReport(
    string Collection,
    string? Environment,
    int Iterations,
    RunStatus Status,
    string? StopReason,
    DateTimeOffset StartedAt,
    DateTimeOffset FinishedAt,
    IReadOnlyList<RunResultEntry> Results)
{
    public int Requests => Results.Count;

    /// <summary>Ağ/script hatası (atlanan istekler hariç). 4xx/5xx yanıt hata sayılmaz; testler karar verir.</summary>
    public int RequestErrors => Results.Count(IsError);

    public int TestsPassed => Results.Sum(r => r.Tests.Count(t => t.Status == TestResultDto.Passed));

    public int TestsFailed => Results.Sum(r => r.Tests.Count(t => t.Status == TestResultDto.Failed));

    public int TestsSkipped => Results.Sum(r => r.Tests.Count(t => t.Status == TestResultDto.Skipped));

    public double Seconds => (FinishedAt - StartedAt).TotalSeconds;

    public bool Succeeded => Status == RunStatus.Completed && TestsFailed == 0 && RequestErrors == 0;

    public static bool IsSkipped(RunResultEntry r) => r.Skipped;

    public static bool IsError(RunResultEntry r) => r.Error is not null && !IsSkipped(r);

    public static bool Failed(RunResultEntry r) => IsError(r) || r.Tests.Any(t => t.Status == TestResultDto.Failed);
}
