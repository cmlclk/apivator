using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Application.Execution;
using Apivator.Domain.Collections;
using Microsoft.AspNetCore.Hosting;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class ExecuteTests(ApivatorApiFactory factory, TestTargetServer target) : IClassFixture<TestTargetServer>
{
    [Fact]
    public async Task Get_ReturnsStatusHeadersBodyAndTiming()
    {
        var result = await ExecuteAsync(new ExecuteHttpRequest("GET", $"{target.BaseUrl}/echo?q=api%20test", [new KeyValueItem("X-Test", "merhaba"), new KeyValueItem("X-Off", "x", Enabled: false)], null));

        Assert.Null(result.Error);
        Assert.Equal(200, result.Status);
        Assert.Equal("text", result.BodyEncoding);
        Assert.True(result.TimeMs > 0);
        Assert.Contains(result.Headers, h => h.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase));

        var echo = JsonDocument.Parse(result.Body).RootElement;
        Assert.Equal("?q=api%20test", echo.GetProperty("query").GetString());
        Assert.Equal("merhaba", echo.GetProperty("headers").GetProperty("x-test").GetString());
        Assert.False(echo.GetProperty("headers").TryGetProperty("x-off", out _));
        Assert.StartsWith("Apivator/", echo.GetProperty("headers").GetProperty("user-agent").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task NonAsciiHeaderValues_AreSentAsUtf8()
    {
        var result = await ExecuteAsync(new ExecuteHttpRequest("GET", $"{target.BaseUrl}/echo", [new KeyValueItem("X-Kullanici", "Ayşe Çağ")], null));

        Assert.Null(result.Error);
        Assert.Equal("Ayşe Çağ", JsonDocument.Parse(result.Body).RootElement.GetProperty("headers").GetProperty("x-kullanici").GetString());
    }

    [Fact]
    public async Task PostRawJson_SendsBodyWithJsonContentType()
    {
        var body = new RequestBody { Mode = BodyMode.Raw, RawLanguage = RawLanguage.Json, Raw = "{\"ad\":\"Ayşe\"}" };
        var result = await ExecuteAsync(new ExecuteHttpRequest("post", $"{target.BaseUrl}/echo", null, body));

        var echo = JsonDocument.Parse(result.Body).RootElement;
        Assert.Equal("POST", echo.GetProperty("method").GetString());
        Assert.Equal("{\"ad\":\"Ayşe\"}", echo.GetProperty("body").GetString());
        Assert.Equal("application/json", echo.GetProperty("contentType").GetString());
    }

    [Fact]
    public async Task ExplicitContentTypeHeader_WinsOverRawLanguage()
    {
        var body = new RequestBody { Mode = BodyMode.Raw, RawLanguage = RawLanguage.Json, Raw = "<a/>" };
        var result = await ExecuteAsync(new ExecuteHttpRequest("PUT", $"{target.BaseUrl}/echo", [new KeyValueItem("Content-Type", "application/vnd.custom+xml")], body));

        Assert.Equal("application/vnd.custom+xml", JsonDocument.Parse(result.Body).RootElement.GetProperty("contentType").GetString());
    }

    [Fact]
    public async Task UrlEncodedForm_IsEncoded()
    {
        var body = new RequestBody { Mode = BodyMode.UrlEncoded, Form = [new KeyValueItem("ad", "Ayşe Y"), new KeyValueItem("gizli", "x", Enabled: false)] };
        var result = await ExecuteAsync(new ExecuteHttpRequest("POST", $"{target.BaseUrl}/echo", null, body));

        var echo = JsonDocument.Parse(result.Body).RootElement;
        Assert.Equal("ad=Ay%C5%9Fe+Y", echo.GetProperty("body").GetString());
        Assert.StartsWith("application/x-www-form-urlencoded", echo.GetProperty("contentType").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task FormData_SendsTextAndFileParts()
    {
        var body = new RequestBody
        {
            Mode = BodyMode.FormData,
            Form = [new KeyValueItem("aciklama", "Ekim"), new KeyValueItem("dosya", "dekont.txt", Type: FormFieldType.File)],
        };
        var files = new[] { new ExecuteFile(1, "dekont.txt", "text/plain", Convert.ToBase64String("merhaba dosya"u8.ToArray())) };

        var result = await ExecuteAsync(new ExecuteHttpRequest("POST", $"{target.BaseUrl}/echo", null, body, Files: files));

        var echoed = JsonDocument.Parse(result.Body).RootElement.GetProperty("body").GetString()!;
        Assert.Contains("name=aciklama", echoed, StringComparison.Ordinal);
        Assert.Contains("filename=dekont.txt", echoed, StringComparison.Ordinal);
        Assert.Contains("merhaba dosya", echoed, StringComparison.Ordinal);
    }

    [Fact]
    public async Task FormData_WithoutFileContent_ReturnsError()
    {
        var body = new RequestBody { Mode = BodyMode.FormData, Form = [new KeyValueItem("dosya", "a.pdf", Type: FormFieldType.File)] };

        var result = await ExecuteAsync(new ExecuteHttpRequest("POST", $"{target.BaseUrl}/echo", null, body));

        Assert.Equal("invalid_request", result.Error?.Code);
        Assert.Contains("dosya", result.Error!.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task BinaryBody_SendsFileWithItsContentType()
    {
        var body = new RequestBody { Mode = BodyMode.Binary, FileName = "veri.csv" };
        var files = new[] { new ExecuteFile(ExecuteFile.BinaryIndex, "veri.csv", "text/csv", Convert.ToBase64String("a,b\n1,2"u8.ToArray())) };

        var result = await ExecuteAsync(new ExecuteHttpRequest("PUT", $"{target.BaseUrl}/echo", null, body, Files: files));

        var echo = JsonDocument.Parse(result.Body).RootElement;
        Assert.Equal("a,b\n1,2", echo.GetProperty("body").GetString());
        Assert.Equal("text/csv", echo.GetProperty("contentType").GetString());
    }

    [Fact]
    public async Task GraphQL_SendsQueryAndVariablesAsJson()
    {
        var body = new RequestBody { Mode = BodyMode.GraphQL, Raw = "query($n:Int){ items(first:$n){ id } }", GraphqlVariables = "{\"n\": 3}" };

        var result = await ExecuteAsync(new ExecuteHttpRequest("POST", $"{target.BaseUrl}/echo", null, body));

        var echo = JsonDocument.Parse(result.Body).RootElement;
        Assert.Equal("application/json", echo.GetProperty("contentType").GetString());
        using var sent = JsonDocument.Parse(echo.GetProperty("body").GetString()!);
        Assert.StartsWith("query($n:Int)", sent.RootElement.GetProperty("query").GetString(), StringComparison.Ordinal);
        Assert.Equal(3, sent.RootElement.GetProperty("variables").GetProperty("n").GetInt32());

        var invalid = await ExecuteAsync(new ExecuteHttpRequest("POST", $"{target.BaseUrl}/echo", null, body with { GraphqlVariables = "{n:" }));
        Assert.Equal("invalid_request", invalid.Error?.Code);
    }

    [Fact]
    public async Task ErrorStatus_IsPassedThrough()
    {
        var result = await ExecuteAsync(new ExecuteHttpRequest("GET", $"{target.BaseUrl}/status/418", null, null));
        Assert.Null(result.Error);
        Assert.Equal(418, result.Status);
    }

    [Fact]
    public async Task Redirect_IsFollowed()
    {
        var result = await ExecuteAsync(new ExecuteHttpRequest("GET", $"{target.BaseUrl}/redirect", null, null));
        Assert.Equal(200, result.Status);
        Assert.EndsWith("/echo?redirected=1", result.FinalUrl, StringComparison.Ordinal);
    }

    [Fact]
    public async Task BinaryResponse_IsBase64()
    {
        var result = await ExecuteAsync(new ExecuteHttpRequest("GET", $"{target.BaseUrl}/binary", null, null));
        Assert.Equal("base64", result.BodyEncoding);
        Assert.Equal(256, Convert.FromBase64String(result.Body).Length);
    }

    [Theory]
    [InlineData("http://169.254.169.254/latest/meta-data/")] // bulut metadata servisi
    [InlineData("http://10.0.0.1/")]
    [InlineData("http://192.168.1.1/")]
    [InlineData("http://[::1]/")]
    [InlineData("http://0.0.0.0/")]
    public async Task PrivateAddresses_AreBlocked(string url)
    {
        var result = await ExecuteAsync(new ExecuteHttpRequest("GET", url, null, null));
        Assert.Equal("blocked", result.Error?.Code);
        Assert.Null(result.Status);
    }

    [Fact]
    public async Task ClosedPort_ReturnsConnectionRefused()
    {
        var result = await ExecuteAsync(new ExecuteHttpRequest("GET", "http://127.0.0.1:1/", null, null));
        Assert.Equal("connection_refused", result.Error?.Code);
    }

    [Fact]
    public async Task SlowServer_TimesOut()
    {
        var result = await ExecuteAsync(new ExecuteHttpRequest("GET", $"{target.BaseUrl}/slow", null, null, TimeoutMs: 300));
        Assert.Equal("timeout", result.Error?.Code);
    }

    [Theory]
    [InlineData("ftp://example.com/file")]
    [InlineData("")]
    [InlineData("http://")]
    public async Task InvalidUrl_ReturnsError(string url)
    {
        var result = await ExecuteAsync(new ExecuteHttpRequest("GET", url, null, null));
        Assert.Equal("invalid_url", result.Error?.Code);
    }

    [Fact]
    public async Task LargeResponse_IsTruncatedAtLimit()
    {
        using var limited = factory.WithWebHostBuilder(b => b.UseSetting("Proxy:MaxResponseBytes", "2048"));
        var client = limited.CreateClient();
        client.WithBearer((await client.RegisterAsync(TestHelpers.NewEmail())).AccessToken);

        var result = await (await client.PostAsJsonAsync("/api/execute", new ExecuteHttpRequest("GET", $"{target.BaseUrl}/big", null, null))).ReadAsync<ExecuteHttpResponse>();

        Assert.True(result.Truncated);
        Assert.Equal(2048, result.Size);
    }

    [Fact]
    public async Task BearerAuth_AddsAuthorizationHeader()
    {
        var auth = new RequestAuth { Type = AuthType.Bearer, BearerToken = "abc.def" };
        var headers = await EchoHeadersAsync(auth);
        Assert.Equal("Bearer abc.def", headers.GetProperty("authorization").GetString());
    }

    [Fact]
    public async Task BasicAuth_EncodesCredentials()
    {
        var auth = new RequestAuth { Type = AuthType.Basic, BasicUsername = "ayşe", BasicPassword = "s:fre" };
        var headers = await EchoHeadersAsync(auth);
        var expected = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("ayşe:s:fre"));
        Assert.Equal($"Basic {expected}", headers.GetProperty("authorization").GetString());
    }

    [Fact]
    public async Task ApiKey_InHeader()
    {
        var auth = new RequestAuth { Type = AuthType.ApiKey, ApiKeyName = "X-Api-Key", ApiKeyValue = "k123" };
        var headers = await EchoHeadersAsync(auth);
        Assert.Equal("k123", headers.GetProperty("x-api-key").GetString());
    }

    [Fact]
    public async Task ApiKey_InQuery_IsAppendedAndEncoded()
    {
        var auth = new RequestAuth { Type = AuthType.ApiKey, ApiKeyName = "api_key", ApiKeyValue = "a b&c", ApiKeyIn = ApiKeyLocation.Query };
        var result = await ExecuteAsync(new ExecuteHttpRequest("GET", $"{target.BaseUrl}/echo?page=2", null, null, Auth: auth));
        Assert.Equal("?page=2&api_key=a%20b%26c", JsonDocument.Parse(result.Body).RootElement.GetProperty("query").GetString());
    }

    [Fact]
    public async Task ManualAuthorizationHeader_WinsOverAuthTab()
    {
        var auth = new RequestAuth { Type = AuthType.Bearer, BearerToken = "sekmeden" };
        var result = await ExecuteAsync(new ExecuteHttpRequest("GET", $"{target.BaseUrl}/echo", [new KeyValueItem("Authorization", "Bearer elle")], null, Auth: auth));
        Assert.Equal("Bearer elle", JsonDocument.Parse(result.Body).RootElement.GetProperty("headers").GetProperty("authorization").GetString());
    }

    [Theory]
    [InlineData(AuthType.Inherit)]
    [InlineData(AuthType.None)]
    public async Task InheritOrNone_AddsNothing(AuthType type)
    {
        var headers = await EchoHeadersAsync(new RequestAuth { Type = type, BearerToken = "x", ApiKeyName = "k", ApiKeyValue = "v" });
        Assert.False(headers.TryGetProperty("authorization", out _));
        Assert.False(headers.TryGetProperty("k", out _));
    }

    [Fact]
    public async Task Execute_RequiresAuthentication()
    {
        var response = await factory.CreateClient().PostAsJsonAsync("/api/execute", new ExecuteHttpRequest("GET", $"{target.BaseUrl}/echo", null, null));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    private async Task<JsonElement> EchoHeadersAsync(RequestAuth auth)
    {
        var result = await ExecuteAsync(new ExecuteHttpRequest("GET", $"{target.BaseUrl}/echo", null, null, Auth: auth));
        return JsonDocument.Parse(result.Body).RootElement.GetProperty("headers");
    }

    private async Task<ExecuteHttpResponse> ExecuteAsync(ExecuteHttpRequest request)
    {
        var (client, _) = await factory.CreateUserAsync();
        return await (await client.PostAsJsonAsync("/api/execute", request)).ReadAsync<ExecuteHttpResponse>();
    }
}
