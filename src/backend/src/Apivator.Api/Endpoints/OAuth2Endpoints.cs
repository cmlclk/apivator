using Apivator.Api.Infrastructure;
using Apivator.Application.Execution;

namespace Apivator.Api.Endpoints;

internal static class OAuth2Endpoints
{
    public static void MapOAuth2Endpoints(this IEndpointRouteBuilder routes)
    {
        // Token isteği sunucudan gider: tarayıcının CORS kısıtına takılmaz, SSRF korumasından geçer.
        routes.MapPost("/oauth2/token", async (OAuth2TokenRequest request, IOAuth2TokenService service, CancellationToken ct) =>
            {
                var result = await service.RequestAsync(request, ct);
                return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
            })
            .WithTags("OAuth 2.0")
            .RequireAuthorization()
            .RequireRateLimiting(RateLimitPolicies.Execute);
    }
}
