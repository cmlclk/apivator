using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Monitors;

namespace Apivator.Api.Endpoints;

internal static class MonitorEndpoints
{
    public static void MapMonitorEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/").WithTags("Monitors").RequireAuthorization();

        group.MapGet("/workspaces/{workspaceId:guid}/monitors", async (Guid workspaceId, IMonitorService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ListAsync(workspaceId, user.RequiredId, ct)).ToOk());

        group.MapPost("/workspaces/{workspaceId:guid}/monitors", async (Guid workspaceId, CreateMonitorRequest request, IMonitorService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.CreateAsync(workspaceId, request, user.RequiredId, ct);
            return result.IsSuccess ? Results.Json(result.Value, statusCode: StatusCodes.Status201Created) : result.Error!.ToProblem();
        });

        group.MapPut("/monitors/{id:guid}", async (Guid id, MonitorSettings settings, IMonitorService service, ICurrentUser user, CancellationToken ct) =>
            (await service.UpdateAsync(id, settings, user.RequiredId, ct)).ToOk());

        group.MapDelete("/monitors/{id:guid}", async (Guid id, IMonitorService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DeleteAsync(id, user.RequiredId, ct)).ToHttp());

        group.MapGet("/monitors/{id:guid}/runs", async (Guid id, int? days, IMonitorService service, ICurrentUser user, CancellationToken ct) =>
            (await service.RunsAsync(id, user.RequiredId, days ?? 7, ct)).ToOk());

        // Çalıştırma bitene kadar bekler; bağlantı kopsa da monitör çalıştırması tamamlanır.
        group.MapPost("/monitors/{id:guid}/run", async (Guid id, IMonitorService service, ICurrentUser user) =>
                (await service.RunNowAsync(id, user.RequiredId, CancellationToken.None)).ToOk())
            .RequireRateLimiting(RateLimitPolicies.Runs);
    }
}
