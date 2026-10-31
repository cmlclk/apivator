using System.Text.Json.Serialization;

namespace Apivator.Domain.Collections;

[JsonConverter(typeof(JsonStringEnumConverter<AuthType>))]
public enum AuthType
{
    /// <summary>Üstteki klasörün ya da collection'ın yetkilendirmesini kullan.</summary>
    Inherit,
    None,
    ApiKey,
    Bearer,
    Basic,
    /// <summary>HTTP Digest; kullanıcı adı/şifre Basic alanlarından okunur.</summary>
    Digest,
    OAuth2,
    AwsSigV4,
}

[JsonConverter(typeof(JsonStringEnumConverter<OAuth2GrantType>))]
public enum OAuth2GrantType
{
    ClientCredentials,
    Password,
    /// <summary>Tarayıcıda kullanıcı onayı; PKCE ile.</summary>
    AuthorizationCode,
}

[JsonConverter(typeof(JsonStringEnumConverter<OAuth2ClientAuthentication>))]
public enum OAuth2ClientAuthentication
{
    /// <summary>client_id/secret Authorization: Basic header'ında.</summary>
    Header,
    /// <summary>client_id/secret form gövdesinde.</summary>
    Body,
}

[JsonConverter(typeof(JsonStringEnumConverter<ApiKeyLocation>))]
public enum ApiKeyLocation
{
    Header,
    Query,
}

/// <summary>
/// İstek, klasör veya collection yetkilendirmesi. Tüm türlerin alanları tek kayıtta durur; tür değiştirilince
/// diğer türün girilmiş değerleri kaybolmaz (Postman'deki gibi).
/// </summary>
public sealed record RequestAuth
{
    public static readonly RequestAuth Inherit = new() { Type = AuthType.Inherit };
    public static readonly RequestAuth None = new() { Type = AuthType.None };

    public AuthType Type { get; init; } = AuthType.Inherit;

    public string ApiKeyName { get; init; } = string.Empty;

    public string ApiKeyValue { get; init; } = string.Empty;

    public ApiKeyLocation ApiKeyIn { get; init; } = ApiKeyLocation.Header;

    public string BearerToken { get; init; } = string.Empty;

    public string BasicUsername { get; init; } = string.Empty;

    public string BasicPassword { get; init; } = string.Empty;

    public OAuth2GrantType OAuth2GrantType { get; init; } = OAuth2GrantType.ClientCredentials;

    public string OAuth2AuthUrl { get; init; } = string.Empty;

    public string OAuth2TokenUrl { get; init; } = string.Empty;

    public string OAuth2ClientId { get; init; } = string.Empty;

    public string OAuth2ClientSecret { get; init; } = string.Empty;

    public string OAuth2Scope { get; init; } = string.Empty;

    public string OAuth2Audience { get; init; } = string.Empty;

    /// <summary>Password akışı için.</summary>
    public string OAuth2Username { get; init; } = string.Empty;

    public string OAuth2Password { get; init; } = string.Empty;

    /// <summary>Boşsa uygulamanın kendi geri dönüş adresi kullanılır.</summary>
    public string OAuth2RedirectUri { get; init; } = string.Empty;

    public OAuth2ClientAuthentication OAuth2ClientAuthentication { get; init; } = OAuth2ClientAuthentication.Header;

    public string OAuth2HeaderPrefix { get; init; } = "Bearer";

    /// <summary>
    /// Kullanılacak token. Kaydedilmez gibi düşünülmeli: istemci yalnızca gönderimde, kendi sakladığı token'ı
    /// buraya koyar. Boşsa client credentials / password akışlarında sunucu token'ı kendisi alır.
    /// </summary>
    public string OAuth2AccessToken { get; init; } = string.Empty;

    public string AwsAccessKey { get; init; } = string.Empty;

    public string AwsSecretKey { get; init; } = string.Empty;

    public string AwsRegion { get; init; } = "us-east-1";

    public string AwsService { get; init; } = string.Empty;

    public string AwsSessionToken { get; init; } = string.Empty;

    /// <summary>
    /// Aynı OAuth 2.0 ayarlarını kullanan istekler token'ı paylaşır; anahtar istemcide de aynı kuralla üretilir.
    /// </summary>
    public string OAuth2Fingerprint => $"{OAuth2GrantType}|{OAuth2TokenUrl}|{OAuth2ClientId}|{OAuth2Scope}";

    /// <summary>Kayıtlı tanımda token tutulmaz (ekiple paylaşılmasın).</summary>
    public RequestAuth WithoutSecrets() => OAuth2AccessToken.Length == 0 ? this : this with { OAuth2AccessToken = string.Empty };
}
