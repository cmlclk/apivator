using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Application.Collections;
using Apivator.Application.Comments;
using Apivator.Application.Import;
using Apivator.Domain.Collections;
using Apivator.Domain.Comments;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Apivator.Api.IntegrationTests;

/// <summary>OpenAPI belgelerini ve Swagger UI sayfalarını sunan test sunucusu (127.0.0.1, rastgele port).</summary>
public sealed class SpecServer : IAsyncLifetime
{
    private readonly ConcurrentDictionary<string, (string Body, string ContentType, string? Auth)> _files = new(StringComparer.Ordinal);
    private WebApplication? _app;

    public string BaseUrl { get; private set; } = string.Empty;

    public void Set(string path, string body, string contentType = "application/json", string? auth = null) =>
        _files[path] = (body, contentType, auth);

    public void Remove(string path) => _files.TryRemove(path, out _);

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        _app = builder.Build();
        _app.Run(async context =>
        {
            if (!_files.TryGetValue(context.Request.Path.Value ?? "/", out var file))
            {
                context.Response.StatusCode = 404;
                return;
            }

            if (file.Auth is not null && context.Request.Headers.Authorization.ToString() != file.Auth)
            {
                context.Response.StatusCode = 401;
                return;
            }

            context.Response.ContentType = file.ContentType;
            await context.Response.WriteAsync(file.Body);
        });
        await _app.StartAsync();
        BaseUrl = _app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First().TrimEnd('/');
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            await _app.DisposeAsync();
        }
    }
}

[Collection(ApiCollection.Name)]
public class SourceImportTests(ApivatorApiFactory factory, SpecServer server) : IClassFixture<SpecServer>
{
    private const string PetsV1 = """
        openapi: 3.0.3
        info:
          title: Evcil Hayvan API
          version: 1.0
        servers:
          - url: /api
        tags:
          - name: pets
        paths:
          /pets:
            get:
              tags: [pets]
              summary: Hayvanları listele
              parameters:
                - { name: page, in: query, required: true, schema: { type: integer, default: 1 } }
                - { name: X-Old, in: header, required: true, schema: { type: string, example: eski } }
              responses:
                '200': { description: Liste, content: { application/json: { example: [{ id: 1 }] } } }
            post:
              tags: [pets]
              summary: Hayvan ekle
              requestBody:
                content:
                  application/json:
                    example: { name: Pamuk }
              responses: { '201': { description: Eklendi } }
          /pets/{petId}:
            get:
              tags: [pets]
              summary: Hayvan getir
              description: Tek hayvan.
              parameters:
                - { name: petId, in: path, required: true, schema: { type: integer, example: 7 } }
              responses: { '200': { description: Hayvan } }
            delete:
              tags: [pets]
              summary: Hayvan sil
              parameters:
                - { name: petId, in: path, required: true, schema: { type: integer } }
              responses: { '204': { description: Silindi } }
        """;

    private const string PetsV2 = """
        openapi: 3.0.3
        info:
          title: Evcil Hayvan API
          version: 2.0
        servers:
          - url: /api
        paths:
          /pets:
            get:
              tags: [pets]
              summary: Tüm hayvanlar
              parameters:
                - { name: page, in: query, required: true, schema: { type: integer, default: 1 } }
                - { name: limit, in: query, required: true, schema: { type: integer, default: 20 } }
              responses:
                '200': { description: Liste, content: { application/json: { example: [{ id: 1 }] } } }
            post:
              tags: [pets]
              summary: Hayvan ekle
              requestBody:
                content:
                  application/json:
                    example: { name: Pamuk, age: 2 }
              responses: { '201': { description: Eklendi } }
          /pets/{petId}:
            get:
              tags: [pets]
              summary: Hayvan getir
              description: Tek hayvanı getirir.
              parameters:
                - { name: petId, in: path, required: true, schema: { type: integer, example: 7 } }
              responses: { '200': { description: Hayvan } }
            put:
              tags: [pets]
              summary: Hayvan güncelle
              parameters:
                - { name: petId, in: path, required: true, schema: { type: integer } }
              responses: { '200': { description: Güncellendi } }
          /stores/{storeId}:
            get:
              tags: [stores]
              summary: Mağaza getir
              parameters:
                - { name: storeId, in: path, required: true, schema: { type: string } }
              responses: { '200': { description: Mağaza } }
        """;

