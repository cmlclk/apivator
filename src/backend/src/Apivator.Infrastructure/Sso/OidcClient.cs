using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Apivator.Application.Common.Localization;
using Apivator.Application.Sso;
using Apivator.Infrastructure.Execution;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Apivator.Infrastructure.Sso;

/// <summary>Kimlik sağlayıcıdan gelen ve doğrulanmış kimlik.</summary>
internal sealed record OidcIdentity(string Issuer, string Subject, string Email, string? Name);

internal sealed class OidcException(string code, string message, Exception? inner = null) : Exception(message, inner)
{
    public string Code { get; } = code;
}

/// <summary>
/// OIDC authorization code + PKCE akışının sunucu tarafı: keşif belgesi (önbellekli), token değişimi ve id_token
/// doğrulaması (imza, issuer, audience, süre, nonce). İstekler ağ korumalı istemciyle gider; özel ağlar
/// <c>Proxy:AllowedNetworks</c> ile açılmadıkça issuer olarak kullanılamaz (SSRF).
/// </summary>
internal sealed class OidcClient(IHttpClientFactory httpClients, IOptions<SsoOptions> options)
{
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);
    private static readonly ConcurrentDictionary<string, ConfigurationManager<OpenIdConnectConfiguration>> Managers = new(StringComparer.Ordinal);

    private HttpClient Http => httpClients.CreateClient(HttpRequestExecutor.HttpClientName);

    /// <summary>Issuer adresinin biçimini denetler (https; http yalnızca izin verilmişse).</summary>
    public string? ValidateAuthority(string authority)
    {
        if (!Uri.TryCreate(authority.Trim(), UriKind.Absolute, out var uri) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
        {
            return L.T("sso.issuer_absolute", "Issuer adresi geçerli bir mutlak adres olmalı (sorgu dizesi olmadan).");
        }

        return uri.Scheme == Uri.UriSchemeHttps || (uri.Scheme == Uri.UriSchemeHttp && options.Value.AllowInsecureAuthority)
            ? null
            : L.T("sso.issuer_https", "Issuer adresi https olmalı.");
    }

    public async Task<OpenIdConnectConfiguration> DiscoverAsync(string authority, CancellationToken ct, bool refresh = false)
    {
        var key = authority.TrimEnd('/');
        var manager = Managers.GetOrAdd(key, a => new ConfigurationManager<OpenIdConnectConfiguration>(
            a + "/.well-known/openid-configuration",
            new OpenIdConnectConfigurationRetriever(),
            new HttpDocumentRetriever(Http) { RequireHttps = !options.Value.AllowInsecureAuthority })
        {
            AutomaticRefreshInterval = TimeSpan.FromHours(12),
            RefreshInterval = TimeSpan.FromMinutes(1),
        });
        if (refresh)
        {
            manager.RequestRefresh();
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(RequestTimeout);
        try
        {
            var config = await manager.GetConfigurationAsync(timeout.Token);
            if (string.IsNullOrEmpty(config.AuthorizationEndpoint) || string.IsNullOrEmpty(config.TokenEndpoint) || string.IsNullOrEmpty(config.Issuer))
            {
                throw new OidcException("sso.discovery", L.T("sso.discovery_missing", "Keşif belgesinde authorization/token adresi ya da issuer yok."));
            }

            // OIDC Discovery 4.3: issuer, belgenin istendiği adresle aynı olmalı (Entra "common" gibi çok kiracılı
            // adresler bu yüzden kabul edilmez; kiracıya özel adres girilmeli).
            if (!string.Equals(config.Issuer.TrimEnd('/'), key, StringComparison.Ordinal))
            {
                throw new OidcException("sso.discovery", L.T("sso.discovery_issuer_mismatch", "Keşif belgesindeki issuer ({issuer}) girilen adresle aynı değil. Kiracıya özel issuer adresini girin.", ("issuer", config.Issuer)));
            }

            // Tarayıcı yetkilendirme adresine yönlendirilir: javascript: gibi şemalar ya da şifresiz adres kabul edilmez.
            if (!SafeEndpoint(config.AuthorizationEndpoint) || !SafeEndpoint(config.TokenEndpoint) || (config.JwksUri is { Length: > 0 } jwks && !SafeEndpoint(jwks)))
            {
                throw new OidcException("sso.discovery", L.T("sso.discovery_https", "Keşif belgesindeki adresler https olmalı."));
            }

            return config;
        }
        catch (OidcException)
        {
            // Hatalı belge düzeltilince hemen yeniden okunsun.
            Managers.TryRemove(key, out _);
            throw;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            // Hatalı adres bir sonraki denemede yeniden çekilsin diye önbellekten çıkar.
            Managers.TryRemove(key, out _);
            throw new OidcException("sso.discovery", L.T("sso.discovery_unreadable", "Kimlik sağlayıcının keşif belgesi okunamadı ({url}).", ("url", $"{key}/.well-known/openid-configuration")), ex);
        }
    }

    /// <summary>Kodu token'a çevirir ve id_token'ı doğrular.</summary>
    public async Task<OidcIdentity> RedeemAsync(
        string authority,
        string clientId,
        string? clientSecret,
        string code,
        string codeVerifier,
        string redirectUri,
        string nonce,
        CancellationToken ct)
    {
        var config = await DiscoverAsync(authority, ct);
        var form = new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = redirectUri,
            ["client_id"] = clientId,
            ["code_verifier"] = codeVerifier,
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, config.TokenEndpoint);
        if (!string.IsNullOrEmpty(clientSecret))
        {
            // Sağlayıcı client_secret_post desteklemiyorsa (ya da belirtmiyorsa) HTTP Basic kullanılır (RFC 6749 varsayılanı).
            if (config.TokenEndpointAuthMethodsSupported.Contains("client_secret_post") && !config.TokenEndpointAuthMethodsSupported.Contains("client_secret_basic"))
            {
                form["client_secret"] = clientSecret;
            }
            else
            {
                request.Headers.Authorization = new AuthenticationHeaderValue(
                    "Basic",
                    Convert.ToBase64String(Encoding.UTF8.GetBytes(Uri.EscapeDataString(clientId) + ":" + Uri.EscapeDataString(clientSecret))));
            }
        }

        request.Content = new FormUrlEncodedContent(form);
        request.Headers.Accept.ParseAdd("application/json");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(RequestTimeout);
        string? idToken;
        try
        {
            using var response = await Http.SendAsync(request, timeout.Token);
            var body = await response.Content.ReadAsStringAsync(timeout.Token);
            using var json = JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body);
            if (!response.IsSuccessStatusCode)
            {
                var error = json.RootElement.TryGetProperty("error_description", out var d) ? d.GetString()
                    : json.RootElement.TryGetProperty("error", out var e) ? e.GetString()
                    : $"HTTP {(int)response.StatusCode}";
                throw new OidcException("sso.token", L.T("sso.token_rejected", "Kimlik sağlayıcı kodu kabul etmedi: {error}", ("error", error)));
            }

            idToken = json.RootElement.TryGetProperty("id_token", out var t) ? t.GetString() : null;
        }
        catch (OidcException)
        {
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException or BlockedDestinationException)
        {
            throw new OidcException("sso.token", L.T("sso.token_unreachable", "Kimlik sağlayıcının token adresine ulaşılamadı."), ex);
        }

        if (string.IsNullOrEmpty(idToken))
        {
            throw new OidcException("sso.token", L.T("sso.no_id_token", "Kimlik sağlayıcı id_token döndürmedi (scope'ta openid olmalı)."));
        }

        var claims = await ValidateAsync(authority, config, clientId, idToken, ct);
        if (!string.Equals(Claim(claims, "nonce"), nonce, StringComparison.Ordinal))
        {
            throw new OidcException("sso.nonce", L.T("sso.nonce_mismatch", "Kimlik doğrulama yanıtı bu girişe ait değil (nonce uyuşmuyor)."));
        }

        // E-posta claim'i yoksa Entra ID'de genellikle preferred_username/upn kullanıcının adresidir.
        var email = Claim(claims, "email") ?? new[] { Claim(claims, "preferred_username"), Claim(claims, "upn") }.FirstOrDefault(v => v?.Contains('@', StringComparison.Ordinal) == true);
        if (string.IsNullOrWhiteSpace(email))
        {
            throw new OidcException("sso.no_email", L.T("sso.no_email", "Kimlik sağlayıcı e-posta adresi göndermedi (scope'ta email olmalı)."));
        }

        if (string.Equals(Claim(claims, "email_verified"), "false", StringComparison.OrdinalIgnoreCase))
        {
            throw new OidcException("sso.email_unverified", L.T("sso.email_unverified", "Kimlik sağlayıcıdaki e-posta adresi doğrulanmamış."));
        }

        var name = Claim(claims, "name")
            ?? string.Join(' ', new[] { Claim(claims, "given_name"), Claim(claims, "family_name") }.Where(v => !string.IsNullOrWhiteSpace(v)));
        return new OidcIdentity(config.Issuer, Claim(claims, "sub")!, email.Trim(), string.IsNullOrWhiteSpace(name) ? null : name.Trim());
    }

    private async Task<ClaimsIdentity> ValidateAsync(string authority, OpenIdConnectConfiguration config, string clientId, string idToken, CancellationToken ct)
    {
        var handler = new JsonWebTokenHandler { MapInboundClaims = false };
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var result = await handler.ValidateTokenAsync(idToken, new TokenValidationParameters
            {
                ValidIssuer = config.Issuer,
                ValidAudience = clientId,
                IssuerSigningKeys = config.SigningKeys,
                ValidateIssuerSigningKey = true,
                RequireSignedTokens = true,
                ValidAlgorithms = AllowedAlgorithms,
                RequireExpirationTime = true,
                ClockSkew = TimeSpan.FromMinutes(2),
            });
            if (result.IsValid && result.ClaimsIdentity.FindFirst("sub") is not null)
            {
                return result.ClaimsIdentity;
            }

            // Sağlayıcı anahtar döndürmüş olabilir: keşif belgesi bir kez tazelenip yeniden denenir.
            if (attempt == 0 && result.Exception is SecurityTokenSignatureKeyNotFoundException)
            {
                config = await DiscoverAsync(authority, ct, refresh: true);
                continue;
            }

            throw new OidcException("sso.id_token", L.T("sso.id_token_invalid", "Kimlik sağlayıcının gönderdiği kimlik doğrulanamadı."), result.Exception);
        }

        throw new OidcException("sso.id_token", L.T("sso.id_token_invalid", "Kimlik sağlayıcının gönderdiği kimlik doğrulanamadı."));
    }

    private static string? Claim(ClaimsIdentity identity, string type) => identity.FindFirst(type)?.Value;

    /// <summary>Yalnızca asimetrik imzalar: HS256 (client secret ile imza) ve none kabul edilmez.</summary>
    private static readonly string[] AllowedAlgorithms =
    [
        SecurityAlgorithms.RsaSha256, SecurityAlgorithms.RsaSha384, SecurityAlgorithms.RsaSha512,
        SecurityAlgorithms.RsaSsaPssSha256, SecurityAlgorithms.EcdsaSha256, SecurityAlgorithms.EcdsaSha384,
    ];

    private bool SafeEndpoint(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttps || (uri.Scheme == Uri.UriSchemeHttp && options.Value.AllowInsecureAuthority));
}
