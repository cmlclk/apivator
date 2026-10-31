using System.Text.Json;
using Apivator.Application.Common.Localization;
using Apivator.Domain.Collections;
using Apivator.Domain.Variables;

namespace Apivator.Application.Import;

internal abstract record ParsedItem(string Name);

internal sealed record ParsedFolder(string Name, RequestAuth Auth, ScriptSet Scripts, IReadOnlyList<ParsedItem> Children, string? Description = null) : ParsedItem(Name);

internal sealed record ParsedRequest(string Name, RequestDefinition Definition, IReadOnlyList<ParsedExample> Examples) : ParsedItem(Name)
{
    /// <summary>OpenAPI'den gelen isteğin belgedeki kimliği ("GET /pets/{id}"); kaynaktan güncellemede eşleştirilir.</summary>
    public string? SourceKey { get; init; }
}

internal sealed record ParsedExample(string Name, int Status, IReadOnlyList<KeyValueItem> Headers, string Body, RequestDefinition Request);

internal sealed record ParsedCollection(
    string Name,
    string? Description,
    RequestAuth Auth,
    IReadOnlyList<Variable> Variables,
    ScriptSet Scripts,
    IReadOnlyList<ParsedItem> Items);

internal sealed record ParsedEnvironment(string Name, IReadOnlyList<Variable> Variables);

/// <summary>
/// Postman v2.0/v2.1 collection ve environment dosyalarını Apivator modeline çevirir. Postman'in aynı alanı
/// farklı biçimlerde yazdığı durumlar (URL metin ya da nesne, yetkilendirme liste ya da nesne) desteklenir.
/// Karşılığı olmayan özellikler atlanır ve uyarı listesine yazılır; içe aktarma yarıda kesilmez.
/// </summary>
internal sealed class PostmanParser
{
    public const int MaxItems = 5000;

    /// <summary>Apivator'a özel istek alanları (WebSocket/SSE türü, kayıtlı mesajlar).</summary>
    public const string ExtensionKey = "x-apivator";
    private const int MaxDepth = 20;

    private readonly List<string> _warnings = [];
    private int _items;
    private int _examples;

    public int ExampleCount => _examples;
    private int _filesToReselect;

    public IReadOnlyList<string> Warnings => _warnings;

