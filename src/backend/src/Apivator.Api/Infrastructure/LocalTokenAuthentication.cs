using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Apivator.Infrastructure.Identity;
using Apivator.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Apivator.Api.Infrastructure;

/// <summary>
/// Yerel modda kimlik doğrulama: masaüstü uygulamasının her açılışta ürettiği token (<c>LocalMode:Token</c>)
/// <c>Authorization: Bearer …</c> başlığında gelir (WebSocket köprülerinde <c>access_token</c> sorgusunda). Doğru
/// token'la gelen her istek <see cref="LocalUser"/> adına çalışır.
/// </summary>
internal sealed class LocalTokenAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    IConfiguration configuration,
    IMemoryCache cache,
    AppDbContext db) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "LocalToken";

    private const string DisplayNameCacheKey = "local-mode:display-name";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (ReadToken(Request) is not { } token)
        {
            return AuthenticateResult.NoResult();
        }

        var expected = Encoding.UTF8.GetBytes(configuration["LocalMode:Token"] ?? string.Empty);
        if (expected.Length == 0 || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(token), expected))
        {
            return AuthenticateResult.Fail("Token geçersiz.");
        }

        // Ad değişiklik kayıtlarında görünür; profil adı değişince bir dakika içinde yansır.
        var displayName = await cache.GetOrCreateAsync(DisplayNameCacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(1);
            return await db.Users.Where(u => u.Id == LocalUser.Id).Select(u => u.DisplayName).FirstOrDefaultAsync(Context.RequestAborted);
        }) ?? string.Empty;

        var identity = new ClaimsIdentity(
            [
                new Claim(JwtRegisteredClaimNames.Sub, LocalUser.Id.ToString()),
                new Claim(JwtRegisteredClaimNames.Name, displayName),
            ],
            SchemeName,
            JwtRegisteredClaimNames.Name,
            null);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }

    private static string? ReadToken(HttpRequest request)
    {
        var authorization = request.Headers.Authorization.ToString();
        if (authorization.StartsWith("Bearer ", StringComparison.Ordinal))
        {
            return authorization["Bearer ".Length..].Trim();
        }

        // WebSocket başlık taşıyamaz (JWT'deki gibi yalnızca /hubs altında).
        return request.Path.StartsWithSegments("/hubs") && request.Query["access_token"].ToString() is { Length: > 0 } query ? query : null;
    }
}
