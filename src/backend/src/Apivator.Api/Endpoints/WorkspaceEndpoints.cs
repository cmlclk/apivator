using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Teams;
using Apivator.Application.Workspaces;

namespace Apivator.Api.Endpoints;

internal static class WorkspaceEndpoints
{
    public static void MapWorkspaceEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/workspaces").WithTags("Workspaces").RequireAuthorization();

        group.MapGet("/", async (IWorkspaceService workspaces, ICurrentUser user, CancellationToken ct) =>
            Results.Ok(await workspaces.ListForUserAsync(user.RequiredId, ct)));

        group.MapPatch("/{id:guid}", async (Guid id, RenameRequest request, IWorkspaceService service, ICurrentUser user, CancellationToken ct) =>
            (await service.RenameAsync(id, request, user.RequiredId, ct)).ToHttp());

        group.MapDelete("/{id:guid}", async (Guid id, IWorkspaceService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DeleteAsync(id, user.RequiredId, ct)).ToHttp());

        group.MapGet("/{id:guid}/members", async (Guid id, IWorkspaceService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.MembersAsync(id, user.RequiredId, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapPut("/{id:guid}/members/users/{userId:guid}", async (Guid id, Guid userId, SetRoleRequest request, IWorkspaceService service, ICurrentUser user, CancellationToken ct) =>
            (await service.SetUserRoleAsync(id, userId, request, user.RequiredId, ct)).ToHttp());

        group.MapDelete("/{id:guid}/members/users/{userId:guid}", async (Guid id, Guid userId, IWorkspaceService service, ICurrentUser user, CancellationToken ct) =>
            (await service.RemoveUserAsync(id, userId, user.RequiredId, ct)).ToHttp());

        group.MapPut("/{id:guid}/members/teams/{teamId:guid}", async (Guid id, Guid teamId, SetRoleRequest request, IWorkspaceService service, ICurrentUser user, CancellationToken ct) =>
            (await service.SetTeamRoleAsync(id, teamId, request, user.RequiredId, ct)).ToHttp());

        group.MapDelete("/{id:guid}/members/teams/{teamId:guid}", async (Guid id, Guid teamId, IWorkspaceService service, ICurrentUser user, CancellationToken ct) =>
            (await service.RemoveTeamAsync(id, teamId, user.RequiredId, ct)).ToHttp());
    }
}
