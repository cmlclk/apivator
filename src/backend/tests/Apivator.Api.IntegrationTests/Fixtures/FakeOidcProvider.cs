using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Apivator.Api.IntegrationTests.Fixtures;

/// <summary>Kimlik sağlayıcının döndüreceği kişi.</summary>
/// <param name="EmailVerified">bool ya da (bazı sağlayıcılar gibi) "false" dizesi; null ise claim gönderilmez.</param>
public sealed record FakeOidcIdentity(string Subject, string? Email, string? Name = null, object? EmailVerified = null)
{
    public object? EmailVerified { get; init; } = EmailVerified ?? true;

    /// <summary>email_verified claim'i hiç gönderilmez (Entra ID gibi).</summary>
    public static readonly object Omitted = new();
}

/// <summary>id_token'ı bilerek bozmanın yolları (güvenlik testleri).</summary>
public enum IdTokenTamper
{
    None,
    WrongNonce,
    ForeignKey,
    WrongAudience,
    WrongIssuer,
    Expired,

    /// <summary>RS256 yerine client secret'la HS256 imzalı (algoritma karıştırma saldırısı).</summary>
    HmacSigned,

    /// <summary>İmzasız token (alg: none).</summary>
    NoSignature,

    /// <summary>sub claim'i yok.</summary>
    NoSubject,
}

/// <summary>
/// Testler için gerçek bir OIDC kimlik sağlayıcısı (127.0.0.1, rastgele port): keşif belgesi, JWKS ve token adresi.
/// Tarayıcıdaki "giriş ekranı" yerine test <see cref="Authorize"/> ile kod üretir; token adresi kodu, PKCE
/// doğrulayıcısını, client kimlik bilgisini ve redirect_uri'yi denetler, RS256 imzalı id_token döner.
/// </summary>
public sealed class FakeOidcProvider : IAsyncLifetime, IDisposable
{
    private const string KeyId = "test-anahtar-1";

    private readonly RSA _key = RSA.Create(2048);
    private readonly RSA _foreignKey = RSA.Create(2048);
    private readonly ConcurrentDictionary<string, Grant> _codes = new(StringComparer.Ordinal);
    private WebApplication? _app;
    private int _tokenRequests;

    public string ClientId { get; } = "apivator-istemci";

    /// <summary>HS256 saldırısında anahtar olarak da kullanılır; bu yüzden en az 32 bayt.</summary>
    public string ClientSecret { get; } = "cok-gizli-istemci-secret-0123456789";

    /// <summary>Keşif belgesinde ve id_token'da ilan edilen issuer; null ise <see cref="BaseUrl"/>.</summary>
    public string? AdvertisedIssuer { get; set; }

    private string Issuer => AdvertisedIssuer ?? BaseUrl;

    /// <summary>Keşif belgesindeki adresleri değiştirir (ör. javascript: ya da ftp:); null ise gerçek adresler.</summary>
    public string? AdvertisedAuthorizationEndpoint { get; set; }

    public string? AdvertisedTokenEndpoint { get; set; }

    public string? AdvertisedJwksUri { get; set; }

    /// <summary>Issuer ve authority (sonda / yok).</summary>
    public string BaseUrl { get; private set; } = string.Empty;

    public int TokenRequests => _tokenRequests;

    /// <summary>Son token isteğinde client'ın kendini nasıl tanıttığı: "basic", "post" ya da "none".</summary>
    public string? LastClientAuth { get; private set; }

    /// <summary>Token adresinin reddettiği isteklerin nedenleri (teşhis için).</summary>
    public ConcurrentQueue<string> Rejections { get; } = new();

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        _app = builder.Build();

        _app.MapGet("/.well-known/openid-configuration", () => Results.Json(new Dictionary<string, object>
        {
            ["issuer"] = Issuer,
            ["authorization_endpoint"] = AdvertisedAuthorizationEndpoint ?? BaseUrl + "/authorize",
            ["token_endpoint"] = AdvertisedTokenEndpoint ?? BaseUrl + "/token",
            ["jwks_uri"] = AdvertisedJwksUri ?? BaseUrl + "/jwks",
            ["response_types_supported"] = new[] { "code" },
            ["subject_types_supported"] = new[] { "public" },
            ["id_token_signing_alg_values_supported"] = new[] { "RS256" },
            ["scopes_supported"] = new[] { "openid", "email", "profile" },
            ["token_endpoint_auth_methods_supported"] = new[] { "client_secret_basic", "client_secret_post" },
            ["code_challenge_methods_supported"] = new[] { "S256" },
        }));
        _app.MapGet("/jwks", () =>
        {
            var parameters = _key.ExportParameters(false);
            return Results.Json(new Dictionary<string, object>
            {
                ["keys"] = new[]
                {
                    new Dictionary<string, string>
                    {
                        ["kty"] = "RSA",
                        ["use"] = "sig",
                        ["alg"] = "RS256",
                        ["kid"] = KeyId,
                        ["n"] = Base64UrlEncoder.Encode(parameters.Modulus),
                        ["e"] = Base64UrlEncoder.Encode(parameters.Exponent),
                    },
                },
            });
        });
        _app.MapGet("/authorize", () => Results.Text("Testlerde bu sayfa yerine FakeOidcProvider.Authorize kullanılır."));
        // HttpContext tek parametre olursa RequestDelegate sayılır ve dönen IResult yazılmaz.
        _app.MapPost("/token", (HttpRequest request) => TokenAsync(request.HttpContext));

