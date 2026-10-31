using System.Text.Json.Nodes;
using Apivator.Domain.Collections;
using Apivator.Domain.Environments;
using Apivator.Domain.Variables;

namespace Apivator.Application.Import;

/// <summary>Collection ve environment'ları Postman v2.1 formatında dışa aktarır; Postman bunları doğrudan içe alır.</summary>
internal static class PostmanExporter
{
    public const string CollectionSchema = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

    public static JsonObject Collection(
        Collection collection,
        IReadOnlyList<Folder> folders,
        IReadOnlyList<ApiRequest> requests,
        IReadOnlyList<ResponseExample> examples)
    {
        var byRequest = examples.ToLookup(e => e.RequestId);
        var info = new JsonObject
        {
            ["_postman_id"] = collection.Id.ToString(),
            ["name"] = collection.Name,
            ["schema"] = CollectionSchema,
        };
        if (!string.IsNullOrEmpty(collection.Description))
        {
            info["description"] = collection.Description;
        }

        var root = new JsonObject { ["info"] = info, ["item"] = Items(null, folders, requests, byRequest) };
        AddEvents(root, collection.Scripts);
        if (Auth(collection.Auth) is { } auth)
        {
            root["auth"] = auth;
        }

        if (collection.Variables.Count > 0)
        {
            root["variable"] = new JsonArray(collection.Variables.Select(v =>
            {
                var node = new JsonObject { ["key"] = v.Key, ["value"] = v.Value };
                if (!v.Enabled)
                {
                    node["disabled"] = true;
                }

                if (v.IsSecret)
                {
                    node["type"] = "secret";
                }

                return (JsonNode)node;
            }).ToArray());
        }

        return root;
    }

    public static JsonObject Environment(WorkspaceEnvironment environment) => new()
    {
        ["id"] = environment.Id.ToString(),
        ["name"] = environment.Name,
        ["values"] = new JsonArray(environment.Variables.Select(v => (JsonNode)new JsonObject
        {
            ["key"] = v.Key,
            ["value"] = v.Value,
            ["type"] = v.IsSecret ? "secret" : "default",
            ["enabled"] = v.Enabled,
        }).ToArray()),
        ["_postman_variable_scope"] = "environment",
        ["_postman_exported_using"] = "Apivator",
    };

    private static JsonArray Items(Guid? parentId, IReadOnlyList<Folder> folders, IReadOnlyList<ApiRequest> requests, ILookup<Guid, ResponseExample> examples)
    {
        var children = folders.Where(f => f.ParentFolderId == parentId).Select(f => (f.SortOrder, Node: Folder(f, folders, requests, examples)))
            .Concat(requests.Where(r => r.FolderId == parentId).Select(r => (r.SortOrder, Node: Request(r, examples[r.Id]))))
            .OrderBy(c => c.SortOrder)
            .Select(c => (JsonNode)c.Node)
            .ToArray();
        return new JsonArray(children);
    }

    private static JsonObject Folder(Folder folder, IReadOnlyList<Folder> folders, IReadOnlyList<ApiRequest> requests, ILookup<Guid, ResponseExample> examples)
    {
        var node = new JsonObject { ["name"] = folder.Name, ["item"] = Items(folder.Id, folders, requests, examples) };
        if (!string.IsNullOrEmpty(folder.Description))
        {
            node["description"] = folder.Description;
        }

        AddEvents(node, folder.Scripts);
        if (Auth(folder.Auth) is { } auth)
        {
            node["auth"] = auth;
        }

        return node;
    }

