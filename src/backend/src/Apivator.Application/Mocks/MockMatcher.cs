using System.Text.Json;
using System.Text.RegularExpressions;
using Apivator.Application.Execution;
using Apivator.Domain.Collections;

namespace Apivator.Application.Mocks;

/// <summary>Eşleştirmeye aday bir örnek yanıt ve alındığı istek.</summary>
public sealed record MockCandidate(
    Guid ExampleId,
    string RequestName,
    string ExampleName,
    int Status,
    IReadOnlyList<KeyValueItem> Headers,
    string Body,
    RequestDefinition Request,
    Guid RequestId = default);

/// <summary>Mock'a gelen istek. <paramref name="Path"/> mock adresinden sonraki kısımdır ("/users/1").</summary>
public sealed record MockIncoming(
    string Method,
    string Path,
    IReadOnlyList<KeyValuePair<string, string>> Query,
    IReadOnlyDictionary<string, string> Headers,
    string Body);

public sealed record MockMatch(MockCandidate Candidate, int Score);

/// <summary>
/// Gelen isteği örneklerle eşleştirir. Kurallar Postman mock server'ına yakındır:
/// <list type="bullet">
/// <item>Method aynı olmalı (HEAD, GET örneğiyle de eşleşir).</item>
/// <item>Yol parça parça karşılaştırılır; <c>:id</c>, <c>{id}</c> ve çözülemeyen <c>{{değişken}}</c> her değeri kabul eder.
/// Örnek URL'sindeki şema ve host (ya da baştaki <c>{{baseUrl}}</c>) yok sayılır.</item>
/// <item>Sabit parça eşleşmesi, joker parçadan; uyan query parametreleri ve aynı body puanı artırır.</item>
/// <item><c>x-mock-response-name</c>, <c>x-mock-response-id</c>, <c>x-mock-response-code</c> header'ları seçimi daraltır;
/// <c>x-mock-match-request-body: true</c> ve <c>x-mock-match-request-headers: a,b</c> eşitliği zorunlu kılar.</item>
/// <item>Eşitlikte, kod istenmemişse 2xx yanıt, sonra collection'daki sıra öne geçer.</item>
/// </list>
/// </summary>
public static partial class MockMatcher
{
    public const string ResponseNameHeader = "x-mock-response-name";
    public const string ResponseIdHeader = "x-mock-response-id";
    public const string ResponseCodeHeader = "x-mock-response-code";
    public const string MatchBodyHeader = "x-mock-match-request-body";
    public const string MatchHeadersHeader = "x-mock-match-request-headers";

    private const int LiteralSegment = 10;
    private const int WildcardSegment = 3;
    private const int QueryMatch = 5;
    private const int QueryLoose = 2;
    private const int QueryMismatch = -5;
    private const int QueryMissing = -2;
    private const int BodyMatch = 8;

    [GeneratedRegex(@"\{\{[^{}]+\}\}")]
    private static partial Regex VariableToken();