    private static string Swagger2(string basePath) => $$"""
        {
          "swagger": "2.0",
          "info": { "title": "Eski Servis", "version": "3" },
          "basePath": "{{basePath}}",
          "consumes": ["application/json"],
          "produces": ["application/json"],
          "securityDefinitions": { "anahtar": { "type": "apiKey", "in": "header", "name": "X-Api-Key" } },
          "security": [{ "anahtar": [] }],
          "definitions": {
            "Kayit": { "type": "object", "properties": { "ad": { "type": "string", "example": "Ayşe" }, "yas": { "type": "integer" }, "not": { "type": "string", "x-nullable": true } } }
          },
          "paths": {
            "/kayitlar/{id}": {
              "parameters": [{ "name": "id", "in": "path", "required": true, "type": "integer", "x-example": 5 }],
              "get": {
                "tags": ["Kayıtlar"],
                "summary": "Kayıt getir",
                "responses": {
                  "200": { "description": "Kayıt", "schema": { "$ref": "#/definitions/Kayit" }, "examples": { "application/json": { "ad": "Ali", "yas": 30 } } }
                }
              },
              "put": {
                "tags": ["Kayıtlar"],
                "summary": "Kayıt güncelle",
                "parameters": [{ "name": "govde", "in": "body", "required": true, "schema": { "$ref": "#/definitions/Kayit" } }],
                "responses": { "204": { "description": "Tamam" } }
              }
            },
            "/belgeler": {
              "post": {
                "summary": "Belge yükle",
                "consumes": ["multipart/form-data"],
                "parameters": [
                  { "name": "aciklama", "in": "formData", "type": "string", "x-example": "Ekim" },
                  { "name": "dosya", "in": "formData", "type": "file", "required": true }
                ],
                "responses": { "201": { "description": "Yüklendi" } }
              }
            }
          }
        }
        """;

    private static async Task<UrlImportResponse> ImportAsync(HttpClient client, Guid workspaceId, string url, IReadOnlyList<KeyValueItem>? headers = null) =>
        await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/import/url", new UrlImportRequest(url, headers))).ReadAsync<UrlImportResponse>();

    private static async Task<(int Status, string Code, string Detail)> ImportErrorAsync(HttpClient client, Guid workspaceId, string url)
    {
        var response = await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/import/url", new UrlImportRequest(url));
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        return ((int)response.StatusCode, problem.GetProperty("code").GetString()!, problem.GetProperty("detail").GetString()!);
    }