    private static JsonObject Request(ApiRequest request, IEnumerable<ResponseExample> examples)
    {
        var requestNode = RequestNode(request.Definition);
        if (request.Definition.Description.Length > 0)
        {
            requestNode["description"] = request.Definition.Description;
        }

        var node = new JsonObject { ["name"] = request.Name, ["request"] = requestNode };
        AddEvents(node, request.Definition.Scripts);
        var responses = examples.Select(e => (JsonNode)new JsonObject
        {
            ["name"] = e.Name,
            ["originalRequest"] = RequestNode(e.Request),
            ["code"] = e.Status,
            ["status"] = ReasonPhrase(e.Status),
            ["header"] = KeyValues(e.Headers),
            ["body"] = e.Body,
        }).ToArray();
        if (responses.Length > 0)
        {
            node["response"] = new JsonArray(responses);
        }

        return node;
    }

    /// <summary>"NotFound" → "Not Found"; Postman bu alanı yalnızca gösterir.</summary>
    private static void AddEvents(JsonObject node, ScriptSet? scripts)
    {
        static JsonObject Event(string listen, string code) => new()
        {
            ["listen"] = listen,
            ["script"] = new JsonObject
            {
                ["type"] = "text/javascript",
                ["exec"] = new JsonArray(code.Split('\n').Select(line => (JsonNode)JsonValue.Create(line.TrimEnd('\r'))!).ToArray()),
            },
        };

        var events = new JsonArray();
        if (!string.IsNullOrWhiteSpace(scripts?.PreRequest))
        {
            events.Add(Event("prerequest", scripts.PreRequest));
        }

        if (!string.IsNullOrWhiteSpace(scripts?.PostResponse))
        {
            events.Add(Event("test", scripts.PostResponse));
        }

        if (events.Count > 0)
        {
            node["event"] = events;
        }
    }

    private static string ReasonPhrase(int status) =>
        Enum.IsDefined(typeof(System.Net.HttpStatusCode), status)
            ? System.Text.RegularExpressions.Regex.Replace(((System.Net.HttpStatusCode)status).ToString(), "(?<=[a-z])(?=[A-Z])", " ")
            : string.Empty;

    private static JsonObject RequestNode(RequestDefinition d)
    {
        var req = new JsonObject
        {
            ["method"] = d.Method,
            ["header"] = KeyValues(d.Headers),
            ["url"] = new JsonObject { ["raw"] = d.Url },
        };

        if (Body(d.Body) is { } body)
        {
            req["body"] = body;
        }

        if (Auth(d.Auth) is { } auth)
        {
            req["auth"] = auth;
        }

        // Postman v2.1'de WebSocket/SSE/gRPC isteği yok; tür ve kayıtlı mesajlar Apivator'a özel alanda taşınır
        // (Postman bu alanı yok sayar, geri içe aktarınca Apivator okur).
        if (d.Kind != RequestKind.Http)
        {
            var extra = new JsonObject { ["kind"] = d.Kind.ToString() };
            if (d.Protocols.Length > 0)
            {
                extra["protocols"] = d.Protocols;
            }

            if (d.Messages.Count > 0)
            {
                extra["messages"] = new JsonArray(d.Messages.Select(m => (JsonNode)new JsonObject { ["name"] = m.Name, ["body"] = m.Body, ["binary"] = m.Binary }).ToArray());
            }

            if (d.Kind == RequestKind.Grpc)
            {
                extra["grpc"] = System.Text.Json.JsonSerializer.SerializeToNode(d.Grpc, PostmanParser.GrpcJson);
            }

            req[PostmanParser.ExtensionKey] = extra;
        }

        return req;
    }

    private static JsonObject? Body(RequestBody body) => body.Mode switch
    {
        BodyMode.Raw => new JsonObject
        {
            ["mode"] = "raw",
            ["raw"] = body.Raw,
            ["options"] = new JsonObject { ["raw"] = new JsonObject { ["language"] = body.RawLanguage.ToString().ToLowerInvariant() } },
        },
        BodyMode.UrlEncoded => new JsonObject { ["mode"] = "urlencoded", ["urlencoded"] = KeyValues(body.Form, withType: true) },
        BodyMode.FormData => new JsonObject { ["mode"] = "formdata", ["formdata"] = KeyValues(body.Form, withType: true) },
        BodyMode.Binary => new JsonObject { ["mode"] = "file", ["file"] = new JsonObject { ["src"] = body.FileName } },
        BodyMode.GraphQL => new JsonObject
        {
            ["mode"] = "graphql",
            ["graphql"] = new JsonObject { ["query"] = body.Raw, ["variables"] = body.GraphqlVariables },
        },
        _ => null,
    };

