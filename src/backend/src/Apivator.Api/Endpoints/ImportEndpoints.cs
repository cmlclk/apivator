using System.Text;
using System.Text.Json;
using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Import;

namespace Apivator.Api.Endpoints;

internal static class ImportEndpoints
{
    private static readonly JsonSerializerOptions Pretty = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static void MapImportEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/").WithTags("Import / Export").RequireAuthorization();

        group.MapPost("/workspaces/{workspaceId:guid}/import/postman", async (Guid workspaceId, JsonElement document, IImportService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.ImportPostmanAsync(workspaceId, document, user.RequiredId, ct);
            return result.IsSuccess ? Results.Json(result.Value, statusCode: StatusCodes.Status201Created) : result.Error!.ToProblem();
        });

        // Adresten (belge, Swagger UI sayfası ya da sunucu adresi) içe aktarma; birden çok sürüm varsa 200 + seçenekler.
        group.MapPost("/workspaces/{workspaceId:guid}/import/url", async (Guid workspaceId, UrlImportRequest request, IImportService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.ImportFromUrlAsync(workspaceId, request, user.RequiredId, ct);
            if (!result.IsSuccess)
            {
                return result.Error!.ToProblem();
            }

            return result.Value.Result is null
                ? Results.Ok(result.Value)
                : Results.Json(result.Value, statusCode: StatusCodes.Status201Created);
        }).RequireRateLimiting(RateLimitPolicies.Execute); // sunucudan dışarıya istek atar

        var source = routes.MapGroup("/collections/{id:guid}/source").WithTags("Import / Export").RequireAuthorization();
        source.MapGet("/", async (Guid id, ICollectionSourceService service, ICurrentUser user, CancellationToken ct) =>
            (await service.GetAsync(id, user.RequiredId, ct)).ToOk());
        source.MapPut("/schedule", async (Guid id, SourceScheduleRequest request, ICollectionSourceService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ScheduleAsync(id, request, user.RequiredId, ct)).ToOk());
        source.MapDelete("/", async (Guid id, ICollectionSourceService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DisconnectAsync(id, user.RequiredId, ct)).ToHttp());
        source.MapPost("/preview", async (Guid id, SourcePreviewRequest request, ICollectionSourceService service, ICurrentUser user, CancellationToken ct) =>
            (await service.PreviewAsync(id, request, user.RequiredId, ct)).ToOk()).RequireRateLimiting(RateLimitPolicies.Execute);
        source.MapPost("/apply", async (Guid id, SourceApplyRequest request, ICollectionSourceService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ApplyAsync(id, request, user.RequiredId, ct)).ToOk());

        group.MapGet("/collections/{id:guid}/export/postman", async (Guid id, IImportService service, ICurrentUser user, CancellationToken ct) =>
            File(await service.ExportCollectionAsync(id, user.RequiredId, ct)));

        group.MapGet("/collections/{id:guid}/export/openapi", async (Guid id, IImportService service, ICurrentUser user, CancellationToken ct) =>
            File(await service.ExportOpenApiAsync(id, user.RequiredId, ct)));

        group.MapGet("/environments/{id:guid}/export/postman", async (Guid id, IImportService service, ICurrentUser user, CancellationToken ct) =>
            File(await service.ExportEnvironmentAsync(id, user.RequiredId, ct)));
    }

    private static IResult File(Result<ExportFile> result)
    {
        if (!result.IsSuccess)
        {
            return result.Error!.ToProblem();
        }

        var bytes = Encoding.UTF8.GetBytes(result.Value.Content.ToJsonString(Pretty));
        var safeName = string.Concat(result.Value.FileName.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));
        return Results.File(bytes, "application/json", safeName);
    }
}