    private static async Task<CollectionTreeDto> TreeAsync(HttpClient client, Guid workspaceId, Guid collectionId) =>
        (await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single(c => c.Id == collectionId);

    private static async Task<ApiRequestDto> RequestAsync(HttpClient client, CollectionTreeDto tree, string name) =>
        (await client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{tree.Requests.Single(r => r.Name == name).Id}"))!;

    [Fact]
    public async Task YamlDocument_IsImportedAndSourceRemembered()
    {
        server.Set("/t1/openapi.yaml", PetsV1, "application/yaml");
        var (client, workspaceId) = await factory.CreateUserAsync();

        var result = (await ImportAsync(client, workspaceId, $"{server.BaseUrl}/t1/openapi.yaml")).Result!;
        Assert.Equal(("Evcil Hayvan API", 1, 4, 1), (result.Name, result.Folders, result.Requests, result.Examples));

        var tree = await TreeAsync(client, workspaceId, result.Id);
        Assert.Equal($"{server.BaseUrl}/t1/openapi.yaml", tree.Source!.Url);
        Assert.False(tree.Source.ChangeDetected);
        // Göreli sunucu ("/api") belgenin adresine göre tamamlanır.
        Assert.Equal($"{server.BaseUrl}/api", tree.Variables.Single(v => v.Key == "baseUrl").Value);

        var source = await client.GetFromJsonAsync<CollectionSourceDto>($"/api/collections/{result.Id}/source");
        Assert.Equal(("1.0", false, null), (source!.Version, source.Local, source.CheckIntervalHours));
    }

    [Fact]
    public async Task ServerAddress_TriesKnownPaths()
    {
        server.Set("/t2/v3/api-docs", """{"openapi":"3.0.1","info":{"title":"Spring Servisi","version":"v0"},"paths":{"/ping":{"get":{"responses":{"200":{"description":"ok"}}}}}}""");
        var (client, workspaceId) = await factory.CreateUserAsync();

        var result = (await ImportAsync(client, workspaceId, $"{server.BaseUrl}/t2")).Result!;
        Assert.Equal(("Spring Servisi", 1), (result.Name, result.Requests));
        var source = await client.GetFromJsonAsync<CollectionSourceDto>($"/api/collections/{result.Id}/source");
        Assert.Equal($"{server.BaseUrl}/t2/v3/api-docs", source!.Url);

        // Hiçbir yolda belge yoksa denenen adresler söylenir.
        var (status, code, detail) = await ImportErrorAsync(client, workspaceId, $"{server.BaseUrl}/bos");
        Assert.Equal((400, "spec.not_found"), (status, code));
        Assert.Contains("/bos/swagger/v1/swagger.json", detail);
        Assert.Contains("/bos/openapi.yaml", detail);
    }

    [Fact]
    public async Task SwashbuckleUi_OffersVersions()
    {
        server.Set("/t3/swagger/index.html", """<!DOCTYPE html><html><head><title>Swagger UI</title></head><body><div id="swagger-ui"></div><script src="./swagger-ui-bundle.js"></script><script src="index.js"></script></body></html>""", "text/html");
        server.Set("/t3/swagger/index.js", """
            /* Swashbuckle */
            window.onload = function () {
              var configObject = JSON.parse('{"urls":[{"url":"v1/swagger.json","name":"Siparişler V1"},{"url":"v2/swagger.json","name":"Siparişler V2"}],"deepLinking":false}');
              var oauthConfigObject = JSON.parse('{"scopeSeparator":" "}');
              configObject.dom_id = "#swagger-ui";
              const ui = SwaggerUIBundle(configObject);
            }
            """, "text/javascript");
        server.Set("/t3/swagger/v1/swagger.json", """{"openapi":"3.0.1","info":{"title":"Siparişler","version":"v1"},"paths":{"/siparisler":{"get":{"responses":{"200":{"description":"ok"}}}}}}""");
        server.Set("/t3/swagger/v2/swagger.json", """{"openapi":"3.0.1","info":{"title":"Siparişler","version":"v2"},"paths":{"/siparisler":{"get":{"responses":{"200":{"description":"ok"}}}},"/iadeler":{"get":{"responses":{"200":{"description":"ok"}}}}}}""");
        var (client, workspaceId) = await factory.CreateUserAsync();

        var page = await ImportAsync(client, workspaceId, $"{server.BaseUrl}/t3/swagger/index.html");
        Assert.Null(page.Result);
        Assert.Equal(
            [("Siparişler V1", $"{server.BaseUrl}/t3/swagger/v1/swagger.json"), ("Siparişler V2", $"{server.BaseUrl}/t3/swagger/v2/swagger.json")],
            page.Choices!.Select(c => (c.Name, c.Url)));

        // Yalnızca sunucu adresi verilse de sürüm listesi bulunur.
        var probed = await ImportAsync(client, workspaceId, $"{server.BaseUrl}/t3");
        Assert.Equal(2, probed.Choices!.Count);

        var chosen = await ImportAsync(client, workspaceId, page.Choices![1].Url);
        Assert.Equal(2, chosen.Result!.Requests);
    }

    [Fact]
    public async Task FastApiAndNestPages_AreUnderstood()
    {
        // FastAPI: /docs sayfasında url: '/openapi.json' (sayfanın sunucusuna göre).
        server.Set("/t4/docs", """
            <html><body><div id="swagger-ui"></div>
            <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
            <script>
            const ui = SwaggerUIBundle({
                url: '/t4/openapi.json',
                "dom_id": "#swagger-ui",
                oauth2RedirectUrl: window.location.origin + '/docs/oauth2-redirect',
            })
            </script></body></html>
            """, "text/html; charset=utf-8");
        server.Set("/t4/openapi.json", """{"openapi":"3.1.0","info":{"title":"FastAPI","version":"0.1.0"},"paths":{"/items/{item_id}":{"get":{"summary":"Read Item","responses":{"200":{"description":"ok"}}}}}}""");

        // NestJS: belge script'in içinde gömülü (swaggerDoc).
        server.Set("/t4/api", """<html><body><div id="swagger-ui"></div><script src="./api/swagger-ui-init.js"></script></body></html>""", "text/html");
        server.Set("/t4/api/swagger-ui-init.js", """
            window.onload = function() {
              let options = {
                "swaggerDoc": {
                  "openapi": "3.0.0",
                  "paths": { "/cats": { "get": { "operationId": "CatsController_findAll", "responses": { "200": { "description": "" } } } } },
                  "info": { "title": "Kediler", "description": "Nest {örnek}", "version": "1.0" },
                  "servers": []
                },
                "customOptions": {}
              };
              url = options.swaggerUrl || url
            };
            """, "application/javascript");
        var (client, workspaceId) = await factory.CreateUserAsync();

        var fastApi = (await ImportAsync(client, workspaceId, $"{server.BaseUrl}/t4/docs")).Result!;
        Assert.Equal(("FastAPI", 1), (fastApi.Name, fastApi.Requests));

        var nest = (await ImportAsync(client, workspaceId, $"{server.BaseUrl}/t4/api")).Result!;
        Assert.Equal(("Kediler", 1), (nest.Name, nest.Requests));
        var tree = await TreeAsync(client, workspaceId, nest.Id);
        Assert.Equal(server.BaseUrl, tree.Variables.Single(v => v.Key == "baseUrl").Value);
    }

    [Fact]
    public async Task Swagger2_IsConvertedFromUrlAndFile()
    {
        server.Set("/t5/swagger.json", Swagger2("/v2"));
        var (client, workspaceId) = await factory.CreateUserAsync();

        var result = (await ImportAsync(client, workspaceId, $"{server.BaseUrl}/t5/swagger.json")).Result!;
        Assert.Equal(("Eski Servis", 1, 3, 1), (result.Name, result.Folders, result.Requests, result.Examples));

        var tree = await TreeAsync(client, workspaceId, result.Id);
        var variables = tree.Variables.ToDictionary(v => v.Key);
        Assert.Equal($"{server.BaseUrl}/v2", variables["baseUrl"].Value); // host yok → belgenin sunucusu
        Assert.Equal("5", variables["id"].Value);
        Assert.Equal((AuthType.ApiKey, "X-Api-Key"), (tree.Auth.Type, tree.Auth.ApiKeyName));
        Assert.Equal(["Kayıtlar"], tree.Folders.Select(f => f.Name));

        var update = (await RequestAsync(client, tree, "Kayıt güncelle")).Definition;
        Assert.Equal(("PUT", "{{baseUrl}}/kayitlar/{{id}}", BodyMode.Raw), (update.Method, update.Url, update.Body.Mode));
        using (var body = JsonDocument.Parse(update.Body.Raw))
        {
            Assert.Equal("Ayşe", body.RootElement.GetProperty("ad").GetString());
        }

        var upload = (await RequestAsync(client, tree, "Belge yükle")).Definition;
        Assert.Equal(BodyMode.FormData, upload.Body.Mode);
        Assert.Equal([("aciklama", FormFieldType.Text, "Ekim"), ("dosya", FormFieldType.File, "")], upload.Body.Form.Select(f => (f.Key, f.Type, f.Value)));

        // Dosyadan içe aktarmada da (eskiden reddediliyordu); host yoksa göreli adres uyarısı.
        var file = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/import/postman", JsonDocument.Parse(Swagger2("/v2")).RootElement)).ReadAsync<ImportResult>();
        Assert.Equal(3, file.Requests);
        Assert.Contains(file.Warnings, w => w.Contains("göreli", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ProtectedDocument_NeedsHeader_AndBlockedNetworksStayBlocked()
    {
        server.Set("/t6/openapi.json", """{"openapi":"3.0.0","info":{"title":"Gizli","version":"1"},"paths":{}}""", auth: "Bearer gizli-token");
        var (client, workspaceId) = await factory.CreateUserAsync();

        var (status, code, _) = await ImportErrorAsync(client, workspaceId, $"{server.BaseUrl}/t6/openapi.json");
        Assert.Equal((400, "spec.unauthorized"), (status, code));

        var ok = await ImportAsync(client, workspaceId, $"{server.BaseUrl}/t6/openapi.json", [new KeyValueItem("Authorization", "Bearer gizli-token")]);
        Assert.Equal("Gizli", ok.Result!.Name);

        // Sunucudan iç ağa (SSRF) istek atılamaz; masaüstünde ajan çeker.
        (status, code, _) = await ImportErrorAsync(client, workspaceId, "http://10.20.30.40/openapi.json");
        Assert.Equal((400, "spec.blocked"), (status, code));
    }

    [Fact]
    public async Task YamlAliasBomb_IsRejected()
    {
        var bomb = "openapi: 3.0.0\na: &a [x,x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\nc: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\n"
            + "d: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]\ne: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]\nf: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e,*e]\n"
            + "g: [*f,*f,*f,*f,*f,*f,*f,*f,*f,*f]\n";
        server.Set("/t7/openapi.yaml", bomb, "application/yaml");
        var (client, workspaceId) = await factory.CreateUserAsync();

        var (status, _, detail) = await ImportErrorAsync(client, workspaceId, $"{server.BaseUrl}/t7/openapi.yaml");
        Assert.Equal(400, status);
        Assert.Contains("çok büyük", detail);
    }

    [Fact]
    public async Task UpdateFromSource_ShowsDiff_AndKeepsLocalEdits()
    {
        server.Set("/t8/openapi.yaml", PetsV1, "application/yaml");
        var (client, workspaceId) = await factory.CreateUserAsync();
        var collectionId = (await ImportAsync(client, workspaceId, $"{server.BaseUrl}/t8/openapi.yaml")).Result!.Id;
        var tree = await TreeAsync(client, workspaceId, collectionId);

        // Yerel düzenlemeler: listeyi yeniden adlandır + kendi header'ını ekle, eklemenin gövdesini değiştir.
        var list = await RequestAsync(client, tree, "Hayvanları listele");
        var edited = list.Definition with { Headers = [.. list.Definition.Headers, new KeyValueItem("X-Benim", "1")], Url = list.Definition.Url.Replace("page=1", "page=3", StringComparison.Ordinal) };
        (await client.PutAsJsonAsync($"/api/requests/{list.Id}", new UpdateApiRequestRequest("Listem", edited, list.Version))).EnsureSuccessStatusCode();
        var create = await RequestAsync(client, tree, "Hayvan ekle");
        (await client.PutAsJsonAsync($"/api/requests/{create.Id}", new UpdateApiRequestRequest(create.Name, create.Definition with { Body = create.Definition.Body with { Raw = """{"name":"Benim"}""" } }, create.Version))).EnsureSuccessStatusCode();

        // Kaynak değişmeden önce fark yok.
        var none = await (await client.PostAsJsonAsync($"/api/collections/{collectionId}/source/preview", new SourcePreviewRequest())).ReadAsync<SourceDiffDto>();
        Assert.Empty(none.Added.Concat(none.Changed).Concat(none.Removed));

        server.Set("/t8/openapi.yaml", PetsV2, "application/yaml");
        var diff = await (await client.PostAsJsonAsync($"/api/collections/{collectionId}/source/preview", new SourcePreviewRequest())).ReadAsync<SourceDiffDto>();
        Assert.Equal(("1.0", "2.0"), (diff.FromVersion, diff.ToVersion));
        Assert.Equal(["GET /stores/{storeId}", "PUT /pets/{petId}"], diff.Added.Select(a => a.Key).Order());
        Assert.Equal("stores", diff.Added.Single(a => a.Method == "GET").Folder);
        Assert.Equal(["DELETE /pets/{petId}"], diff.Removed.Select(r => r.Key));
        Assert.Equal(["storeId"], diff.NewVariables);

        var changed = diff.Changed.ToDictionary(c => c.Key);
        Assert.Equal(3, changed.Count);
        var listChange = changed["GET /pets"];
        Assert.Equal(["Query parametreleri", "Header'lar"], listChange.Fields);
        Assert.Contains(listChange.Notes, n => n.StartsWith("Ad yerelde", StringComparison.Ordinal));
        Assert.Equal(["Gövde"], changed["POST /pets"].Fields);
        Assert.Contains(changed["POST /pets"].Notes, n => n.StartsWith("Gövde yerelde", StringComparison.Ordinal));
        Assert.Equal(["Açıklama"], changed["GET /pets/{petId}"].Fields);

        // Kaldırılan uç hariç hepsi uygulanır.
        var keys = diff.Added.Concat(diff.Changed).Select(c => c.Key).ToList();
        var stale = await client.PostAsJsonAsync($"/api/collections/{collectionId}/source/apply", new SourceApplyRequest("eski", keys));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        var applied = await (await client.PostAsJsonAsync($"/api/collections/{collectionId}/source/apply", new SourceApplyRequest(diff.Hash, keys))).ReadAsync<SourceApplyResult>();
        Assert.Equal((2, 3, 0, 1), (applied.Added, applied.Updated, applied.Removed, applied.Variables));
        Assert.Equal("2.0", applied.Source.Version);

        tree = await TreeAsync(client, workspaceId, collectionId);
        Assert.Equal(["pets", "stores"], tree.Folders.OrderBy(f => f.SortOrder).Select(f => f.Name));
        Assert.Contains(tree.Requests, r => r.Name == "Hayvan sil"); // seçilmedi, kaldı
        Assert.Contains(tree.Variables, v => v.Key == "storeId");

        var listAfter = await RequestAsync(client, tree, "Listem"); // yerel ad korundu
        Assert.Equal("{{baseUrl}}/pets?page=3&limit=20", listAfter.Definition.Url); // kullanıcının değeri kaldı, yeni parametre geldi
        Assert.Equal(["Accept", "X-Benim"], listAfter.Definition.Headers.Select(h => h.Key)); // X-Old belgeden kalktı
        using (var body = JsonDocument.Parse((await RequestAsync(client, tree, "Hayvan ekle")).Definition.Body.Raw))
        {
            Assert.Equal(2, body.RootElement.GetProperty("age").GetInt32());
        }

        Assert.Equal("Tek hayvanı getirir.", (await RequestAsync(client, tree, "Hayvan getir")).Definition.Description);
        Assert.Equal("{{baseUrl}}/stores/{{storeId}}", (await RequestAsync(client, tree, "Mağaza getir")).Definition.Url);

        // Uygulanan belgeye göre artık fark yok (seçilmeyen silme de "görüldü").
        var after = await (await client.PostAsJsonAsync($"/api/collections/{collectionId}/source/preview", new SourcePreviewRequest())).ReadAsync<SourceDiffDto>();
        Assert.Empty(after.Added.Concat(after.Changed).Concat(after.Removed));
    }

    [Fact]
    public async Task ScheduledCheck_NotifiesOnceWhenDocumentChanges()
    {
        server.Set("/t9/openapi.yaml", PetsV1, "application/yaml");
        var (client, workspaceId) = await factory.CreateUserAsync();
        var collectionId = (await ImportAsync(client, workspaceId, $"{server.BaseUrl}/t9/openapi.yaml")).Result!.Id;

        var invalid = await client.PutAsJsonAsync($"/api/collections/{collectionId}/source/schedule", new SourceScheduleRequest(5));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        var scheduler = factory.Services.GetRequiredService<ISourceCheckScheduler>();
        async Task CheckAsync()
        {
            // Aralık yeniden ayarlanınca ilk kontrol hemen yapılır.
            (await client.PutAsJsonAsync($"/api/collections/{collectionId}/source/schedule", new SourceScheduleRequest(6))).EnsureSuccessStatusCode();
            while (await scheduler.RunDueAsync() > 0)
            {
            }
        }

        await CheckAsync();
        var source = await client.GetFromJsonAsync<CollectionSourceDto>($"/api/collections/{collectionId}/source");
        Assert.Equal((6, (string?)null, (DateTimeOffset?)null), (source!.CheckIntervalHours, source.LastCheckError, source.ChangeDetectedAt));
        Assert.NotNull(source.LastCheckedAt);

        server.Set("/t9/openapi.yaml", PetsV2, "application/yaml");
        await CheckAsync();
        await CheckAsync();

        var notifications = (await client.GetFromJsonAsync<NotificationsDto>("/api/me/notifications"))!.Items
            .Where(n => n.Kind == NotificationKind.SourceChanged).ToList();
        var notification = Assert.Single(notifications);
        Assert.Equal((collectionId, CommentTarget.Collection, "Evcil Hayvan API"), (notification.TargetId, notification.TargetType, notification.TargetName));
        Assert.StartsWith("2 yeni, 3 değişen, 1 kaldırılan uç", notification.Preview, StringComparison.Ordinal);
        Assert.True((await TreeAsync(client, workspaceId, collectionId)).Source!.ChangeDetected);

        // Belgeye erişilemezse hata kaydedilir.
        server.Remove("/t9/openapi.yaml");
        await CheckAsync();
        source = await client.GetFromJsonAsync<CollectionSourceDto>($"/api/collections/{collectionId}/source");
        Assert.Contains("404", source!.LastCheckError, StringComparison.Ordinal);

        // Bağlantı kaldırılınca istekler kalır.
        (await client.DeleteAsync($"/api/collections/{collectionId}/source")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/collections/{collectionId}/source")).StatusCode);
        var tree = await TreeAsync(client, workspaceId, collectionId);
        Assert.Null(tree.Source);
        Assert.Equal(4, tree.Requests.Count);
    }

    [Fact]
    public async Task DesktopFetchedDocument_IsImportedWithoutServerFetch()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var request = new UrlImportRequest("http://localhost:5000/swagger/v1/swagger.json", Document: PetsV1);
        var result = (await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/import/url", request)).ReadAsync<UrlImportResponse>()).Result!;
        var source = await client.GetFromJsonAsync<CollectionSourceDto>($"/api/collections/{result.Id}/source");
        Assert.True(source!.Local);
        Assert.Equal("http://localhost:5000/api", (await TreeAsync(client, workspaceId, result.Id)).Variables.Single(v => v.Key == "baseUrl").Value);

        // Masaüstünde yeniden çekilen belgeyle önizleme.
        var diff = await (await client.PostAsJsonAsync(
            $"/api/collections/{result.Id}/source/preview",
            new SourcePreviewRequest(Document: PetsV2, Url: "http://localhost:5000/swagger/v1/swagger.json"))).ReadAsync<SourceDiffDto>();
        Assert.Equal(2, diff.Added.Count);

        // Sunucu localhost'a erişemez: masaüstünde güncellenmesi söylenir.
        var serverSide = await client.PostAsJsonAsync($"/api/collections/{result.Id}/source/preview", new SourcePreviewRequest());
        Assert.Equal(HttpStatusCode.BadRequest, serverSide.StatusCode);
        Assert.Contains("masaüstü", await serverSide.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }
}