    public static MockMatch? Match(MockIncoming incoming, IReadOnlyList<MockCandidate> candidates, Func<string, string?> lookup)
    {
        var method = incoming.Method.ToUpperInvariant();
        var path = Segments(incoming.Path);
        var header = (string name) => incoming.Headers.TryGetValue(name, out var v) ? v.Trim() : null;

        var wantedName = header(ResponseNameHeader);
        var wantedId = Guid.TryParse(header(ResponseIdHeader), out var id) ? id : (Guid?)null;
        var wantedCode = int.TryParse(header(ResponseCodeHeader), out var code) ? code : (int?)null;
        var matchBody = string.Equals(header(MatchBodyHeader), "true", StringComparison.OrdinalIgnoreCase);
        var matchHeaders = (header(MatchHeadersHeader) ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        MockMatch? best = null;
        var bestRank = (Score: int.MinValue, Success: false, Index: int.MaxValue, ExactMethod: false);
        for (var index = 0; index < candidates.Count; index++)
        {
            var candidate = candidates[index];
            if (wantedId is { } wid && candidate.ExampleId != wid)
            {
                continue;
            }

            if (wantedName is not null && !string.Equals(candidate.ExampleName, wantedName, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (wantedCode is { } wc && candidate.Status != wc)
            {
                continue;
            }

            var candidateMethod = candidate.Request.Method.ToUpperInvariant();
            var exactMethod = candidateMethod == method;
            if (!exactMethod && !(method == "HEAD" && candidateMethod == "GET"))
            {
                continue;
            }

            var template = ParseTemplate(candidate.Request.Url, lookup);
            if (PathScore(template.Segments, path) is not { } score)
            {
                continue;
            }

            score += QueryScore(template.Query, incoming.Query);

            var exampleBody = ExampleBody(candidate.Request, lookup);
            var bodyEqual = exampleBody is not null && SameBody(exampleBody, incoming.Body);
            if (matchBody && !bodyEqual && !(exampleBody is null && string.IsNullOrEmpty(incoming.Body)))
            {
                continue;
            }

            if (bodyEqual && exampleBody!.Length > 0)
            {
                score += BodyMatch;
            }

            if (!HeadersMatch(matchHeaders, candidate.Request, incoming.Headers, lookup))
            {
                continue;
            }

            var rank = (Score: score, Success: wantedCode is null && candidate.Status is >= 200 and < 300, Index: index, ExactMethod: exactMethod);
            if (best is null || Better(rank, bestRank))
            {
                best = new MockMatch(candidate, score);
                bestRank = rank;
            }
        }

        return best;
    }

    /// <summary>Örnek URL'sinin yol parçaları ve query parametreleri.</summary>
    public static (IReadOnlyList<string> Segments, IReadOnlyList<KeyValuePair<string, string>> Query) ParseTemplate(string url, Func<string, string?> lookup)
    {
        var resolved = VariableResolver.Resolve(url, lookup).Trim();
        var hash = resolved.IndexOf('#', StringComparison.Ordinal);
        if (hash >= 0)
        {
            resolved = resolved[..hash];
        }

        var question = resolved.IndexOf('?', StringComparison.Ordinal);
        var path = question >= 0 ? resolved[..question] : resolved;
        var query = question >= 0 ? ParseQuery(resolved[(question + 1)..]) : [];

        var scheme = path.IndexOf("://", StringComparison.Ordinal);
        if (scheme >= 0)
        {
            path = path[(scheme + 3)..];
            var slash = path.IndexOf('/', StringComparison.Ordinal);
            path = slash >= 0 ? path[slash..] : "/";
        }
        else if (!path.StartsWith('/'))
        {
            // "{{baseUrl}}/users", "api.example.com/users", "localhost:5000/users": baştaki host kısmı atılır.
            var slash = path.IndexOf('/', StringComparison.Ordinal);
            var first = slash >= 0 ? path[..slash] : path;
            if (first.Contains("{{", StringComparison.Ordinal) || first.Contains('.', StringComparison.Ordinal)
                || first.Contains(':', StringComparison.Ordinal) || first.Equals("localhost", StringComparison.OrdinalIgnoreCase))
            {
                path = slash >= 0 ? path[slash..] : "/";
            }
        }

        return (Segments(path), query);
    }

    public static IReadOnlyList<KeyValuePair<string, string>> ParseQuery(string query) =>
        query.Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(pair =>
            {
                var eq = pair.IndexOf('=', StringComparison.Ordinal);
                var key = eq >= 0 ? pair[..eq] : pair;
                var value = eq >= 0 ? pair[(eq + 1)..] : string.Empty;
                return new KeyValuePair<string, string>(Decode(key, plusIsSpace: true), Decode(value, plusIsSpace: true));
            })
            .Where(p => p.Key.Length > 0)
            .ToList();

    private static bool Better(
        (int Score, bool Success, int Index, bool ExactMethod) a,
        (int Score, bool Success, int Index, bool ExactMethod) b)
    {
        if (a.ExactMethod != b.ExactMethod)
        {
            return a.ExactMethod;
        }

        if (a.Score != b.Score)
        {
            return a.Score > b.Score;
        }

        return a.Success != b.Success ? a.Success : a.Index < b.Index;
    }

    private static List<string> Segments(string path) =>
        path.Split('/', StringSplitOptions.RemoveEmptyEntries).Select(s => Decode(s, plusIsSpace: false)).ToList();

    private static int? PathScore(IReadOnlyList<string> template, List<string> actual)
    {
        if (template.Count != actual.Count)
        {
            return null;
        }

        var score = 0;
        for (var i = 0; i < template.Count; i++)
        {
            var t = template[i];
            var a = actual[i];
            if (IsWildcard(t))
            {
                score += WildcardSegment;
            }
            else if (t.Contains("{{", StringComparison.Ordinal))
            {
                // "user-{{id}}" gibi karışık parça: değişkenler herhangi bir değere uyar.
                var pattern = "^" + string.Join("[^/]+", VariableToken().Split(t).Select(Regex.Escape)) + "$";
                if (!Regex.IsMatch(a, pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(50)))
                {
                    return null;
                }

                score += WildcardSegment + 1;
            }
            else if (string.Equals(t, a, StringComparison.OrdinalIgnoreCase))
            {
                score += LiteralSegment;
            }
            else
            {
                return null;
            }
        }

        return score;
    }

    private static bool IsWildcard(string segment) =>
        (segment.StartsWith(':') && segment.Length > 1)
        || (segment.StartsWith('{') && segment.EndsWith('}') && segment.Length > 2 && !segment.StartsWith("{{", StringComparison.Ordinal))
        || (segment.StartsWith("{{", StringComparison.Ordinal) && segment.EndsWith("}}", StringComparison.Ordinal)
            && VariableToken().Match(segment) is { Success: true } m && m.Length == segment.Length);

    private static int QueryScore(IReadOnlyList<KeyValuePair<string, string>> template, IReadOnlyList<KeyValuePair<string, string>> actual)
    {
        var score = 0;
        foreach (var (key, value) in template)
        {
            var present = actual.Where(p => p.Key == key).Select(p => p.Value).ToList();
            if (present.Count == 0)
            {
                score += QueryMissing;
            }
            else if (present.Contains(value, StringComparer.Ordinal))
            {
                score += QueryMatch;
            }
            else
            {
                score += value.Length == 0 || value.Contains("{{", StringComparison.Ordinal) ? QueryLoose : QueryMismatch;
            }
        }

        return score;
    }

    /// <summary>Örneğin alındığı isteğin metin body'si (raw ya da GraphQL); başka türlerde null.</summary>
    private static string? ExampleBody(RequestDefinition request, Func<string, string?> lookup) => request.Body.Mode switch
    {
        BodyMode.Raw when !string.IsNullOrEmpty(request.Body.Raw) => VariableResolver.Resolve(request.Body.Raw, lookup),
        BodyMode.GraphQL when !string.IsNullOrEmpty(request.Body.Raw) => VariableResolver.Resolve(request.Body.Raw, lookup),
        _ => null,
    };

    /// <summary>JSON ise boşluk ve anahtar sırası farkı yok sayılır; değilse metin kırpılarak karşılaştırılır.</summary>
    private static bool SameBody(string expected, string actual)
    {
        if (Normalize(expected) is { } a && Normalize(actual) is { } b)
        {
            return JsonElement.DeepEquals(a, b);
        }

        return string.Equals(expected.Trim(), actual.Trim(), StringComparison.Ordinal);

        static JsonElement? Normalize(string text)
        {
            var trimmed = text.TrimStart();
            if (trimmed.Length == 0 || trimmed[0] is not ('{' or '['))
            {
                return null;
            }

            try
            {
                using var doc = JsonDocument.Parse(text);
                return doc.RootElement.Clone();
            }
            catch (JsonException)
            {
                return null;
            }
        }
    }

    private static bool HeadersMatch(string[] names, RequestDefinition request, IReadOnlyDictionary<string, string> incoming, Func<string, string?> lookup)
    {
        foreach (var name in names)
        {
            var expected = request.Headers.FirstOrDefault(h => h.Enabled && string.Equals(h.Key, name, StringComparison.OrdinalIgnoreCase));
            var actual = incoming.TryGetValue(name, out var v) ? v : null;
            if (expected is null)
            {
                if (actual is not null)
                {
                    return false;
                }

                continue;
            }

            if (!string.Equals(VariableResolver.Resolve(expected.Value, lookup).Trim(), actual?.Trim(), StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }

    private static string Decode(string value, bool plusIsSpace)
    {
        try
        {
            return Uri.UnescapeDataString(plusIsSpace ? value.Replace('+', ' ') : value);
        }
        catch (UriFormatException)
        {
            return value;
        }
    }
}
