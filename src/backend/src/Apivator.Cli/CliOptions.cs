using Apivator.Application.Common.Localization;

namespace Apivator.Cli;

internal sealed class UsageException(string message) : Exception(message);

/// <summary>"apivator run" seçenekleri. Adlar newman'a yakındır; Postman'den geçen ekipler tanıdık bulsun.</summary>
internal sealed record RunOptions
{
    public required string Collection { get; init; }

    public string? Environment { get; init; }

    public string? Globals { get; init; }

    public string? IterationData { get; init; }

    public int? Iterations { get; init; }

    public string? Folder { get; init; }

    public int DelayMs { get; init; }

    public bool Bail { get; init; }

    public List<KeyValuePair<string, string>> EnvVars { get; init; } = [];

    public List<KeyValuePair<string, string>> GlobalVars { get; init; } = [];

    public int? TimeoutMs { get; init; }

    public bool Insecure { get; init; }

    public List<string> CaCertificates { get; init; } = [];

    public List<string> Reporters { get; init; } = ["cli"];

    public string? JUnitPath { get; init; }

    public string? JsonPath { get; init; }

    public string? HtmlPath { get; init; }

    public string? Server { get; init; }

    public string? ApiKey { get; init; }

    public string? Workspace { get; init; }

    public bool NoReport { get; init; }

    public bool SuppressExitCode { get; init; }

    public bool Verbose { get; init; }
}

internal sealed record ListOptions(string? Server, string? ApiKey, string? Workspace);

internal static class CliOptions
{
    /// <summary>Yardım metni; satırlar çağrı anında etkin dile göre seçilir.</summary>
    public static string Usage() => string.Join(Environment.NewLine,
    [
        L.T("cli.help.line1", "Apivator CLI — collection'ları komut satırında ve CI'da çalıştırır."),
        string.Empty,
        L.T("cli.help.line2", "Kullanım:"),
        L.T("cli.help.line3", "  apivator run <collection> [seçenekler]"),
        L.T("cli.help.line4", "  apivator list [--workspace <ad|id>]"),
        L.T("cli.help.line5", "  apivator --version"),
        string.Empty,
        L.T("cli.help.line6", "<collection>:"),
        L.T("cli.help.line7", "  Bir dosya (Postman v2.1 ya da Apivator'dan dışa aktarılmış .json) veya sunucudaki collection'ın adı ya da"),
        L.T("cli.help.line7b", "  kimliği. Sunucu için --server ve --api-key gerekir (ya da APIVATOR_SERVER ve APIVATOR_API_KEY)."),
        string.Empty,
        L.T("cli.help.line8", "Seçenekler:"),
        L.T("cli.help.opt_environment", "  -e, --environment <dosya|ad|id>   Environment (sunucuda adı ya da kimliği)"),
        L.T("cli.help.opt_globals", "  -g, --globals <dosya>             Globals dosyası (sunucuda workspace globals'ı kendiliğinden kullanılır)"),
        L.T("cli.help.opt_iteration_data", "  -d, --iteration-data <dosya>      CSV ya da JSON veri dosyası; her satır bir iterasyon"),
        L.T("cli.help.opt_iteration_count", "  -n, --iteration-count <sayı>      İterasyon sayısı"),
        L.T("cli.help.opt_folder", "      --folder <ad>                 Yalnızca bu klasörü çalıştır"),
        L.T("cli.help.opt_delay_request", "      --delay-request <ms>          İstekler arası bekleme"),
        L.T("cli.help.opt_bail", "      --bail                        İlk başarısız istek ya da testte dur"),
        L.T("cli.help.opt_env_var", "      --env-var <anahtar=değer>     Environment değişkeni ekle/ez (tekrarlanabilir)"),
        L.T("cli.help.opt_global_var", "      --global-var <anahtar=değer>  Global değişken ekle/ez (tekrarlanabilir)"),
        L.T("cli.help.opt_timeout_request", "      --timeout-request <ms>        İstek başına zaman aşımı (varsayılan 30000)"),
        L.T("cli.help.opt_insecure", "  -k, --insecure                    SSL sertifikasını doğrulama"),
        L.T("cli.help.opt_ca_cert", "      --ca-cert <dosya>             Güvenilecek ek CA sertifikası (PEM/CRT/DER; tekrarlanabilir)"),
        L.T("cli.help.opt_reporters", "  -r, --reporters <liste>           cli,junit,json,html (virgülle; varsayılan cli)"),
        L.T("cli.help.opt_reporter_junit_export", "      --reporter-junit-export <yol> JUnit XML dosyası (varsayılan apivator-report.xml)"),
        L.T("cli.help.opt_reporter_json_export", "      --reporter-json-export <yol>  JSON rapor dosyası (varsayılan apivator-report.json)"),
        L.T("cli.help.opt_reporter_html_export", "      --reporter-html-export <yol>  HTML rapor dosyası (varsayılan apivator-report.html)"),
        L.T("cli.help.opt_server", "      --server <url>                Apivator sunucusu (APIVATOR_SERVER)"),
        L.T("cli.help.opt_api_key", "      --api-key <anahtar>           Kişisel API anahtarı (APIVATOR_API_KEY)"),
        L.T("cli.help.opt_workspace", "  -w, --workspace <ad|id>           Collection'ı bu workspace'te ara"),
        L.T("cli.help.opt_no_report", "      --no-report                   Sonucu sunucuya kaydetme"),
        L.T("cli.help.opt_suppress_exit_code", "      --suppress-exit-code          Testler başarısız olsa da 0 ile çık"),
        L.T("cli.help.opt_verbose", "      --verbose                     Script konsol çıktısını da yaz"),
        L.T("cli.help.opt_lang", "      --lang <tr|en>                Arayüz dili (APIVATOR_LANG; varsayılan işletim sistemi dili)"),
        L.T("cli.help.opt_no_color", "      --no-color                    Renkli çıktı kullanma (NO_COLOR da geçerli)"),
        string.Empty,
        L.T("cli.help.line9", "Çıkış kodları: 0 başarılı, 1 başarısız test ya da istek, 2 kullanım ya da bağlantı hatası."),
    ]);

