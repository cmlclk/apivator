using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Domain.Collections;
using Microsoft.Extensions.Caching.Memory;

namespace Apivator.Application.Execution;

/// <summary>
/// Token isteği. <see cref="Auth"/> değişkenleri çözülmüş OAuth 2.0 ayarlarıdır. Authorization code akışında
/// <see cref="Code"/> + <see cref="CodeVerifier"/> + <see cref="RedirectUri"/>, yenilemede <see cref="RefreshToken"/>.
/// </summary>
public sealed record OAuth2TokenRequest(
    RequestAuth Auth,
    string? Code = null,
    string? CodeVerifier = null,
    string? RedirectUri = null,
    string? RefreshToken = null);

public sealed record OAuth2TokenDto(
    string AccessToken,
    string? RefreshToken,
    string TokenType,
    int? ExpiresIn,
    string? Scope);

public interface IOAuth2TokenService
{
    /// <summary>Token uç noktasından yeni token alır (kullanıcı "Token al" dediğinde).</summary>
    Task<Result<OAuth2TokenDto>> RequestAsync(OAuth2TokenRequest request, CancellationToken ct = default);

    /// <summary>
    /// Client credentials / password akışlarında istek gönderilirken kullanılır: önbellekte geçerli token varsa onu,
    /// yoksa yenisini alır. Önbellek kullanıcıya ve ayarların tamamına göre ayrılır.
    /// </summary>
    Task<Result<string>> GetForRequestAsync(RequestAuth auth, CancellationToken ct = default);
}

internal sealed class OAuth2TokenService(IRequestExecutor executor, IMemoryCache cache, ICurrentUser user) : IOAuth2TokenService
{
    private static readonly TimeSpan DefaultLifetime = TimeSpan.FromMinutes(10);

    public async Task<Result<string>> GetForRequestAsync(RequestAuth auth, CancellationToken ct = default)
    {
        if (auth.OAuth2GrantType == OAuth2GrantType.AuthorizationCode)
        {
            return Error.Validation(
                "oauth2_token_required",
                L.T("oauth2_token_required", "Bu istek OAuth 2.0 (authorization code) kullanıyor; önce Authorization sekmesinden \"Token al\" ile giriş yapın."));
        }

        var key = CacheKey(auth);
        if (cache.TryGetValue(key, out string? cached) && cached is not null)
        {
            return cached;
        }

        var result = await RequestAsync(new OAuth2TokenRequest(auth), ct);
        if (!result.IsSuccess)
        {
            return result.Error!;
        }

        var token = result.Value!;
        // Süre bitmeden biraz önce yenilensin.
        var lifetime = token.ExpiresIn is > 60 ? TimeSpan.FromSeconds(token.ExpiresIn.Value - 30) : DefaultLifetime;
        cache.Set(key, token.AccessToken, lifetime);
        return token.AccessToken;
    }

