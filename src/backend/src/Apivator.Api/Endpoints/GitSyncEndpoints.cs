using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.GitSync;

namespace Apivator.Api.Endpoints;

internal static class GitSyncEndpoints
{
    public static void MapGitSyncEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/collections/{id:guid}/git").WithTags("GitSync").RequireAuthorization();

        group.MapGet("/", async (Guid id, IGitSyncService service, ICurrentUser user, CancellationToken ct) =>
            (await service.GetAsync(id, user.RequiredId, ct)).ToOk());

        group.MapPut("/", async (Guid id, ConnectGitRequest body, IGitSyncService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ConnectAsync(id, body, user.RequiredId, ct)).ToOk());

        group.MapDelete("/", async (Guid id, IGitSyncService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DisconnectAsync(id, user.RequiredId, ct)).ToHttp());

        group.MapPost("/push", async (Guid id, PushGitRequest body, IGitSyncService service, ICurrentUser user, CancellationToken ct) =>
            (await service.PushAsync(id, body, user.RequiredId, ct)).ToOk());

        group.MapPost("/pull/preview", async (Guid id, IGitSyncService service, ICurrentUser user, CancellationToken ct) =>
            (await service.PreviewPullAsync(id, user.RequiredId, ct)).ToOk());

        group.MapPost("/pull", async (Guid id, PullGitRequest body, IGitSyncService service, ICurrentUser user, CancellationToken ct) =>
            (await service.PullAsync(id, body, user.RequiredId, ct)).ToOk());

        group.MapPut("/schedule", async (Guid id, SetGitScheduleRequest body, IGitSyncService service, ICurrentUser user, CancellationToken ct) =>
            (await service.SetScheduleAsync(id, body, user.RequiredId, ct)).ToOk());
    }
}
