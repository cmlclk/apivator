using System.Text.Json;
using System.Text.Json.Serialization;
using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Runs;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Options;

namespace Apivator.Api.Endpoints;

internal static class RunEndpoints
{
    public static void MapRunEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/").WithTags("Runner").RequireAuthorization();

        // Sonuçlar oluştukça NDJSON (her satır bir olay) olarak akar; istemci bağlantıyı keserse çalıştırma durur
        // ve rapor "Stopped" olarak kaydedilir.
        group.MapPost("/runs", async (
                StartRunRequest request,
                ICollectionRunner runner,
                ICurrentUser user,
                IOptions<Microsoft.AspNetCore.Http.Json.JsonOptions> json,
                HttpContext http,
                CancellationToken ct) =>
            {
                if (await runner.ValidateAsync(request, user.RequiredId, ct) is { } error)
                {
                    return error.ToProblem();
                }

                var options = new JsonSerializerOptions(json.Value.SerializerOptions)
                {
                    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
                };
                http.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
                http.Response.ContentType = "application/x-ndjson; charset=utf-8";
                http.Response.Headers.CacheControl = "no-cache";

                await foreach (var item in runner.RunAsync(request, user.RequiredId, ct).WithCancellation(CancellationToken.None))
                {
                    if (ct.IsCancellationRequested)
                    {
                        // İstemci gitti; çalıştırıcı kalan adımları atlayıp raporu kaydediyor.
                        continue;
                    }

                    try
                    {
                        await JsonSerializer.SerializeAsync(http.Response.Body, item, options, ct);
                        await http.Response.Body.WriteAsync("\n"u8.ToArray(), ct);
                        await http.Response.Body.FlushAsync(ct);
                    }
                    catch (OperationCanceledException)
                    {
                        // Bağlantı koptu.
                    }
                }

                return Results.Empty;
            })
            .RequireRateLimiting(RateLimitPolicies.Runs);

        // Masaüstü: istekler kullanıcının bilgisayarında yürütülür; collection buradan alınır, rapor buraya yazılır.
        group.MapGet("/collections/{id:guid}/run-source", async (Guid id, IRunService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.GetSourceAsync(id, user.RequiredId, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapPost("/runs/report", async (RunReportRequest request, IRunService service, ICurrentUser user, CancellationToken ct) =>
            {
                var result = await service.ReportAsync(request, user.RequiredId, ct);
                return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
            })
            .RequireRateLimiting(RateLimitPolicies.Runs)
            // En fazla 10.000 sonuç; her biri test listesiyle birkaç KB tutabilir.
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(32L * 1024 * 1024));

        group.MapGet("/workspaces/{workspaceId:guid}/runs", async (Guid workspaceId, Guid? collectionId, int? limit, IRunService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.ListAsync(workspaceId, collectionId, user.RequiredId, limit ?? 50, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapGet("/runs/{id:guid}", async (Guid id, IRunService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.GetAsync(id, user.RequiredId, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : result.Error!.ToProblem();
        });

        group.MapDelete("/runs/{id:guid}", async (Guid id, IRunService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DeleteAsync(id, user.RequiredId, ct)).ToHttp());
    }
}
