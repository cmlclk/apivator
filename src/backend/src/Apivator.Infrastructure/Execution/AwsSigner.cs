using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Apivator.Domain.Collections;

namespace Apivator.Infrastructure.Execution;

/// <summary>AWS Signature Version 4 (header ile). https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html</summary>
internal static class AwsSigner
{
    private const string Algorithm = "AWS4-HMAC-SHA256";

    public static void Sign(HttpRequestMessage message, byte[] body, RequestAuth auth, DateTimeOffset now)
    {
        var uri = message.RequestUri!;
        var amzDate = now.UtcDateTime.ToString("yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture);
        var date = amzDate[..8];
        var region = string.IsNullOrWhiteSpace(auth.AwsRegion) ? "us-east-1" : auth.AwsRegion.Trim();
        var service = auth.AwsService.Trim();
        var payloadHash = Hex(SHA256.HashData(body));

        message.Headers.Remove("X-Amz-Date");
        message.Headers.TryAddWithoutValidation("X-Amz-Date", amzDate);
        if (!string.IsNullOrEmpty(auth.AwsSessionToken))
        {
            message.Headers.Remove("X-Amz-Security-Token");
            message.Headers.TryAddWithoutValidation("X-Amz-Security-Token", auth.AwsSessionToken);
        }

        // S3 gövde özetini header olarak ister; diğer servisler için gerekmez.
        if (service.Equals("s3", StringComparison.OrdinalIgnoreCase) && !message.Headers.Contains("X-Amz-Content-Sha256"))
        {
            message.Headers.TryAddWithoutValidation("X-Amz-Content-Sha256", payloadHash);
        }

        var headers = new SortedDictionary<string, string>(StringComparer.Ordinal)
        {
            ["host"] = uri.IsDefaultPort ? uri.Host : $"{uri.Host}:{uri.Port}",
        };
        foreach (var (headerName, values) in message.Headers.Concat(message.Content?.Headers ?? Enumerable.Empty<KeyValuePair<string, IEnumerable<string>>>()))
        {
            var name = headerName.ToLowerInvariant();
            if (name is "authorization" or "user-agent" or "accept" or "content-length" || name == "host")
            {
                continue;
            }

            headers[name] = string.Join(',', values.Select(v => string.Join(' ', v.Split(' ', StringSplitOptions.RemoveEmptyEntries))));
        }

        var signedHeaders = string.Join(';', headers.Keys);
        var canonicalRequest = string.Join('\n',
            message.Method.Method,
            CanonicalPath(uri, service),
            CanonicalQuery(uri),
            string.Concat(headers.Select(h => $"{h.Key}:{h.Value.Trim()}\n")),
            signedHeaders,
            payloadHash);

        var scope = $"{date}/{region}/{service}/aws4_request";
        var stringToSign = string.Join('\n', Algorithm, amzDate, scope, Hex(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalRequest))));

        var key = Hmac(Encoding.UTF8.GetBytes("AWS4" + auth.AwsSecretKey), date);
        key = Hmac(key, region);
        key = Hmac(key, service);
        key = Hmac(key, "aws4_request");
        var signature = Hex(Hmac(key, stringToSign));

        message.Headers.Remove("Authorization");
        message.Headers.TryAddWithoutValidation(
            "Authorization",
            $"{Algorithm} Credential={auth.AwsAccessKey}/{scope}, SignedHeaders={signedHeaders}, Signature={signature}");
    }

    private static string CanonicalPath(Uri uri, string service)
    {
        var path = uri.AbsolutePath;
        if (string.IsNullOrEmpty(path))
        {
            return "/";
        }

        // S3 dışındaki servislerde yol segmentleri iki kez kodlanır.
        var segments = path.Split('/').Select(s => Encode(Uri.UnescapeDataString(s)));
        var once = string.Join('/', segments);
        return service.Equals("s3", StringComparison.OrdinalIgnoreCase) ? once : string.Join('/', once.Split('/').Select(Encode));
    }

    private static string CanonicalQuery(Uri uri)
    {
        var query = uri.Query.TrimStart('?');
        if (query.Length == 0)
        {
            return string.Empty;
        }

        return string.Join('&', query
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(pair =>
            {
                var eq = pair.IndexOf('=', StringComparison.Ordinal);
                var key = eq < 0 ? pair : pair[..eq];
                var value = eq < 0 ? string.Empty : pair[(eq + 1)..];
                return (Key: Encode(Uri.UnescapeDataString(key.Replace('+', ' '))), Value: Encode(Uri.UnescapeDataString(value.Replace('+', ' '))));
            })
            .OrderBy(p => p.Key, StringComparer.Ordinal)
            .ThenBy(p => p.Value, StringComparer.Ordinal)
            .Select(p => $"{p.Key}={p.Value}"));
    }

    /// <summary>RFC 3986: harf, rakam, "-_.~" dışındaki her bayt %XX.</summary>
    private static string Encode(string value)
    {
        var builder = new StringBuilder();
        foreach (var b in Encoding.UTF8.GetBytes(value))
        {
            var c = (char)b;
            if (char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or '~')
            {
                builder.Append(c);
            }
            else
            {
                builder.Append('%').Append(b.ToString("X2", CultureInfo.InvariantCulture));
            }
        }

        return builder.ToString();
    }

    private static byte[] Hmac(byte[] key, string data) => HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(data));

    private static string Hex(byte[] bytes) => Convert.ToHexStringLower(bytes);
}
