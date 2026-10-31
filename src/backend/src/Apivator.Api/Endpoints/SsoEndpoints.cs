using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Sso;

namespace Apivator.Api.Endpoints;

internal static class SsoEndpoints
{
    public static void MapSsoEndpoints(this IEndpointRouteBuilder routes)
    {
        // Giriş: keşif, kimlik sağlayıcıya yönlendirme, dönüş ve tek kullanımlık kodla oturum.
        var login = routes.MapGroup("/auth/sso").WithTags("SSO").RequireRateLimiting(RateLimitPolicies.Auth);

        login.MapGet("/discover", async (string? email, ISsoLoginService service, CancellationToken ct) =>
            Results.Ok(await service.DiscoverAsync(email ?? string.Empty, ct)));

        login.MapPost("/start", async (SsoStartRequest request, ISsoLoginService service, CancellationToken ct) =>
            Ok(await service.StartAsync(request, ct)));

        // Kimlik sağlayıcının döndüğü adres (IdP'ye kaydedilen redirect URI). Her durumda istemciye yönlendirir.
        login.MapGet("/callback", async (string? code, string? state, string? error, ISsoLoginService service, HttpContext http, CancellationToken ct) =>
            Results.Redirect(await service.CallbackAsync(code, state, error, ClientInfoReader.From(http), ct)));

        login.MapPost("/exchange", async (SsoExchangeRequest request, ISsoLoginService service, HttpContext http, CancellationToken ct) =>
        {
            var result = await service.ExchangeAsync(request, ClientInfoReader.From(http), ct);
            if (!result.IsSuccess)
            {
                return result.Error!.ToProblem();
            }

            RefreshTokenCookie.Set(http, result.Value);
            return Results.Ok(result.Value);
        });

        // E-postadaki bağlantı: mevcut hesabın SSO kimliğine bağlanmasını onaylar (oturum açmaz; ardından SSO ile girilir).
        login.MapPost("/link", async (SsoLinkConfirmRequest request, ISsoLoginService service, HttpContext http, CancellationToken ct) =>
            (await service.ConfirmLinkAsync(request.Token, ClientInfoReader.From(http), ct)).ToHttp());

        // Yönetim: okuma sahip/yönetici, değiştirme yalnızca sahip.
        var admin = routes.MapGroup("/organizations/{id:guid}/sso").WithTags("SSO").RequireAuthorization();

        admin.MapGet("/", async (Guid id, ISsoAdminService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.GetAsync(id, user.RequiredId, ct)));

        admin.MapPut("/", async (Guid id, UpdateSsoRequest request, ISsoAdminService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.UpdateAsync(id, request, user.RequiredId, ct)));

        admin.MapPut("/state", async (Guid id, SsoStateRequest request, ISsoAdminService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.SetStateAsync(id, request, user.RequiredId, ct)));

        admin.MapPost("/domains", async (Guid id, AddSsoDomainRequest request, ISsoAdminService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.AddDomainAsync(id, request, user.RequiredId, ct)));

        admin.MapPost("/domains/{domainId:guid}/verify", async (Guid id, Guid domainId, ISsoAdminService service, ICurrentUser user, CancellationToken ct) =>
                Ok(await service.VerifyDomainAsync(id, domainId, user.RequiredId, ct)))
            .RequireRateLimiting(RateLimitPolicies.Runs);

        admin.MapDelete("/domains/{domainId:guid}", async (Guid id, Guid domainId, ISsoAdminService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.RemoveDomainAsync(id, domainId, user.RequiredId, ct)));
    }

    private static IResult Ok<T>(Result<T> result) => result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
}
