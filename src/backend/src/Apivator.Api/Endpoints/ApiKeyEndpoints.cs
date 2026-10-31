using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.ApiKeys;

namespace Apivator.Api.Endpoints;

internal static class ApiKeyEndpoints
{
    public static void MapApiKeyEndpoints(this IEndpointRouteBuilder routes)
    {
        var keys = routes.MapGroup("/me/api-keys").WithTags("API keys").RequireAuthorization();

        keys.MapGet("/", async (IApiKeyService service, ICurrentUser user, CancellationToken ct) =>
            Results.Ok(await service.ListAsync(user.RequiredId, ct)));

        keys.MapPost("/", async (CreateApiKeyRequest request, IApiKeyService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.CreateAsync(request, user.RequiredId, ct);
            return result.IsSuccess ? Results.Json(result.Value, statusCode: StatusCodes.Status201Created) : result.Error!.ToProblem();
        });

        keys.MapDelete("/{id:guid}", async (Guid id, IApiKeyService service, ICurrentUser user, CancellationToken ct) =>
            (await service.RevokeAsync(id, user.RequiredId, ct)).ToHttp());
    }
}
