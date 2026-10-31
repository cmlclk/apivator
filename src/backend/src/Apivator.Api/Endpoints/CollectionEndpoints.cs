using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Collections;
using Apivator.Application.Common;

namespace Apivator.Api.Endpoints;

internal static class CollectionEndpoints
{
    public static void MapCollectionEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/").WithTags("Collections").RequireAuthorization();

        group.MapGet("/workspaces/{workspaceId:guid}/collections", async (Guid workspaceId, ICollectionService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ListAsync(workspaceId, user.RequiredId, ct)).ToOk());

        group.MapPost("/workspaces/{workspaceId:guid}/collections", async (Guid workspaceId, CreateCollectionRequest request, ICollectionService service, ICurrentUser user, CancellationToken ct) =>
            (await service.CreateAsync(workspaceId, request, user.RequiredId, ct)).ToCreated());

        group.MapPatch("/collections/{id:guid}", async (Guid id, UpdateCollectionRequest request, ICollectionService service, ICurrentUser user, CancellationToken ct) =>
            (await service.UpdateAsync(id, request, user.RequiredId, ct)).ToOk());

        group.MapGet("/collections/{id:guid}/access", async (Guid id, ICollectionAccessService service, ICurrentUser user, CancellationToken ct) =>
            (await service.GetAsync(id, user.RequiredId, ct)).ToOk());

        group.MapPut("/collections/{id:guid}/access", async (Guid id, UpdateCollectionAccessRequest request, ICollectionAccessService service, ICurrentUser user, CancellationToken ct) =>
            (await service.UpdateAsync(id, request, user.RequiredId, ct)).ToOk());

        group.MapDelete("/collections/{id:guid}", async (Guid id, ICollectionService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DeleteAsync(id, user.RequiredId, ct)).ToHttp());

        group.MapPost("/collections/{id:guid}/folders", async (Guid id, CreateFolderRequest request, ICollectionService service, ICurrentUser user, CancellationToken ct) =>
            (await service.CreateFolderAsync(id, request, user.RequiredId, ct)).ToCreated());

        group.MapPatch("/folders/{id:guid}", async (Guid id, UpdateFolderRequest request, ICollectionService service, ICurrentUser user, CancellationToken ct) =>
            (await service.UpdateFolderAsync(id, request, user.RequiredId, ct)).ToOk());

        group.MapDelete("/folders/{id:guid}", async (Guid id, ICollectionService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DeleteFolderAsync(id, user.RequiredId, ct)).ToHttp());

        group.MapPost("/collections/{id:guid}/requests", async (Guid id, CreateApiRequestRequest request, ICollectionService service, ICurrentUser user, CancellationToken ct) =>
            (await service.CreateRequestAsync(id, request, user.RequiredId, ct)).ToCreated());

        group.MapGet("/collections/{id:guid}/requests", async (Guid id, ICollectionService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ListRequestsAsync(id, user.RequiredId, ct)).ToOk());

        group.MapGet("/requests/{id:guid}", async (Guid id, ICollectionService service, ICurrentUser user, CancellationToken ct) =>
            (await service.GetRequestAsync(id, user.RequiredId, ct)).ToOk());

        group.MapPut("/requests/{id:guid}", async (Guid id, UpdateApiRequestRequest request, ICollectionService service, ICurrentUser user, CancellationToken ct) =>
            (await service.UpdateRequestAsync(id, request, user.RequiredId, ct)).ToOk());

        group.MapPost("/requests/{id:guid}/move", async (Guid id, MoveApiRequestRequest request, ICollectionTreeService service, ICurrentUser user, CancellationToken ct) =>
            (await service.MoveRequestAsync(id, request, user.RequiredId, ct)).ToOk());

        group.MapPost("/folders/{id:guid}/move", async (Guid id, MoveFolderRequest request, ICollectionTreeService service, ICurrentUser user, CancellationToken ct) =>
            (await service.MoveFolderAsync(id, request, user.RequiredId, ct)).ToOk());

        group.MapPost("/requests/{id:guid}/duplicate", async (Guid id, ICollectionTreeService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DuplicateRequestAsync(id, user.RequiredId, ct)).ToCreated());

        group.MapPost("/folders/{id:guid}/duplicate", async (Guid id, ICollectionTreeService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DuplicateFolderAsync(id, user.RequiredId, ct)).ToCreated());

        // Gövde boşsa aynı workspace'e, { workspaceId } verilirse başka bir workspace'e kopyalar.
        group.MapPost("/collections/{id:guid}/duplicate", async (Guid id, HttpRequest http, ICollectionTreeService service, ICurrentUser user, CancellationToken ct) =>
        {
            var target = http.ContentLength > 0 ? await http.ReadFromJsonAsync<CollectionTargetRequest>(ct) : null;
            var workspaceId = target?.WorkspaceId is { } w && w != Guid.Empty ? w : (Guid?)null;
            return (await service.DuplicateCollectionAsync(id, user.RequiredId, workspaceId, ct)).ToCreated();
        });

        group.MapPost("/collections/{id:guid}/move", async (Guid id, CollectionTargetRequest request, ICollectionTreeService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.MoveCollectionAsync(id, request.WorkspaceId, user.RequiredId, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapDelete("/requests/{id:guid}", async (Guid id, ICollectionService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DeleteRequestAsync(id, user.RequiredId, ct)).ToHttp());
    }

    private static IResult ToOk<T>(this Result<T> result) =>
        result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();

    private static IResult ToCreated<T>(this Result<T> result) =>
        result.IsSuccess ? Results.Json(result.Value, statusCode: StatusCodes.Status201Created) : result.Error!.ToProblem();
}
