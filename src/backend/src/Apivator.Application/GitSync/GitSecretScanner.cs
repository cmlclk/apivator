using System.Text.RegularExpressions;
using Apivator.Application.Common.Localization;
using Apivator.Domain.Collections;

namespace Apivator.Application.GitSync;

/// <summary>
/// Depoya gidecek içerikte olası gizli değerleri bulur (başlık/gövde/adresteki Bearer, JWT, API anahtarı).
/// Kesin bir tespit değildir; yalnızca göndermeden önce kullanıcıyı uyarır.
/// </summary>
internal static partial class GitSecretScanner
{
    private const int MaxWarnings = 20;

    private static readonly HashSet<string> SensitiveHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "api-key", "apikey",
        "x-auth-token", "x-access-token", "x-csrf-token", "x-amz-security-token",
    };

    [GeneratedRegex(@"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*")]
    private static partial Regex Jwt();

    [GeneratedRegex(@"\bBearer\s+(?!\{\{)[A-Za-z0-9._~+/=-]{16,}", RegexOptions.IgnoreCase)]
    private static partial Regex BearerLiteral();

    [GeneratedRegex(@"[?&](access_token|api_key|apikey|token|key|secret|password|client_secret)=(?!\{\{)[^&\s]{6,}", RegexOptions.IgnoreCase)]
    private static partial Regex SecretQuery();

    public static List<string> Scan(IEnumerable<GitItem> items)
    {
        var warnings = new List<string>();
        foreach (var item in items.Where(i => i.Kind == Domain.Forks.ForkItemKind.Request))
        {
            var definition = item.Doc.Definition;
            if (definition is not null)
            {
                ScanDefinition(item.Name, definition, warnings);
            }

            foreach (var example in item.Doc.Examples ?? [])
            {
                if (Jwt().IsMatch(example.Body))
                {
                    warnings.Add(L.T("git.secret_example_jwt", "{name}: \"{example}\" örnek yanıtında JWT benzeri bir değer var.", ("name", item.Name), ("example", example.Name)));
                }
            }
        }

        return [.. warnings.Take(MaxWarnings)];
    }

    private static void ScanDefinition(string name, RequestDefinition definition, List<string> warnings)
    {
        foreach (var header in definition.Headers.Where(h => SensitiveHeaders.Contains(h.Key) && h.Value.Length > 0 && !GitSecrets.IsPlaceholder(h.Value)))
        {
            warnings.Add(L.T("git.secret_header",
                "{name}: \"{header}\" başlığında sabit bir değer var; {hint} kullanın.",
                ("name", name),
                ("header", header.Key),
                ("hint", "{{" + L.T("git.secret_variable", "değişken") + "}}")));
        }

        var texts = new[] { definition.Url, definition.Body.Raw }
            .Concat(definition.Headers.Select(h => h.Value))
            .Concat(definition.Body.Form.Select(f => f.Value));
        foreach (var text in texts)
        {
            if (Jwt().IsMatch(text) || BearerLiteral().IsMatch(text))
            {
                warnings.Add(L.T("git.secret_token", "{name}: JWT/Bearer benzeri sabit bir belirteç var.", ("name", name)));
                break;
            }
        }

        if (SecretQuery().IsMatch(definition.Url))
        {
            warnings.Add(L.T("git.secret_url", "{name}: adreste sabit bir anahtar/belirteç parametresi var.", ("name", name)));
        }

        foreach (var field in definition.Body.Form.Where(f => f.Key.Contains("secret", StringComparison.OrdinalIgnoreCase)
            || f.Key.Contains("password", StringComparison.OrdinalIgnoreCase) || f.Key.Contains("token", StringComparison.OrdinalIgnoreCase)))
        {
            if (field.Value.Length > 0 && !GitSecrets.IsPlaceholder(field.Value))
            {
                warnings.Add(L.T("git.secret_form", "{name}: \"{field}\" form alanında sabit bir değer var.", ("name", name), ("field", field.Key)));
            }
        }
    }
}
