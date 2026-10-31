using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Activity;
using Apivator.Application.Comments;
using Apivator.Application.Common;
using Apivator.Domain.Comments;

namespace Apivator.Api.Endpoints;

internal static class ActivityEndpoints
{
    public static void MapActivityEndpoints(this IEndpointRouteBuilder routes)
    {
        var activity = routes.MapGroup("/").WithTags("Activity").RequireAuthorization();

        activity.MapGet("/workspaces/{id:guid}/activity", async (Guid id, DateTimeOffset? before, int? limit, IActivityService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.FeedAsync(id, before, limit ?? 50, user.RequiredId, ct)));

        activity.MapGet("/requests/{id:guid}/versions", async (Guid id, IActivityService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.RequestHistoryAsync(id, user.RequiredId, ct)));

        activity.MapPost("/requests/{id:guid}/restore", async (Guid id, RestoreVersionRequest request, IActivityService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.RestoreRequestAsync(id, request, user.RequiredId, ct)));

        activity.MapPost("/activity/{changeId:guid}/restore", async (Guid changeId, IActivityService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.RestoreDeletedRequestAsync(changeId, user.RequiredId, ct)));

        activity.MapGet("/environments/{id:guid}/versions", async (Guid id, IActivityService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.EnvironmentHistoryAsync(id, user.RequiredId, ct)));

        activity.MapPost("/environments/{id:guid}/restore", async (Guid id, RestoreVersionRequest request, IActivityService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.RestoreEnvironmentAsync(id, request, user.RequiredId, ct)));

        var comments = routes.MapGroup("/").WithTags("Comments").RequireAuthorization();

        comments.MapGet("/comments", async (CommentTarget targetType, Guid targetId, ICommentService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.ListAsync(targetType, targetId, user.RequiredId, ct)));

        comments.MapPost("/comments", async (CreateCommentRequest request, ICommentService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.CreateAsync(request, user.RequiredId, ct);
            return result.IsSuccess ? Results.Json(result.Value, statusCode: StatusCodes.Status201Created) : result.Error!.ToProblem();
        });

        comments.MapPatch("/comments/{id:guid}", async (Guid id, EditCommentRequest request, ICommentService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.EditAsync(id, request, user.RequiredId, ct)));

        comments.MapDelete("/comments/{id:guid}", async (Guid id, ICommentService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DeleteAsync(id, user.RequiredId, ct)).ToHttp());

        comments.MapPost("/comments/{id:guid}/resolve", async (Guid id, ResolveCommentRequest request, ICommentService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ResolveAsync(id, request, user.RequiredId, ct)).ToHttp());

        comments.MapGet("/workspaces/{id:guid}/comment-counts", async (Guid id, ICommentService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.CountsAsync(id, user.RequiredId, ct)));

        comments.MapGet("/workspaces/{id:guid}/people", async (Guid id, ICommentService service, ICurrentUser user, CancellationToken ct) =>
            Ok(await service.PeopleAsync(id, user.RequiredId, ct)));

        comments.MapGet("/me/notifications", async (ICommentService service, ICurrentUser user, CancellationToken ct) =>
            Results.Ok(await service.NotificationsAsync(user.RequiredId, ct)));

        comments.MapPost("/me/notifications/read", async (MarkNotificationsReadRequest request, ICommentService service, ICurrentUser user, CancellationToken ct) =>
        {
            await service.MarkReadAsync(request, user.RequiredId, ct);
            return Results.NoContent();
        });
    }

    private static IResult Ok<T>(Result<T> result) => result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
}
