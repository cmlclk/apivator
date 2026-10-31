using System.Globalization;
using System.Text;
using System.Text.Json;
using Apivator.Application.Common.Localization;
using Apivator.Domain.Collections;

namespace Apivator.Application.Import;

/// <summary>
/// HAR (HTTP Archive 1.2) dosyasını collection'a çevirir: tarayıcı geliştirici araçlarından ya da proxy'lerden
/// kaydedilen her istek bir istek olur, yanıtı örnek yanıt olarak eklenir. Birden çok host varsa istekler
/// host'a göre klasörlenir. Aynı method ve URL'ye tekrar eden istekler tek istekte toplanır (ilk
/// <see cref="MaxExamplesPerRequest"/> yanıt örnek olur). Resim, stil, script ve font istekleri atlanır;
/// bağlantıya özgü header'lar (Host, Content-Length, HTTP/2 sözde header'ları…) alınmaz.
/// </summary>
internal sealed class HarParser
{
    private const int MaxExamplesPerRequest = 5;

    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };

    private static readonly HashSet<string> SkippedHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer",
        "proxy-connection", "accept-encoding",
    };

    private static readonly HashSet<string> SkippedResourceTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image", "stylesheet", "script", "font", "media", "manifest", "texttrack", "imageset", "ping",
    };

    private readonly List<string> _warnings = [];
    private int _examples;

    public IReadOnlyList<string> Warnings => _warnings;

    public int ExampleCount => _examples;

    public static bool IsHar(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object
        && root.TryGetProperty("log", out var log)
        && log.ValueKind == JsonValueKind.Object
        && log.TryGetProperty("entries", out var entries)
        && entries.ValueKind == JsonValueKind.Array;

    public ParsedCollection Parse(JsonElement root)
    {
        var log = root.GetProperty("log");
        var byKey = new Dictionary<string, Draft>(StringComparer.Ordinal);
        var order = new List<Draft>();
        int skippedAssets = 0, skippedInvalid = 0;
        var truncated = false;

        foreach (var entry in log.GetProperty("entries").EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.Object || !entry.TryGetProperty("request", out var request) || request.ValueKind != JsonValueKind.Object)
            {
                skippedInvalid++;
                continue;
            }

            var method = Text(request, "method").Trim().ToUpperInvariant();
            var url = Text(request, "url").Trim();
            if (method.Length == 0 || !Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
            {
                skippedInvalid++;
                continue;
            }

            entry.TryGetProperty("response", out var response);
            if (IsAsset(entry, response))
            {
                skippedAssets++;
                continue;
            }

            var key = method + " " + url;
            if (!byKey.TryGetValue(key, out var draft))
            {
                if (order.Count >= PostmanParser.MaxItems)
                {
                    truncated = true;
                    continue;
                }

                if (url.Length > RequestDefinition.UrlMaxLength)
                {
                    skippedInvalid++;
                    continue;
                }

                draft = new Draft(uri.Host, Name(method, uri), new RequestDefinition
                {
                    Method = method,
                    Url = url,
                    Headers = Headers(request),
                    Body = Body(request),
                });
                byKey[key] = draft;
                order.Add(draft);
            }

            if (draft.Examples.Count < MaxExamplesPerRequest && Example(response, draft.Definition) is { } example)
            {
                draft.Examples.Add(example);
                _examples++;
            }
        }

        if (skippedAssets > 0)
        {
            _warnings.Add(L.T("import.har_assets", "{count} statik dosya isteği (resim, stil, script, font) atlandı.", ("count", skippedAssets)));
        }

        if (skippedInvalid > 0)
        {
            _warnings.Add(L.T("import.har_invalid", "{count} kayıt HTTP(S) isteği olmadığı ya da okunamadığı için atlandı.", ("count", skippedInvalid)));
        }

        if (truncated)
        {
            _warnings.Add(L.T("import.har_truncated", "İlk {max} farklı istekten sonrası içe aktarılmadı.", ("max", PostmanParser.MaxItems)));
        }

        var hosts = order.Select(d => d.Host).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        IReadOnlyList<ParsedItem> items = hosts.Count > 1
            ? hosts.Select(h => (ParsedItem)new ParsedFolder(
                h,
                RequestAuth.Inherit,
                ScriptSet.Empty,
                order.Where(d => d.Host.Equals(h, StringComparison.OrdinalIgnoreCase)).Select(d => d.ToParsed()).ToList())).ToList()
            : order.Select(d => (ParsedItem)d.ToParsed()).ToList();

        return new ParsedCollection(CollectionName(log, hosts), Description(log), RequestAuth.Inherit, [], ScriptSet.Empty, items);
    }

    private static string CollectionName(JsonElement log, List<string> hosts)
    {
        if (log.TryGetProperty("pages", out var pages) && pages.ValueKind == JsonValueKind.Array)
        {
            foreach (var page in pages.EnumerateArray())
            {
                var title = Text(page, "title").Trim();
                if (title.Length > 0 && !title.StartsWith("http", StringComparison.OrdinalIgnoreCase))
                {
                    return title;
                }
            }
        }

        return hosts.Count == 1 ? $"HAR · {hosts[0]}" : L.T("import.har_default_name", "HAR içe aktarma");
    }

    private static string? Description(JsonElement log)
    {
        if (!log.TryGetProperty("creator", out var creator) || creator.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var name = Text(creator, "name").Trim();
        var version = Text(creator, "version").Trim();
        return name.Length == 0 ? null : L.T("import.har_description", "{creator} ile kaydedilen HAR dosyasından içe aktarıldı.", ("creator", $"{name} {version}".Trim()));
    }

    private static string Name(string method, Uri uri)
    {
        var path = uri.AbsolutePath;
        var name = $"{method} {(path.Length > 0 ? path : "/")}";
        return name.Length > 120 ? name[..117] + "…" : name;
    }

    private static bool IsAsset(JsonElement entry, JsonElement response)
    {
        if (entry.TryGetProperty("_resourceType", out var type) && type.ValueKind == JsonValueKind.String && SkippedResourceTypes.Contains(type.GetString()!))
        {
            return true;
        }

        if (response.ValueKind == JsonValueKind.Object && response.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Object)
        {
            var mime = Text(content, "mimeType").Split(';')[0].Trim().ToLowerInvariant();
            return mime.StartsWith("image/", StringComparison.Ordinal) || mime.StartsWith("font/", StringComparison.Ordinal)
                || mime.StartsWith("video/", StringComparison.Ordinal) || mime.StartsWith("audio/", StringComparison.Ordinal)
                || mime is "text/css" or "text/javascript" or "application/javascript" or "application/x-javascript";
        }

        return false;
    }

    private static List<KeyValueItem> Headers(JsonElement message)
    {
        var headers = new List<KeyValueItem>();
        if (!message.TryGetProperty("headers", out var array) || array.ValueKind != JsonValueKind.Array)
        {
            return headers;
        }

        foreach (var header in array.EnumerateArray())
        {
            var name = Text(header, "name").Trim();
            if (name.Length == 0 || name.StartsWith(':') || SkippedHeaders.Contains(name))
            {
                continue;
            }

            headers.Add(new KeyValueItem(name, Text(header, "value")));
        }

        return headers;
    }

    private static RequestBody Body(JsonElement request)
    {
        if (!request.TryGetProperty("postData", out var post) || post.ValueKind != JsonValueKind.Object)
        {
            return RequestBody.None;
        }

        var mime = Text(post, "mimeType").Split(';')[0].Trim().ToLowerInvariant();
        var text = Text(post, "text");
        var parameters = post.TryGetProperty("params", out var p) && p.ValueKind == JsonValueKind.Array ? p.EnumerateArray().ToList() : [];

        if (mime == "multipart/form-data" && parameters.Count > 0)
        {
            return new RequestBody
            {
                Mode = BodyMode.FormData,
                Form = parameters.Select(x => Text(x, "fileName") is { Length: > 0 } file
                    ? new KeyValueItem(Text(x, "name"), file, Type: FormFieldType.File)
                    : new KeyValueItem(Text(x, "name"), Text(x, "value"))).ToList(),
            };
        }

        if (mime == "application/x-www-form-urlencoded")
        {
            var form = parameters.Count > 0
                ? parameters.Select(x => new KeyValueItem(Decode(Text(x, "name")), Decode(Text(x, "value")))).ToList()
                : text.Split('&', StringSplitOptions.RemoveEmptyEntries).Select(pair =>
                {
                    var eq = pair.IndexOf('=', StringComparison.Ordinal);
                    return eq >= 0 ? new KeyValueItem(Decode(pair[..eq]), Decode(pair[(eq + 1)..])) : new KeyValueItem(Decode(pair), string.Empty);
                }).ToList();
            return new RequestBody { Mode = BodyMode.UrlEncoded, Form = form };
        }

        if (text.Length == 0)
        {
            return RequestBody.None;
        }

        // GraphQL istekleri JSON gövdeyle gelir; "query" alanı varsa GraphQL moduna çevrilir.
        if (mime.Contains("json", StringComparison.Ordinal) && TryGraphQl(text) is { } graphQl)
        {
            return graphQl;
        }

        return new RequestBody
        {
            Mode = BodyMode.Raw,
            RawLanguage = mime.Contains("json", StringComparison.Ordinal) ? RawLanguage.Json
                : mime.Contains("xml", StringComparison.Ordinal) ? RawLanguage.Xml
                : mime.Contains("html", StringComparison.Ordinal) ? RawLanguage.Html
                : RawLanguage.Text,
            Raw = text,
        };
    }

    private static RequestBody? TryGraphQl(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.ValueKind != JsonValueKind.Object
                || !doc.RootElement.TryGetProperty("query", out var query) || query.ValueKind != JsonValueKind.String
                || !query.GetString()!.TrimStart().StartsWith('{') && !LooksLikeGraphQlOperation(query.GetString()!))
            {
                return null;
            }

            var variables = doc.RootElement.TryGetProperty("variables", out var v) && v.ValueKind == JsonValueKind.Object
                ? JsonSerializer.Serialize(v, Indented)
                : string.Empty;
            return new RequestBody { Mode = BodyMode.GraphQL, Raw = query.GetString()!, GraphqlVariables = variables };
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static bool LooksLikeGraphQlOperation(string query)
    {
        var trimmed = query.TrimStart();
        return trimmed.StartsWith("query", StringComparison.Ordinal) || trimmed.StartsWith("mutation", StringComparison.Ordinal)
            || trimmed.StartsWith("subscription", StringComparison.Ordinal) || trimmed.StartsWith("fragment", StringComparison.Ordinal);
    }

    private ParsedExample? Example(JsonElement response, RequestDefinition request)
    {
        if (response.ValueKind != JsonValueKind.Object || !response.TryGetProperty("status", out var s) || !s.TryGetInt32(out var status) || status is < 100 or > 599)
        {
            // Durumu 0 olan kayıtlar (iptal edilen, engellenen istekler) örnek olmaz.
            return null;
        }

        var body = string.Empty;
        if (response.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Object)
        {
            body = Text(content, "text");
            if (Text(content, "encoding").Equals("base64", StringComparison.OrdinalIgnoreCase) && body.Length > 0)
            {
                body = DecodeBase64Text(body) ?? string.Empty;
                if (body.Length == 0)
                {
                    _warnings.Add(L.T("import.har_binary_body", "{method} {url}: ikili (binary) yanıt gövdesi örneğe alınmadı.", ("method", request.Method), ("url", request.Url)));
                }
            }
        }

        if (body.Length > ResponseExample.BodyMaxLength)
        {
            _warnings.Add(L.T("import.har_large_body", "{method} {url}: yanıt gövdesi çok büyük olduğu için örneğe alınmadı.", ("method", request.Method), ("url", request.Url)));
            body = string.Empty;
        }

        var statusText = Text(response, "statusText").Trim();
        var name = statusText.Length > 0 ? $"{status.ToString(CultureInfo.InvariantCulture)} {statusText}" : status.ToString(CultureInfo.InvariantCulture);
        var headers = Headers(response).Where(h => !h.Key.Equals("content-encoding", StringComparison.OrdinalIgnoreCase)).Take(ResponseExample.MaxHeaders).ToList();
        return new ParsedExample(name, status, headers, body, request);
    }

    /// <summary>Base64 içerik geçerli UTF-8 metinse çözülür; ikili içerik için null.</summary>
    private static string? DecodeBase64Text(string value)
    {
        try
        {
            var bytes = Convert.FromBase64String(value);
            var text = new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(bytes);
            return text.Contains('\0', StringComparison.Ordinal) ? null : text;
        }
        catch (Exception e) when (e is FormatException or DecoderFallbackException)
        {
            return null;
        }
    }

    private static string Decode(string value)
    {
        try
        {
            return Uri.UnescapeDataString(value.Replace('+', ' '));
        }
        catch (UriFormatException)
        {
            return value;
        }
    }

    private static string Text(JsonElement element, string name) =>
        element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()!
            : string.Empty;

    private sealed class Draft(string host, string name, RequestDefinition definition)
    {
        public string Host { get; } = host;

        public RequestDefinition Definition { get; } = definition;

        public List<ParsedExample> Examples { get; } = [];

        public ParsedRequest ToParsed() => new(name, Definition, Examples);
    }
}
