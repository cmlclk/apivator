using System.Security.Claims;
using System.Text.Encodings.Web;
using Apivator.Application.ApiKeys;
using Apivator.Application.Common.Localization;
using Apivator.Domain.Access;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Apivator.Api.Infrastructure;

/// <summary>
/// Kişisel API anahtarıyla kimlik doğrulama (CLI ve CI). Anahtar <c>Authorization: Bearer apv_…</c> ya da
/// <c>X-Api-Key</c> başlığında gelir. Anahtarla gelen istekler kısıtlıdır: bkz. <see cref="ApiKeyRestrictions"/>.
/// </summary>
internal sealed class ApiKeyAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IApiKeyService keys) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "ApiKey";
    public const string HeaderName = "X-Api-Key";

    /// <summary>"amr" (authentication method) claim değeri: isteğin API anahtarıyla geldiğini işaretler.</summary>
    public const string Method = "api_key";

    public static string? ReadKey(HttpRequest request)
    {
        if (request.Headers[HeaderName].ToString() is { Length: > 0 } header)
        {
            return header.Trim();
        }

        var authorization = request.Headers.Authorization.ToString();
        return authorization.StartsWith("Bearer " + ApiKey.TokenPrefix, StringComparison.Ordinal) ? authorization["Bearer ".Length..].Trim() : null;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (ReadKey(Request) is not { } secret)
        {
            return AuthenticateResult.NoResult();
        }

        var owner = await keys.AuthenticateAsync(secret, Context.RequestAborted);
        if (owner is null)
        {
            return AuthenticateResult.Fail(L.T("api_key.invalid", "API anahtarı geçersiz, iptal edilmiş ya da süresi dolmuş."));
        }

        var identity = new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, owner.UserId.ToString()),
                new Claim(JwtRegisteredClaimNames.Name, owner.DisplayName),
                new Claim(JwtRegisteredClaimNames.Amr, Method),
                new Claim("api_key_id", owner.KeyId.ToString()),
            ],
            SchemeName,
            JwtRegisteredClaimNames.Name,
            null);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }
}

/// <summary>
/// API anahtarı tam oturum değildir: yalnızca okuma (GET) ve çalıştırma raporu gönderme. Anahtar yönetimi,
/// hesap işlemleri ve canlı kanal anahtarla yapılamaz; anahtar sızarsa verilebilecek zarar sınırlı kalır.
/// </summary>
internal static class ApiKeyRestrictions
{
    public static IApplicationBuilder UseApiKeyRestrictions(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        if (context.User.FindFirst(JwtRegisteredClaimNames.Amr)?.Value == ApiKeyAuthenticationHandler.Method && !Allowed(context.Request))
        {
            await Results.Problem(
                    detail: L.T("api_key.restricted", "API anahtarıyla yalnızca okuma ve çalıştırma raporu gönderme yapılabilir."),
                    statusCode: StatusCodes.Status403Forbidden,
                    extensions: new Dictionary<string, object?> { ["code"] = "api_key.forbidden" })
                .ExecuteAsync(context);
            return;
        }

        await next(context);
    });

    private static bool Allowed(HttpRequest request)
    {
        var path = request.Path;
        if (path.StartsWithSegments("/api/me/api-keys") || path.StartsWithSegments("/hubs"))
        {
            return false;
        }

        // Denetim kaydı (IP, e-posta, cihaz) ve SSO ayarları sızan bir anahtarla okunamasın: yalnızca oturumla.
        if (path.StartsWithSegments("/api/organizations", StringComparison.OrdinalIgnoreCase, out var rest)
            && rest.Value is { } tail
            && (tail.Contains("/audit", StringComparison.OrdinalIgnoreCase) || tail.Contains("/sso", StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        return HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method)
            || (HttpMethods.IsPost(request.Method) && path.Equals("/api/runs/report", StringComparison.OrdinalIgnoreCase));
    }
}
