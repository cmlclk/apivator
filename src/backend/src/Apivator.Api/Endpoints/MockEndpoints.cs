using System.Text;
using Apivator.Api.Infrastructure;
using Apivator.Application.Abstractions;
using Apivator.Application.Common.Localization;
using Apivator.Application.Mocks;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;

namespace Apivator.Api.Endpoints;

internal static class MockEndpoints
{
    public const string CorsPolicy = "mock";

    private static readonly string[] AllMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

    /// <summary>Mock'ların yönetimi (/api altında, oturum gerekir).</summary>
    public static void MapMockEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/").WithTags("Mocks").RequireAuthorization();

        group.MapGet("/workspaces/{workspaceId:guid}/mocks", async (Guid workspaceId, IMockService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ListAsync(workspaceId, user.RequiredId, ct)).ToOk());

        group.MapPost("/workspaces/{workspaceId:guid}/mocks", async (Guid workspaceId, CreateMockRequest request, IMockService service, ICurrentUser user, CancellationToken ct) =>
        {
            var result = await service.CreateAsync(workspaceId, request, user.RequiredId, ct);
            return result.IsSuccess ? Results.Json(result.Value, statusCode: StatusCodes.Status201Created) : result.Error!.ToProblem();
        });

        group.MapPut("/mocks/{id:guid}", async (Guid id, UpdateMockRequest request, IMockService service, ICurrentUser user, CancellationToken ct) =>
            (await service.UpdateAsync(id, request, user.RequiredId, ct)).ToOk());

        group.MapPost("/mocks/{id:guid}/regenerate-key", async (Guid id, IMockService service, ICurrentUser user, CancellationToken ct) =>
            (await service.RegenerateKeyAsync(id, user.RequiredId, ct)).ToOk());

        group.MapDelete("/mocks/{id:guid}", async (Guid id, IMockService service, ICurrentUser user, CancellationToken ct) =>
            (await service.DeleteAsync(id, user.RequiredId, ct)).ToHttp());

        group.MapGet("/mocks/{id:guid}/calls", async (Guid id, int? limit, Guid? before, IMockService service, ICurrentUser user, CancellationToken ct) =>
            (await service.CallsAsync(id, user.RequiredId, limit ?? 100, before, ct)).ToOk());

        group.MapGet("/mocks/{id:guid}/routes", async (Guid id, IMockService service, ICurrentUser user, CancellationToken ct) =>
            (await service.RoutesAsync(id, user.RequiredId, ct)).ToOk());

        group.MapDelete("/mocks/{id:guid}/calls", async (Guid id, IMockService service, ICurrentUser user, CancellationToken ct) =>
            (await service.ClearCallsAsync(id, user.RequiredId, ct)).ToHttp());
    }

    /// <summary>
    /// Mock'ların kendisi: <c>/mock/{key}/...</c>. Oturum gerektirmez (gizli mock'lar x-api-key ister); her
    /// origin'den çağrılabilir, çünkü amacı henüz yazılmamış bir API'nin yerine geçmektir.
    /// </summary>
    public static void MapMockRuntime(this IEndpointRouteBuilder routes)
    {
        routes.MapMethods(MockPaths.Prefix + "/{key}", AllMethods, (HttpContext http, string key, IMockRuntime runtime, IOptions<MockOptions> options, CancellationToken ct) =>
                HandleAsync(http, key, null, runtime, options.Value, ct))
            .AllowAnonymous().RequireCors(CorsPolicy).RequireRateLimiting(RateLimitPolicies.Mock).ExcludeFromDescription();

        routes.MapMethods(MockPaths.Prefix + "/{key}/{**path}", AllMethods, (HttpContext http, string key, string? path, IMockRuntime runtime, IOptions<MockOptions> options, CancellationToken ct) =>
                HandleAsync(http, key, path, runtime, options.Value, ct))
            .AllowAnonymous().RequireCors(CorsPolicy).RequireRateLimiting(RateLimitPolicies.Mock).ExcludeFromDescription();
    }

    private static async Task HandleAsync(HttpContext http, string key, string? path, IMockRuntime runtime, MockOptions options, CancellationToken ct)
    {
        // Örnek yanıt bilerek boş body'li bir 404/500 olabilir; hata sayfası araya girmesin.
        if (http.Features.Get<IStatusCodePagesFeature>() is { } statusPages)
        {
            statusPages.Enabled = false;
        }

        var request = http.Request;
        if (request.ContentLength > options.MaxRequestBytes)
        {
            await WriteErrorAsync(http, StatusCodes.Status413PayloadTooLarge, L.T("api.mock_body_too_large", "İstek body'si en fazla {kb} KB olabilir.", ("kb", options.MaxRequestBytes / 1024)), ct);
            return;
        }

        var body = await ReadBodyAsync(request, options.MaxRequestBytes, ct);
        if (body is null)
        {
            await WriteErrorAsync(http, StatusCodes.Status413PayloadTooLarge, L.T("api.mock_body_too_large", "İstek body'si en fazla {kb} KB olabilir.", ("kb", options.MaxRequestBytes / 1024)), ct);
            return;
        }

        var headers = request.Headers.ToDictionary(h => h.Key.ToLowerInvariant(), h => h.Value.ToString(), StringComparer.OrdinalIgnoreCase);
        var query = request.Query.SelectMany(q => q.Value.Select(v => new KeyValuePair<string, string>(q.Key, v ?? string.Empty))).ToList();
        var incoming = new MockIncoming(request.Method, "/" + (path ?? string.Empty), query, headers, body);

        var outcome = await runtime.HandleAsync(key, incoming, ct);
        if (outcome.DelayMs > 0)
        {
            await Task.Delay(outcome.DelayMs, ct);
        }

        var response = http.Response;
        response.StatusCode = outcome.Status;
        foreach (var group in outcome.Headers.GroupBy(h => h.Key, StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                response.Headers[group.Key] = new StringValues(group.Select(h => h.Value).ToArray());
            }
            catch (InvalidOperationException)
            {
                // Geçersiz karakter içeren header (ör. ASCII dışı) gönderilemez; atlanır.
            }
        }

        if (!HttpMethods.IsHead(request.Method) && outcome.Body.Length > 0 && outcome.Status is not (204 or 304))
        {
            await response.Body.WriteAsync(Encoding.UTF8.GetBytes(outcome.Body), ct);
        }
    }

    /// <summary>Sınırı aşan body için null.</summary>
    private static async Task<string?> ReadBodyAsync(HttpRequest request, int maxBytes, CancellationToken ct)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        int read;
        while ((read = await request.Body.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > maxBytes)
            {
                return null;
            }

            buffer.Write(chunk, 0, read);
        }

        return Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);
    }

    private static Task WriteErrorAsync(HttpContext http, int status, string message, CancellationToken ct)
    {
        http.Response.StatusCode = status;
        return http.Response.WriteAsJsonAsync(new { error = new { name = "mockRequestError", message } }, ct);
    }
}
