using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Xml;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Apivator.Domain.Runs;

namespace Apivator.Cli.Reporters;

/// <summary>Dosyaya yazılan raporlar: JUnit XML (CI test sekmeleri), JSON (makine okuması) ve HTML (paylaşım).</summary>
internal static class FileReporters
{
    private static readonly JsonSerializerOptions Indented = new(ServerClient.Json) { WriteIndented = true };

    private const string Css = """
            :root{--fg:#1f2328;--muted:#57606a;--line:#d0d7de;--ok:#1f8a4c;--bad:#d1383d;--bg:#fff;--soft:#f6f8fa}
            @media (prefers-color-scheme:dark){:root{--fg:#e6edf3;--muted:#8d96a0;--line:#30363d;--ok:#3fb950;--bad:#f85149;--bg:#0d1117;--soft:#161b22}}
            body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg);background:var(--bg);margin:0;padding:24px}
            main{max-width:960px;margin:0 auto} h1{font-size:20px;margin:0 0 4px} .muted{color:var(--muted)}
            .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:20px 0}
            .stat{border:1px solid var(--line);border-radius:8px;padding:12px} .stat b{display:block;font-size:22px}
            .ok{color:var(--ok)} .bad{color:var(--bad)}
            details{border:1px solid var(--line);border-radius:8px;margin:8px 0;background:var(--soft)}
            summary{cursor:pointer;padding:10px 12px;display:flex;gap:10px;align-items:baseline} summary .url{font-family:ui-monospace,monospace;font-size:12px;overflow-wrap:anywhere}
            ul{margin:0;padding:0 12px 10px 32px} li{margin:2px 0} code{font-family:ui-monospace,monospace;font-size:12px}
        """;

    /// <summary>
    /// Her istek yürütmesi bir testsuite, her test bir testcase. İstek hatası (bağlantı, script) ayrı bir
    /// "istek" testcase'inde error olarak yazılır; Jenkins, GitHub ve Azure DevOps bu yapıyı okur.
    /// </summary>
    public static void WriteJUnit(RunReport report, string path)
    {
        var settings = new XmlWriterSettings { Indent = true, Encoding = new UTF8Encoding(false) };
        using var xml = XmlWriter.Create(Prepare(path), settings);
        xml.WriteStartElement("testsuites");
        xml.WriteAttributeString("name", report.Collection);
        xml.WriteAttributeString("tests", Count(report).ToString(CultureInfo.InvariantCulture));
        xml.WriteAttributeString("failures", report.TestsFailed.ToString(CultureInfo.InvariantCulture));
        xml.WriteAttributeString("errors", report.RequestErrors.ToString(CultureInfo.InvariantCulture));
        xml.WriteAttributeString("time", Seconds(report.Seconds));

        foreach (var r in report.Results)
        {
            var name = report.Iterations > 1 ? $"{r.Name} [{r.Iteration + 1}]" : r.Name;
            xml.WriteStartElement("testsuite");
            xml.WriteAttributeString("name", name);
            xml.WriteAttributeString("tests", Math.Max(1, r.Tests.Count + (RunReport.IsError(r) ? 1 : 0)).ToString(CultureInfo.InvariantCulture));
            xml.WriteAttributeString("failures", r.Tests.Count(t => t.Status == TestResultDto.Failed).ToString(CultureInfo.InvariantCulture));
            xml.WriteAttributeString("errors", RunReport.IsError(r) ? "1" : "0");
            xml.WriteAttributeString("skipped", r.Tests.Count(t => t.Status == TestResultDto.Skipped).ToString(CultureInfo.InvariantCulture));
            xml.WriteAttributeString("time", Seconds(r.TimeMs / 1000));
            xml.WriteAttributeString("timestamp", report.StartedAt.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture));

            xml.WriteStartElement("properties");
            Property(xml, "method", r.Method);
            Property(xml, "url", r.Url);
            Property(xml, "status", r.Status?.ToString(CultureInfo.InvariantCulture) ?? string.Empty);
            xml.WriteEndElement();

            if (RunReport.IsError(r) || r.Tests.Count == 0)
            {
                Case(xml, name, $"{r.Method} {r.Url}", r.TimeMs, error: RunReport.IsError(r) ? r.Error : null, skipped: RunReport.IsSkipped(r));
            }

            foreach (var t in r.Tests)
            {
                Case(xml, name, t.Name, 0, failure: t.Status == TestResultDto.Failed ? t.Error ?? L.T("cli.junit.test_failed", "Test başarısız.") : null, skipped: t.Status == TestResultDto.Skipped);
            }

            xml.WriteEndElement();
        }

