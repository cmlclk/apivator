using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Apivator.Infrastructure.Execution;

/// <summary>
/// HTTP Digest (RFC 7616): sunucu 401 + WWW-Authenticate: Digest ile meydan okur; istemci aynı isteği hesaplanan
/// Authorization header'ıyla tekrar gönderir. MD5 ve SHA-256, qop=auth desteklenir.
/// </summary>
internal static partial class DigestAuth
{
    [GeneratedRegex("""(\w+)=(?:"([^"]*)"|([^\s,]+))""")]
    private static partial Regex Parameter();

    public static AuthenticationHeaderValue? Challenge(HttpResponseMessage response) =>
        response.Headers.WwwAuthenticate.FirstOrDefault(h => h.Scheme.Equals("Digest", StringComparison.OrdinalIgnoreCase));

    public static string Authorization(AuthenticationHeaderValue challenge, string method, Uri uri, string username, string password)
    {
        var values = Parameter().Matches(challenge.Parameter ?? string.Empty)
            .ToDictionary(m => m.Groups[1].Value.ToLowerInvariant(), m => m.Groups[2].Success ? m.Groups[2].Value : m.Groups[3].Value);
        var realm = values.GetValueOrDefault("realm", string.Empty);
        var nonce = values.GetValueOrDefault("nonce", string.Empty);
        var algorithm = values.GetValueOrDefault("algorithm", "MD5");
        var sha256 = algorithm.StartsWith("SHA-256", StringComparison.OrdinalIgnoreCase);
        var qop = values.TryGetValue("qop", out var q) && q.Split(',').Select(x => x.Trim()).Contains("auth") ? "auth" : null;
        var digestUri = uri.PathAndQuery;
        var cnonce = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(8));
        const string nc = "00000001";

        // Digest standardı MD5'i varsayılan olarak ister; güvenlik kararı karşı sunucunundur.
#pragma warning disable CA5351
        string H(string text) => Convert.ToHexStringLower(sha256 ? SHA256.HashData(Encoding.UTF8.GetBytes(text)) : MD5.HashData(Encoding.UTF8.GetBytes(text)));
#pragma warning restore CA5351

        var ha1 = H($"{username}:{realm}:{password}");
        if (algorithm.EndsWith("-sess", StringComparison.OrdinalIgnoreCase))
        {
            ha1 = H($"{ha1}:{nonce}:{cnonce}");
        }

        var ha2 = H($"{method}:{digestUri}");
        var response = qop is null ? H($"{ha1}:{nonce}:{ha2}") : H($"{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}");

        var header = new StringBuilder().Append(CultureInfo.InvariantCulture, $"Digest username=\"{username}\", realm=\"{realm}\", nonce=\"{nonce}\", uri=\"{digestUri}\", algorithm={algorithm}, response=\"{response}\"");
        if (qop is not null)
        {
            header.Append(CultureInfo.InvariantCulture, $", qop={qop}, nc={nc}, cnonce=\"{cnonce}\"");
        }

        if (values.TryGetValue("opaque", out var opaque))
        {
            header.Append(CultureInfo.InvariantCulture, $", opaque=\"{opaque}\"");
        }

        return header.ToString();
    }
}
