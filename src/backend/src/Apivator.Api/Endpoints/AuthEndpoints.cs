using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Application.Auth;
using Apivator.Application.Common;

namespace Apivator.Api.Endpoints;

internal static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/auth").WithTags("Auth").RequireRateLimiting(RateLimitPolicies.Auth);

        // Oturum yenileme her sayfa açılışında çalışır ve tahmin edilemeyen bir token ister; bir ofisin tüm
        // ekibi aynı IP'den gelebileceği için giriş denemelerinin sıkı sınırına bağlanmaz.
        var session = routes.MapGroup("/auth").WithTags("Auth").RequireRateLimiting(RateLimitPolicies.Session);

        group.MapPost("/register", async (RegisterRequest request, IAuthService auth, HttpContext http, CancellationToken ct) =>
            Respond(await auth.RegisterAsync(request, ClientInfoReader.From(http), ct), http, StatusCodes.Status201Created));

        // İki adımlı doğrulama açıksa oturum yerine { twoFactorRequired, challengeToken } döner.
        group.MapPost("/login", async (LoginRequest request, IAuthService auth, HttpContext http, CancellationToken ct) =>
        {
            var result = await auth.LoginAsync(request, ClientInfoReader.From(http), ct);
            if (!result.IsSuccess)
            {
                return result.Error!.ToProblem();
            }

            return result.Value.Challenge is { } challenge
                ? Results.Ok(challenge)
                : Respond(result.Value.Auth!, http, StatusCodes.Status200OK);
        });

        group.MapPost("/login/2fa", async (TwoFactorLoginRequest request, IAuthService auth, HttpContext http, CancellationToken ct) =>
            Respond(await auth.LoginTwoFactorAsync(request, ClientInfoReader.From(http), ct), http, StatusCodes.Status200OK));

        session.MapPost("/refresh", async (RefreshRequest? request, IAuthService auth, HttpContext http, CancellationToken ct) =>
        {
            var result = await auth.RefreshAsync(RefreshTokenCookie.Read(http, request) ?? string.Empty, ClientInfoReader.From(http), ct);
            if (!result.IsSuccess)
            {
                RefreshTokenCookie.Clear(http);
            }

            return Respond(result, http, StatusCodes.Status200OK);
        });

        session.MapPost("/logout", async (RefreshRequest? request, IAuthService auth, HttpContext http, CancellationToken ct) =>
        {
            await auth.LogoutAsync(RefreshTokenCookie.Read(http, request) ?? string.Empty, ct);
            RefreshTokenCookie.Clear(http);
            return Results.NoContent();
        });

        group.MapPost("/confirm-email", async (ConfirmEmailRequest request, IAuthService auth, CancellationToken ct) =>
            (await auth.ConfirmEmailAsync(request, ct)).ToHttp());

        group.MapPost("/resend-confirmation", async (IAuthService auth, ICurrentUser user, CancellationToken ct) =>
            (await auth.ResendConfirmationAsync(user.RequiredId, ct)).ToHttp())
            .RequireAuthorization();

        group.MapPost("/forgot-password", async (ForgotPasswordRequest request, IAuthService auth, CancellationToken ct) =>
        {
            await auth.ForgotPasswordAsync(request, ct);
            return Results.Accepted();
        });

        group.MapPost("/reset-password", async (ResetPasswordRequest request, IAuthService auth, CancellationToken ct) =>
            (await auth.ResetPasswordAsync(request, ct)).ToHttp());
    }

    private static IResult Respond(Result<AuthResult> result, HttpContext http, int successStatus)
    {
        if (!result.IsSuccess)
        {
            return result.Error!.ToProblem();
        }

        RefreshTokenCookie.Set(http, result.Value);
        return Results.Json(result.Value, statusCode: successStatus);
    }
}
