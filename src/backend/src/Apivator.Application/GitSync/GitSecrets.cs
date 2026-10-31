using Apivator.Domain.Collections;
using Apivator.Domain.Forks;
using Apivator.Domain.Variables;

namespace Apivator.Application.GitSync;

/// <summary>
/// Depoya yazılan dosyalarda gizli değer bulunmaz: yetkilendirme alanları <c>{{alan}}</c> yer tutucusuna,
/// gizli değişkenlerin değeri boşluğa çevrilir. Depodan alırken yer tutucunun yerine yereldeki gerçek değer korunur.
/// Zaten <c>{{...}}</c> içeren (değişken başvurusu olan) değerlere dokunulmaz.
/// </summary>
internal static class GitSecrets
{
    private sealed record Field(string Name, Func<RequestAuth, string> Get, Func<RequestAuth, string, RequestAuth> Set);

    private static readonly Field[] Fields =
    [
        new("apiKeyValue", a => a.ApiKeyValue, (a, v) => a with { ApiKeyValue = v }),
        new("bearerToken", a => a.BearerToken, (a, v) => a with { BearerToken = v }),
        new("basicPassword", a => a.BasicPassword, (a, v) => a with { BasicPassword = v }),
        new("oauth2ClientSecret", a => a.OAuth2ClientSecret, (a, v) => a with { OAuth2ClientSecret = v }),
        new("oauth2Password", a => a.OAuth2Password, (a, v) => a with { OAuth2Password = v }),
        new("awsSecretKey", a => a.AwsSecretKey, (a, v) => a with { AwsSecretKey = v }),
        new("awsSessionToken", a => a.AwsSessionToken, (a, v) => a with { AwsSessionToken = v }),
    ];

    public static string Placeholder(string name) => "{{" + name + "}}";

    private static readonly System.Text.RegularExpressions.Regex PlaceholderPattern =
        new(@"^(?:(?:Bearer|Basic|Token|Digest)\s+)?\{\{[^{}]+\}\}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant | System.Text.RegularExpressions.RegexOptions.IgnoreCase, TimeSpan.FromSeconds(1));

    /// <summary>Değer tam olarak bir değişken başvurusu mu ({{ad}}, isteğe bağlı "Bearer " önekiyle)?</summary>
    public static bool IsPlaceholder(string value) => PlaceholderPattern.IsMatch(value);

    public static RequestAuth Strip(RequestAuth auth)
    {
        var result = auth.WithoutSecrets();
        foreach (var field in Fields)
        {
            var value = field.Get(result);
            if (value.Length > 0 && !IsPlaceholder(value))
            {
                result = field.Set(result, Placeholder(field.Name));
            }
        }

        return result;
    }

    /// <summary>Gelen yetkilendirmedeki yer tutucuların yerine <paramref name="existing"/>'teki gerçek değeri koyar.</summary>
    public static RequestAuth Restore(RequestAuth incoming, RequestAuth? existing)
    {
        if (existing is null)
        {
            return incoming;
        }

        var result = incoming;
        foreach (var field in Fields)
        {
            if (field.Get(result) == Placeholder(field.Name) && field.Get(existing).Length > 0)
            {
                result = field.Set(result, field.Get(existing));
            }
        }

        return result;
    }

    public static IReadOnlyList<Variable> Strip(IReadOnlyList<Variable> variables) =>
        [.. variables.Select(v => v.IsSecret ? v with { Value = string.Empty } : v)];

    /// <summary>Gizli değişkenin değeri boşsa aynı adlı yerel değişkenin değerini korur.</summary>
    public static IReadOnlyList<Variable> Restore(IReadOnlyList<Variable> incoming, IReadOnlyList<Variable> existing) =>
    [
        .. incoming.Select(v => v.IsSecret && v.Value.Length == 0 && existing.FirstOrDefault(e => e.Key == v.Key && e.IsSecret) is { } old
            ? v with { Value = old.Value }
            : v),
    ];

    public static RequestDefinition Strip(RequestDefinition definition) => definition with { Auth = Strip(definition.Auth) };

    public static RequestDefinition Restore(RequestDefinition incoming, RequestDefinition? existing) =>
        incoming with { Auth = Restore(incoming.Auth, existing?.Auth) };

    private static readonly HashSet<string> ExampleHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "set-cookie", "cookie", "authorization", "proxy-authorization",
    };

    /// <summary>Örneklerden oturum/kimlik başlıkları çıkarılır; isteğin yetkilendirmesi de yer tutucuya çevrilir.</summary>
    public static IReadOnlyList<ExampleSnapshot> Strip(IReadOnlyList<ExampleSnapshot> examples) =>
    [
        .. examples.Select(e => e with
        {
            Headers = [.. e.Headers.Where(h => !ExampleHeaders.Contains(h.Key))],
            Request = Strip(e.Request) with { Headers = [.. e.Request.Headers.Where(h => !ExampleHeaders.Contains(h.Key))] },
        }),
    ];
}
