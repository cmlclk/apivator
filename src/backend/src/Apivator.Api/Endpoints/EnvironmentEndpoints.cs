using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Environments;

namespace Apivator.Api.Endpoints;

internal static class EnvironmentEndpoints
{
    public static void MapEnvironmentEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/").WithTags("Environments").RequireAuthorization();

        group.MapGet("/workspaces/{workspaceId:guid}/environments", async (Guid workspaceId, IEnvironmentService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.ListAsync(workspaceId, user.RequiredId, ct)));

        group.MapPost("/workspaces/{workspaceId:guid}/environments", async (Guid workspaceId, CreateEnvironmentRequest request, IEnvironmentService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.CreateAsync(workspaceId, request, user.RequiredId, ct);
            return result.IsSuccess ? Results.Json(result.Value, statusCode: StatusCodes.Status201Created) : result.Error!.ToProblem();
        });

        group.MapPut("/environments/{id:guid}", async (Guid id, UpdateEnvironmentRequest request, IEnvironmentService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.UpdateAsync(id, request, user.RequiredId, ct)));

        group.MapDelete("/environments/{id:guid}", async (Guid id, IEnvironmentService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DeleteAsync(id, user.RequiredId, ct)).ToHttp());

        group.MapGet("/workspaces/{workspaceId:guid}/globals", async (Guid workspaceId, IEnvironmentService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.GetGlobalsAsync(workspaceId, user.RequiredId, ct)));

        group.MapPut("/workspaces/{workspaceId:guid}/globals", async (Guid workspaceId, UpdateGlobalsRequest request, IEnvironmentService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.UpdateGlobalsAsync(workspaceId, request, user.RequiredId, ct)));
    }

    private static IResult Ok<T>(Result<T> result) =>
        result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
}
