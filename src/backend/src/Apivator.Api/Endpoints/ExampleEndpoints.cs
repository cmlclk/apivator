using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Examples;

namespace Apivator.Api.Endpoints;

internal static class ExampleEndpoints
{
    public static void MapExampleEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/").WithTags("Examples").RequireAuthorization();

        group.MapGet("/requests/{requestId:guid}/examples", async (Guid requestId, IExampleService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.ListAsync(requestId, user.RequiredId, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapPost("/requests/{requestId:guid}/examples", async (Guid requestId, CreateExampleRequest request, IExampleService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.CreateAsync(requestId, request, user.RequiredId, ct);
            return result.IsSuccess ? Results.Json(result.Value, statusCode: StatusCodes.Status201Created) : result.Error!.ToProblem();
        });

        group.MapGet("/examples/{id:guid}", async (Guid id, IExampleService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.GetAsync(id, user.RequiredId, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapPatch("/examples/{id:guid}", async (Guid id, UpdateExampleRequest request, IExampleService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.UpdateAsync(id, request, user.RequiredId, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapDelete("/examples/{id:guid}", async (Guid id, IExampleService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DeleteAsync(id, user.RequiredId, ct)).ToHttp());
    }
}