    /// <summary>Komut ve seçenekleri ayrıştırır. "--ad değer" ve "--ad=değer" biçimleri desteklenir.</summary>
    public static (string Command, Dictionary<string, List<string>> Values, List<string> Positional) Parse(string[] args)
    {
        if (args.Length == 0)
        {
            return ("help", [], []);
        }

        var command = args[0] switch
        {
            "-h" or "--help" or "help" => "help",
            "-v" or "--version" or "version" => "version",
            _ => args[0],
        };

        var values = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var positional = new List<string>();
        for (var i = 1; i < args.Length; i++)
        {
            var arg = args[i];
            if (!arg.StartsWith('-') || arg == "-")
            {
                positional.Add(arg);
                continue;
            }

            string name;
            string? value = null;
            var eq = arg.IndexOf('=', StringComparison.Ordinal);
            if (arg.StartsWith("--", StringComparison.Ordinal) && eq > 0)
            {
                name = Canonical(arg[..eq]);
                value = arg[(eq + 1)..];
            }
            else
            {
                name = Canonical(arg);
            }

            if (Flags.Contains(name))
            {
                values[name] = [value ?? "true"];
                continue;
            }

            if (!WithValue.Contains(name))
            {
                throw new UsageException(L.T("cli.error.unknown_option", "Bilinmeyen seçenek: {arg}. Yardım için: apivator --help", ("arg", arg)));
            }

            if (value is null)
            {
                if (i + 1 >= args.Length)
                {
                    throw new UsageException(L.T("cli.error.needs_value", "{arg} bir değer bekliyor.", ("arg", arg)));
                }

                value = args[++i];
            }

            if (!values.TryGetValue(name, out var list))
            {
                values[name] = list = [];
            }

            list.Add(value);
        }

        return (command, values, positional);
    }

    public static RunOptions ToRun(Dictionary<string, List<string>> v, List<string> positional, Func<string, string?> env)
    {
        if (positional.Count != 1)
        {
            throw new UsageException(L.T("cli.error.collection_required", "Çalıştırılacak collection'ı verin: apivator run <dosya|ad|id>"));
        }

        string? One(string name) => v.TryGetValue(name, out var list) ? list[^1] : null;
        List<string> All(string name) => v.TryGetValue(name, out var list) ? list : [];
        int? Int(string name, int min, int max)
        {
            if (One(name) is not { } text)
            {
                return null;
            }

            return int.TryParse(text, out var n) && n >= min && n <= max
                ? n
                : throw new UsageException(L.T("cli.error.number_range", "--{name} {min} ile {max} arasında bir sayı olmalı.", ("name", name), ("min", min), ("max", max)));
        }

        var reporters = All("reporters").SelectMany(r => r.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)).Select(r => r.ToLowerInvariant()).ToList();
        foreach (var r in reporters.Where(r => r is not ("cli" or "junit" or "json" or "html")))
        {
            throw new UsageException(L.T("cli.error.unknown_reporter", "Bilinmeyen raporlayıcı: {name} (cli, junit, json, html)", ("name", r)));
        }

