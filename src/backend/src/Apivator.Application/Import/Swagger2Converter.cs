using System.Text.Json.Nodes;

namespace Apivator.Application.Import;

/// <summary>
/// Swagger 2.0 belgesini OpenAPI 3.0.3'e çevirir; böylece tek içe aktarıcı (OpenApiParser) ikisini de okur.
/// host/basePath/schemes → servers, definitions → components.schemas, body ve formData parametreleri →
/// requestBody, yanıt şeması → content (produces türleriyle), securityDefinitions → securitySchemes.
/// </summary>
internal static class Swagger2Converter
{
    private static readonly string[] Methods = ["get", "put", "post", "delete", "options", "head", "patch"];

    /// <param name="swagger">Swagger 2.0 belgesi (değiştirilmez).</param>
    /// <param name="documentUrl">Belge bir adresten çekildiyse; host ya da şema yoksa ondan tamamlanır.</param>
    public static JsonObject Convert(JsonObject swagger, Uri? documentUrl)
    {
        var converter = new State(swagger);
        return converter.Run(documentUrl);
    }

    private sealed class State(JsonObject src)
    {
        private readonly JsonArray _consumes = Strings(src["consumes"], "application/json");
        private readonly JsonArray _produces = Strings(src["produces"], "application/json");

        public JsonObject Run(Uri? documentUrl)
        {
            var result = new JsonObject
            {
                ["openapi"] = "3.0.3",
                ["info"] = src["info"]?.DeepClone() ?? new JsonObject { ["title"] = "API", ["version"] = "1.0" },
                ["servers"] = new JsonArray(new JsonObject { ["url"] = Server(documentUrl) }),
            };

            foreach (var key in new[] { "tags", "externalDocs", "security" })
            {
                if (src[key] is { } value)
                {
                    result[key] = value.DeepClone();
                }
            }

            CopyExtensions(src, result);

            var components = new JsonObject();
            if (src["definitions"] is JsonObject definitions)
            {
                components["schemas"] = Schema(definitions.DeepClone(), propertyMap: true);
            }

            if (src["parameters"] is JsonObject parameters)
            {
                var converted = new JsonObject();
                foreach (var (name, parameter) in parameters)
                {
                    if (parameter is JsonObject p && Text(p, "in") is not ("body" or "formData"))
                    {
                        converted[name] = Parameter(p);
                    }
                }

                if (converted.Count > 0)
                {
                    components["parameters"] = converted;
                }
            }

            if (src["responses"] is JsonObject responses)
            {
                var converted = new JsonObject();
                foreach (var (name, response) in responses)
                {
                    converted[name] = Response(response as JsonObject, _produces);
                }

                components["responses"] = converted;
            }

            if (src["securityDefinitions"] is JsonObject security)
            {
                var schemes = new JsonObject();
                foreach (var (name, definition) in security)
                {
                    if (definition is JsonObject d && SecurityScheme(d) is { } scheme)
                    {
                        schemes[name] = scheme;
                    }
                }

                components["securitySchemes"] = schemes;
            }

            var paths = new JsonObject();
            if (src["paths"] is JsonObject sourcePaths)
            {
                foreach (var (path, item) in sourcePaths)
                {
                    if (item is JsonObject pathItem)
                    {
                        paths[path] = PathItem(pathItem);
                    }
                }
            }

            result["paths"] = paths;
            if (components.Count > 0)
            {
                result["components"] = components;
            }

            return result;
        }

        private string Server(Uri? documentUrl)
        {
            var basePath = Text(src, "basePath") ?? string.Empty;
            if (basePath.Length > 0 && !basePath.StartsWith('/'))
            {
                basePath = "/" + basePath;
            }

            basePath = basePath.TrimEnd('/');
            var host = Text(src, "host");
            var schemes = Strings(src["schemes"]).Select(s => s?.GetValue<string>()).ToList();
            var scheme = schemes.Contains("https") ? "https"
                : schemes.FirstOrDefault(s => s is "http" or "https")
                ?? (documentUrl is { Scheme: "http" or "https" } ? documentUrl.Scheme : "https");

            if (string.IsNullOrWhiteSpace(host))
            {
                // Host yoksa belge hangi sunucudan geldiyse o; dosyadan geldiyse göreli kalır (içe aktarıcı uyarır).
                return documentUrl is null ? (basePath.Length > 0 ? basePath : "/") : $"{scheme}://{documentUrl.Authority}{basePath}";
            }

            return $"{scheme}://{host.TrimEnd('/')}{basePath}";
        }

        // ------------------------------------------------------------------------------------ yollar

