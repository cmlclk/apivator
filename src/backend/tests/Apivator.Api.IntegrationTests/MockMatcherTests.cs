using Apivator.Application.Mocks;
using Apivator.Domain.Collections;

namespace Apivator.Api.IntegrationTests;

public class MockMatcherTests
{
    private static readonly Func<string, string?> NoVariables = _ => null;

    private static MockCandidate Example(string method, string url, int status = 200, string name = "Örnek", string? requestBody = null, IReadOnlyList<KeyValueItem>? requestHeaders = null) => new(
        Guid.NewGuid(),
        "İstek",
        name,
        status,
        [],
        "{}",
        new RequestDefinition
        {
            Method = method,
            Url = url,
            Headers = requestHeaders ?? [],
            Body = requestBody is null ? RequestBody.None : new RequestBody { Mode = BodyMode.Raw, Raw = requestBody },
        });

    private static MockIncoming Call(string method, string pathAndQuery, string body = "", Dictionary<string, string>? headers = null)
    {
        var question = pathAndQuery.IndexOf('?', StringComparison.Ordinal);
        var path = question >= 0 ? pathAndQuery[..question] : pathAndQuery;
        var query = question >= 0 ? MockMatcher.ParseQuery(pathAndQuery[(question + 1)..]) : [];
        return new MockIncoming(method, path, query, headers ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase), body);
    }

    [Theory]
    [InlineData("{{baseUrl}}/users/1")]
    [InlineData("https://api.example.com/users/1")]
    [InlineData("api.example.com/users/1?")]
    [InlineData("localhost:5000/users/1")]
    [InlineData("/users/1/")]
    public void HostAndBaseUrl_AreIgnored(string url)
    {
        var example = Example("GET", url);

        Assert.Same(example, MockMatcher.Match(Call("GET", "/users/1"), [example], NoVariables)?.Candidate);
    }

    [Fact]
    public void ResolvedBaseUrl_KeepsItsPath()
    {
        var example = Example("GET", "{{baseUrl}}/users");
        var lookup = (string name) => name == "baseUrl" ? "https://api.example.com/v2" : null;

        Assert.Null(MockMatcher.Match(Call("GET", "/users"), [example], lookup));
        Assert.Same(example, MockMatcher.Match(Call("GET", "/v2/users"), [example], lookup)?.Candidate);
    }

    [Fact]
    public void MethodMustMatch_ButHeadUsesGet()
    {
        var example = Example("GET", "/users");

        Assert.Null(MockMatcher.Match(Call("POST", "/users"), [example], NoVariables));
        Assert.Same(example, MockMatcher.Match(Call("HEAD", "/users"), [example], NoVariables)?.Candidate);
    }

    [Theory]
    [InlineData("/users/:id")]
    [InlineData("/users/{id}")]
    [InlineData("/users/{{userId}}")]
    public void PathParameters_MatchAnyValue(string url)
    {
        var example = Example("GET", url);

        Assert.Same(example, MockMatcher.Match(Call("GET", "/users/42"), [example], NoVariables)?.Candidate);
        Assert.Null(MockMatcher.Match(Call("GET", "/users/42/orders"), [example], NoVariables));
    }

    [Fact]
    public void LiteralPath_BeatsParameter()
    {
        var any = Example("GET", "/users/:id", name: "Herhangi");
        var me = Example("GET", "/users/me", name: "Ben");

        Assert.Same(me, MockMatcher.Match(Call("GET", "/users/me"), [any, me], NoVariables)?.Candidate);
        Assert.Same(any, MockMatcher.Match(Call("GET", "/users/7"), [any, me], NoVariables)?.Candidate);
    }

    [Fact]
    public void MatchingQuery_Wins()
    {
        var active = Example("GET", "/users?status=active", name: "Aktif");
        var passive = Example("GET", "/users?status=passive", name: "Pasif");

        Assert.Same(passive, MockMatcher.Match(Call("GET", "/users?status=passive"), [active, passive], NoVariables)?.Candidate);
        Assert.Same(active, MockMatcher.Match(Call("GET", "/users?status=active&page=2"), [active, passive], NoVariables)?.Candidate);
    }

    [Fact]
    public void SameBody_Wins_AndJsonFormattingIsIgnored()
    {
        var admin = Example("POST", "/login", name: "Admin", requestBody: "{\"user\":\"admin\",\"pass\":\"1\"}");
        var other = Example("POST", "/login", status: 401, name: "Hatalı", requestBody: "{\"user\":\"x\"}");

        var match = MockMatcher.Match(Call("POST", "/login", "{ \"pass\": \"1\", \"user\": \"admin\" }"), [other, admin], NoVariables);

        Assert.Same(admin, match?.Candidate);
    }

    [Fact]
    public void WithoutOtherSignals_SuccessResponseIsPreferred()
    {
        var notFound = Example("GET", "/users/:id", status: 404, name: "Yok");
        var ok = Example("GET", "/users/:id", status: 200, name: "Var");

        Assert.Same(ok, MockMatcher.Match(Call("GET", "/users/1"), [notFound, ok], NoVariables)?.Candidate);
    }

    [Fact]
    public void ResponseCodeNameAndIdHeaders_SelectTheExample()
    {
        var ok = Example("GET", "/users/:id", status: 200, name: "Var");
        var notFound = Example("GET", "/users/:id", status: 404, name: "Yok");
        Dictionary<string, string> H(string key, string value) => new(StringComparer.OrdinalIgnoreCase) { [key] = value };

        Assert.Same(notFound, MockMatcher.Match(Call("GET", "/users/1", headers: H("x-mock-response-code", "404")), [ok, notFound], NoVariables)?.Candidate);
        Assert.Same(notFound, MockMatcher.Match(Call("GET", "/users/1", headers: H("x-mock-response-name", "yok")), [ok, notFound], NoVariables)?.Candidate);
        Assert.Same(notFound, MockMatcher.Match(Call("GET", "/users/1", headers: H("x-mock-response-id", notFound.ExampleId.ToString())), [ok, notFound], NoVariables)?.Candidate);
        Assert.Null(MockMatcher.Match(Call("GET", "/users/1", headers: H("x-mock-response-code", "500")), [ok, notFound], NoVariables));
    }

    [Fact]
    public void StrictBodyAndHeaderMatching_CanBeRequired()
    {
        var example = Example("POST", "/orders", requestBody: "{\"id\":1}", requestHeaders: [new KeyValueItem("X-Tenant", "a")]);
        Dictionary<string, string> H(params (string Key, string Value)[] pairs) => pairs.ToDictionary(p => p.Key, p => p.Value, StringComparer.OrdinalIgnoreCase);

        Assert.NotNull(MockMatcher.Match(Call("POST", "/orders", "{\"id\":2}"), [example], NoVariables));
        Assert.Null(MockMatcher.Match(Call("POST", "/orders", "{\"id\":2}", H(("x-mock-match-request-body", "true"))), [example], NoVariables));
        Assert.NotNull(MockMatcher.Match(Call("POST", "/orders", "{\"id\":1}", H(("x-mock-match-request-body", "true"))), [example], NoVariables));

        Assert.Null(MockMatcher.Match(Call("POST", "/orders", headers: H(("x-mock-match-request-headers", "x-tenant"), ("x-tenant", "b"))), [example], NoVariables));
        Assert.NotNull(MockMatcher.Match(Call("POST", "/orders", headers: H(("x-mock-match-request-headers", "x-tenant"), ("x-tenant", "a"))), [example], NoVariables));
    }

    [Fact]
    public void PathSegments_AreDecodedAndCaseInsensitive()
    {
        var example = Example("GET", "/files/my%20report");

        Assert.NotNull(MockMatcher.Match(Call("GET", "/Files/my report"), [example], NoVariables));
    }
}