        await _app.StartAsync();
        BaseUrl = _app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First().TrimEnd('/');
    }

    /// <summary>
    /// Kullanıcının sağlayıcıda giriş yapıp izin verdiğini taklit eder: yetkilendirme adresindeki parametrelere
    /// bağlı bir kod üretir. Uygulama bu kodu dönüşte token adresine götürür.
    /// </summary>
    public string Authorize(string authorizationUrl, FakeOidcIdentity identity, IdTokenTamper tamper = IdTokenTamper.None)
    {
        var uri = new Uri(authorizationUrl);
        Assert.Equal(BaseUrl + "/authorize", uri.GetLeftPart(UriPartial.Path));
        var query = QueryHelpers.ParseQuery(uri.Query);
        Assert.Equal("code", query["response_type"].ToString());
        Assert.Equal(ClientId, query["client_id"].ToString());
        Assert.Equal("S256", query["code_challenge_method"].ToString());
        Assert.Contains("openid", query["scope"].ToString().Split(' '));

        var code = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(24));
        _codes[code] = new Grant(query["redirect_uri"].ToString(), query["code_challenge"].ToString(), query["nonce"].ToString(), identity, tamper);
        return code;
    }

    private async Task<IResult> TokenAsync(HttpContext context)
    {
        Interlocked.Increment(ref _tokenRequests);
        var form = await context.Request.ReadFormAsync();
        string? clientId = form["client_id"], secret = form["client_secret"];
        var header = context.Request.Headers.Authorization.ToString();
        if (header.StartsWith("Basic ", StringComparison.Ordinal))
        {
            var pair = Encoding.UTF8.GetString(Convert.FromBase64String(header[6..])).Split(':', 2);
            (clientId, secret) = (Uri.UnescapeDataString(pair[0]), Uri.UnescapeDataString(pair[1]));
            LastClientAuth = "basic";
        }
        else
        {
            LastClientAuth = string.IsNullOrEmpty(secret) ? "none" : "post";
        }

        if (clientId != ClientId || secret != ClientSecret)
        {
            return Reject("invalid_client", "İstemci tanınmadı.", 401);
        }

        if (form["grant_type"] != "authorization_code" || !_codes.TryRemove(form["code"].ToString(), out var grant))
        {
            return Reject("invalid_grant", "Kod geçersiz ya da kullanılmış.");
        }

        if (form["redirect_uri"] != grant.RedirectUri)
        {
            return Reject("invalid_grant", "redirect_uri uyuşmuyor.");
        }

        var verifier = form["code_verifier"].ToString();
        if (verifier.Length < 43 || WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))) != grant.CodeChallenge)
        {
            return Reject("invalid_grant", "PKCE doğrulayıcısı uyuşmuyor.");
        }

        return Results.Json(new Dictionary<string, object>
        {
            ["access_token"] = "idp-erisim-tokeni",
            ["token_type"] = "Bearer",
            ["expires_in"] = 3600,
            ["id_token"] = IdToken(grant),
        });
    }

    private IResult Reject(string error, string description, int status = 400)
    {
        Rejections.Enqueue(description);
        return Results.Json(new Dictionary<string, string> { ["error"] = error, ["error_description"] = description }, statusCode: status);
    }

    private string IdToken(Grant grant)
    {
        var now = DateTime.UtcNow;
        var expired = grant.Tamper == IdTokenTamper.Expired;
        var claims = new Dictionary<string, object>
        {
            ["nonce"] = grant.Tamper == IdTokenTamper.WrongNonce ? "baska-bir-nonce" : grant.Nonce,
        };
        if (grant.Tamper != IdTokenTamper.NoSubject)
        {
            claims["sub"] = grant.Identity.Subject;
        }

        if (grant.Identity.Email is not null)
        {
            claims["email"] = grant.Identity.Email;
        }

        if (grant.Identity.EmailVerified is { } verified && verified != FakeOidcIdentity.Omitted)
        {
            claims["email_verified"] = verified;
        }

        if (grant.Identity.Name is not null)
        {
            claims["name"] = grant.Identity.Name;
        }

        var credentials = grant.Tamper == IdTokenTamper.NoSignature ? null
            : grant.Tamper == IdTokenTamper.HmacSigned
            ? new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(ClientSecret)) { KeyId = KeyId }, SecurityAlgorithms.HmacSha256)
            : new SigningCredentials(new RsaSecurityKey(grant.Tamper == IdTokenTamper.ForeignKey ? _foreignKey : _key) { KeyId = KeyId }, SecurityAlgorithms.RsaSha256);
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = grant.Tamper == IdTokenTamper.WrongIssuer ? "https://sahte-issuer.example" : Issuer,
            Audience = grant.Tamper == IdTokenTamper.WrongAudience ? "baska-istemci" : ClientId,
            IssuedAt = expired ? now.AddMinutes(-30) : now,
            NotBefore = expired ? now.AddMinutes(-30) : now.AddSeconds(-5),
            Expires = expired ? now.AddMinutes(-10) : now.AddMinutes(5),
            Claims = claims,
            SigningCredentials = credentials,
        });
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            await _app.DisposeAsync();
        }

        Dispose();
    }

    public void Dispose()
    {
        _key.Dispose();
        _foreignKey.Dispose();
    }

    private sealed record Grant(string RedirectUri, string CodeChallenge, string Nonce, FakeOidcIdentity Identity, IdTokenTamper Tamper);
}