        private JsonObject PathItem(JsonObject item)
        {
            var result = new JsonObject();
            var shared = Parameters(item["parameters"]);
            foreach (var (key, value) in item)
            {
                if (key is "summary" or "description" or "servers" || key.StartsWith("x-", StringComparison.Ordinal))
                {
                    result[key] = value?.DeepClone();
                }
            }

            foreach (var method in Methods)
            {
                if (item[method] is JsonObject operation)
                {
                    result[method] = Operation(operation, shared);
                }
            }

            return result;
        }

        private JsonObject Operation(JsonObject operation, List<JsonObject> shared)
        {
            var result = new JsonObject();
            foreach (var key in new[] { "tags", "summary", "description", "operationId", "deprecated", "security", "externalDocs" })
            {
                if (operation[key] is { } value)
                {
                    result[key] = value.DeepClone();
                }
            }

            CopyExtensions(operation, result);

            // İşlem düzeyindeki parametre yol düzeyindekini (ad + konum) ezer.
            var parameters = shared.ToList();
            foreach (var p in Parameters(operation["parameters"]))
            {
                parameters.RemoveAll(x => Text(x, "name") == Text(p, "name") && Text(x, "in") == Text(p, "in"));
                parameters.Add(p);
            }

            var consumes = operation["consumes"] is JsonArray c ? Strings(c, "application/json") : _consumes;
            var produces = operation["produces"] is JsonArray pr ? Strings(pr, "application/json") : _produces;

            var converted = new JsonArray();
            JsonObject? body = null;
            var form = new List<JsonObject>();
            foreach (var p in parameters)
            {
                switch (Text(p, "in"))
                {
                    case "body":
                        body = p;
                        break;
                    case "formData":
                        form.Add(p);
                        break;
                    case null when p["$ref"] is not null:
                        converted.Add(new JsonObject { ["$ref"] = Ref(Text(p, "$ref")!) });
                        break;
                    default:
                        converted.Add(Parameter(p));
                        break;
                }
            }

            if (converted.Count > 0)
            {
                result["parameters"] = converted;
            }

            if (body is not null)
            {
                result["requestBody"] = BodyParameter(body, consumes);
            }
            else if (form.Count > 0)
            {
                result["requestBody"] = FormBody(form, consumes);
            }

            var responses = new JsonObject();
            if (operation["responses"] is JsonObject sourceResponses)
            {
                foreach (var (code, response) in sourceResponses)
                {
                    responses[code] = response is JsonObject r && Text(r, "$ref") is { } reference
                        ? new JsonObject { ["$ref"] = Ref(reference) }
                        : Response(response as JsonObject, produces);
                }
            }

            result["responses"] = responses.Count > 0 ? responses : new JsonObject { ["default"] = new JsonObject { ["description"] = string.Empty } };
            return result;
        }

        /// <summary>Parametre listesi; body/formData'ya giden genel parametre referansları içeri açılır.</summary>
        private List<JsonObject> Parameters(JsonNode? node)
        {
            var result = new List<JsonObject>();
            foreach (var item in node as JsonArray ?? [])
            {
                if (item is not JsonObject p)
                {
                    continue;
                }

                if (Text(p, "$ref") is { } reference && reference.StartsWith("#/parameters/", StringComparison.Ordinal))
                {
                    var name = Unescape(reference["#/parameters/".Length..]);
                    if (src["parameters"]?[name] is JsonObject target && Text(target, "in") is "body" or "formData")
                    {
                        result.Add(target);
                        continue;
                    }

                    // Diğerleri components.parameters'a referans olarak kalır; ad/konum çakışma kontrolü için çözülmüş hali gerekmez.
                    var copy = new JsonObject { ["$ref"] = reference };
                    if (src["parameters"]?[name] is JsonObject resolved)
                    {
                        copy["name"] = resolved["name"]?.DeepClone();
                        copy["in"] = resolved["in"]?.DeepClone();
                    }

                    result.Add(copy);
                    continue;
                }

                result.Add(p);
            }

            return result;
        }

        private static JsonObject Parameter(JsonObject p)
        {
            if (Text(p, "$ref") is { } reference)
            {
                return new JsonObject { ["$ref"] = Ref(reference) };
            }

            var result = new JsonObject();
            foreach (var key in new[] { "name", "in", "description", "required", "allowEmptyValue", "deprecated" })
            {
                if (p[key] is { } value)
                {
                    result[key] = value.DeepClone();
                }
            }

            if (Text(p, "in") == "path")
            {
                result["required"] = true;
            }

            result["schema"] = SimpleSchema(p);
            if (p["x-example"] is { } example)
            {
                result["example"] = example.DeepClone();
            }

            if (Text(p, "collectionFormat") is { } format && p["type"]?.GetValue<string>() == "array")
            {
                switch (format)
                {
                    case "multi":
                        result["explode"] = true;
                        break;
                    case "csv":
                        result["explode"] = false;
                        break;
                    case "ssv":
                        result["style"] = "spaceDelimited";
                        break;
                    case "pipes":
                        result["style"] = "pipeDelimited";
                        break;
                }
            }

            CopyExtensions(p, result);
            return result;
        }

