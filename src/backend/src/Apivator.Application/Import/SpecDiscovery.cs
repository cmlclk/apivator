using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Apivator.Application.Import;

/// <summary>Belge sürümü seçeneği (Swagger UI'daki "Select a definition" listesi).</summary>
public sealed record SpecChoice(string Name, string Url);

/// <summary>Bir sayfada ya da script'te bulunanlar.</summary>
internal sealed record PageFindings(List<SpecChoice> Candidates, string? ConfigUrl, string? InlineDocument)
{
    public static PageFindings Empty => new([], null, null);
}

/// <summary>
/// Swagger UI (Swashbuckle, springdoc, swagger-ui-dist, FastAPI, NestJS), ReDoc ve Scalar sayfalarından belge
/// adresini bulur. Yalnızca metin üzerinde çalışır (ağ yok); çekmeyi <see cref="IApiSpecFetcher"/> yapar.
/// </summary>
internal static partial class SpecDiscovery
{
    /// <summary>Yalnızca sunucu adresi verildiğinde sırayla denenen yollar ve sürüm listesinin okunduğu sayfa.</summary>
    public static readonly (string Path, string? VersionsPage)[] KnownPaths =
    [
        ("/swagger/v1/swagger.json", "/swagger/index.html"), // ASP.NET Core (Swashbuckle)
        ("/openapi/v1.json", null), // ASP.NET Core 9+ (Microsoft.AspNetCore.OpenApi)
        ("/v3/api-docs", "/v3/api-docs/swagger-config"), // Spring (springdoc)
        ("/v2/api-docs", null), // Spring (springfox)
        ("/openapi.json", null), // FastAPI
        ("/api-json", null), // NestJS
        ("/q/openapi", null), // Quarkus
        ("/swagger.json", null),
        ("/openapi.yaml", null),
    ];

    private const string PetstoreHost = "petstore.swagger.io";
    private const int MaxScripts = 5;

    [GeneratedRegex(@"(?<![A-Za-z0-9_$])[""']?swaggerDoc[""']?\s*:\s*\{")]
    private static partial Regex InlineDoc();

    [GeneratedRegex(@"(?<![A-Za-z0-9_$])[""']?urls[""']?\s*:\s*\[")]
    private static partial Regex UrlsArray();

    [GeneratedRegex(@"(?<![A-Za-z0-9_$])[""']?configUrl[""']?\s*:\s*[""']([^""'\s]+)[""']")]
    private static partial Regex ConfigUrl();

    [GeneratedRegex(@"(?<![A-Za-z0-9_$.\-])[""']?url[""']?\s*:\s*[""']([^""'\s]+)[""']")]
    private static partial Regex SingleUrl();

    [GeneratedRegex(@"(?<![A-Za-z0-9_$.\-])[""']?name[""']?\s*:\s*[""']([^""']+)[""']")]
    private static partial Regex NameProperty();

    [GeneratedRegex(@"(?:spec-url|data-url)\s*=\s*[""']([^""'\s]+)[""']", RegexOptions.IgnoreCase)]
    private static partial Regex UrlAttribute();

    [GeneratedRegex(@"Redoc\.init\(\s*[""']([^""'\s]+)[""']")]
    private static partial Regex RedocInit();

    [GeneratedRegex(@"<script\b[^>]*\bsrc\s*=\s*[""']([^""']+)[""']", RegexOptions.IgnoreCase)]
    private static partial Regex ScriptSource();

    [GeneratedRegex(@"(swagger|initializer|init|index|config|redoc|scalar|api-reference)[^/]*\.js$", RegexOptions.IgnoreCase)]
    private static partial Regex InterestingScript();

    public static bool IsHtml(string text, string? contentType) =>
        (contentType?.Contains("html", StringComparison.OrdinalIgnoreCase) ?? false)
        || text.TrimStart().StartsWith('<');

