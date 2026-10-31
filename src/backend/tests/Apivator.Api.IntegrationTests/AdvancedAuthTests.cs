using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Apivator.Application.Collections;
using Apivator.Application.Execution;
using Apivator.Domain.Collections;
using Apivator.Infrastructure.Execution;

namespace Apivator.Api.IntegrationTests;

[Collection(ApiCollection.Name)]
public class AdvancedAuthTests(ApivatorApiFactory factory, TestTargetServer target) : IClassFixture<TestTargetServer>
{
    private RequestAuth OAuth(OAuth2GrantType grant, string scope = "okuma") => new()
    {
        Type = AuthType.OAuth2,
        OAuth2GrantType = grant,
        OAuth2TokenUrl = $"{target.BaseUrl}/oauth/token",
        OAuth2ClientId = "istemci",
        OAuth2ClientSecret = "gizli",
        OAuth2Scope = scope,
        OAuth2Username = "ayse",
        OAuth2Password = "sifre",
    };

    private async Task<ExecuteHttpResponse> ExecuteAsync(HttpClient client, string path, RequestAuth auth) =>
        await (await client.PostAsJsonAsync("/api/execute", new ExecuteHttpRequest("GET", $"{target.BaseUrl}{path}", null, null, Auth: auth))).ReadAsync<ExecuteHttpResponse>();

    private static string? AuthorizationHeader(ExecuteHttpResponse response) =>
        JsonDocument.Parse(response.Body).RootElement.GetProperty("headers").TryGetProperty("authorization", out var h) ? h.GetString() : null;

    [Fact]
    public async Task ClientCredentials_TokenIsFetchedOnce_AndCached()
    {
        var (client, _) = await factory.CreateUserAsync();
        var auth = OAuth(OAuth2GrantType.ClientCredentials, $"kapsam-{Guid.NewGuid():N}");
        var before = target.TokenRequests;

        var first = await ExecuteAsync(client, "/echo", auth);
        var second = await ExecuteAsync(client, "/echo", auth);

        Assert.Equal($"Bearer tkn-cc-{auth.OAuth2Scope}", AuthorizationHeader(first));
        Assert.Equal(AuthorizationHeader(first), AuthorizationHeader(second));
        Assert.Equal(1, target.TokenRequests - before);
    }