        xml.WriteEndElement();
    }

    public static void WriteJson(RunReport report, string path)
    {
        var json = new
        {
            collection = report.Collection,
            environment = report.Environment,
            status = report.Status.ToString(),
            succeeded = report.Succeeded,
            stopReason = report.StopReason,
            startedAt = report.StartedAt,
            finishedAt = report.FinishedAt,
            stats = new
            {
                iterations = report.Iterations,
                requests = new { total = report.Requests, failed = report.RequestErrors },
                tests = new { passed = report.TestsPassed, failed = report.TestsFailed, skipped = report.TestsSkipped },
            },
            results = report.Results,
        };
        File.WriteAllText(Prepare(path), JsonSerializer.Serialize(json, Indented));
    }

    public static void WriteHtml(RunReport report, string path)
    {
        static string E(string? s) => WebUtility.HtmlEncode(s ?? string.Empty);
        var html = new StringBuilder();
        html.Append(CultureInfo.InvariantCulture, $$"""
            <!doctype html>
            <html lang="{{Lang.Current}}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>{{E(report.Collection)}} · {{E(L.T("cli.html.title", "Apivator raporu"))}}</title>
            <style>{{Css}}</style></head><body><main>
            <h1>{{E(report.Collection)}}</h1>
            <p class="muted">{{E(report.Environment is null ? L.T("cli.html.no_environment", "Environment yok") : L.T("cli.html.environment", "Environment: {name}", ("name", report.Environment)))}} · {{E(L.T("cli.html.date", "{at:dd.MM.yyyy HH:mm:ss}", ("at", report.StartedAt.ToLocalTime())))}} · {{E(L.T("cli.html.seconds", "{n:0.0} sn", ("n", report.Seconds)))}}</p>
            <p class="{{(report.Succeeded ? "ok" : "bad")}}"><strong>{{(report.Succeeded ? "✓ " + E(L.T("cli.report.succeeded", "Başarılı")) : "✗ " + E(L.T("cli.report.failed", "Başarısız")))}}</strong>{{(report.StopReason is null ? string.Empty : " — " + E(report.StopReason))}}</p>
            <div class="stats">
              <div class="stat"><b>{{report.Iterations}}</b>{{E(L.T("cli.html.stat_iterations", "iterasyon"))}}</div>
              <div class="stat"><b>{{report.Requests}}</b>{{E(L.T("cli.html.stat_requests", "istek"))}}</div>
              <div class="stat"><b class="{{(report.RequestErrors > 0 ? "bad" : string.Empty)}}">{{report.RequestErrors}}</b>{{E(L.T("cli.html.stat_request_errors", "istek hatası"))}}</div>
              <div class="stat"><b class="ok">{{report.TestsPassed}}</b>{{E(L.T("cli.html.stat_tests_passed", "geçen test"))}}</div>
              <div class="stat"><b class="{{(report.TestsFailed > 0 ? "bad" : string.Empty)}}">{{report.TestsFailed}}</b>{{E(L.T("cli.html.stat_tests_failed", "kalan test"))}}</div>
            </div>
            """);
        foreach (var r in report.Results)
        {
            var failed = RunReport.Failed(r);
            html.Append(CultureInfo.InvariantCulture, $"""
                <details{(failed ? " open" : string.Empty)}><summary><span class="{(failed ? "bad" : "ok")}">{(failed ? "✗" : "✓")}</span>
                <strong>{E(r.Name)}</strong>{(report.Iterations > 1 ? $" <span class=\"muted\">#{r.Iteration + 1}</span>" : string.Empty)}
                <span class="url">{E(r.Method)} {E(r.Url)}</span><span class="muted">{r.Status?.ToString(CultureInfo.InvariantCulture) ?? "—"} · {r.TimeMs:0} ms</span></summary><ul>
                """);
            if (r.Error is not null)
            {
                html.Append(CultureInfo.InvariantCulture, $"<li class=\"{(RunReport.IsSkipped(r) ? "muted" : "bad")}\">{E(r.Error)}</li>");
            }

            foreach (var t in r.Tests)
            {
                var cls = t.Status == TestResultDto.Passed ? "ok" : t.Status == TestResultDto.Failed ? "bad" : "muted";
                var mark = t.Status == TestResultDto.Passed ? "✓" : t.Status == TestResultDto.Failed ? "✗" : "–";
                html.Append(CultureInfo.InvariantCulture, $"<li class=\"{cls}\">{mark} {E(t.Name)}{(t.Error is null ? string.Empty : $" — <code>{E(t.Error)}</code>")}</li>");
            }

            if (r.Error is null && r.Tests.Count == 0)
            {
                html.Append(CultureInfo.InvariantCulture, $"<li class=\"muted\">{E(L.T("cli.html.no_tests", "Test yok"))}</li>");
            }

            html.Append("</ul></details>");
        }

        html.Append(CultureInfo.InvariantCulture, $"<p class=\"muted\">{E(L.T("cli.html.footer", "Apivator CLI ile oluşturuldu."))}</p></main></body></html>");
        File.WriteAllText(Prepare(path), html.ToString());
    }

    private static int Count(RunReport report) =>
        report.Results.Sum(r => Math.Max(1, r.Tests.Count + (RunReport.IsError(r) ? 1 : 0)));

    private static void Case(XmlWriter xml, string suite, string name, double timeMs, string? failure = null, string? error = null, bool skipped = false)
    {
        xml.WriteStartElement("testcase");
        xml.WriteAttributeString("classname", suite);
        xml.WriteAttributeString("name", name);
        xml.WriteAttributeString("time", Seconds(timeMs / 1000));
        if (failure is not null)
        {
            xml.WriteStartElement("failure");
            xml.WriteAttributeString("message", failure);
            xml.WriteAttributeString("type", "AssertionFailure");
            xml.WriteString(failure);
            xml.WriteEndElement();
        }
        else if (error is not null)
        {
            xml.WriteStartElement("error");
            xml.WriteAttributeString("message", error);
            xml.WriteAttributeString("type", "RequestError");
            xml.WriteString(error);
            xml.WriteEndElement();
        }
        else if (skipped)
        {
            xml.WriteElementString("skipped", string.Empty);
        }

        xml.WriteEndElement();
    }

    private static void Property(XmlWriter xml, string name, string value)
    {
        xml.WriteStartElement("property");
        xml.WriteAttributeString("name", name);
        xml.WriteAttributeString("value", value);
        xml.WriteEndElement();
    }

    private static string Seconds(double seconds) => seconds.ToString("0.000", CultureInfo.InvariantCulture);

    /// <summary>Klasörü oluşturur; tam yolu döner.</summary>
    private static string Prepare(string path)
    {
        var full = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        return full;
    }
}
