using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Apivator.Application.Common.Localization;
using Apivator.Domain.Collections;
using Apivator.Domain.Variables;

namespace Apivator.Application.Import;

/// <summary>
/// OpenAPI 3.x belgesini collection'a çevirir: her işlem bir istek, ilk etiket klasör olur. Yol parametreleri
/// collection değişkeni ({{ad}}), sunucu adresi {{baseUrl}} olur. Body örneği belgeden ya da şemadan üretilir;
/// yanıt örnekleri istek örneği (Example) olarak eklenir. Yalnızca belge içi ($ref "#/...") referanslar çözülür.
/// </summary>
internal sealed partial class OpenApiParser(JsonElement root)
{
    private const int MaxDepth = 8;
    private const int MaxExamplesPerOperation = 5;
    private static readonly string[] Methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private readonly List<string> _warnings = [];
    private readonly List<Variable> _variables = [];
    private readonly HashSet<string> _externalRefs = [];
    private int _examples;

    public IReadOnlyList<string> Warnings => _warnings;

    public int ExampleCount => _examples;

    public static bool IsOpenApi3(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty("openapi", out var v) && v.ValueKind == JsonValueKind.String
        && (v.GetString() ?? string.Empty).StartsWith('3');

    public static bool IsSwagger2(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty("swagger", out var v) && v.ValueKind == JsonValueKind.String;

    [GeneratedRegex(@"\{([^{}/]+)\}")]
    private static partial Regex PathParameter();

    public ParsedCollection Parse()
    {
        var info = Property(root, "info");
        var name = Text(info, "title") is { Length: > 0 } title ? Trim(title, 120) : "OpenAPI";

        AddVariable("baseUrl", BaseUrl(), secret: false);

        var schemes = Property(Property(root, "components"), "securitySchemes");
        var collectionAuth = AuthFor(Property(root, "security"), schemes, fallback: RequestAuth.None);

        // Etiket sırası: önce belgedeki "tags" listesi, sonra ilk görülme sırası.
        var folders = new List<(string Name, List<ParsedItem> Items)>();
        foreach (var tag in Array(Property(root, "tags")))
        {
            if (Text(tag, "name") is { Length: > 0 } tagName && folders.All(f => f.Name != tagName))
            {
                folders.Add((tagName, []));
            }
        }

        var rootItems = new List<ParsedItem>();
        var count = 0;
        foreach (var path in Object(Property(root, "paths")))
        {
            var pathItem = Resolve(path.Value);
            var shared = Array(Property(pathItem, "parameters")).Select(Resolve).ToList();
            foreach (var method in Methods)
            {
                if (!pathItem.TryGetProperty(method, out var operation) || operation.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                if (++count > PostmanParser.MaxItems)
                {
                    _warnings.Add(L.T("import.openapi_truncated", "İlk {max} işlemden sonrası içe aktarılmadı.", ("max", PostmanParser.MaxItems)));
                    goto done;
                }

                var request = Operation(path.Name, method, operation, shared, schemes, collectionAuth);
                var tagName = Array(Property(operation, "tags")).Select(t => t.ValueKind == JsonValueKind.String ? t.GetString() : null).FirstOrDefault(t => !string.IsNullOrWhiteSpace(t));
                if (tagName is null)
                {
                    rootItems.Add(request);
                    continue;
                }

                var folder = folders.FirstOrDefault(f => f.Name == tagName);
                if (folder.Items is null)
                {
                    folder = (tagName, []);
                    folders.Add(folder);
                }

                folder.Items.Add(request);
            }
        }

    done:
        if (_externalRefs.Count > 0)
        {
            _warnings.Add(L.T("import.openapi_external_refs", "Belge dışı referanslar çözülemedi: {refs}", ("refs", string.Join(", ", _externalRefs.Take(5)) + (_externalRefs.Count > 5 ? "…" : string.Empty))));
        }

        var items = folders
            .Where(f => f.Items.Count > 0)
            .Select(f => (ParsedItem)new ParsedFolder(Trim(f.Name, 120), RequestAuth.Inherit, ScriptSet.Empty, f.Items))
            .Concat(rootItems)
            .ToList();

        var description = Text(info, "description");
        return new ParsedCollection(name, string.IsNullOrWhiteSpace(description) ? null : description, collectionAuth, _variables, ScriptSet.Empty, items);
    }

    // ----------------------------------------------------------------------------------------- işlemler

    private ParsedRequest Operation(
        string path,
        string method,
        JsonElement operation,
        IReadOnlyList<JsonElement> shared,
        JsonElement schemes,
        RequestAuth collectionAuth)
    {
        var name = Text(operation, "summary") is { Length: > 0 } summary ? summary
            : Text(operation, "operationId") is { Length: > 0 } id ? id
            : $"{method.ToUpperInvariant()} {path}";

        // İşlem düzeyindeki parametreler yol düzeyindekileri (ad + konum) ezer.
        var parameters = shared.ToList();
        foreach (var p in Array(Property(operation, "parameters")).Select(Resolve))
        {
            parameters.RemoveAll(x => Text(x, "name") == Text(p, "name") && Text(x, "in") == Text(p, "in"));
            parameters.Add(p);
        }

        var url = "{{baseUrl}}" + PathParameter().Replace(path, m => "{{" + m.Groups[1].Value + "}}");
        var query = new List<string>();
        var headers = new List<KeyValueItem>();
        foreach (var p in parameters)
        {
            var pName = Text(p, "name");
            if (string.IsNullOrEmpty(pName))
            {
                continue;
            }

            var value = ParameterValue(p);
            var required = p.TryGetProperty("required", out var r) && r.ValueKind == JsonValueKind.True;
            switch (Text(p, "in"))
            {
                case "path":
                    AddVariable(pName, value ?? string.Empty, secret: false);
                    break;
                case "query" when required || value is not null:
                    query.Add($"{Uri.EscapeDataString(pName)}={Uri.EscapeDataString(value ?? string.Empty)}");
                    break;
                case "header" when (required || value is not null) && !IsReservedHeader(pName):
                    headers.Add(new KeyValueItem(pName, value ?? string.Empty, Description: Text(p, "description")));
                    break;
                case "cookie" when required || value is not null:
                    headers.Add(new KeyValueItem("Cookie", $"{pName}={value}"));
                    break;
            }
        }

        if (query.Count > 0)
        {
            url += "?" + string.Join('&', query);
        }

        var body = Body(Resolve(Property(operation, "requestBody")), headers);
        if (AcceptType(operation) is { } accept && !headers.Any(h => h.Key.Equals("Accept", StringComparison.OrdinalIgnoreCase)))
        {
            headers.Add(new KeyValueItem("Accept", accept));
        }

        var auth = operation.TryGetProperty("security", out var security)
            ? AuthFor(security, schemes, fallback: RequestAuth.None)
            : RequestAuth.Inherit;
        if (auth != RequestAuth.Inherit && auth == collectionAuth)
        {
            auth = RequestAuth.Inherit;
        }

        // Açıklama: summary ad olduğu için description (yoksa boş); dokümantasyon sayfasında gösterilir.
        var description = Text(operation, "description") ?? string.Empty;
        var definition = new RequestDefinition
        {
            Method = method.ToUpperInvariant(),
            Url = url,
            Headers = headers,
            Body = body,
            Auth = auth,
            Description = description.Length > RequestDefinition.DescriptionMaxLength ? description[..RequestDefinition.DescriptionMaxLength] : description,
        };
        return new ParsedRequest(Trim(name, ApiRequest.NameMaxLength), definition, Examples(operation, definition))
        {
            SourceKey = SourceKey(method, path),
        };
    }

    /// <summary>İşlemin belgedeki kimliği: metot + yol ("GET /pets/{id}").</summary>
    public static string SourceKey(string method, string path) => $"{method.ToUpperInvariant()} {path}";

    private static bool IsReservedHeader(string name) =>
        name.Equals("Accept", StringComparison.OrdinalIgnoreCase)
        || name.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)
        || name.Equals("Authorization", StringComparison.OrdinalIgnoreCase);

    private string? ParameterValue(JsonElement parameter)
    {
        if (parameter.TryGetProperty("example", out var example))
        {
            return Scalar(example);
        }

        if (Object(Property(parameter, "examples")).Select(e => Resolve(e.Value)).FirstOrDefault(e => e.TryGetProperty("value", out _)) is { ValueKind: JsonValueKind.Object } first)
        {
            return Scalar(first.GetProperty("value"));
        }

        var schema = Resolve(Property(parameter, "schema"));
        if (schema.TryGetProperty("example", out var schemaExample))
        {
            return Scalar(schemaExample);
        }

        if (schema.TryGetProperty("default", out var def))
        {
            return Scalar(def);
        }

        return Array(Property(schema, "enum")).Select(Scalar).FirstOrDefault();
    }

    private RequestBody Body(JsonElement requestBody, List<KeyValueItem> headers)
    {
        var content = Property(requestBody, "content");
        if (content.ValueKind != JsonValueKind.Object)
        {
            return RequestBody.None;
        }

        var types = Object(content).ToList();
        if (types.Count == 0)
        {
            return RequestBody.None;
        }

        int Find(Func<string, bool> match) => types.FindIndex(t => match(t.Name));
        var index = Find(n => n.Contains("json", StringComparison.OrdinalIgnoreCase));
        if (index < 0)
        {
            index = Find(n => n.StartsWith("application/x-www-form-urlencoded", StringComparison.OrdinalIgnoreCase));
        }

        if (index < 0)
        {
            index = Find(n => n.StartsWith("multipart/form-data", StringComparison.OrdinalIgnoreCase));
        }

        var chosen = types[Math.Max(index, 0)];
        var mediaType = chosen.Name;
        var media = Resolve(chosen.Value);
        var schema = Resolve(Property(media, "schema"));

        if (mediaType.StartsWith("application/x-www-form-urlencoded", StringComparison.OrdinalIgnoreCase)
            || mediaType.StartsWith("multipart/form-data", StringComparison.OrdinalIgnoreCase))
        {
            var multipart = mediaType.StartsWith("multipart", StringComparison.OrdinalIgnoreCase);
            var form = Object(Property(MergeAllOf(schema), "properties")).Select(p =>
            {
                var property = Resolve(p.Value);
                var binary = Text(property, "format") is "binary" or "base64";
                return multipart && binary
                    ? new KeyValueItem(p.Name, string.Empty, true, null, FormFieldType.File)
                    : new KeyValueItem(p.Name, Scalar(Sample(property, 0, [])) ?? string.Empty);
            }).ToList();
            return new RequestBody { Mode = multipart ? BodyMode.FormData : BodyMode.UrlEncoded, Form = form };
        }

        if (mediaType.Contains("octet-stream", StringComparison.OrdinalIgnoreCase))
        {
            headers.Add(new KeyValueItem("Content-Type", mediaType));
            return new RequestBody { Mode = BodyMode.Binary };
        }

        var example = MediaExample(media) ?? Sample(schema, 0, []);
        var raw = example is null ? string.Empty
            : example is JsonValue v && v.TryGetValue<string>(out var s) && !mediaType.Contains("json", StringComparison.OrdinalIgnoreCase) ? s
            : example.ToJsonString(Indented);
        var language = mediaType.Contains("json", StringComparison.OrdinalIgnoreCase) ? RawLanguage.Json
            : mediaType.Contains("xml", StringComparison.OrdinalIgnoreCase) ? RawLanguage.Xml
            : mediaType.Contains("html", StringComparison.OrdinalIgnoreCase) ? RawLanguage.Html
            : RawLanguage.Text;
        headers.Add(new KeyValueItem("Content-Type", mediaType));
        return new RequestBody { Mode = BodyMode.Raw, RawLanguage = language, Raw = raw };
    }

    private JsonNode? MediaExample(JsonElement media)
    {
        if (media.TryGetProperty("example", out var example))
        {
            return JsonNode.Parse(example.GetRawText());
        }

        foreach (var named in Object(Property(media, "examples")))
        {
            var resolved = Resolve(named.Value);
            if (resolved.TryGetProperty("value", out var value))
            {
                return JsonNode.Parse(value.GetRawText());
            }
        }

        return null;
    }

    private static string? AcceptType(JsonElement operation)
    {
        foreach (var response in Object(Property(operation, "responses")))
        {
            if (!response.Name.StartsWith('2'))
            {
                continue;
            }

            var first = Object(Property(response.Value, "content")).Select(c => c.Name).FirstOrDefault();
            if (first is not null)
            {
                return first;
            }
        }

        return null;
    }

    private List<ParsedExample> Examples(JsonElement operation, RequestDefinition request)
    {
        var result = new List<ParsedExample>();
        foreach (var response in Object(Property(operation, "responses")))
        {
            if (result.Count >= MaxExamplesPerOperation || !int.TryParse(response.Name, NumberStyles.None, CultureInfo.InvariantCulture, out var status))
            {
                continue;
            }

            var resolved = Resolve(response.Value);
            foreach (var media in Object(Property(resolved, "content")))
            {
                var example = MediaExample(Resolve(media.Value));
                if (example is null)
                {
                    continue;
                }

                var body = example is JsonValue v && v.TryGetValue<string>(out var text) ? text : example.ToJsonString(Indented);
                var name = Text(resolved, "description") is { Length: > 0 } d ? Trim(d, ResponseExample.NameMaxLength) : L.T("import.response_name", "{status} yanıtı", ("status", status));
                result.Add(new ParsedExample(name, status, [new KeyValueItem("Content-Type", media.Name)], body, request));
                _examples++;
                break;
            }
        }

        return result;
    }

    // ----------------------------------------------------------------------------------------- güvenlik

    private RequestAuth AuthFor(JsonElement security, JsonElement schemes, RequestAuth fallback)
    {
        if (security.ValueKind != JsonValueKind.Array)
        {
            return fallback;
        }

        var requirement = security.EnumerateArray().FirstOrDefault();
        if (requirement.ValueKind != JsonValueKind.Object)
        {
            return RequestAuth.None; // security: [] → yetkilendirmesiz
        }

        var schemeName = requirement.EnumerateObject().Select(p => p.Name).FirstOrDefault();
        if (schemeName is null)
        {
            return RequestAuth.None; // security: [{}] → isteğe bağlı
        }

        var scheme = Resolve(Property(schemes, schemeName));
        switch (Text(scheme, "type"))
        {
            case "http" when (Text(scheme, "scheme") ?? string.Empty).Equals("bearer", StringComparison.OrdinalIgnoreCase):
                AddVariable("bearerToken", string.Empty, secret: true);
                return new RequestAuth { Type = AuthType.Bearer, BearerToken = "{{bearerToken}}" };
            case "http" when (Text(scheme, "scheme") ?? string.Empty).Equals("basic", StringComparison.OrdinalIgnoreCase):
                AddVariable("basicUsername", string.Empty, secret: false);
                AddVariable("basicPassword", string.Empty, secret: true);
                return new RequestAuth { Type = AuthType.Basic, BasicUsername = "{{basicUsername}}", BasicPassword = "{{basicPassword}}" };
            case "apiKey" when Text(scheme, "in") is "header" or "query":
                AddVariable("apiKey", string.Empty, secret: true);
                return new RequestAuth
                {
                    Type = AuthType.ApiKey,
                    ApiKeyName = Text(scheme, "name") ?? "api_key",
                    ApiKeyValue = "{{apiKey}}",
                    ApiKeyIn = Text(scheme, "in") == "query" ? ApiKeyLocation.Query : ApiKeyLocation.Header,
                };
            case "oauth2":
                return OAuth2Scheme(scheme, requirement.EnumerateObject().First().Value);
            case "openIdConnect":
                AddVariable("accessToken", string.Empty, secret: true);
                Warn(L.T("import.openapi_openid", "'{scheme}' OpenID Connect şeması Bearer {token} olarak alındı.", ("scheme", schemeName), ("token", "{{accessToken}}")));
                return new RequestAuth { Type = AuthType.Bearer, BearerToken = "{{accessToken}}" };
            default:
                Warn(L.T("import.openapi_scheme_unsupported", "'{scheme}' güvenlik şeması desteklenmiyor; yetkilendirmesiz alındı.", ("scheme", schemeName)));
                return RequestAuth.None;
        }
    }

    /// <summary>OAuth 2.0 akışlarından ilk desteklenen: authorizationCode, clientCredentials, password.</summary>
    private RequestAuth OAuth2Scheme(JsonElement scheme, JsonElement requiredScopes)
    {
        var flows = Property(scheme, "flows");
        var (grant, flow) =
            Property(flows, "authorizationCode") is { ValueKind: JsonValueKind.Object } code ? (OAuth2GrantType.AuthorizationCode, code)
            : Property(flows, "clientCredentials") is { ValueKind: JsonValueKind.Object } cc ? (OAuth2GrantType.ClientCredentials, cc)
            : Property(flows, "password") is { ValueKind: JsonValueKind.Object } pw ? (OAuth2GrantType.Password, pw)
            : (OAuth2GrantType.AuthorizationCode, Property(flows, "implicit"));

        var scopes = Array(requiredScopes).Select(s => s.GetString() ?? string.Empty).Where(s => s.Length > 0).ToList();
        if (scopes.Count == 0)
        {
            scopes = Object(Property(flow, "scopes")).Select(s => s.Name).ToList();
        }

        AddVariable("clientId", string.Empty, secret: false);
        AddVariable("clientSecret", string.Empty, secret: true);
        return new RequestAuth
        {
            Type = AuthType.OAuth2,
            OAuth2GrantType = grant,
            OAuth2AuthUrl = Text(flow, "authorizationUrl") ?? string.Empty,
            OAuth2TokenUrl = Text(flow, "tokenUrl") ?? string.Empty,
            OAuth2ClientId = "{{clientId}}",
            OAuth2ClientSecret = "{{clientSecret}}",
            OAuth2Scope = string.Join(' ', scopes),
        };
    }

    // ----------------------------------------------------------------------------------------- şemadan örnek

    /// <summary>Şemadan örnek değer üretir (example → default → enum → türe göre yer tutucu).</summary>
    private JsonNode? Sample(JsonElement schema, int depth, HashSet<string> visiting)
    {
        if (schema.ValueKind != JsonValueKind.Object || depth > MaxDepth)
        {
            return null;
        }

        if (Text(schema, "$ref") is { } reference)
        {
            if (!visiting.Add(reference))
            {
                return null; // döngüsel şema
            }

            var result = Sample(Resolve(schema), depth, visiting);
            visiting.Remove(reference);
            return result;
        }

        if (schema.TryGetProperty("example", out var example))
        {
            return JsonNode.Parse(example.GetRawText());
        }

        if (schema.TryGetProperty("default", out var def))
        {
            return JsonNode.Parse(def.GetRawText());
        }

        if (Array(Property(schema, "enum")).FirstOrDefault() is { ValueKind: not JsonValueKind.Undefined } first)
        {
            return JsonNode.Parse(first.GetRawText());
        }

        foreach (var key in new[] { "oneOf", "anyOf" })
        {
            if (Array(Property(schema, key)).FirstOrDefault() is { ValueKind: JsonValueKind.Object } option)
            {
                return Sample(option, depth + 1, visiting);
            }
        }

        if (schema.TryGetProperty("allOf", out _))
        {
            var merged = new JsonObject();
            foreach (var part in Array(Property(schema, "allOf")))
            {
                if (Sample(part, depth + 1, visiting) is JsonObject obj)
                {
                    foreach (var (k, v) in obj.ToList())
                    {
                        obj.Remove(k);
                        merged[k] = v;
                    }
                }
            }

            return merged;
        }

        var type = Text(schema, "type") ?? (schema.TryGetProperty("properties", out _) ? "object" : null);
        switch (type)
        {
            case "object":
                var result = new JsonObject();
                foreach (var property in Object(Property(schema, "properties")))
                {
                    result[property.Name] = Sample(property.Value, depth + 1, visiting);
                }

                return result;
            case "array":
                var item = Sample(Property(schema, "items"), depth + 1, visiting);
                return item is null ? new JsonArray() : new JsonArray(item);
            case "integer":
                return JsonValue.Create(0);
            case "number":
                return JsonValue.Create(0.0);
            case "boolean":
                return JsonValue.Create(true);
            case "string":
                return JsonValue.Create(Text(schema, "format") switch
                {
                    "date-time" => "2026-01-01T00:00:00Z",
                    "date" => "2026-01-01",
                    "email" => "kullanici@ornek.com",
                    "uuid" => "00000000-0000-0000-0000-000000000000",
                    "uri" or "url" => "https://ornek.com",
                    "password" => string.Empty,
                    _ => "string",
                });
            default:
                return null;
        }
    }

    /// <summary>allOf parçalarının özelliklerini tek şemada birleştirir (form alanları için).</summary>
    private JsonElement MergeAllOf(JsonElement schema)
    {
        if (!schema.TryGetProperty("allOf", out var parts) || parts.ValueKind != JsonValueKind.Array)
        {
            return schema;
        }

        var properties = new JsonObject();
        foreach (var part in parts.EnumerateArray().Select(Resolve))
        {
            foreach (var p in Object(Property(part, "properties")))
            {
                properties[p.Name] = JsonNode.Parse(p.Value.GetRawText());
            }
        }

        return JsonDocument.Parse(new JsonObject { ["properties"] = properties }.ToJsonString()).RootElement.Clone();
    }

    // ----------------------------------------------------------------------------------------- yardımcılar

    private string BaseUrl()
    {
        var server = Array(Property(root, "servers")).FirstOrDefault();
        var url = Text(server, "url");
        if (string.IsNullOrWhiteSpace(url))
        {
            Warn(L.T("import.openapi_no_servers", "Belgede sunucu (servers) yok; baseUrl değişkenini doldurun."));
            return string.Empty;
        }

        var variables = Property(server, "variables");
        url = PathParameter().Replace(url, m => Text(Property(variables, m.Groups[1].Value), "default") ?? m.Value);
        if (url.StartsWith('/'))
        {
            Warn(L.T("import.openapi_relative_server", "Sunucu adresi göreli ({url}); baseUrl değişkenine tam adresi yazın.", ("url", url)));
        }

        return url.TrimEnd('/');
    }

    private void AddVariable(string key, string value, bool secret)
    {
        if (_variables.All(v => v.Key != key) && _variables.Count < VariableRules.MaxCount)
        {
            _variables.Add(new Variable(key, value, true, secret));
        }
    }

    private void Warn(string message)
    {
        if (!_warnings.Contains(message))
        {
            _warnings.Add(message);
        }
    }

    /// <summary>"#/components/..." referansını izler; belge dışı referanslar boş nesne olur.</summary>
    private JsonElement Resolve(JsonElement element)
    {
        for (var hop = 0; hop < 20; hop++)
        {
            if (element.ValueKind != JsonValueKind.Object || Text(element, "$ref") is not { } reference)
            {
                return element;
            }

            if (!reference.StartsWith("#/", StringComparison.Ordinal))
            {
                _externalRefs.Add(reference);
                return default;
            }

            var current = root;
            foreach (var segment in reference[2..].Split('/'))
            {
                var key = Uri.UnescapeDataString(segment).Replace("~1", "/", StringComparison.Ordinal).Replace("~0", "~", StringComparison.Ordinal);
                if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(key, out current))
                {
                    _externalRefs.Add(reference);
                    return default;
                }
            }

            element = current;
        }

        return element;
    }

    private static JsonElement Property(JsonElement owner, string name) =>
        owner.ValueKind == JsonValueKind.Object && owner.TryGetProperty(name, out var value) ? value : default;

    // Dizi/nesne olmayan öğelerde boş dizi dönebilmek için IEnumerable (enumerator türü bunu desteklemez).
#pragma warning disable CA1859
    private static IEnumerable<JsonElement> Array(JsonElement element) =>
        element.ValueKind == JsonValueKind.Array ? element.EnumerateArray() : [];

    private static IEnumerable<JsonProperty> Object(JsonElement element) =>
        element.ValueKind == JsonValueKind.Object ? element.EnumerateObject() : [];
#pragma warning restore CA1859

    private static string? Text(JsonElement owner, string name) =>
        owner.ValueKind == JsonValueKind.Object && owner.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static string? Scalar(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        _ => value.GetRawText(),
    };

    private static string? Scalar(JsonNode? value) => value switch
    {
        null => null,
        JsonValue v when v.TryGetValue<string>(out var s) => s,
        _ => value.ToJsonString(),
    };

    private static string Trim(string value, int max) => value.Length > max ? value[..max] : value.Trim();
}
