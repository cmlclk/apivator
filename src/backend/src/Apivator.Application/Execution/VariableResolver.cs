using System.Text.RegularExpressions;
using Apivator.Domain.Collections;

namespace Apivator.Application.Execution;

/// <summary>
/// {{değişken}} ifadelerini çözer. İstemcideki (packages/core/variables.ts) ile aynı kurallar: değişken değeri
/// başka değişken içerebilir (en fazla 10 kat), bulunamayan değişken metinde olduğu gibi kalır.
/// </summary>
public static partial class VariableResolver
{
    private const int MaxDepth = 10;

    [GeneratedRegex(@"\{\{\s*([^{}]+?)\s*\}\}")]
    private static partial Regex VariablePattern();

    public static string Resolve(string? text, Func<string, string?> lookup, ISet<string>? unresolved = null)
    {
        if (string.IsNullOrEmpty(text) || !text.Contains("{{", StringComparison.Ordinal))
        {
            return text ?? string.Empty;
        }

        var current = text;
        for (var depth = 0; depth < MaxDepth; depth++)
        {
            var changed = false;
            current = VariablePattern().Replace(current, match =>
            {
                var name = match.Groups[1].Value.Trim();
                var value = lookup(name) ?? Dynamic(name);
                if (value is null)
                {
                    unresolved?.Add(name);
                    return match.Value;
                }

                changed = true;
                return value;
            });

            if (!changed)
            {
                break;
            }
        }

        return current;
    }

    /// <summary>Postman'deki hazır dinamik değişkenler; her kullanımda yeniden üretilir (bkz. <see cref="DynamicValues"/>).</summary>
    public static string? Dynamic(string name) => DynamicValues.Generate(name);

    /// <summary>İsteğin tüm parçalarını çözer; URL'de çözülemeyen değişkenleri ayrıca döner.</summary>
    public static ExecuteHttpRequest ResolveRequest(ExecuteHttpRequest request, Func<string, string?> lookup, out IReadOnlySet<string> unresolvedInUrl)
    {
        var urlMissing = new HashSet<string>(StringComparer.Ordinal);
        string R(string? value) => Resolve(value, lookup);

        IReadOnlyList<KeyValueItem> Pairs(IReadOnlyList<KeyValueItem>? items) =>
            (items ?? []).Select(i => !i.Enabled
                ? i
                : i with { Key = R(i.Key), Value = i.Type == FormFieldType.File ? i.Value : R(i.Value) }).ToList();

        var body = request.Body ?? RequestBody.None;
        var textBody = body.Mode is BodyMode.Raw or BodyMode.GraphQL;
        var auth = request.Auth;
        var resolved = request with
        {
            Url = Resolve(request.Url, lookup, urlMissing),
            Headers = Pairs(request.Headers),
            Body = body with
            {
                Raw = textBody ? R(body.Raw) : body.Raw,
                GraphqlVariables = body.Mode == BodyMode.GraphQL ? R(body.GraphqlVariables) : body.GraphqlVariables,
                Form = Pairs(body.Form),
            },
            Auth = auth is null ? null : auth with
            {
                ApiKeyName = R(auth.ApiKeyName),
                ApiKeyValue = R(auth.ApiKeyValue),
                BearerToken = R(auth.BearerToken),
                BasicUsername = R(auth.BasicUsername),
                BasicPassword = R(auth.BasicPassword),
                OAuth2AuthUrl = R(auth.OAuth2AuthUrl),
                OAuth2TokenUrl = R(auth.OAuth2TokenUrl),
                OAuth2ClientId = R(auth.OAuth2ClientId),
                OAuth2ClientSecret = R(auth.OAuth2ClientSecret),
                OAuth2Scope = R(auth.OAuth2Scope),
                OAuth2Audience = R(auth.OAuth2Audience),
                OAuth2Username = R(auth.OAuth2Username),
                OAuth2Password = R(auth.OAuth2Password),
                OAuth2AccessToken = R(auth.OAuth2AccessToken),
                AwsAccessKey = R(auth.AwsAccessKey),
                AwsSecretKey = R(auth.AwsSecretKey),
                AwsRegion = R(auth.AwsRegion),
                AwsService = R(auth.AwsService),
                AwsSessionToken = R(auth.AwsSessionToken),
            },
        };

        unresolvedInUrl = urlMissing;
        return resolved;
    }
}