    public static bool IsScript(string? contentType, Uri uri) =>
        (contentType?.Contains("javascript", StringComparison.OrdinalIgnoreCase) ?? false)
        || uri.AbsolutePath.EndsWith(".js", StringComparison.OrdinalIgnoreCase);

    /// <summary>Sayfanın yüklediği, aynı sunucudaki ve yapılandırma içerebilecek script'ler.</summary>
    public static List<Uri> Scripts(string html, Uri page)
    {
        var result = new List<Uri>();
        foreach (Match match in ScriptSource().Matches(html))
        {
            if (Uri.TryCreate(page, System.Net.WebUtility.HtmlDecode(match.Groups[1].Value), out var uri)
                && SameOrigin(uri, page)
                && InterestingScript().IsMatch(uri.AbsolutePath)
                && !uri.AbsolutePath.Contains("bundle", StringComparison.OrdinalIgnoreCase)
                && !uri.AbsolutePath.Contains("standalone", StringComparison.OrdinalIgnoreCase)
                && !result.Contains(uri))
            {
                result.Add(uri);
                if (result.Count == MaxScripts)
                {
                    break;
                }
            }
        }

        return result;
    }

    /// <summary>Sayfa ya da script metnindeki belge adresleri, yapılandırma adresi ve gömülü belge.</summary>
    public static PageFindings Scan(string text, Uri source)
    {
        var candidates = new List<SpecChoice>();
        string? inline = null;

        // NestJS: belge script'in içinde ("swaggerDoc": {...}).
        if (InlineDoc().Match(text) is { Success: true } doc
            && Balanced(text, doc.Index + doc.Length - 1) is { } json
            && TryJson(json) is JsonObject inlineDocument
            && (inlineDocument.ContainsKey("openapi") || inlineDocument.ContainsKey("swagger")))
        {
            inline = json;
        }

        // Birden çok sürüm: urls: [{ url, name }, ...]
        foreach (Match match in UrlsArray().Matches(text))
        {
            if (Balanced(text, match.Index + match.Length - 1) is not { } array)
            {
                continue;
            }

            if (TryJson(array) is JsonArray items)
            {
                foreach (var item in items.OfType<JsonObject>())
                {
                    if (item["url"] is JsonValue u && u.TryGetValue<string>(out var url))
                    {
                        var name = item["name"] is JsonValue n && n.TryGetValue<string>(out var s) ? s : null;
                        Add(candidates, source, url, name);
                    }
                }

                continue;
            }

            // JSON değilse (JS nesne yazımı) her { ... } içinden url ve name.
            for (var i = array.IndexOf('{', StringComparison.Ordinal); i >= 0; i = array.IndexOf('{', i + 1))
            {
                if (Balanced(array, i) is { } item && SingleUrl().Match(item) is { Success: true } url)
                {
                    var name = NameProperty().Match(item) is { Success: true } n ? n.Groups[1].Value : null;
                    Add(candidates, source, Unescape(url.Groups[1].Value), name);
                    i += item.Length - 1;
                }
            }
        }

        var configUrl = ConfigUrl().Match(text) is { Success: true } config
            && Uri.TryCreate(source, Unescape(config.Groups[1].Value), out var configUri)
            ? configUri.ToString()
            : null;

        if (candidates.Count == 0)
        {
            foreach (var match in SingleUrl().Matches(text).Concat(UrlAttribute().Matches(text)).Concat(RedocInit().Matches(text)))
            {
                Add(candidates, source, Unescape(match.Groups[1].Value), null);
            }
        }

        // swagger-ui-dist'in varsayılan örneği (petstore) başka bir ipucu varsa yok sayılır.
        if (configUrl is not null || inline is not null || candidates.Any(c => !IsPetstore(c.Url)))
        {
            candidates.RemoveAll(c => IsPetstore(c.Url));
        }

        return new PageFindings(candidates, configUrl, inline);
    }

