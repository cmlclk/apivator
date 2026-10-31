using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Apivator.Domain.Runs;

namespace Apivator.Cli.Reporters;

/// <summary>Terminale canlı çıktı: her istek, testleri ve sonda özet tablosu.</summary>
internal sealed class CliReporter(TextWriter output, bool color, bool verbose)
{
    private const string Reset = "\u001b[0m";
    private const string Green = "\u001b[32m";
    private const string Red = "\u001b[31m";
    private const string Yellow = "\u001b[33m";
    private const string Gray = "\u001b[90m";
    private const string Bold = "\u001b[1m";

    private int _iteration = -1;
    private int _iterations;

    private string Paint(string code, string text) => color ? code + text + Reset : text;

    public void Start(string collection, string? environment, int iterations, int requests)
    {
        _iterations = iterations;
        output.WriteLine(Paint(Bold, $"apivator · {collection}"));
        var details = new List<string> { L.T("cli.report.requests_count", "{n} istek", ("n", requests)) };
        if (iterations > 1)
        {
            details.Add(L.T("cli.report.iterations_count", "{n} iterasyon", ("n", iterations)));
        }

        if (environment is not null)
        {
            details.Add(L.T("cli.report.environment", "environment: {name}", ("name", environment)));
        }

        output.WriteLine(Paint(Gray, string.Join(" · ", details)));
    }

    public void Result(RunResultEntry r, IReadOnlyList<ConsoleEntryDto>? console)
    {
        if (_iterations > 1 && r.Iteration != _iteration)
        {
            _iteration = r.Iteration;
            output.WriteLine();
            output.WriteLine(Paint(Gray, L.T("cli.report.iteration_of", "İterasyon {n}/{total}", ("n", r.Iteration + 1), ("total", _iterations))));
        }

        output.WriteLine();
        output.WriteLine($"→ {r.Name}");
        if (RunReport.IsSkipped(r))
        {
            output.WriteLine(Paint(Gray, L.T("cli.report.skipped_request", "  atlandı (pm.execution.skipRequest)")));
            return;
        }

        var status = r.Status is { } s ? $"{s}" : L.T("cli.report.no_response", "yanıt yok");
        var statusColor = r.Status is null or >= 400 ? Yellow : Gray;
        output.WriteLine($"  {r.Method} {r.Url} " + Paint(statusColor, L.T("cli.report.response_info", "[{status}, {ms:0} ms, {size}]", ("status", status), ("ms", r.TimeMs), ("size", Size(r.Size)))));
        if (r.Error is { } error)
        {
            output.WriteLine(Paint(Red, $"  ✗ {error}"));
        }

        if (verbose && console is not null)
        {
            foreach (var line in console)
            {
                output.WriteLine(Paint(Gray, $"  │ {line.Message}"));
            }
        }

        foreach (var test in r.Tests)
        {
            switch (test.Status)
            {
                case TestResultDto.Passed:
                    output.WriteLine(Paint(Green, "  ✓ ") + test.Name);
                    break;
                case TestResultDto.Failed:
                    output.WriteLine(Paint(Red, $"  ✗ {test.Name}") + (test.Error is null ? string.Empty : Paint(Gray, $" — {test.Error}")));
                    break;
                default:
                    output.WriteLine(Paint(Gray, L.T("cli.report.test_skipped", "  - {name} (atlandı)", ("name", test.Name))));
                    break;
            }
        }
    }

    public void Warning(string message) => output.WriteLine(Paint(Yellow, $"! {message}"));

    public void Summary(RunReport report)
    {
        output.WriteLine();
        var rows = new (string Label, string Total, string Failed)[]
        {
            (L.T("cli.report.row_iterations", "İterasyon"), N(report.Iterations), "-"),
            (L.T("cli.report.row_requests", "İstek"), N(report.Requests), N(report.RequestErrors)),
            (L.T("cli.report.row_tests", "Test"), N(report.TestsPassed + report.TestsFailed + report.TestsSkipped), N(report.TestsFailed)),
        };
        output.WriteLine($"┌────────────┬────────────┬────────────┐");
        output.WriteLine($"│            │ {L.T("cli.report.col_total", "toplam"),10} │ {L.T("cli.report.col_failed", "başarısız"),10} │");
        output.WriteLine($"├────────────┼────────────┼────────────┤");
        foreach (var (label, total, failed) in rows)
        {
            var failedText = failed is "-" or "0" ? $"{failed,10}" : Paint(Red, $"{failed,10}");
            output.WriteLine($"│ {label,-10} │ {total,10} │ {failedText} │");
        }

        output.WriteLine($"└────────────┴────────────┴────────────┘");
        var avg = report.Results.Count > 0 ? report.Results.Average(r => r.TimeMs) : 0;
        output.WriteLine(Paint(Gray, L.T("cli.report.duration", "Süre {sec:0.0} sn · ortalama yanıt {avg:0} ms", ("sec", report.Seconds), ("avg", avg))));

        if (report.StopReason is { } reason)
        {
            output.WriteLine(Paint(Yellow, reason));
        }

        var failures = report.Results.Where(RunReport.Failed).ToList();
        if (failures.Count > 0)
        {
            output.WriteLine();
            output.WriteLine(Paint(Bold, L.T("cli.report.failures", "Başarısızlar")));
            var n = 0;
            foreach (var r in failures)
            {
                var where = report.Iterations > 1 ? L.T("cli.report.where_iteration", " (iterasyon {n})", ("n", r.Iteration + 1)) : string.Empty;
                if (RunReport.IsError(r))
                {
                    output.WriteLine($"{++n}. {r.Name}{where}: {r.Error}");
                }

                foreach (var t in r.Tests.Where(t => t.Status == TestResultDto.Failed))
                {
                    output.WriteLine($"{++n}. {r.Name}{where} › {t.Name}" + (t.Error is null ? string.Empty : $": {t.Error}"));
                }
            }
        }

        output.WriteLine();
        output.WriteLine(report.Succeeded ? Paint(Green + Bold, "✓ " + L.T("cli.report.succeeded", "Başarılı")) : Paint(Red + Bold, "✗ " + (report.Status == RunStatus.Completed ? L.T("cli.report.failed", "Başarısız") : Status(report.Status))));
    }

    private static string Status(RunStatus status) => status switch
    {
        RunStatus.Stopped => L.T("cli.report.status_stopped", "Durduruldu"),
        RunStatus.Failed => L.T("cli.report.status_failed", "Hata ile bitti"),
        _ => L.T("cli.report.status_completed", "Tamamlandı"),
    };

    private static string N(int value) => value.ToString("N0", Lang.Culture);

    private static string Size(long bytes) => bytes switch
    {
        < 1024 => L.T("cli.report.size_b", "{n} B", ("n", bytes)),
        < 1024 * 1024 => L.T("cli.report.size_kb", "{n:0.#} KB", ("n", bytes / 1024.0)),
        _ => L.T("cli.report.size_mb", "{n:0.#} MB", ("n", bytes / 1024.0 / 1024.0)),
    };

}
