using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Apivator.Application.Collections;
using Apivator.Application.Import;
using Apivator.Domain.Collections;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class OpenApiExportAndHarTests(ApivatorApiFactory factory)
{
    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();

    private static async Task<ImportResult> ImportAsync(HttpClient client, Guid workspaceId, JsonElement document) =>
        await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/import/postman", document)).ReadAsync<ImportResult>();

    private const string Postman = """
        {
          "info": { "name": "Mağaza", "description": "Ürün uçları", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
          "auth": { "type": "bearer", "bearer": [{ "key": "token", "value": "{{token}}" }] },
          "variable": [{ "key": "baseUrl", "value": "https://api.magaza.test/v1" }],
          "item": [
            {
              "name": "Ürünler",
              "item": [
                {
                  "name": "Ürün getir",
                  "request": {
                    "method": "GET",
                    "url": "{{baseUrl}}/urunler/:id?detay=true",
                    "header": [{ "key": "X-Dil", "value": "tr" }, { "key": "Accept", "value": "application/json" }]
                  },
                  "response": [
                    { "name": "Bulundu", "code": 200, "header": [{ "key": "Content-Type", "value": "application/json" }], "body": "{\"id\":42,\"ad\":\"Kalem\",\"fiyat\":9.5,\"etiketler\":[\"ofis\"]}" },
                    { "name": "Yok", "code": 404, "body": "" }
                  ]
                },
                {
                  "name": "Ürün ekle",
                  "request": {
                    "method": "POST",
                    "url": "{{baseUrl}}/urunler",
                    "header": [{ "key": "Content-Type", "value": "application/json" }],
                    "body": { "mode": "raw", "raw": "{\"ad\":\"Defter\",\"stok\":3}", "options": { "raw": { "language": "json" } } }
                  }
                }
              ]
            },
            {
              "name": "Giriş",
              "request": {
                "method": "POST",
                "auth": { "type": "noauth" },
                "url": "{{baseUrl}}/giris",
                "body": { "mode": "urlencoded", "urlencoded": [{ "key": "kullanici", "value": "ali" }] }
              }
            },
            {
              "name": "Ürün getir kopya",
              "request": { "method": "GET", "url": "{{baseUrl}}/urunler/{{id}}" }
            }
          ]
        }
        """;

    [Fact]
    public async Task ExportOpenApi_ProducesValidDocument_ThatImportsBack()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var imported = await ImportAsync(client, workspaceId, Parse(Postman));

        var response = await client.GetAsync($"/api/collections/{imported.Id}/export/openapi");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(".openapi.json", response.Content.Headers.ContentDisposition?.ToString(), StringComparison.Ordinal);
        var doc = Parse(await response.Content.ReadAsStringAsync());

        Assert.Equal("3.0.3", doc.GetProperty("openapi").GetString());
        Assert.Equal(("Mağaza", "Ürün uçları"), (doc.GetProperty("info").GetProperty("title").GetString(), doc.GetProperty("info").GetProperty("description").GetString()));
        Assert.Equal("https://api.magaza.test/v1", doc.GetProperty("servers")[0].GetProperty("url").GetString());
        Assert.Equal("bearer", doc.GetProperty("components").GetProperty("securitySchemes").GetProperty("bearerAuth").GetProperty("scheme").GetString());
        Assert.True(doc.GetProperty("security")[0].TryGetProperty("bearerAuth", out _));

        var paths = doc.GetProperty("paths");
        var get = paths.GetProperty("/urunler/{id}").GetProperty("get");
        Assert.Equal(("Ürün getir", "urunGetir"), (get.GetProperty("summary").GetString(), get.GetProperty("operationId").GetString()));
        Assert.Equal("Ürünler", get.GetProperty("tags")[0].GetString());
        var parameters = get.GetProperty("parameters").EnumerateArray().Select(p => (p.GetProperty("name").GetString(), p.GetProperty("in").GetString())).ToList();
        Assert.Equal([("id", "path"), ("detay", "query"), ("X-Dil", "header")], parameters);
        var ok = get.GetProperty("responses").GetProperty("200");
        var schema = ok.GetProperty("content").GetProperty("application/json").GetProperty("schema");
        Assert.Equal("integer", schema.GetProperty("properties").GetProperty("id").GetProperty("type").GetString());
        Assert.Equal("number", schema.GetProperty("properties").GetProperty("fiyat").GetProperty("type").GetString());
        Assert.Equal("array", schema.GetProperty("properties").GetProperty("etiketler").GetProperty("type").GetString());
        Assert.Equal("Yok", get.GetProperty("responses").GetProperty("404").GetProperty("description").GetString());

        var post = paths.GetProperty("/urunler").GetProperty("post");
        Assert.Equal(3, post.GetProperty("requestBody").GetProperty("content").GetProperty("application/json").GetProperty("example").GetProperty("stok").GetInt32());

        var login = paths.GetProperty("/giris").GetProperty("post");
        Assert.Equal(0, login.GetProperty("security").GetArrayLength());
        Assert.Equal("ali", login.GetProperty("requestBody").GetProperty("content").GetProperty("application/x-www-form-urlencoded").GetProperty("example").GetProperty("kullanici").GetString());

        // Aynı method + yol ikinci kez gelirse atlanır ve uyarı verilir.
        Assert.Contains("Ürün getir kopya", doc.GetProperty("x-apivator-warnings")[0].GetString(), StringComparison.Ordinal);

        var back = await ImportAsync(client, workspaceId, doc);
        Assert.Equal(("collection", "Mağaza", 3), (back.Kind, back.Name, back.Requests));
    }

    [Fact]
    public async Task WebSocketRequests_RoundTripThroughPostman_AndAreSkippedInOpenApi()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var imported = await ImportAsync(client, workspaceId, Parse("""
            {
              "info": { "name": "Canlı", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
              "item": [
                {
                  "name": "Sohbet",
                  "request": {
                    "method": "GET", "url": "wss://canli.test/sohbet",
                    "x-apivator": { "kind": "WebSocket", "protocols": "chat.v1", "messages": [{ "name": "Selam", "body": "{\"tip\":\"selam\"}" }] }
                  }
                },
                { "name": "Akış", "request": { "method": "GET", "url": "https://canli.test/akis", "x-apivator": { "kind": "Sse" } } },
                {
                  "name": "Ürün getir",
                  "request": {
                    "method": "POST", "url": "grpcs://katalog.test",
                    "x-apivator": {
                      "kind": "Grpc",
                      "grpc": {
                        "method": "/magaza.v1.Katalog/UrunGetir", "useReflection": false, "message": "{\"id\":\"u1\"}", "deadlineSeconds": 5,
                        "protoFiles": [{ "name": "katalog.proto", "content": "syntax = \"proto3\";" }]
                      }
                    }
                  }
                }
              ]
            }
            """));
        var tree = (await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single(c => c.Id == imported.Id);
        var chat = (await client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{tree.Requests.Single(r => r.Name == "Sohbet").Id}"))!.Definition;
        Assert.Equal((RequestKind.WebSocket, "chat.v1"), (chat.Kind, chat.Protocols));
        Assert.Equal(RequestKind.WebSocket, tree.Requests.Single(r => r.Name == "Sohbet").Kind);
        Assert.Equal([new SavedMessage("Selam", "{\"tip\":\"selam\"}")], chat.Messages);

        var postman = Parse(await client.GetStringAsync($"/api/collections/{imported.Id}/export/postman"));
        var copy = await ImportAsync(client, workspaceId, postman);
        var copyTree = (await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single(c => c.Id == copy.Id);
        var copied = (await client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{copyTree.Requests.Single(r => r.Name == "Sohbet").Id}"))!.Definition;
        Assert.Equal(chat.Messages, copied.Messages);
        Assert.Equal(RequestKind.WebSocket, copied.Kind);
        var sse = (await client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{copyTree.Requests.Single(r => r.Name == "Akış").Id}"))!.Definition;
        Assert.Equal(RequestKind.Sse, sse.Kind);
        var grpc = (await client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{copyTree.Requests.Single(r => r.Name == "Ürün getir").Id}"))!.Definition;
        Assert.Equal(RequestKind.Grpc, grpc.Kind);
        Assert.Equal(("/magaza.v1.Katalog/UrunGetir", false, "{\"id\":\"u1\"}", 5d), (grpc.Grpc.Method, grpc.Grpc.UseReflection, grpc.Grpc.Message, grpc.Grpc.DeadlineSeconds));
        Assert.Equal("katalog.proto", Assert.Single(grpc.Grpc.ProtoFiles).Name);

        var openApi = Parse(await client.GetStringAsync($"/api/collections/{imported.Id}/export/openapi"));
        Assert.False(openApi.GetProperty("paths").TryGetProperty("/sohbet", out _));
        Assert.True(openApi.GetProperty("paths").TryGetProperty("/akis", out _));
        Assert.Contains(openApi.GetProperty("x-apivator-warnings").EnumerateArray(), w => w.GetString()!.Contains("gRPC", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ExportOpenApi_RequiresAccess()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var imported = await ImportAsync(client, workspaceId, Parse(Postman));
        var (stranger, _) = await factory.CreateUserAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await stranger.GetAsync($"/api/collections/{imported.Id}/export/openapi")).StatusCode);
    }

    private static string Har()
    {
        var binary = Convert.ToBase64String([0x89, 0x50, 0x00, 0xff]);
        var text = Convert.ToBase64String(Encoding.UTF8.GetBytes("{\"tamam\":true}"));
        return $$$"""
            {
              "log": {
                "version": "1.2",
                "creator": { "name": "WebInspector", "version": "537.36" },
                "pages": [{ "id": "page_1", "title": "Panel oturumu" }],
                "entries": [
                  {
                    "request": {
                      "method": "GET", "url": "https://api.ornek.test/kullanicilar?sayfa=2",
                      "headers": [{ "name": ":authority", "value": "api.ornek.test" }, { "name": "Host", "value": "api.ornek.test" }, { "name": "Authorization", "value": "Bearer abc" }]
                    },
                    "response": {
                      "status": 200, "statusText": "OK",
                      "headers": [{ "name": "Content-Type", "value": "application/json" }, { "name": "Content-Encoding", "value": "gzip" }],
                      "content": { "mimeType": "application/json", "text": "[{\"id\":1}]" }
                    }
                  },
                  {
                    "request": { "method": "GET", "url": "https://api.ornek.test/kullanicilar?sayfa=2", "headers": [] },
                    "response": { "status": 304, "statusText": "Not Modified", "content": { "mimeType": "application/json" } }
                  },
                  {
                    "request": {
                      "method": "POST", "url": "https://api.ornek.test/giris", "headers": [{ "name": "Content-Type", "value": "application/x-www-form-urlencoded" }],
                      "postData": { "mimeType": "application/x-www-form-urlencoded", "text": "kullanici=ali+veli&sifre=%C5%9Fifre" }
                    },
                    "response": { "status": 200, "content": { "mimeType": "application/json", "encoding": "base64", "text": "{{{text}}}" } }
                  },
                  {
                    "request": {
                      "method": "POST", "url": "https://cdn.ornek.test/graphql",
                      "postData": { "mimeType": "application/json", "text": "{\"query\":\"query { ben { id } }\",\"variables\":{\"x\":1}}" }
                    },
                    "response": { "status": 0, "content": {} }
                  },
                  {
                    "request": { "method": "GET", "url": "https://cdn.ornek.test/logo.png" },
                    "response": { "status": 200, "content": { "mimeType": "image/png", "encoding": "base64", "text": "{{{binary}}}" } }
                  },
                  {
                    "_resourceType": "script",
                    "request": { "method": "GET", "url": "https://cdn.ornek.test/app.js" },
                    "response": { "status": 200, "content": { "mimeType": "text/plain" } }
                  },
                  {
                    "request": { "method": "GET", "url": "https://cdn.ornek.test/dosya" },
                    "response": { "status": 200, "content": { "mimeType": "application/octet-stream", "encoding": "base64", "text": "{{{binary}}}" } }
                  },
                  { "request": { "method": "GET", "url": "chrome-extension://abc/x" }, "response": { "status": 200 } }
                ]
              }
            }
            """;
    }

    [Fact]
    public async Task ImportHar_GroupsByHost_DedupesAndSkipsAssets()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var result = await ImportAsync(client, workspaceId, Parse(Har()));

        Assert.Equal(("collection", "Panel oturumu", 2, 4, 4), (result.Kind, result.Name, result.Folders, result.Requests, result.Examples));
        Assert.Contains(result.Warnings, w => w.StartsWith("2 statik dosya", StringComparison.Ordinal));
        Assert.Contains(result.Warnings, w => w.StartsWith("1 kayıt", StringComparison.Ordinal));
        Assert.Contains(result.Warnings, w => w.Contains("ikili", StringComparison.Ordinal));

        var tree = (await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single(c => c.Id == result.Id);
        Assert.Equal(["api.ornek.test", "cdn.ornek.test"], tree.Folders.OrderBy(f => f.SortOrder).Select(f => f.Name));
        Assert.Contains("WebInspector", tree.Description, StringComparison.Ordinal);

        async Task<ApiRequestDto> Get(string name) =>
            (await client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{tree.Requests.Single(r => r.Name == name).Id}"))!;

        var list = await Get("GET /kullanicilar");
        Assert.Equal("https://api.ornek.test/kullanicilar?sayfa=2", list.Definition.Url);
        Assert.Equal([new KeyValueItem("Authorization", "Bearer abc")], list.Definition.Headers);
        var listExamples = tree.Examples.Where(e => e.RequestId == list.Id).ToList();
        Assert.Equal([("200 OK", 200), ("304 Not Modified", 304)], listExamples.Select(e => (e.Name, e.Status)));

        var login = await Get("POST /giris");
        Assert.Equal(BodyMode.UrlEncoded, login.Definition.Body.Mode);
        Assert.Equal([new KeyValueItem("kullanici", "ali veli"), new KeyValueItem("sifre", "şifre")], login.Definition.Body.Form);

        var graphQl = await Get("POST /graphql");
        Assert.Equal((BodyMode.GraphQL, "query { ben { id } }"), (graphQl.Definition.Body.Mode, graphQl.Definition.Body.Raw));
        Assert.DoesNotContain(tree.Examples, e => e.RequestId == graphQl.Id);
    }

    [Fact]
    public async Task ImportHar_WithoutApiRequests_IsRejected()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var response = await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/import/postman", Parse("""{ "log": { "entries": [] } }"""));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