        /// <summary>Body dışı parametrenin ve form alanının tip bilgisinden şema.</summary>
        private static JsonObject SimpleSchema(JsonObject p)
        {
            var schema = new JsonObject();
            foreach (var key in new[]
            {
                "type", "format", "items", "enum", "default", "maximum", "exclusiveMaximum", "minimum", "exclusiveMinimum",
                "maxLength", "minLength", "pattern", "maxItems", "minItems", "uniqueItems", "multipleOf",
            })
            {
                if (p[key] is { } value)
                {
                    schema[key] = value.DeepClone();
                }
            }

            if (Text(schema, "type") == "file")
            {
                schema["type"] = "string";
                schema["format"] = "binary";
            }

            return (JsonObject)Schema(schema, propertyMap: false);
        }

        private static JsonObject BodyParameter(JsonObject body, JsonArray consumes)
        {
            var content = new JsonObject();
            var types = consumes.Select(t => t?.GetValue<string>() ?? string.Empty)
                .Where(t => t.Length > 0 && !t.StartsWith("multipart/", StringComparison.OrdinalIgnoreCase) && !t.StartsWith("application/x-www-form-urlencoded", StringComparison.OrdinalIgnoreCase))
                .DefaultIfEmpty("application/json");
            foreach (var type in types)
            {
                var media = new JsonObject { ["schema"] = Schema(body["schema"]?.DeepClone() ?? new JsonObject(), propertyMap: false) };
                if (body["x-example"] is { } example)
                {
                    media["example"] = example.DeepClone();
                }
                else if (body["x-examples"] is JsonObject examples && examples[type] is { } typed)
                {
                    media["example"] = typed.DeepClone();
                }

                content[type] = media;
            }

            var result = new JsonObject { ["content"] = content };
            if (body["description"] is { } description)
            {
                result["description"] = description.DeepClone();
            }

            if (body["required"] is { } required)
            {
                result["required"] = required.DeepClone();
            }

            return result;
        }

        private static JsonObject FormBody(List<JsonObject> fields, JsonArray consumes)
        {
            var multipart = fields.Any(f => Text(f, "type") == "file")
                || consumes.Any(t => (t?.GetValue<string>() ?? string.Empty).StartsWith("multipart/form-data", StringComparison.OrdinalIgnoreCase));
            var properties = new JsonObject();
            var required = new JsonArray();
            foreach (var field in fields)
            {
                if (Text(field, "name") is not { } name)
                {
                    continue;
                }

                var schema = SimpleSchema(field);
                if (field["description"] is { } description)
                {
                    schema["description"] = description.DeepClone();
                }

                if (field["x-example"] is { } example)
                {
                    schema["example"] = example.DeepClone();
                }

                properties[name] = schema;
                if (field["required"]?.GetValueKind() == System.Text.Json.JsonValueKind.True)
                {
                    required.Add(name);
                }
            }

            var objectSchema = new JsonObject { ["type"] = "object", ["properties"] = properties };
            if (required.Count > 0)
            {
                objectSchema["required"] = required;
            }

            return new JsonObject
            {
                ["content"] = new JsonObject
                {
                    [multipart ? "multipart/form-data" : "application/x-www-form-urlencoded"] = new JsonObject { ["schema"] = objectSchema },
                },
            };
        }

        private static JsonObject Response(JsonObject? response, JsonArray produces)
        {
            var result = new JsonObject { ["description"] = response?["description"]?.DeepClone() ?? string.Empty };
            if (response is null)
            {
                return result;
            }

            if (response["headers"] is JsonObject headers)
            {
                var converted = new JsonObject();
                foreach (var (name, header) in headers)
                {
                    if (header is JsonObject h)
                    {
                        var item = new JsonObject { ["schema"] = SimpleSchema(h) };
                        if (h["description"] is { } description)
                        {
                            item["description"] = description.DeepClone();
                        }

                        converted[name] = item;
                    }
                }

                result["headers"] = converted;
            }

            var content = new JsonObject();
            if (response["schema"] is { } schema)
            {
                foreach (var type in produces.Select(t => t?.GetValue<string>()).OfType<string>())
                {
                    content[type] = new JsonObject { ["schema"] = Schema(schema.DeepClone(), propertyMap: false) };
                }
            }

            if (response["examples"] is JsonObject examples)
            {
                foreach (var (type, example) in examples)
                {
                    if (content[type] is not JsonObject media)
                    {
                        media = new JsonObject();
                        if (response["schema"] is { } s)
                        {
                            media["schema"] = Schema(s.DeepClone(), propertyMap: false);
                        }

                        content[type] = media;
                    }

                    media["example"] = example?.DeepClone();
                }
            }

            if (content.Count > 0)
            {
                result["content"] = content;
            }

            return result;
        }

