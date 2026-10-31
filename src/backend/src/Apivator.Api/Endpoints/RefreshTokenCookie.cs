using Apivator.Application.Auth;

namespace Apivator.Api.Endpoints;

/// <summary>
/// Web istemcisi için refresh token httpOnly cookie'de taşınır; JavaScript erişemez.
/// Desktop ve CLI istemcileri aynı token'ı yanıt gövdesinden alıp gövdede geri gönderir.
/// </summary>
internal static class RefreshTokenCookie
{
    public const string Name = "apivator_rt";
    private const string Path = "/api/auth";

    public static void Set(HttpContext context, AuthResult result) =>
        context.Response.Cookies.Append(Name, result.RefreshToken, new CookieOptions
        {
            HttpOnly = true,
            Secure = context.Request.IsHttps,
            SameSite = SameSiteMode.Strict,
            Path = Path,
            Expires = result.RefreshTokenExpiresAt,
        });

    public static void Clear(HttpContext context) =>
        context.Response.Cookies.Delete(Name, new CookieOptions { Path = Path });

    public static string? Read(HttpContext context, RefreshRequest? body) =>
        string.IsNullOrWhiteSpace(body?.RefreshToken) ? context.Request.Cookies[Name] : body.RefreshToken;
}
