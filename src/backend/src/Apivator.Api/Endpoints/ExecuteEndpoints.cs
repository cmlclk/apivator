using Apivator.Api.Infrastructure;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Apivator.Infrastructure.Execution;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Apivator.Api.Endpoints;

internal static class ExecuteEndpoints
{
    private const long MaxRequestBytes = 72L * 1024 * 1024;

    public const string WebSocketProxyPath = "/hubs/ws-proxy";

    public const string GrpcProxyPath = "/hubs/grpc-proxy";

    public static void MapExecuteEndpoints(this IEndpointRouteBuilder routes)
    {
        // Web istemcisi istekleri tarayıcının CORS kısıtına takılmadan bu uç üzerinden gönderir.
        routes.MapPost("/execute", async (ExecuteHttpRequest request, IRequestPipeline pipeline, CancellationToken ct) =>
                Results.Ok(await pipeline.RunAsync(request, ct)))
            .WithTags("Execute")
            .RequireAuthorization()
            .RequireRateLimiting(RateLimitPolicies.Execute)
            // Dosyalar base64 olarak gelir (~%33 büyür); asıl sınırı Proxy:MaxUploadBytes uygular.
            .WithMetadata(new RequestSizeLimitAttribute(MaxRequestBytes));

        // Server-Sent Events: olaylar geldikçe NDJSON satırı olarak akar; istemci bağlantıyı kesince biter.
        routes.MapPost("/execute/stream", async (
                ExecuteHttpRequest request,
                IRequestPipeline pipeline,
                IRequestStreamer streamer,
                IOptions<Microsoft.AspNetCore.Http.Json.JsonOptions> json,
                HttpContext http,
                CancellationToken ct) =>
            {
                await StreamResponder.WriteAsync(request, pipeline, streamer, json.Value.SerializerOptions, http, ct);
            })
            .WithTags("Execute")
            .RequireAuthorization()
            .RequireRateLimiting(RateLimitPolicies.Execute)
            .WithMetadata(new RequestSizeLimitAttribute(MaxRequestBytes));

        // gRPC: .proto dosyalarından ya da server reflection'dan servis/metot listesi.
        routes.MapPost("/grpc/describe", async (GrpcDescribeRequest request, IGrpcService grpc, CancellationToken ct) =>
                (await grpc.DescribeAsync(request, ct)).ToOk())
            .WithTags("Execute")
            .RequireAuthorization()
            .RequireRateLimiting(RateLimitPolicies.Execute)
            .WithMetadata(new RequestSizeLimitAttribute(8L * 1024 * 1024));
    }

    /// <summary>WebSocket köprüsü (/hubs altında: ters proxy'lerde WebSocket yükseltmesi orada açık).</summary>
    public static void MapWebSocketProxy(this IEndpointRouteBuilder routes) =>
        routes.Map(WebSocketProxyPath, async (HttpContext http, IWebSocketRelay relay, CancellationToken ct) =>
            {
                if (!http.WebSockets.IsWebSocketRequest)
                {
                    return Results.BadRequest(new { error = L.T("api.websocket_expected", "WebSocket bağlantısı bekleniyordu.") });
                }

                using var socket = await http.WebSockets.AcceptWebSocketAsync();
                await relay.RunAsync(socket, ct);
                return Results.Empty;
            })
            .RequireAuthorization()
            .RequireRateLimiting(RateLimitPolicies.Execute)
            .ExcludeFromDescription();

    /// <summary>gRPC köprüsü: çağrı sunucudan yapılır, mesajlar WebSocket üzerinden JSON olarak akar.</summary>
    public static void MapGrpcProxy(this IEndpointRouteBuilder routes) =>
        routes.Map(GrpcProxyPath, async (HttpContext http, IGrpcRelay relay, CancellationToken ct) =>
            {
                if (!http.WebSockets.IsWebSocketRequest)
                {
                    return Results.BadRequest(new { error = L.T("api.websocket_expected", "WebSocket bağlantısı bekleniyordu.") });
                }

                using var socket = await http.WebSockets.AcceptWebSocketAsync();
                await relay.RunAsync(socket, ct);
                return Results.Empty;
            })
            .RequireAuthorization()
            .RequireRateLimiting(RateLimitPolicies.Execute)
            .ExcludeFromDescription();
}
