using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Application.Collections;
using Apivator.Application.Import;
using Apivator.Domain.Collections;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class OpenApiImportTests(ApivatorApiFactory factory)
{
    private static JsonElement Fixture() =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "sample.openapi.json"))).RootElement.Clone();

    [Fact]
    public async Task ImportsOperationsAsTaggedRequests()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var result = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/import/postman", Fixture())).ReadAsync<ImportResult>();

        Assert.Equal(("collection", "Mağaza API", 2, 7, 3), (result.Kind, result.Name, result.Folders, result.Requests, result.Examples));

        var tree = (await client.GetFromJsonAsync<List<CollectionTreeDto>>($"/api/workspaces/{workspaceId}/collections"))!.Single(c => c.Id == result.Id);
        Assert.Equal("Ürün ve sipariş uçları.", tree.Description);
        Assert.Equal(["Siparişler", "Ürünler"], tree.Folders.OrderBy(f => f.SortOrder).Select(f => f.Name));
        Assert.Equal(("Bearer", "{{bearerToken}}"), (tree.Auth.Type.ToString(), tree.Auth.BearerToken));
        var variables = tree.Variables.ToDictionary(v => v.Key);
        Assert.Equal("https://test.magaza.test/api/v1", variables["baseUrl"].Value);
        Assert.Equal("42", variables["urunId"].Value);
        Assert.True(variables["bearerToken"].IsSecret);
        Assert.True(variables.ContainsKey("siparisNo"));

        async Task<RequestDefinition> Get(string name) =>
            (await client.GetFromJsonAsync<ApiRequestDto>($"/api/requests/{tree.Requests.Single(r => r.Name == name).Id}"))!.Definition;

        var list = await Get("Ürünleri listele");
        Assert.Equal("{{baseUrl}}/urunler?sayfa=1", list.Url);
        Assert.Contains(list.Headers, h => h is { Key: "X-Dil", Value: "tr" });
        Assert.Contains(list.Headers, h => h is { Key: "Accept", Value: "application/json" });
        Assert.Equal(AuthType.Inherit, list.Auth.Type);

        var create = await Get("urunEkle");
        Assert.Equal(BodyMode.Raw, create.Body.Mode);
        using (var body = JsonDocument.Parse(create.Body.Raw))
        {
            Assert.Equal("Defter", body.RootElement.GetProperty("ad").GetString());
            Assert.Equal(12.5, body.RootElement.GetProperty("fiyat").GetDouble());
            Assert.Equal("taslak", body.RootElement.GetProperty("durum").GetString());
            Assert.Equal(JsonValueKind.Array, body.RootElement.GetProperty("etiketler").ValueKind);
        }

        var one = await Get("Ürün getir");
        Assert.Equal("{{baseUrl}}/urunler/{{urunId}}", one.Url);
        Assert.Equal((AuthType.ApiKey, "X-API-Key", "{{apiKey}}"), (one.Auth.Type, one.Auth.ApiKeyName, one.Auth.ApiKeyValue));

        var upload = await Get("Dekont yükle");
        Assert.Equal(BodyMode.FormData, upload.Body.Mode);
        Assert.Equal([("aciklama", FormFieldType.Text, "Ekim"), ("dosya", FormFieldType.File, "")], upload.Body.Form.Select(f => (f.Key, f.Type, f.Value)));

        var health = await Get("Sağlık");
        Assert.Equal(AuthType.None, health.Auth.Type);

        var login = await Get("Giriş");
        Assert.Equal(BodyMode.UrlEncoded, login.Body.Mode);
        Assert.Equal(["kullanici", "sifre"], login.Body.Form.Select(f => f.Key));

        Assert.Contains(tree.Examples, e => e is { Name: "Bulunamadı", Status: 404 });
        Assert.Contains(tree.Examples, e => e is { Name: "Başarılı", Status: 200 });
        Assert.Contains(tree.Examples, e => e is { Name: "Ayakta", Status: 200 });
    }

    [Fact]
    public async Task Swagger2_IsAccepted_OlderVersionsAreNot()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var swagger2 = JsonDocument.Parse("""{ "swagger": "2.0", "info": { "title": "Eski" }, "host": "eski.test", "paths": { "/a": { "get": { "responses": { "200": { "description": "ok" } } } } } }""").RootElement;
        var result = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/import/postman", swagger2)).ReadAsync<ImportResult>();
        Assert.Equal(("Eski", 1), (result.Name, result.Requests));

        var swagger12 = JsonDocument.Parse("""{ "swagger": "1.2", "info": { "title": "Çok eski" }, "apis": [] }""").RootElement;
        var response = await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/import/postman", swagger12);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("Swagger 1.2 desteklenmiyor", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task ExternalRefsAndMissingServers_ProduceWarnings()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var document = JsonDocument.Parse("""
            {
              "openapi": "3.1.0",
              "info": { "title": "Eksik" },
              "paths": {
                "/a": { "post": { "requestBody": { "$ref": "ortak.yaml#/components/requestBodies/A" }, "responses": {} } }
              }
            }
            """).RootElement;

        var result = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/import/postman", document)).ReadAsync<ImportResult>();

        Assert.Equal(1, result.Requests);
        Assert.Contains(result.Warnings, w => w.Contains("servers", StringComparison.Ordinal));
        Assert.Contains(result.Warnings, w => w.Contains("ortak.yaml", StringComparison.Ordinal));
    }
}
