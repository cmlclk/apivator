using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.History;

namespace Apivator.Api.Endpoints;

internal static class HistoryEndpoints
{
    public static void MapHistoryEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/").WithTags("History").RequireAuthorization();

        group.MapGet("/workspaces/{workspaceId:guid}/history", async (Guid workspaceId, DateTimeOffset? before, int? limit, IHistoryService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.ListAsync(workspaceId, user.RequiredId, before, limit ?? 100, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapGet("/history/{id:guid}/response", async (Guid id, IHistoryService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.GetResponseAsync(id, user.RequiredId, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapPost("/workspaces/{workspaceId:guid}/history", async (Guid workspaceId, RecordHistoryRequest request, IHistoryService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.RecordAsync(workspaceId, request, user.RequiredId, ct);
            return result.IsSuccess ? Results.Json(result.Value, statusCode: StatusCodes.Status201Created) : result.Error!.ToProblem();
        });

        group.MapDelete("/workspaces/{workspaceId:guid}/history", async (Guid workspaceId, IHistoryService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ClearAsync(workspaceId, user.RequiredId, ct)).ToHttp());

        group.MapDelete("/history/{id:guid}", async (Guid id, IHistoryService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DeleteAsync(id, user.RequiredId, ct)).ToHttp());
    }
}