    [Fact]
    public async Task WrongClientSecret_ReturnsTokenError()
    {
        var (client, _) = await factory.CreateUserAsync();

        var response = await ExecuteAsync(client, "/echo", OAuth(OAuth2GrantType.ClientCredentials) with { OAuth2ClientSecret = "yanlis", OAuth2Scope = Guid.NewGuid().ToString() });

        Assert.Equal("oauth2_token_error", response.Error?.Code);
        Assert.Contains("İstemci tanınmadı", response.Error!.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TokenEndpoint_SupportsPasswordCodeAndRefresh()
    {
        var (client, _) = await factory.CreateUserAsync();

        var password = await (await client.PostAsJsonAsync("/api/oauth2/token", new OAuth2TokenRequest(OAuth(OAuth2GrantType.Password)))).ReadAsync<OAuth2TokenDto>();
        Assert.Equal(("tkn-pw", "yenile", 3600), (password.AccessToken, password.RefreshToken, password.ExpiresIn));

        var codeAuth = OAuth(OAuth2GrantType.AuthorizationCode) with { OAuth2ClientSecret = string.Empty };
        var code = await (await client.PostAsJsonAsync(
            "/api/oauth2/token",
            new OAuth2TokenRequest(codeAuth, "kod-123", "dogrulayici-123", "http://localhost:5173/oauth/callback"))).ReadAsync<OAuth2TokenDto>();
        Assert.Equal("tkn-code", code.AccessToken);

        var wrong = await client.PostAsJsonAsync("/api/oauth2/token", new OAuth2TokenRequest(codeAuth, "kod-123", "yanlis"));
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        Assert.Contains("Geçersiz istek", await wrong.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var refreshed = await (await client.PostAsJsonAsync("/api/oauth2/token", new OAuth2TokenRequest(codeAuth, RefreshToken: "yenile"))).ReadAsync<OAuth2TokenDto>();
        Assert.Equal("tkn-yenilendi", refreshed.AccessToken);
    }

    [Fact]
    public async Task AuthorizationCode_NeedsTokenFromClient()
    {
        var (client, _) = await factory.CreateUserAsync();
        var auth = OAuth(OAuth2GrantType.AuthorizationCode);

        var missing = await ExecuteAsync(client, "/echo", auth);
        Assert.Equal("oauth2_token_required", missing.Error?.Code);

        var withToken = await ExecuteAsync(client, "/echo", auth with { OAuth2AccessToken = "tkn-tarayici", OAuth2HeaderPrefix = "Token" });
        Assert.Equal("Token tkn-tarayici", AuthorizationHeader(withToken));
    }

    [Fact]
    public async Task SavedDefinitions_NeverKeepAccessTokens()
    {
        var (client, workspaceId) = await factory.CreateUserAsync();
        var collection = await (await client.PostAsJsonAsync($"/api/workspaces/{workspaceId}/collections", new CreateCollectionRequest("Gizli"))).ReadAsync<CollectionTreeDto>();
        var auth = OAuth(OAuth2GrantType.AuthorizationCode) with { OAuth2AccessToken = "sızmamalı" };

        var request = await (await client.PostAsJsonAsync($"/api/collections/{collection.Id}/requests", new CreateApiRequestRequest("r", null, new RequestDefinition { Url = "x", Auth = auth }))).ReadAsync<ApiRequestDto>();
        var updated = await (await client.PatchAsJsonAsync($"/api/collections/{collection.Id}", new UpdateCollectionRequest(null, null, auth))).ReadAsync<CollectionTreeDto>();

        Assert.Equal(string.Empty, request.Definition.Auth.OAuth2AccessToken);
        Assert.Equal(string.Empty, updated.Auth.OAuth2AccessToken);
        Assert.Equal("istemci", updated.Auth.OAuth2ClientId);
    }

    [Fact]
    public async Task Digest_AnswersTheChallenge()
    {
        var (client, _) = await factory.CreateUserAsync();

        var ok = await ExecuteAsync(client, "/digest", new RequestAuth { Type = AuthType.Digest, BasicUsername = "ayse", BasicPassword = "sifre" });
        var wrong = await ExecuteAsync(client, "/digest", new RequestAuth { Type = AuthType.Digest, BasicUsername = "ayse", BasicPassword = "yanlis" });

        Assert.Equal((200, "içeri"), (ok.Status, ok.Body));
        Assert.StartsWith("Digest username=\"ayse\"", ok.Request!.Headers.Single(h => h.Key == "Authorization").Value, StringComparison.Ordinal);
        Assert.Equal(401, wrong.Status);
    }

    [Fact]
    public void AwsSigner_MatchesOfficialTestVector()
    {
        // AWS SigV4 test paketindeki "get-vanilla" örneği.
        using var message = new HttpRequestMessage(HttpMethod.Get, "https://example.amazonaws.com/");
        var auth = new RequestAuth
        {
            Type = AuthType.AwsSigV4,
            AwsAccessKey = "AKIDEXAMPLE",
            AwsSecretKey = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            AwsRegion = "us-east-1",
            AwsService = "service",
        };

        AwsSigner.Sign(message, [], auth, new DateTimeOffset(2015, 8, 30, 12, 36, 0, TimeSpan.Zero));

        Assert.Equal(
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
            message.Headers.GetValues("Authorization").Single());
    }

    [Fact]
    public async Task AwsSigV4_IsAppliedToRequests()
    {
        var (client, _) = await factory.CreateUserAsync();

        var response = await ExecuteAsync(client, "/echo?b=2&a=1", new RequestAuth { Type = AuthType.AwsSigV4, AwsAccessKey = "AK", AwsSecretKey = "SK", AwsRegion = "eu-central-1", AwsService = "s3" });

        var headers = JsonDocument.Parse(response.Body).RootElement.GetProperty("headers");
        Assert.StartsWith("AWS4-HMAC-SHA256 Credential=AK/", headers.GetProperty("authorization").GetString(), StringComparison.Ordinal);
        Assert.True(headers.TryGetProperty("x-amz-date", out _));
        Assert.True(headers.TryGetProperty("x-amz-content-sha256", out _));
    }
}