        private static JsonObject? SecurityScheme(JsonObject definition)
        {
            switch (Text(definition, "type"))
            {
                case "basic":
                    return new JsonObject { ["type"] = "http", ["scheme"] = "basic" };
                case "apiKey":
                    return new JsonObject { ["type"] = "apiKey", ["name"] = definition["name"]?.DeepClone(), ["in"] = definition["in"]?.DeepClone() };
                case "oauth2":
                    var flow = new JsonObject { ["scopes"] = definition["scopes"]?.DeepClone() ?? new JsonObject() };
                    if (definition["authorizationUrl"] is { } authorizationUrl)
                    {
                        flow["authorizationUrl"] = authorizationUrl.DeepClone();
                    }

                    if (definition["tokenUrl"] is { } tokenUrl)
                    {
                        flow["tokenUrl"] = tokenUrl.DeepClone();
                    }

                    var name = Text(definition, "flow") switch
                    {
                        "implicit" => "implicit",
                        "password" => "password",
                        "application" => "clientCredentials",
                        _ => "authorizationCode",
                    };
                    return new JsonObject { ["type"] = "oauth2", ["flows"] = new JsonObject { [name] = flow } };
                default:
                    return null;
            }
        }
    }

    /// <summary>
    /// Şemadaki 2.0'a özgü yazımları çevirir: $ref yolları, x-nullable, type: file, metin discriminator.
    /// propertyMap: düğüm bir ad → şema eşlemesi (definitions, properties) ise.
    /// </summary>
    private static JsonNode Schema(JsonNode node, bool propertyMap)
    {
        if (node is JsonArray array)
        {
            foreach (var item in array)
            {
                if (item is not null)
                {
                    Schema(item, propertyMap: false);
                }
            }

            return node;
        }

        if (node is not JsonObject obj)
        {
            return node;
        }

        if (propertyMap)
        {
            foreach (var (_, value) in obj)
            {
                if (value is not null)
                {
                    Schema(value, propertyMap: false);
                }
            }

            return node;
        }

        if (Text(obj, "$ref") is { } reference)
        {
            obj["$ref"] = Ref(reference);
        }

        if (obj["x-nullable"]?.GetValueKind() == System.Text.Json.JsonValueKind.True)
        {
            obj.Remove("x-nullable");
            obj["nullable"] = true;
        }

        if (Text(obj, "type") == "file")
        {
            obj["type"] = "string";
            obj["format"] = "binary";
        }

        if (Text(obj, "discriminator") is { } discriminator)
        {
            obj["discriminator"] = new JsonObject { ["propertyName"] = discriminator };
        }

        foreach (var key in new[] { "items", "additionalProperties", "not" })
        {
            if (obj[key] is JsonObject child)
            {
                Schema(child, propertyMap: false);
            }
        }

        foreach (var key in new[] { "allOf", "anyOf", "oneOf" })
        {
            if (obj[key] is JsonArray children)
            {
                Schema(children, propertyMap: false);
            }
        }

        if (obj["properties"] is JsonObject properties)
        {
            Schema(properties, propertyMap: true);
        }

        return node;
    }

    private static string Ref(string reference) =>
        reference.StartsWith("#/definitions/", StringComparison.Ordinal) ? "#/components/schemas/" + reference["#/definitions/".Length..]
        : reference.StartsWith("#/parameters/", StringComparison.Ordinal) ? "#/components/parameters/" + reference["#/parameters/".Length..]
        : reference.StartsWith("#/responses/", StringComparison.Ordinal) ? "#/components/responses/" + reference["#/responses/".Length..]
        : reference;

    private static string Unescape(string segment) =>
        Uri.UnescapeDataString(segment).Replace("~1", "/", StringComparison.Ordinal).Replace("~0", "~", StringComparison.Ordinal);

    private static void CopyExtensions(JsonObject from, JsonObject to)
    {
        foreach (var (key, value) in from)
        {
            if (key.StartsWith("x-", StringComparison.Ordinal) && key is not ("x-example" or "x-examples" or "x-nullable"))
            {
                to[key] = value?.DeepClone();
            }
        }
    }

    private static JsonArray Strings(JsonNode? node, string? fallback = null)
    {
        var result = new JsonArray();
        foreach (var item in node as JsonArray ?? [])
        {
            if (item is JsonValue v && v.TryGetValue<string>(out var s) && s.Length > 0)
            {
                result.Add(s);
            }
        }

        if (result.Count == 0 && fallback is not null)
        {
            result.Add(fallback);
        }

        return result;
    }

    private static string? Text(JsonObject? owner, string name) =>
        owner?[name] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}
