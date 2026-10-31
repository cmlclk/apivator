using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Forks;
using Apivator.Domain.Forks;

namespace Apivator.Api.Endpoints;

internal static class ForkEndpoints
{
    public static void MapForkEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/").WithTags("Forks").RequireAuthorization();

        group.MapPost("/collections/{id:guid}/forks", async (Guid id, CreateForkRequest request, IForkService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.CreateAsync(id, request, user.RequiredId, ct);
            return result.IsSuccess ? Results.Json(result.Value, statusCode: StatusCodes.Status201Created) : result.Error!.ToProblem();
        });

        group.MapGet("/collections/{id:guid}/forks", async (Guid id, IForkService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ForCollectionAsync(id, user.RequiredId, ct)).ToOk());

        group.MapGet("/workspaces/{workspaceId:guid}/forks", async (Guid workspaceId, IForkService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ForWorkspaceAsync(workspaceId, user.RequiredId, ct)).ToOk());

        group.MapGet("/forks/{id:guid}/compare", async (Guid id, IForkService service, ICurrentUser user, CancellationToken ct) =>
            (await service.CompareAsync(id, user.RequiredId, ct)).ToOk());

        group.MapPost("/forks/{id:guid}/pull", async (Guid id, PullRequestBody body, IForkService service, ICurrentUser user, CancellationToken ct) =>
            (await service.PullAsync(id, body, user.RequiredId, ct)).ToOk());

        group.MapDelete("/forks/{id:guid}", async (Guid id, IForkService service, ICurrentUser user, CancellationToken ct) =>
            (await service.UnlinkAsync(id, user.RequiredId, ct)).ToHttp());

        group.MapPost("/forks/{id:guid}/merge-requests", async (Guid id, CreateMergeRequestBody body, IMergeRequestService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.CreateAsync(id, body, user.RequiredId, ct);
            return result.IsSuccess ? Results.Json(result.Value, statusCode: StatusCodes.Status201Created) : result.Error!.ToProblem();
        });

        group.MapGet("/workspaces/{workspaceId:guid}/merge-requests", async (Guid workspaceId, MergeRequestStatus? status, IMergeRequestService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ListAsync(workspaceId, status, user.RequiredId, ct)).ToOk());

        group.MapGet("/merge-requests/{id:guid}", async (Guid id, IMergeRequestService service, ICurrentUser user, CancellationToken ct) =>
            (await service.GetAsync(id, user.RequiredId, ct)).ToOk());

        group.MapPut("/merge-requests/{id:guid}", async (Guid id, EditMergeRequestBody body, IMergeRequestService service, ICurrentUser user, CancellationToken ct) =>
            (await service.EditAsync(id, body, user.RequiredId, ct)).ToOk());

        group.MapPost("/merge-requests/{id:guid}/approve", async (Guid id, IMergeRequestService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ToggleApprovalAsync(id, user.RequiredId, ct)).ToOk());

        group.MapPost("/merge-requests/{id:guid}/merge", async (Guid id, IMergeRequestService service, ICurrentUser user, CancellationToken ct) =>
            (await service.MergeAsync(id, user.RequiredId, ct)).ToOk());

        group.MapPost("/merge-requests/{id:guid}/decline", async (Guid id, IMergeRequestService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DeclineAsync(id, user.RequiredId, ct)).ToOk());

        group.MapPost("/merge-requests/{id:guid}/close", async (Guid id, IMergeRequestService service, ICurrentUser user, CancellationToken ct) =>
            (await service.CloseAsync(id, user.RequiredId, ct)).ToOk());
    }
}
