using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Auth;

namespace Apivator.Api.Endpoints;

internal static class MeEndpoints
{
    public static void MapMeEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/me", async (IAuthService auth, ICurrentUser user, CancellationToken ct) =>
            {
                var result = await auth.GetUserAsync(user.RequiredId, ct);
                return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
            })
            .WithTags("Me")
            .RequireAuthorization();
    }
}
