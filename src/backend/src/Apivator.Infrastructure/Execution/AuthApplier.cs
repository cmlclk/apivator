using System.Text;
using Apivator.Domain.Collections;

namespace Apivator.Infrastructure.Execution;

/// <summary>
/// İsteğe yetkilendirme bilgisini ekler. Kullanıcı Headers sekmesine aynı adlı bir header'ı kendisi
/// yazdıysa ona dokunulmaz (elle yazılan kazanır).
/// </summary>
internal static class AuthApplier
{
    public static Uri ApplyToUri(Uri uri, RequestAuth? auth)
    {
        if (auth is not { Type: AuthType.ApiKey, ApiKeyIn: ApiKeyLocation.Query } || string.IsNullOrWhiteSpace(auth.ApiKeyName))
        {
            return uri;
        }

        var pair = $"{Uri.EscapeDataString(auth.ApiKeyName.Trim())}={Uri.EscapeDataString(auth.ApiKeyValue)}";
        var builder = new UriBuilder(uri);
        var query = builder.Query.TrimStart('?');
        builder.Query = query.Length == 0 ? pair : $"{query}&{pair}";
        return builder.Uri;
    }

    public static void ApplyToHeaders(HttpRequestMessage message, RequestAuth? auth)
    {
        switch (auth?.Type)
        {
            case AuthType.Bearer when !string.IsNullOrWhiteSpace(auth.BearerToken):
                AddIfMissing(message, "Authorization", $"Bearer {auth.BearerToken.Trim()}");
                break;

            case AuthType.Basic when auth.BasicUsername.Length > 0 || auth.BasicPassword.Length > 0:
                var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{auth.BasicUsername}:{auth.BasicPassword}"));
                AddIfMissing(message, "Authorization", $"Basic {credentials}");
                break;

            case AuthType.OAuth2 when !string.IsNullOrWhiteSpace(auth.OAuth2AccessToken):
                var prefix = string.IsNullOrWhiteSpace(auth.OAuth2HeaderPrefix) ? string.Empty : auth.OAuth2HeaderPrefix.Trim() + " ";
                AddIfMissing(message, "Authorization", prefix + auth.OAuth2AccessToken.Trim());
                break;

            case AuthType.ApiKey when auth.ApiKeyIn == ApiKeyLocation.Header && !string.IsNullOrWhiteSpace(auth.ApiKeyName):
                AddIfMissing(message, auth.ApiKeyName.Trim(), auth.ApiKeyValue);
                break;
        }
    }

    private static void AddIfMissing(HttpRequestMessage message, string name, string value)
    {
        if (!message.Headers.Contains(name))
        {
            message.Headers.TryAddWithoutValidation(name, value);
        }
    }
}
