using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Apivator.Domain.Collections;

namespace Apivator.Application.Import;

/// <summary>
/// Collection'dan OpenAPI 3.0.3 belgesi üretir. Her istek bir işlem; üst klasör etiket olur. URL'nin başındaki
/// <c>{{baseUrl}}</c> (ya da şema+host) sunucu adresine, <c>:id</c> ve <c>{{id}}</c> yol parametresine dönüşür.
/// Body ve kayıtlı örnek yanıtlar örnek olarak eklenir; JSON örneklerden basit şema çıkarılır. Yetkilendirme
/// (Bearer, Basic, Digest, API key, OAuth 2.0) güvenlik şemalarına çevrilir. Aynı method ve yola ikinci istek
/// atlanır ve uyarı olarak eklenir (x-apivator-warnings).
/// </summary>
internal static partial class OpenApiExporter
{
    private const int MaxSchemaDepth = 8;

    private static readonly HashSet<string> SkippedHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "content-type", "accept", "authorization", "content-length", "host", "user-agent", "cookie",
    };

    [GeneratedRegex(@"^\{\{\s*([^{}]+?)\s*\}\}$")]
    private static partial Regex WholeVariable();

    [GeneratedRegex(@"\{\{\s*([^{}]+?)\s*\}\}")]
    private static partial Regex AnyVariable();

    [GeneratedRegex(@"[^A-Za-z0-9]+")]
    private static partial Regex NonWord();

    public static JsonObject Export(Collection collection, IReadOnlyList<Folder> folders, IReadOnlyList<ApiRequest> requests, IReadOnlyList<ResponseExample> examples)
    {
        var variables = collection.Variables.Where(v => v.Enabled).GroupBy(v => v.Key).ToDictionary(g => g.Key, g => g.Last().Value);
        var folderById = folders.ToDictionary(f => f.Id);
        var examplesByRequest = examples.ToLookup(e => e.RequestId);
        var warnings = new List<string>();
        var servers = new List<string>();
        var paths = new SortedDictionary<string, JsonObject>(StringComparer.Ordinal);
        var schemes = new JsonObject();
        var operationIds = new HashSet<string>(StringComparer.Ordinal);
        var tags = new List<string>();

        var collectionAuth = collection.Auth.Type == AuthType.Inherit ? RequestAuth.None : collection.Auth;
        var collectionSecurity = SecurityFor(collectionAuth, schemes);

        foreach (var request in TreeOrder(folders, requests))
        {
            var definition = request.Definition;
            if (definition.Kind is RequestKind.WebSocket or RequestKind.Grpc)
            {
                warnings.Add(L.T("export.openapi_skip_kind", "\"{name}\" atlandı: {kind} istekleri OpenAPI'de tanımlanamaz.", ("name", request.Name), ("kind", definition.Kind == RequestKind.Grpc ? "gRPC" : "WebSocket")));
                continue;
            }

            var (server, path, query) = Split(definition.Url, variables);
            if (server is not null && !servers.Contains(server))
            {
                servers.Add(server);
            }

            var parameters = new JsonArray();
            var pathTemplate = PathTemplate(path, parameters);
            var method = definition.Method.ToLowerInvariant();
            if (!paths.TryGetValue(pathTemplate, out var pathItem))
            {
                pathItem = [];
                paths[pathTemplate] = pathItem;
            }

            if (pathItem.ContainsKey(method))
            {
                warnings.Add(L.T("export.openapi_skip_duplicate", "\"{name}\" atlandı: {method} {path} için zaten bir istek var.", ("name", request.Name), ("method", definition.Method), ("path", pathTemplate)));
                continue;
            }

            foreach (var (key, value) in query)
            {
                parameters.Add(Parameter(key, "query", required: false, value));
            }

            foreach (var header in definition.Headers.Where(h => h.Enabled && !string.IsNullOrWhiteSpace(h.Key) && !SkippedHeaders.Contains(h.Key.Trim())))
            {
                parameters.Add(Parameter(header.Key.Trim(), "header", required: false, header.Value));
            }

            var operation = new JsonObject
            {
                ["summary"] = request.Name,
                ["operationId"] = UniqueOperationId(request.Name, method, operationIds),
            };
            if (definition.Description.Length > 0)
            {
                operation["description"] = definition.Description;
            }

            var tag = TopFolder(request.FolderId, folderById);
            if (tag is not null)
            {
                operation["tags"] = new JsonArray(tag);
                if (!tags.Contains(tag))
                {
                    tags.Add(tag);
                }
            }

            if (parameters.Count > 0)
            {
                operation["parameters"] = parameters;
            }

            if (RequestBodyFor(definition.Body, definition.Headers) is { } body)
            {
                operation["requestBody"] = body;
            }

            operation["responses"] = Responses(examplesByRequest[request.Id].OrderBy(e => e.SortOrder).ThenBy(e => e.CreatedAt).ToList());

            var auth = EffectiveAuth(request, folderById, collection.Auth);
            if (auth != collectionAuth)
            {
                operation["security"] = SecurityFor(auth, schemes) ?? [];
            }

            pathItem[method] = operation;
        }

        var document = new JsonObject
        {
            ["openapi"] = "3.0.3",
            ["info"] = new JsonObject
            {
                ["title"] = collection.Name,
                ["version"] = "1.0.0",
            },
        };
        if (!string.IsNullOrWhiteSpace(collection.Description))
        {
            ((JsonObject)document["info"]!)["description"] = collection.Description;
        }

        if (servers.Count > 0)
        {
            document["servers"] = new JsonArray(servers.Select(ServerObject).ToArray<JsonNode?>());
        }

        if (tags.Count > 0)
        {
            document["tags"] = new JsonArray(tags.Select(t =>
            {
                var tagObject = new JsonObject { ["name"] = t };
                if (folderById.Values.FirstOrDefault(f => f.ParentFolderId is null && f.Name == t)?.Description is { Length: > 0 } tagDescription)
                {
                    tagObject["description"] = tagDescription;
                }

                return (JsonNode?)tagObject;
            }).ToArray());
        }

        var pathsObject = new JsonObject();
        foreach (var (key, value) in paths)
        {
            pathsObject[key] = value;
        }

        document["paths"] = pathsObject;
        if (schemes.Count > 0)
        {
            document["components"] = new JsonObject { ["securitySchemes"] = schemes };
        }

        if (collectionSecurity is not null)
        {
            document["security"] = collectionSecurity;
        }

        if (warnings.Count > 0)
        {
            document["x-apivator-warnings"] = new JsonArray(warnings.Select(w => (JsonNode?)w).ToArray());
        }

        return document;
    }

    /// <summary>URL'yi sunucu, yol ve query'ye ayırır. Sunucu: baştaki {{değişken}} (çözülebiliyorsa değeri) ya da şema+host.</summary>
    internal static (string? Server, string Path, List<(string Key, string Value)> Query) Split(string url, IReadOnlyDictionary<string, string> variables)
    {
        var value = url.Trim();
        var hash = value.IndexOf('#', StringComparison.Ordinal);
        if (hash >= 0)
        {
            value = value[..hash];
        }

        var question = value.IndexOf('?', StringComparison.Ordinal);
        var query = new List<(string, string)>();
        if (question >= 0)
        {
            foreach (var pair in value[(question + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var eq = pair.IndexOf('=', StringComparison.Ordinal);
                query.Add(eq >= 0 ? (Uri.UnescapeDataString(pair[..eq]), Uri.UnescapeDataString(pair[(eq + 1)..])) : (Uri.UnescapeDataString(pair), string.Empty));
            }

            value = value[..question];
        }

        string? server = null;
        var scheme = value.IndexOf("://", StringComparison.Ordinal);
        if (scheme >= 0)
        {
            var slash = value.IndexOf('/', scheme + 3);
            server = slash >= 0 ? value[..slash] : value;
            value = slash >= 0 ? value[slash..] : "/";
        }
        else if (!value.StartsWith('/'))
        {
            var slash = value.IndexOf('/', StringComparison.Ordinal);
            var first = slash >= 0 ? value[..slash] : value;
            if (first.Contains("{{", StringComparison.Ordinal) || first.Contains('.', StringComparison.Ordinal) || first.Contains(':', StringComparison.Ordinal)
                || first.Equals("localhost", StringComparison.OrdinalIgnoreCase))
            {
                server = first;
                value = slash >= 0 ? value[slash..] : "/";
            }
        }

        if (server is not null)
        {
            // {{baseUrl}} çözülebiliyorsa değeri (ve içindeki yol) kullanılır; çözülemiyorsa sunucu değişkeni olur.
            server = VariableResolver.Resolve(server, name => variables.GetValueOrDefault(name));
            if (!server.Contains("://", StringComparison.Ordinal) && !server.Contains("{{", StringComparison.Ordinal))
            {
                server = "https://" + server;
            }

            server = server.TrimEnd('/');
        }

        return (server, value.Length == 0 ? "/" : value, query);
    }

    private static JsonObject ServerObject(string server)
    {
        var variables = new JsonObject();
        var url = AnyVariable().Replace(server, m =>
        {
            var name = m.Groups[1].Value.Trim();
            variables[name] = new JsonObject { ["default"] = name == "baseUrl" ? "https://api.example.com" : name };
            return "{" + name + "}";
        });
        var result = new JsonObject { ["url"] = url };
        if (variables.Count > 0)
        {
            result["variables"] = variables;
        }

        return result;
    }

    /// <summary>":id", "{id}" ve "{{id}}" parçaları {id} olur ve yol parametresi eklenir.</summary>
    private static string PathTemplate(string path, JsonArray parameters)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries).Select(segment =>
        {
            string? name = null;
            if (segment.StartsWith(':') && segment.Length > 1)
            {
                name = segment[1..];
            }
            else if (WholeVariable().Match(segment) is { Success: true } m)
            {
                name = m.Groups[1].Value.Trim();
            }
            else if (segment.StartsWith('{') && segment.EndsWith('}') && segment.Length > 2)
            {
                name = segment[1..^1];
            }

            if (name is null)
            {
                return AnyVariable().Replace(segment, m => "{" + m.Groups[1].Value.Trim() + "}");
            }

            parameters.Add(Parameter(name, "path", required: true, null));
            return "{" + name + "}";
        });
        return "/" + string.Join('/', segments);
    }

    private static JsonObject Parameter(string name, string location, bool required, string? example)
    {
        var parameter = new JsonObject
        {
            ["name"] = name,
            ["in"] = location,
            ["required"] = required,
            ["schema"] = new JsonObject { ["type"] = "string" },
        };
        if (!string.IsNullOrEmpty(example) && !example.Contains("{{", StringComparison.Ordinal))
        {
            parameter["example"] = example;
        }

        return parameter;
    }

    private static string UniqueOperationId(string name, string method, HashSet<string> used)
    {
        var words = NonWord().Split(Ascii(name)).Where(w => w.Length > 0).ToList();
        var id = words.Count == 0
            ? method
            : words[0].ToLowerInvariant() + string.Concat(words.Skip(1).Select(w => char.ToUpperInvariant(w[0]) + w[1..].ToLowerInvariant()));
        var candidate = id;
        for (var i = 2; !used.Add(candidate); i++)
        {
            candidate = id + i.ToString(CultureInfo.InvariantCulture);
        }

        return candidate;
    }

    /// <summary>operationId için Türkçe harfleri sadeleştirir.</summary>
    private static string Ascii(string text)
    {
        var builder = new StringBuilder(text.Length);
        foreach (var c in text)
        {
            builder.Append(c switch
            {
                'ç' => 'c',
                'Ç' => 'C',
                'ğ' => 'g',
                'Ğ' => 'G',
                'ı' => 'i',
                'İ' => 'I',
                'ö' => 'o',
                'Ö' => 'O',
                'ş' => 's',
                'Ş' => 'S',
                'ü' => 'u',
                'Ü' => 'U',
                _ => c,
            });
        }

        return builder.ToString();
    }

    private static JsonObject? RequestBodyFor(RequestBody body, IReadOnlyList<KeyValueItem> headers)
    {
        var declared = headers.LastOrDefault(h => h.Enabled && h.Key.Trim().Equals("Content-Type", StringComparison.OrdinalIgnoreCase))?.Value.Split(';')[0].Trim();
        switch (body.Mode)
        {
            case BodyMode.Raw when body.Raw.Length > 0:
                {
                    var mediaType = declared ?? body.RawLanguage switch
                    {
                        RawLanguage.Json => "application/json",
                        RawLanguage.Xml => "application/xml",
                        RawLanguage.Html => "text/html",
                        RawLanguage.JavaScript => "application/javascript",
                        _ => "text/plain",
                    };
                    return Content(mediaType, MediaObject(body.Raw, mediaType));
                }

            case BodyMode.GraphQL:
                {
                    var example = new JsonObject { ["query"] = body.Raw };
                    if (TryParse(body.GraphqlVariables) is { } vars)
                    {
                        example["variables"] = vars;
                    }

                    return Content("application/json", new JsonObject { ["schema"] = InferSchema(example, 0), ["example"] = example.DeepClone() });
                }

            case BodyMode.UrlEncoded or BodyMode.FormData:
                {
                    var properties = new JsonObject();
                    var example = new JsonObject();
                    foreach (var field in body.Form.Where(f => f.Enabled && !string.IsNullOrWhiteSpace(f.Key)))
                    {
                        properties[field.Key] = field.Type == FormFieldType.File
                            ? new JsonObject { ["type"] = "string", ["format"] = "binary" }
                            : new JsonObject { ["type"] = "string" };
                        if (field.Type != FormFieldType.File && !field.Value.Contains("{{", StringComparison.Ordinal))
                        {
                            example[field.Key] = field.Value;
                        }
                    }

                    var media = new JsonObject { ["schema"] = new JsonObject { ["type"] = "object", ["properties"] = properties } };
                    if (example.Count > 0)
                    {
                        media["example"] = example;
                    }

                    return Content(body.Mode == BodyMode.FormData ? "multipart/form-data" : "application/x-www-form-urlencoded", media);
                }

            case BodyMode.Binary:
                return Content(declared ?? "application/octet-stream", new JsonObject { ["schema"] = new JsonObject { ["type"] = "string", ["format"] = "binary" } });

            default:
                return null;
        }

        static JsonObject Content(string mediaType, JsonObject media) =>
            new() { ["content"] = new JsonObject { [mediaType] = media } };
    }

    private static JsonObject Responses(List<ResponseExample> examples)
    {
        var responses = new JsonObject();
        if (examples.Count == 0)
        {
            responses["default"] = new JsonObject { ["description"] = L.T("export.openapi_response", "Yanıt") };
            return responses;
        }

        foreach (var group in examples.GroupBy(e => e.Status).OrderBy(g => g.Key))
        {
            var first = group.First();
            var response = new JsonObject { ["description"] = string.Join(" / ", group.Select(e => e.Name)) };
            var contentType = first.Headers.LastOrDefault(h => h.Enabled && h.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase))?.Value.Split(';')[0].Trim()
                ?? (TryParse(first.Body) is not null ? "application/json" : "text/plain");
            var withBody = group.Where(e => e.Body.Length > 0).ToList();
            if (withBody.Count > 0)
            {
                var media = MediaObject(withBody[0].Body, contentType);
                if (withBody.Count > 1)
                {
                    media.Remove("example");
                    var named = new JsonObject();
                    foreach (var example in withBody)
                    {
                        var key = example.Name;
                        for (var i = 2; named.ContainsKey(key); i++)
                        {
                            key = $"{example.Name} {i}";
                        }

                        named[key] = new JsonObject { ["summary"] = example.Name, ["value"] = Value(example.Body, contentType) };
                    }

                    media["examples"] = named;
                }

                response["content"] = new JsonObject { [contentType] = media };
            }

            responses[group.Key.ToString(CultureInfo.InvariantCulture)] = response;
        }

        return responses;
    }

    private static JsonObject MediaObject(string body, string mediaType)
    {
        var media = new JsonObject();
        var value = Value(body, mediaType);
        if (value is JsonObject or JsonArray)
        {
            media["schema"] = InferSchema(value, 0);
        }
        else
        {
            media["schema"] = new JsonObject { ["type"] = "string" };
        }

        media["example"] = value?.DeepClone();
        return media;
    }

    private static JsonNode? Value(string body, string mediaType) =>
        mediaType.Contains("json", StringComparison.OrdinalIgnoreCase) && TryParse(body) is { } parsed ? parsed : JsonValue.Create(body);

    private static JsonNode? TryParse(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        try
        {
            return JsonNode.Parse(text);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>JSON örnekten basit şema: tipler, nesne alanları, dizinin ilk elemanı.</summary>
    internal static JsonObject InferSchema(JsonNode? node, int depth)
    {
        if (depth > MaxSchemaDepth)
        {
            return [];
        }

        switch (node)
        {
            case JsonObject obj:
                {
                    var properties = new JsonObject();
                    foreach (var (key, value) in obj)
                    {
                        properties[key] = InferSchema(value, depth + 1);
                    }

                    return new JsonObject { ["type"] = "object", ["properties"] = properties };
                }

            case JsonArray array:
                return new JsonObject { ["type"] = "array", ["items"] = array.Count > 0 ? InferSchema(array[0], depth + 1) : new JsonObject() };
            case JsonValue value:
                return value.GetValueKind() switch
                {
                    JsonValueKind.String => new JsonObject { ["type"] = "string" },
                    JsonValueKind.Number => new JsonObject { ["type"] = value.TryGetValue<long>(out _) ? "integer" : "number" },
                    JsonValueKind.True or JsonValueKind.False => new JsonObject { ["type"] = "boolean" },
                    _ => new JsonObject { ["nullable"] = true },
                };
            default:
                return new JsonObject { ["nullable"] = true };
        }
    }

    private static RequestAuth EffectiveAuth(ApiRequest request, Dictionary<Guid, Folder> folders, RequestAuth collectionAuth) =>
        AuthInheritance.Resolve(request.Definition.Auth, request.FolderId, folders, collectionAuth);

    /// <summary>Yetkilendirmeyi güvenlik şemasına çevirir; şema bileşenlere eklenir. Yetkilendirme yoksa null.</summary>
    private static JsonArray? SecurityFor(RequestAuth auth, JsonObject schemes)
    {
        (string Name, JsonObject Scheme)? entry = auth.Type switch
        {
            AuthType.Bearer => ("bearerAuth", new JsonObject { ["type"] = "http", ["scheme"] = "bearer" }),
            AuthType.Basic => ("basicAuth", new JsonObject { ["type"] = "http", ["scheme"] = "basic" }),
            AuthType.Digest => ("digestAuth", new JsonObject { ["type"] = "http", ["scheme"] = "digest" }),
            AuthType.ApiKey when auth.ApiKeyName.Length > 0 => (
                $"apiKey_{NonWord().Replace(auth.ApiKeyName, "_")}",
                new JsonObject { ["type"] = "apiKey", ["name"] = auth.ApiKeyName, ["in"] = auth.ApiKeyIn == ApiKeyLocation.Query ? "query" : "header" }),
            AuthType.OAuth2 => ("oauth2", new JsonObject { ["type"] = "oauth2", ["flows"] = OAuthFlows(auth) }),
            _ => null,
        };
        if (entry is not { } e)
        {
            return null;
        }

        schemes[e.Name] = e.Scheme;
        var scopes = auth.Type == AuthType.OAuth2
            ? new JsonArray(auth.OAuth2Scope.Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(s => (JsonNode?)s).ToArray())
            : [];
        return [new JsonObject { [e.Name] = scopes }];
    }

    private static JsonObject OAuthFlows(RequestAuth auth)
    {
        var scopes = new JsonObject();
        foreach (var scope in auth.OAuth2Scope.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            scopes[scope] = scope;
        }

        var tokenUrl = string.IsNullOrEmpty(auth.OAuth2TokenUrl) ? "https://example.com/oauth/token" : auth.OAuth2TokenUrl;
        return auth.OAuth2GrantType switch
        {
            OAuth2GrantType.AuthorizationCode => new JsonObject
            {
                ["authorizationCode"] = new JsonObject
                {
                    ["authorizationUrl"] = string.IsNullOrEmpty(auth.OAuth2AuthUrl) ? "https://example.com/oauth/authorize" : auth.OAuth2AuthUrl,
                    ["tokenUrl"] = tokenUrl,
                    ["scopes"] = scopes,
                },
            },
            OAuth2GrantType.Password => new JsonObject { ["password"] = new JsonObject { ["tokenUrl"] = tokenUrl, ["scopes"] = scopes } },
            _ => new JsonObject { ["clientCredentials"] = new JsonObject { ["tokenUrl"] = tokenUrl, ["scopes"] = scopes } },
        };
    }

    private static string? TopFolder(Guid? folderId, Dictionary<Guid, Folder> folders)
    {
        Folder? top = null;
        var guard = 0;
        while (folderId is { } id && folders.TryGetValue(id, out var folder) && guard++ < 50)
        {
            top = folder;
            folderId = folder.ParentFolderId;
        }

        return top?.Name;
    }

    /// <summary>İstekleri ağaçtaki sırayla (derinlik öncelikli; aynı seviyede SortOrder) döndürür.</summary>
    private static List<ApiRequest> TreeOrder(IReadOnlyList<Folder> folders, IReadOnlyList<ApiRequest> requests)
    {
        var folderIds = folders.Select(f => f.Id).ToHashSet();
        var childFolders = folders.ToLookup(f => f.ParentFolderId is { } p && folderIds.Contains(p) ? p : (Guid?)null);
        var childRequests = requests.ToLookup(r => r.FolderId is { } f && folderIds.Contains(f) ? f : (Guid?)null);
        var result = new List<ApiRequest>(requests.Count);
        var visited = new HashSet<Guid>();

        void Walk(Guid? parent)
        {
            var level = childFolders[parent].Select(f => (f.SortOrder, Folder: (Folder?)f, Request: (ApiRequest?)null))
                .Concat(childRequests[parent].Select(r => (r.SortOrder, Folder: (Folder?)null, Request: (ApiRequest?)r)))
                .OrderBy(x => x.SortOrder).ThenBy(x => x.Folder is null ? 1 : 0);
            foreach (var (_, folder, request) in level)
            {
                if (request is not null)
                {
                    result.Add(request);
                }
                else if (folder is not null && visited.Add(folder.Id))
                {
                    Walk(folder.Id);
                }
            }
        }

        Walk(null);
        return result;
    }
}