        // Dışa aktarma yolu verilen raporlayıcı ayrıca istenmese de açılır.
        if (One("reporter-junit-export") is not null && !reporters.Contains("junit"))
        {
            reporters.Add("junit");
        }

        if (One("reporter-json-export") is not null && !reporters.Contains("json"))
        {
            reporters.Add("json");
        }

        if (One("reporter-html-export") is not null && !reporters.Contains("html"))
        {
            reporters.Add("html");
        }

        return new RunOptions
        {
            Collection = positional[0],
            Environment = One("environment"),
            Globals = One("globals"),
            IterationData = One("iteration-data"),
            Iterations = Int("iteration-count", 1, Apivator.Application.Runs.RunLimits.MaxIterations),
            Folder = One("folder"),
            DelayMs = Int("delay-request", 0, Apivator.Application.Runs.RunLimits.MaxDelayMs) ?? 0,
            Bail = One("bail") is not null,
            EnvVars = All("env-var").Select(Pair).ToList(),
            GlobalVars = All("global-var").Select(Pair).ToList(),
            TimeoutMs = Int("timeout-request", 1, 600_000),
            Insecure = One("insecure") is not null,
            CaCertificates = All("ca-cert"),
            Reporters = reporters.Count == 0 ? ["cli"] : reporters.Distinct().ToList(),
            JUnitPath = One("reporter-junit-export"),
            JsonPath = One("reporter-json-export"),
            HtmlPath = One("reporter-html-export"),
            Server = One("server") ?? env("APIVATOR_SERVER"),
            ApiKey = One("api-key") ?? env("APIVATOR_API_KEY"),
            Workspace = One("workspace"),
            NoReport = One("no-report") is not null,
            SuppressExitCode = One("suppress-exit-code") is not null,
            Verbose = One("verbose") is not null,
        };
    }

    /// <summary>
    /// Etkin dil: --lang, APIVATOR_LANG, işletim sistemi dili, Türkçe sırasıyla. Seçenekler ayrıştırılmadan önce
    /// belli olsun diye argümanlar ham taranır; geçersiz değer burada yutulur, ayrıştırmadan sonra bildirilir.
    /// </summary>
    public static string ResolveLanguage(string[] args, Func<string, string?> env, string? systemLanguage) =>
        Lang.Match(RawLang(args)) ?? Lang.Match(env("APIVATOR_LANG")) ?? Lang.Match(systemLanguage) ?? Lang.Default;

    public static string? RawLang(string[] args)
    {
        // Parse ile aynı yürüyüş: başka bir seçeneğin değeri olarak geçen "--lang" (ör. --env-var --lang=en) sayılmaz.
        string? value = null;
        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            if (!arg.StartsWith('-') || arg == "-")
            {
                continue;
            }

            var eq = arg.StartsWith("--", StringComparison.Ordinal) ? arg.IndexOf('=', StringComparison.Ordinal) : -1;
            var name = Canonical(eq > 0 ? arg[..eq] : arg);
            if (name == "lang")
            {
                value = eq > 0 ? arg[(eq + 1)..] : i + 1 < args.Length ? args[++i] : null;
            }
            else if (eq < 0 && WithValue.Contains(name))
            {
                i++;
            }
        }

        return value;
    }

    private static KeyValuePair<string, string> Pair(string text)
    {
        var eq = text.IndexOf('=', StringComparison.Ordinal);
        return eq > 0
            ? new(text[..eq], text[(eq + 1)..])
            : throw new UsageException(L.T("cli.error.bad_pair", "Değişken anahtar=değer biçiminde olmalı: {text}", ("text", text)));
    }

    private static string Canonical(string arg) => arg switch
    {
        "-e" => "environment",
        "-g" => "globals",
        "-d" => "iteration-data",
        "-n" => "iteration-count",
        "-k" => "insecure",
        "-r" => "reporters",
        "-w" => "workspace",
        _ when arg.StartsWith("--", StringComparison.Ordinal) => arg[2..],
        _ => arg,
    };

    private static readonly HashSet<string> Flags = new(StringComparer.Ordinal)
    {
        "bail", "insecure", "no-report", "suppress-exit-code", "verbose", "no-color",
    };

    private static readonly HashSet<string> WithValue = new(StringComparer.Ordinal)
    {
        "environment", "globals", "iteration-data", "iteration-count", "folder", "delay-request", "env-var", "global-var",
        "timeout-request", "ca-cert", "reporters", "reporter-junit-export", "reporter-json-export", "reporter-html-export",
        "server", "api-key", "workspace", "lang",
    };
}