    /// <summary>springdoc'un /v3/api-docs/swagger-config yanıtı: { url } ya da { urls: [...] }.</summary>
    public static List<SpecChoice> ConfigChoices(string json, Uri source)
    {
        var result = new List<SpecChoice>();
        if (TryJson(json) is not JsonObject config)
        {
            return result;
        }

        foreach (var item in config["urls"] as JsonArray ?? [])
        {
            if (item?["url"] is JsonValue u && u.TryGetValue<string>(out var url))
            {
                Add(result, source, url, item["name"] is JsonValue n && n.TryGetValue<string>(out var s) ? s : null);
            }
        }

        if (result.Count == 0 && config["url"] is JsonValue single && single.TryGetValue<string>(out var only))
        {
            Add(result, source, only, null);
        }

        return result;
    }

    public static bool SameOrigin(Uri a, Uri b) =>
        string.Equals(a.Scheme, b.Scheme, StringComparison.OrdinalIgnoreCase)
        && string.Equals(a.Host, b.Host, StringComparison.OrdinalIgnoreCase)
        && a.Port == b.Port;

    /// <summary>Adres yalnızca bir sunucu/kök gibi mi görünüyor (dosya adı yok); öyleyse bilinen yollar denenir.</summary>
    public static bool LooksLikeBase(Uri uri)
    {
        var last = uri.AbsolutePath.TrimEnd('/').Split('/')[^1];
        return !last.Contains('.', StringComparison.Ordinal);
    }

    private static void Add(List<SpecChoice> list, Uri source, string url, string? name)
    {
        if (string.IsNullOrWhiteSpace(url) || url.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
            || url.EndsWith(".js", StringComparison.OrdinalIgnoreCase) || url.EndsWith(".css", StringComparison.OrdinalIgnoreCase)
            || url.EndsWith(".html", StringComparison.OrdinalIgnoreCase) || url.EndsWith(".png", StringComparison.OrdinalIgnoreCase)
            || url.Contains("oauth2-redirect", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        if (!Uri.TryCreate(source, url, out var absolute) || absolute.Scheme is not ("http" or "https"))
        {
            return;
        }

        var text = absolute.ToString();
        if (list.Any(c => c.Url == text))
        {
            return;
        }

        list.Add(new SpecChoice(string.IsNullOrWhiteSpace(name) ? DefaultName(absolute) : name.Trim(), text));
    }

    /// <summary>"/swagger/v1/swagger.json" → "v1"; aksi halde yol.</summary>
    private static string DefaultName(Uri uri)
    {
        var segments = uri.AbsolutePath.Trim('/').Split('/');
        var version = segments.FirstOrDefault(s => s.Length > 1 && (s[0] is 'v' or 'V') && char.IsDigit(s[1]));
        return version ?? uri.AbsolutePath;
    }

    private static bool IsPetstore(string url) => url.Contains(PetstoreHost, StringComparison.OrdinalIgnoreCase);

    /// <summary>JS dizesindeki kaçışlar ("\/", "/").</summary>
    private static string Unescape(string value) =>
        value.Contains('\\', StringComparison.Ordinal) ? Regex.Unescape(value) : value;

    private static JsonNode? TryJson(string text)
    {
        try
        {
            return JsonNode.Parse(text, documentOptions: new JsonDocumentOptions { AllowTrailingCommas = true, MaxDepth = 256 });
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>start'taki { ya da [ ile eşleşen kapanışa kadar olan metin (dize içindeki parantezler sayılmaz).</summary>
    internal static string? Balanced(string text, int start)
    {
        var open = text[start];
        var close = open == '{' ? '}' : ']';
        var depth = 0;
        char? quote = null;
        for (var i = start; i < text.Length; i++)
        {
            var c = text[i];
            if (quote is not null)
            {
                if (c == '\\')
                {
                    i++;
                }
                else if (c == quote)
                {
                    quote = null;
                }

                continue;
            }

            if (c is '"' or '\'' or '`')
            {
                quote = c;
            }
            else if (c == open)
            {
                depth++;
            }
            else if (c == close && --depth == 0)
            {
                return text[start..(i + 1)];
            }
        }

        return null;
    }
}