    public async Task<Result<OAuth2TokenDto>> RequestAsync(OAuth2TokenRequest request, CancellationToken ct = default)
    {
        var auth = request.Auth;
        if (!Uri.TryCreate(auth.OAuth2TokenUrl?.Trim(), UriKind.Absolute, out var tokenUrl) || tokenUrl.Scheme is not ("http" or "https"))
        {
            return Error.Validation("oauth2_invalid", L.T("oauth2.token_url_invalid", "Geçerli bir token adresi (Access Token URL) girin."));
        }

        var form = new List<KeyValueItem>();
        void Add(string key, string? value)
        {
            if (!string.IsNullOrEmpty(value))
            {
                form.Add(new KeyValueItem(key, value));
            }
        }

        if (request.RefreshToken is { Length: > 0 } refresh)
        {
            Add("grant_type", "refresh_token");
            Add("refresh_token", refresh);
        }
        else
        {
            switch (auth.OAuth2GrantType)
            {
                case OAuth2GrantType.ClientCredentials:
                    Add("grant_type", "client_credentials");
                    break;
                case OAuth2GrantType.Password:
                    Add("grant_type", "password");
                    Add("username", auth.OAuth2Username);
                    Add("password", auth.OAuth2Password);
                    break;
                case OAuth2GrantType.AuthorizationCode:
                    if (string.IsNullOrEmpty(request.Code))
                    {
                        return Error.Validation("oauth2_invalid", L.T("oauth2.code_missing", "Yetki kodu (code) eksik."));
                    }

                    Add("grant_type", "authorization_code");
                    Add("code", request.Code);
                    Add("redirect_uri", request.RedirectUri);
                    Add("code_verifier", request.CodeVerifier);
                    break;
            }
        }

        if (request.RefreshToken is null)
        {
            Add("scope", auth.OAuth2Scope);
            Add("audience", auth.OAuth2Audience);
        }

        var headers = new List<KeyValueItem> { new("Accept", "application/json") };
        if (auth.OAuth2ClientAuthentication == OAuth2ClientAuthentication.Header && auth.OAuth2ClientSecret.Length > 0)
        {
            var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes(
                $"{Uri.EscapeDataString(auth.OAuth2ClientId)}:{Uri.EscapeDataString(auth.OAuth2ClientSecret)}"));
            headers.Add(new KeyValueItem("Authorization", $"Basic {credentials}"));
        }
        else
        {
            Add("client_id", auth.OAuth2ClientId);
            Add("client_secret", auth.OAuth2ClientSecret);
        }

        // Normal isteklerle aynı yol: SSRF koruması ve zaman aşımı geçerli.
        var response = await executor.ExecuteAsync(
            new ExecuteHttpRequest("POST", tokenUrl.ToString(), headers, new RequestBody { Mode = BodyMode.UrlEncoded, Form = form }),
            ct);
        if (response.Error is { } error)
        {
            return Error.Validation("oauth2_token_error", L.T("oauth2.token_unreachable", "Token adresine ulaşılamadı: {error}", ("error", error.Message)));
        }

        var values = Parse(response.Body);
        if (response.Status is not (>= 200 and < 300) || !values.TryGetValue("access_token", out var accessToken) || string.IsNullOrEmpty(accessToken))
        {
            var reason = values.TryGetValue("error_description", out var description) ? description
                : values.TryGetValue("error", out var code) ? code
                : response.Body.Length > 300 ? response.Body[..300] : response.Body;
            return Error.Validation("oauth2_token_error", L.T("oauth2.token_failed", "Token alınamadı ({status}): {reason}", ("status", response.Status), ("reason", reason)));
        }

        return new OAuth2TokenDto(
            accessToken,
            values.GetValueOrDefault("refresh_token"),
            values.GetValueOrDefault("token_type") ?? "Bearer",
            int.TryParse(values.GetValueOrDefault("expires_in"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var expires) ? expires : null,
            values.GetValueOrDefault("scope"));
    }

    /// <summary>Yanıt JSON ya da (GitHub gibi) form biçiminde olabilir.</summary>
    private static Dictionary<string, string> Parse(string body)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.ValueKind == JsonValueKind.Object)
            {
                foreach (var property in document.RootElement.EnumerateObject())
                {
                    result[property.Name] = property.Value.ValueKind == JsonValueKind.String ? property.Value.GetString()! : property.Value.GetRawText();
                }
            }

            return result;
        }
        catch (JsonException)
        {
            foreach (var pair in body.Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var eq = pair.IndexOf('=', StringComparison.Ordinal);
                if (eq > 0)
                {
                    result[Uri.UnescapeDataString(pair[..eq])] = Uri.UnescapeDataString(pair[(eq + 1)..].Replace('+', ' '));
                }
            }

            return result;
        }
    }

    private string CacheKey(RequestAuth auth)
    {
        var material = string.Join('\n', user.Id, auth.OAuth2GrantType, auth.OAuth2TokenUrl, auth.OAuth2ClientId, auth.OAuth2ClientSecret,
            auth.OAuth2Scope, auth.OAuth2Audience, auth.OAuth2Username, auth.OAuth2Password, auth.OAuth2ClientAuthentication);
        return "oauth2:" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(material)));
    }
}