    private static JsonObject? Auth(RequestAuth auth)
    {
        static JsonArray Params(params (string Key, string Value)[] values) =>
            new(values.Select(v => (JsonNode)new JsonObject { ["key"] = v.Key, ["value"] = v.Value, ["type"] = "string" }).ToArray());

        return auth.Type switch
        {
            AuthType.Inherit => null,
            AuthType.None => new JsonObject { ["type"] = "noauth" },
            AuthType.Bearer => new JsonObject { ["type"] = "bearer", ["bearer"] = Params(("token", auth.BearerToken)) },
            AuthType.Basic => new JsonObject { ["type"] = "basic", ["basic"] = Params(("username", auth.BasicUsername), ("password", auth.BasicPassword)) },
            AuthType.ApiKey => new JsonObject
            {
                ["type"] = "apikey",
                ["apikey"] = Params(("key", auth.ApiKeyName), ("value", auth.ApiKeyValue), ("in", auth.ApiKeyIn == ApiKeyLocation.Query ? "query" : "header")),
            },
            AuthType.Digest => new JsonObject { ["type"] = "digest", ["digest"] = Params(("username", auth.BasicUsername), ("password", auth.BasicPassword)) },
            AuthType.AwsSigV4 => new JsonObject
            {
                ["type"] = "awsv4",
                ["awsv4"] = Params(
                    ("accessKey", auth.AwsAccessKey),
                    ("secretKey", auth.AwsSecretKey),
                    ("region", auth.AwsRegion),
                    ("service", auth.AwsService),
                    ("sessionToken", auth.AwsSessionToken)),
            },
            AuthType.OAuth2 => new JsonObject
            {
                ["type"] = "oauth2",
                ["oauth2"] = Params(
                    ("grant_type", auth.OAuth2GrantType switch
                    {
                        OAuth2GrantType.ClientCredentials => "client_credentials",
                        OAuth2GrantType.Password => "password",
                        _ => "authorization_code_with_pkce",
                    }),
                    ("authUrl", auth.OAuth2AuthUrl),
                    ("accessTokenUrl", auth.OAuth2TokenUrl),
                    ("clientId", auth.OAuth2ClientId),
                    ("clientSecret", auth.OAuth2ClientSecret),
                    ("scope", auth.OAuth2Scope),
                    ("username", auth.OAuth2Username),
                    ("password", auth.OAuth2Password),
                    ("redirect_uri", auth.OAuth2RedirectUri),
                    ("client_authentication", auth.OAuth2ClientAuthentication == OAuth2ClientAuthentication.Body ? "body" : "header"),
                    ("headerPrefix", auth.OAuth2HeaderPrefix),
                    ("addTokenTo", "header")),
            },
            _ => null,
        };
    }

    private static JsonArray KeyValues(IEnumerable<KeyValueItem> items, bool withType = false) =>
        new(items.Select(item =>
        {
            var node = item.Type == FormFieldType.File && withType
                ? new JsonObject { ["key"] = item.Key, ["type"] = "file", ["src"] = item.Value }
                : new JsonObject { ["key"] = item.Key, ["value"] = item.Value };
            if (withType && item.Type != FormFieldType.File)
            {
                node["type"] = "text";
            }

            if (!item.Enabled)
            {
                node["disabled"] = true;
            }

            if (!string.IsNullOrEmpty(item.Description))
            {
                node["description"] = item.Description;
            }

            return (JsonNode)node;
        }).ToArray());
}
