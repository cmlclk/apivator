using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Docs;

namespace Apivator.Api.Endpoints;

internal static class DocumentationEndpoints
{
    public static void MapDocumentationEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/").WithTags("Docs").RequireAuthorization();

        group.MapGet("/collections/{id:guid}/documentation", async (Guid id, Guid? environmentId, IDocumentationService service, ICurrentUser user, CancellationToken ct) =>
            (await service.GetAsync(id, environmentId, user.RequiredId, ct)).ToOk());

        // Yayınlanmamışsa 204.
        group.MapGet("/collections/{id:guid}/publication", async (Guid id, IDocumentationService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.GetPublicationAsync(id, user.RequiredId, ct);
            return !result.IsSuccess ? result.Error!.ToProblem() : result.Value is null ? Results.NoContent() : Results.Ok(result.Value);
        });

        group.MapPut("/collections/{id:guid}/publication", async (Guid id, PublishDocRequest request, IDocumentationService service, ICurrentUser user, CancellationToken ct) =>
            (await service.PublishAsync(id, request, user.RequiredId, ct)).ToOk());

        group.MapPost("/collections/{id:guid}/publication/regenerate", async (Guid id, IDocumentationService service, ICurrentUser user, CancellationToken ct) =>
            (await service.RegenerateLinkAsync(id, user.RequiredId, ct)).ToOk());

        group.MapDelete("/collections/{id:guid}/publication", async (Guid id, IDocumentationService service, ICurrentUser user, CancellationToken ct) =>
            (await service.UnpublishAsync(id, user.RequiredId, ct)).ToHttp());

        // Yayınlanmış doküman: herkese açık olanlar oturumsuz; organizasyona açık olanlar oturum ve üyelik ister.
        routes.MapGet("/docs/{slug}", async (string slug, IDocumentationService service, ICurrentUser user, HttpContext http, CancellationToken ct) =>
            {
                var result = await service.GetPublishedAsync(slug, user.Id, ct);
                // Doküman canlıdır; ara belleklerde (paylaşılan proxy'ler dahil) tutulmaz.
                http.Response.Headers.CacheControl = "no-store";
                http.Response.Headers["X-Robots-Tag"] = "noindex";
                return result.ToOk();
            })
            .WithTags("Docs")
            .AllowAnonymous()
            .RequireRateLimiting(RateLimitPolicies.Docs);
    }
}