    public static bool IsCollection(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty("info", out _) && root.TryGetProperty("item", out _);

    public static bool IsEnvironment(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty("values", out var values) && values.ValueKind == JsonValueKind.Array;

    public static bool IsLegacyV1(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty("requests", out _) && root.TryGetProperty("order", out _);

    public ParsedCollection ParseCollection(JsonElement root)
    {
        var info = root.GetProperty("info");
        var items = ParseItems(root.GetProperty("item"), 0);

        if (_filesToReselect > 0)
        {
            _warnings.Add(L.T("import.postman_files", "{count} dosya alanı aktarıldı; dosyalar Postman'deki gibi saklanmaz, göndermeden önce yeniden seçin.", ("count", _filesToReselect)));
        }

        var auth = ParseAuth(root, AuthType.None);
        if (auth.Type == AuthType.Inherit)
        {
            auth = RequestAuth.None;
        }

        return new ParsedCollection(
            CleanName(Text(info, "name"), L.T("import.default_collection", "İçe aktarılan collection"), 120),
            Description(info),
            auth,
            ParseVariables(root, "variable", enabledProperty: null),
            ParseScripts(root),
            items);
    }

    public static ParsedEnvironment ParseEnvironment(JsonElement root) =>
        new(CleanName(Text(root, "name"), L.T("import.default_environment", "İçe aktarılan environment"), 120), ParseVariables(root, "values", enabledProperty: "enabled"));

    private List<ParsedItem> ParseItems(JsonElement items, int depth)
    {
        var result = new List<ParsedItem>();
        if (items.ValueKind != JsonValueKind.Array)
        {
            return result;
        }

        if (depth > MaxDepth)
        {
            _warnings.Add(L.T("import.postman_depth", "{max} seviyeden derin klasörler atlandı.", ("max", MaxDepth)));
            return result;
        }

        foreach (var item in items.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (++_items > MaxItems)
            {
                _warnings.Add(L.T("import.postman_truncated", "İlk {max} öğeden sonrası içe aktarılmadı.", ("max", MaxItems)));
                break;
            }

            if (item.TryGetProperty("item", out var children))
            {
                result.Add(new ParsedFolder(
                    CleanName(Text(item, "name"), L.T("import.unnamed_folder", "Adsız klasör"), 120),
                    ParseAuth(item, AuthType.Inherit),
                    ParseScripts(item),
                    ParseItems(children, depth + 1),
                    Clip(DescriptionText(item))));
            }
            else if (item.TryGetProperty("request", out var request))
            {
                var name = CleanName(Text(item, "name"), L.T("import.unnamed_request", "Adsız istek"), 200);
                var definition = ParseRequest(request, name) with { Scripts = ParseScripts(item) };
                result.Add(new ParsedRequest(name, definition, ParseExamples(item, name, definition)));
            }
        }

        return result;
    }

    private RequestDefinition ParseRequest(JsonElement request, string name)
    {
        // v2.1'de istek yalnızca URL metni de olabilir.
        if (request.ValueKind == JsonValueKind.String)
        {
            return new RequestDefinition { Method = "GET", Url = request.GetString() ?? string.Empty, Auth = RequestAuth.Inherit };
        }

        var method = (Text(request, "method") ?? "GET").Trim().ToUpperInvariant();
        if (method.Length is 0 or > 20 || !method.All(char.IsAsciiLetter))
        {
            _warnings.Add(L.T("import.postman_invalid_method", "'{name}': geçersiz method '{method}', GET olarak alındı.", ("name", name), ("method", method)));
            method = "GET";
        }

        var headers = ParseHeaders(request);
        var body = ParseBody(request, name);

        return ParseExtension(request, new RequestDefinition
        {
            Description = Clip(DescriptionText(request)) ?? string.Empty,
            Method = method,
            Url = ParseUrl(request),
            Headers = headers,
            Body = body,
            Auth = ParseAuth(request, AuthType.Inherit, name),
        });
    }

    internal static readonly JsonSerializerOptions GrpcJson = new(JsonSerializerDefaults.Web);

    private static RequestDefinition ParseExtension(JsonElement request, RequestDefinition definition)
    {
        if (!request.TryGetProperty(ExtensionKey, out var extra) || extra.ValueKind != JsonValueKind.Object
            || !Enum.TryParse<RequestKind>(Text(extra, "kind"), ignoreCase: true, out var kind))
        {
            return definition;
        }

        var messages = new List<SavedMessage>();
        if (extra.TryGetProperty("messages", out var list) && list.ValueKind == JsonValueKind.Array)
        {
            foreach (var m in list.EnumerateArray().Take(RequestDefinition.MaxSavedMessages))
            {
                var body = Text(m, "body") ?? string.Empty;
                if (body.Length <= RequestDefinition.SavedMessageMaxLength)
                {
                    messages.Add(new SavedMessage(
                        CleanName(Text(m, "name"), "Mesaj", 200),
                        body,
                        m.TryGetProperty("binary", out var b) && b.ValueKind == JsonValueKind.True));
                }
            }
        }

        var grpc = GrpcSettings.Empty;
        if (extra.TryGetProperty("grpc", out var grpcJson) && grpcJson.ValueKind == JsonValueKind.Object)
        {
            try
            {
                grpc = (JsonSerializer.Deserialize<GrpcSettings>(grpcJson, GrpcJson) ?? GrpcSettings.Empty).Normalize();
            }
            catch (JsonException)
            {
                grpc = GrpcSettings.Empty;
            }

            // Sınırları aşan tanımlar alınmaz (kullanıcı yeniden yükler ya da reflection kullanır).
            if (grpc.ProtoFiles.Count > GrpcSettings.MaxProtoFiles
                || grpc.ProtoFiles.Any(f => f?.Content is null || f.Name is null)
                || grpc.ProtoFiles.Sum(f => (long)(f?.Content?.Length ?? 0)) > GrpcSettings.MaxProtoBytes)
            {
                grpc = grpc with { ProtoFiles = [] };
            }

            if (grpc.Message.Length > RequestDefinition.SavedMessageMaxLength || grpc.Method.Length > 500)
            {
                grpc = grpc with { Message = string.Empty, Method = grpc.Method.Length > 500 ? string.Empty : grpc.Method };
            }
        }

        var protocols = Text(extra, "protocols") ?? string.Empty;
        return definition with
        {
            Kind = kind,
            Grpc = grpc,
            Messages = messages,
            Protocols = protocols.Length > RequestDefinition.ProtocolsMaxLength ? string.Empty : protocols,
        };
    }

    private List<ParsedExample> ParseExamples(JsonElement item, string requestName, RequestDefinition fallback)
    {
        if (!item.TryGetProperty("response", out var responses) || responses.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var result = new List<ParsedExample>();
        foreach (var response in responses.EnumerateArray().Where(r => r.ValueKind == JsonValueKind.Object))
        {
            var body = Text(response, "body") ?? string.Empty;
            if (body.Length > ResponseExample.BodyMaxLength)
            {
                _warnings.Add(L.T("import.postman_large_example", "'{name}': çok büyük bir örnek yanıt atlandı.", ("name", requestName)));
                continue;
            }

            var status = response.TryGetProperty("code", out var code) && code.TryGetInt32(out var parsed) ? parsed : 200;
            var original = response.TryGetProperty("originalRequest", out var originalRequest)
                ? ParseRequest(originalRequest, requestName)
                : fallback;
            _examples++;
            result.Add(new ParsedExample(
                CleanName(Text(response, "name"), L.T("import.response_name", "{status} yanıtı", ("status", status)), ResponseExample.NameMaxLength),
                status,
                ParseHeaders(response),
                body,
                original));
        }

        return result;
    }

    private static string ParseUrl(JsonElement request)
    {
        if (!request.TryGetProperty("url", out var url))
        {
            return string.Empty;
        }

        if (url.ValueKind == JsonValueKind.String)
        {
            return url.GetString() ?? string.Empty;
        }

        if (url.ValueKind != JsonValueKind.Object)
        {
            return string.Empty;
        }

        if (Text(url, "raw") is { Length: > 0 } raw)
        {
            return raw;
        }

        // raw yoksa parçalardan kur.
        var protocol = Text(url, "protocol");
        var host = JoinParts(url, "host", ".");
        var path = JoinParts(url, "path", "/");
        var port = Text(url, "port");
        var builder = (protocol is { Length: > 0 } ? protocol + "://" : string.Empty) + host + (port is { Length: > 0 } ? ":" + port : string.Empty);
        if (path.Length > 0)
        {
            builder += "/" + path;
        }

        if (url.TryGetProperty("query", out var query) && query.ValueKind == JsonValueKind.Array)
        {
            var pairs = query.EnumerateArray()
                .Where(q => !IsDisabled(q))
                .Select(q => Text(q, "value") is { } value ? $"{Text(q, "key")}={value}" : Text(q, "key"))
                .Where(p => !string.IsNullOrEmpty(p));
            var joined = string.Join('&', pairs);
            if (joined.Length > 0)
            {
                builder += "?" + joined;
            }
        }

        return builder;
    }

    private static string JoinParts(JsonElement url, string property, string separator)
    {
        if (!url.TryGetProperty(property, out var value))
        {
            return string.Empty;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString() ?? string.Empty,
            JsonValueKind.Array => string.Join(separator, value.EnumerateArray().Select(AsString)),
            _ => string.Empty,
        };
    }

    private static List<KeyValueItem> ParseHeaders(JsonElement request)
    {
        if (!request.TryGetProperty("header", out var header))
        {
            return [];
        }

        // Eski dışa aktarımlarda header'lar "Anahtar: Değer" satırları olarak gelebilir.
        if (header.ValueKind == JsonValueKind.String)
        {
            return (header.GetString() ?? string.Empty)
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(line => line.Split(':', 2))
                .Where(parts => parts[0].Length > 0)
                .Select(parts => new KeyValueItem(parts[0].Trim(), parts.Length > 1 ? parts[1].Trim() : string.Empty))
                .ToList();
        }

        return header.ValueKind != JsonValueKind.Array
            ? []
            : header.EnumerateArray()
                .Where(h => h.ValueKind == JsonValueKind.Object && !string.IsNullOrEmpty(Text(h, "key")))
                .Select(h => new KeyValueItem(Text(h, "key")!, Text(h, "value") ?? string.Empty, !IsDisabled(h), DescriptionText(h)))
                .ToList();
    }

    private RequestBody ParseBody(JsonElement request, string name)
    {
        if (!request.TryGetProperty("body", out var body) || body.ValueKind != JsonValueKind.Object)
        {
            return RequestBody.None;
        }

        switch (Text(body, "mode"))
        {
            case "raw":
                var language = body.TryGetProperty("options", out var options)
                    && options.TryGetProperty("raw", out var rawOptions)
                    ? Text(rawOptions, "language")
                    : null;
                return new RequestBody { Mode = BodyMode.Raw, Raw = Text(body, "raw") ?? string.Empty, RawLanguage = Language(language) };

            case "urlencoded":
                return new RequestBody { Mode = BodyMode.UrlEncoded, Form = FormFields(body, "urlencoded", name) };

            case "formdata":
                return new RequestBody { Mode = BodyMode.FormData, Form = FormFields(body, "formdata", name) };

            case "graphql":
                var graphql = body.TryGetProperty("graphql", out var g) && g.ValueKind == JsonValueKind.Object ? g : default;
                return new RequestBody
                {
                    Mode = BodyMode.GraphQL,
                    Raw = graphql.ValueKind == JsonValueKind.Object ? Text(graphql, "query") ?? string.Empty : string.Empty,
                    GraphqlVariables = graphql.ValueKind == JsonValueKind.Object ? Text(graphql, "variables") ?? string.Empty : string.Empty,
                };

            case "file":
                var fileName = body.TryGetProperty("file", out var file) && file.ValueKind == JsonValueKind.Object ? FileName(file) : null;
                _filesToReselect++;
                return new RequestBody { Mode = BodyMode.Binary, FileName = fileName };

            default:
                return RequestBody.None;
        }
    }

    private List<KeyValueItem> FormFields(JsonElement body, string property, string name)
    {
        if (!body.TryGetProperty(property, out var fields) || fields.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var result = new List<KeyValueItem>();
        foreach (var field in fields.EnumerateArray())
        {
            if (string.IsNullOrEmpty(Text(field, "key")))
            {
                continue;
            }

            if (Text(field, "type") == "file")
            {
                _filesToReselect++;
                result.Add(new KeyValueItem(Text(field, "key")!, FileName(field) ?? string.Empty, !IsDisabled(field), DescriptionText(field), FormFieldType.File));
            }
            else
            {
                result.Add(new KeyValueItem(Text(field, "key")!, Text(field, "value") ?? string.Empty, !IsDisabled(field), DescriptionText(field)));
            }
        }

        return result;
    }

    private RequestAuth ParseAuth(JsonElement owner, AuthType whenMissing, string? name = null)
    {
        if (!owner.TryGetProperty("auth", out var auth) || auth.ValueKind != JsonValueKind.Object)
        {
            return new RequestAuth { Type = whenMissing };
        }

        var type = Text(auth, "type");
        string Param(string key)
        {
            if (type is null || !auth.TryGetProperty(type, out var values))
            {
                return string.Empty;
            }

            // v2.1: [{ key, value }], v2.0: { key: value }
            if (values.ValueKind == JsonValueKind.Array)
            {
                foreach (var entry in values.EnumerateArray())
                {
                    if (Text(entry, "key") == key)
                    {
                        return Text(entry, "value") ?? string.Empty;
                    }
                }

                return string.Empty;
            }

            return values.ValueKind == JsonValueKind.Object ? Text(values, key) ?? string.Empty : string.Empty;
        }

        switch (type)
        {
            case "noauth":
                return RequestAuth.None;
            case "inherit":
                return RequestAuth.Inherit;
            case "bearer":
                return new RequestAuth { Type = AuthType.Bearer, BearerToken = Param("token") };
            case "basic":
                return new RequestAuth { Type = AuthType.Basic, BasicUsername = Param("username"), BasicPassword = Param("password") };
            case "apikey":
                return new RequestAuth
                {
                    Type = AuthType.ApiKey,
                    ApiKeyName = Param("key"),
                    ApiKeyValue = Param("value"),
                    ApiKeyIn = Param("in").Equals("query", StringComparison.OrdinalIgnoreCase) ? ApiKeyLocation.Query : ApiKeyLocation.Header,
                };
            case "digest":
                return new RequestAuth { Type = AuthType.Digest, BasicUsername = Param("username"), BasicPassword = Param("password") };
            case "awsv4":
                return new RequestAuth
                {
                    Type = AuthType.AwsSigV4,
                    AwsAccessKey = Param("accessKey"),
                    AwsSecretKey = Param("secretKey"),
                    AwsRegion = Param("region") is { Length: > 0 } region ? region : "us-east-1",
                    AwsService = Param("service"),
                    AwsSessionToken = Param("sessionToken"),
                };
            case "oauth2":
                var grant = Param("grant_type");
                if (grant == "implicit")
                {
                    _warnings.Add(L.T("import.postman_implicit", "{subject}: OAuth 2.0 implicit akışı desteklenmiyor; authorization code (PKCE) olarak alındı.", ("subject", AuthSubject(name))));
                }

                return new RequestAuth
                {
                    Type = AuthType.OAuth2,
                    OAuth2GrantType = grant switch
                    {
                        "client_credentials" => OAuth2GrantType.ClientCredentials,
                        "password" => OAuth2GrantType.Password,
                        _ => OAuth2GrantType.AuthorizationCode,
                    },
                    OAuth2AuthUrl = Param("authUrl"),
                    OAuth2TokenUrl = Param("accessTokenUrl"),
                    OAuth2ClientId = Param("clientId"),
                    OAuth2ClientSecret = Param("clientSecret"),
                    OAuth2Scope = Param("scope"),
                    OAuth2Username = Param("username"),
                    OAuth2Password = Param("password"),
                    OAuth2RedirectUri = Param("redirect_uri"),
                    OAuth2ClientAuthentication = Param("client_authentication") == "body" ? OAuth2ClientAuthentication.Body : OAuth2ClientAuthentication.Header,
                    OAuth2HeaderPrefix = Param("headerPrefix") is { Length: > 0 } prefix ? prefix : "Bearer",
                };
            default:
                _warnings.Add(L.T("import.postman_auth_unsupported", "{subject}: '{type}' yetkilendirmesi henüz desteklenmiyor, yetkilendirmesiz alındı.", ("subject", AuthSubject(name)), ("type", type)));
                return RequestAuth.None;
        }
    }

    private static List<Variable> ParseVariables(JsonElement root, string property, string? enabledProperty)
    {
        if (!root.TryGetProperty(property, out var variables) || variables.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return variables.EnumerateArray()
            .Where(v => v.ValueKind == JsonValueKind.Object && !string.IsNullOrWhiteSpace(Text(v, "key")))
            .Select(v =>
            {
                var enabled = enabledProperty is not null && v.TryGetProperty(enabledProperty, out var e) && e.ValueKind == JsonValueKind.False
                    ? false
                    : !IsDisabled(v);
                return new Variable(Text(v, "key")!.Trim(), Text(v, "value") ?? string.Empty, enabled, Text(v, "type") == "secret");
            })
            .ToList();
    }

    /// <summary>Postman "event" dizisi: listen = prerequest | test; script.exec satır dizisi ya da metin.</summary>
    private ScriptSet ParseScripts(JsonElement owner)
    {
        if (!owner.TryGetProperty("event", out var events) || events.ValueKind != JsonValueKind.Array)
        {
            return ScriptSet.Empty;
        }

        var pre = new List<string>();
        var post = new List<string>();
        foreach (var e in events.EnumerateArray())
        {
            if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty("script", out var script) || script.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var code = script.TryGetProperty("exec", out var exec)
                ? exec.ValueKind == JsonValueKind.Array
                    ? string.Join('\n', exec.EnumerateArray().Select(line => AsString(line) ?? string.Empty))
                    : AsString(exec) ?? string.Empty
                : string.Empty;
            if (string.IsNullOrWhiteSpace(code) || IsDisabled(e))
            {
                continue;
            }

            switch (Text(e, "listen"))
            {
                case "prerequest":
                    pre.Add(code);
                    break;
                case "test":
                    post.Add(code);
                    break;
            }
        }

        var result = new ScriptSet { PreRequest = string.Join("\n\n", pre), PostResponse = string.Join("\n\n", post) };
        if (result.IsTooLong)
        {
            _warnings.Add(L.T("import.postman_long_script", "Çok uzun bir script kısaltılmadan atlandı."));
            return ScriptSet.Empty;
        }

        return result;
    }

    private static RawLanguage Language(string? language) => language?.ToLowerInvariant() switch
    {
        "json" => RawLanguage.Json,
        "xml" => RawLanguage.Xml,
        "html" => RawLanguage.Html,
        "javascript" => RawLanguage.JavaScript,
        _ => RawLanguage.Text,
    };

    /// <summary>Postman dosya yolunu (src) saklar; yalnızca dosya adını alıyoruz.</summary>
    private static string? FileName(JsonElement owner)
    {
        if (!owner.TryGetProperty("src", out var src))
        {
            return null;
        }

        var path = src.ValueKind switch
        {
            JsonValueKind.String => src.GetString(),
            JsonValueKind.Array => src.EnumerateArray().Select(AsString).FirstOrDefault(v => !string.IsNullOrEmpty(v)),
            _ => null,
        };

        return string.IsNullOrEmpty(path) ? null : path.Split('/', '\\')[^1];
    }

    private static string? Description(JsonElement owner) =>
        owner.TryGetProperty("description", out var d)
            ? d.ValueKind == JsonValueKind.String ? d.GetString() : d.ValueKind == JsonValueKind.Object ? Text(d, "content") : null
            : null;

    private static string? Clip(string? text) =>
        text is { Length: > RequestDefinition.DescriptionMaxLength } ? text[..RequestDefinition.DescriptionMaxLength] : text;

    private static string? DescriptionText(JsonElement owner) => Description(owner) is { Length: > 0 } text ? text : null;

    private static bool IsDisabled(JsonElement element) =>
        element.TryGetProperty("disabled", out var disabled) && disabled.ValueKind == JsonValueKind.True;

    private static string? Text(JsonElement owner, string property) =>
        owner.ValueKind == JsonValueKind.Object && owner.TryGetProperty(property, out var value) ? AsString(value) : null;

    private static string? AsString(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.String => value.GetString(),
        JsonValueKind.Number => value.GetRawText(),
        JsonValueKind.True => "true",
        JsonValueKind.False => "false",
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        _ => value.GetRawText(),
    };

    /// <summary>Yetkilendirme uyarılarında kaynak: klasör adı ya da (adsızsa) collection.</summary>
    private static string AuthSubject(string? name) =>
        name is null ? L.T("import.postman_folder_or_collection", "Klasör/collection") : $"'{name}'";

    private static string CleanName(string? name, string fallback, int maxLength)
    {
        var trimmed = name?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return fallback;
        }

        return trimmed.Length > maxLength ? trimmed[..maxLength] : trimmed;
    }

}
