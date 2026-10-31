using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using Apivator.Application;
using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Execution;
using Apivator.Application.Import;
using Apivator.Application.Runs;
using Apivator.Infrastructure;
using Apivator.Infrastructure.Execution;
using Apivator.Infrastructure.Execution.Local;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;

namespace Apivator.Agent;

public static class AgentHost
{
    private const long MaxRequestBytes = 72L * 1024 * 1024;

    public const string WebSocketPath = "/ws-proxy";

    public const string GrpcPath = "/grpc-proxy";

    /// <summary>Ajan uygulamasını kurar (başlatmaz). Testler de bunu kullanır.</summary>
    public static WebApplication Build(AgentOptions options, Action<IConfigurationBuilder>? configure = null)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            ContentRootPath = AppContext.BaseDirectory,
            EnvironmentName = Environments.Production,
        });
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            // Masaüstünde amaç tam olarak localhost ve iç ağa erişmek; SSRF koruması burada gerekmez.
            ["Proxy:AllowPrivateNetworks"] = "true",
            ["Proxy:SslErrorHint"] = "desktop",
            ["Logging:LogLevel:Default"] = "Warning",
            ["Logging:LogLevel:Microsoft.Hosting.Lifetime"] = "Warning",
        });
        configure?.Invoke(builder.Configuration);

        // Yalnızca geri döngü arayüzü: ağdaki başka makineler ajana ulaşamaz.
        builder.WebHost.ConfigureKestrel(kestrel =>
        {
            kestrel.Listen(IPAddress.Loopback, options.Port);
            kestrel.Limits.MaxRequestBodySize = MaxRequestBytes;
        });

        builder.Services.AddSingleton(options);
        // Proxy/SSL ayarlı HTTP istemcisi; AddRequestExecution varsayılanı bunun yerine geçmez.
        builder.Services.AddSingleton<LocalHttpClientSource>();
        builder.Services.AddSingleton<IExecutionHttpClientSource>(sp => sp.GetRequiredService<LocalHttpClientSource>());
        builder.Services.AddExecutionServices();
        builder.Services.AddRequestExecution(builder.Configuration);
        builder.Services.AddSingleton<ICurrentUser, LocalUser>();
        builder.Services.AddSingleton<OAuthCallbacks>();
        builder.Services.AddHostedService<ParentWatcher>();
        builder.Services.AddProblemDetails();
        builder.Services.AddCors(cors => cors.AddDefaultPolicy(policy => policy
            .WithOrigins([.. options.AllowedOrigins])
            .AllowAnyHeader()
            .AllowAnyMethod()));

        var app = builder.Build();
        // Dil: ?lang= (WebSocket/gRPC köprüsü başlık gönderemez) → Accept-Language → Türkçe; hata/sayfa metinlerine uygulanır.
        app.Use(async (context, next) =>
        {
            var language = Lang.Match(context.Request.Query["lang"].ToString())
                ?? Lang.FromAcceptLanguage(context.Request.Headers.AcceptLanguage.ToString());
            using (Lang.Use(language))
            {
                await next(context);
            }
        });
        app.UseCors();
        app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });
        app.Use(async (context, next) =>
        {
            // DNS rebinding'e karşı: yalnızca loopback adına gelen istekler.
            var host = context.Request.Host.Host;
            if (host is not ("127.0.0.1" or "localhost" or "[::1]" or "::1"))
            {
                context.Response.StatusCode = StatusCodes.Status421MisdirectedRequest;
                return;
            }

            // OAuth dönüşünü sistem tarayıcısı açar; token taşıyamaz (state ile korunur).
            if (context.Request.Path.StartsWithSegments("/oauth/callback", StringComparison.Ordinal)
                || HttpMethods.IsOptions(context.Request.Method)
                || HasValidToken(context, options.Token)
                || ((context.Request.Path.StartsWithSegments(WebSocketPath, StringComparison.Ordinal)
                        || context.Request.Path.StartsWithSegments(GrpcPath, StringComparison.Ordinal))
                    && IsAllowedOrigin(context, options)
                    && Matches(context.Request.Query["token"].ToString(), options.Token)))
            {
                await next();
                return;
            }

            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        });

        app.MapGet("/health", () => Results.Ok(new { status = "ok", version = typeof(AgentHost).Assembly.GetName().Version?.ToString() }));

        app.MapPost("/execute", async (ExecuteHttpRequest request, IRequestPipeline pipeline, CancellationToken ct) =>
            Results.Ok(await pipeline.RunAsync(request, ct)));

        app.MapPost("/execute/stream", (ExecuteHttpRequest request, IRequestPipeline pipeline, IRequestStreamer streamer, HttpContext http, CancellationToken ct) =>
            StreamResponder.WriteAsync(request, pipeline, streamer, new JsonSerializerOptions(JsonSerializerDefaults.Web), http, ct));

        // WebSocket köprüsü: tarayıcı WebSocket'te header gönderemediği için ajan anahtarı adreste (?token=) gelir.
        app.Map(WebSocketPath, async (HttpContext http, IWebSocketRelay relay, CancellationToken ct) =>
        {
            if (!http.WebSockets.IsWebSocketRequest)
            {
                return Results.BadRequest();
            }

            using var socket = await http.WebSockets.AcceptWebSocketAsync();
            await relay.RunAsync(socket, ct);
            return Results.Empty;
        });

        app.Map(GrpcPath, async (HttpContext http, IGrpcRelay relay, CancellationToken ct) =>
        {
            if (!http.WebSockets.IsWebSocketRequest)
            {
                return Results.BadRequest();
            }

            using var socket = await http.WebSockets.AcceptWebSocketAsync();
            await relay.RunAsync(socket, ct);
            return Results.Empty;
        });

        // OpenAPI/Swagger belgesini bu bilgisayardan bulur ve çeker (localhost ve iç ağ dahil); içe aktarmayı sunucu yapar.
        app.MapPost("/openapi/fetch", async (SpecFetchRequest request, IApiSpecFetcher fetcher, CancellationToken ct) =>
        {
            var result = await fetcher.FetchAsync(request, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Problem(result.Error!);
        });

        app.MapPost("/grpc/describe", async (GrpcDescribeRequest request, IGrpcService grpc, CancellationToken ct) =>
        {
            var result = await grpc.DescribeAsync(request, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Problem(result.Error!);
        });

        // Collection runner: kaynak istemciden gelir (sunucudan alınmış), sonuçlar NDJSON olarak akar; en sonda
        // istemcinin sunucuya kaydedeceği rapor gönderilir. İstemci bağlantıyı keserse çalıştırma durur.
        app.MapPost("/runs", async (LocalRunRequest request, RunEngine engine, TimeProvider clock, HttpContext http, CancellationToken ct) =>
        {
            if (RunLimits.Validate(request.Run) is { } invalid)
            {
                return Problem(invalid);
            }

            var json = new JsonSerializerOptions(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
            http.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
            http.Response.ContentType = "application/x-ndjson; charset=utf-8";
            http.Response.Headers.CacheControl = "no-cache";

            async Task WriteAsync(RunEvent item)
            {
                if (ct.IsCancellationRequested)
                {
                    return;
                }

                try
                {
                    await JsonSerializer.SerializeAsync(http.Response.Body, item, json, ct);
                    await http.Response.Body.WriteAsync("\n"u8.ToArray(), ct);
                    await http.Response.Body.FlushAsync(ct);
                }
                catch (OperationCanceledException)
                {
                    // Bağlantı koptu.
                }
            }

            var startedAt = clock.GetUtcNow();
            var outcome = new RunOutcome();
            await foreach (var item in engine.RunAsync(request.Source, request.Run, outcome, ct).WithCancellation(CancellationToken.None))
            {
                await WriteAsync(item);
            }

            await WriteAsync(new RunEvent("done")
            {
                Variables = outcome.Variables,
                Message = outcome.StopReason,
                Report = new LocalRunReport(outcome.Name, outcome.Iterations, outcome.Status, startedAt, clock.GetUtcNow(), outcome.Results),
            });
            return Results.Empty;
        });

        // Ağ ayarları: parolalar dahil tamamı gönderilir (arayüz anahtar zincirinden okur); okurken parolalar dönmez.
        app.MapGet("/settings", (LocalHttpClientSource source) => Results.Ok(source.Settings with
        {
            ProxyPassword = null,
            ClientCertificates = [.. source.Settings.ClientCertificates.Select(c => c with { Password = null })],
        }));

        app.MapPut("/settings", (NetworkSettings settings, LocalHttpClientSource source) =>
        {
            var errors = source.Apply(settings);
            return errors.Count == 0
                ? Results.NoContent()
                : Results.Problem(
                    string.Join(" ", errors),
                    statusCode: StatusCodes.Status400BadRequest,
                    extensions: new Dictionary<string, object?> { ["code"] = "settings_invalid", ["errors"] = errors });
        });

        app.MapPost("/oauth2/token", async (OAuth2TokenRequest request, IOAuth2TokenService service, CancellationToken ct) =>
        {
            var result = await service.RequestAsync(request, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Problem(result.Error!);
        });

        app.MapPost("/oauth/sessions", (OAuthSessionRequest request, OAuthCallbacks callbacks, HttpContext context) =>
        {
            if (string.IsNullOrWhiteSpace(request.State) || request.State.Length is < 16 or > 256)
            {
                return Results.Problem(L.T("agent.oauth_state", "state 16–256 karakter olmalı."), statusCode: StatusCodes.Status400BadRequest);
            }

            callbacks.Expect(request.State);
            var port = context.Connection.LocalPort;
            return Results.Ok(new { redirectUri = $"http://127.0.0.1:{port}/oauth/callback" });
        });

        app.MapGet("/oauth/sessions/{state}", (string state, OAuthCallbacks callbacks) =>
        {
            var (known, outcome) = callbacks.Take(state);
            if (!known)
            {
                return Results.NotFound();
            }

            return outcome is null
                ? Results.Ok(new { status = "pending" })
                : Results.Ok(new { status = "done", code = outcome.Code, error = outcome.Error, errorDescription = outcome.ErrorDescription });
        });

        app.MapGet("/oauth/callback", (
            [FromQuery] string? state,
            [FromQuery] string? code,
            [FromQuery] string? error,
            [FromQuery(Name = "error_description")] string? description,
            OAuthCallbacks callbacks) =>
        {
            var accepted = state is not null && callbacks.Complete(state, new OAuthCallbacks.Outcome(code, error, description));
            var (title, text) = !accepted
                ? (L.T("agent.oauth_unknown_title", "Giriş isteği tanınmadı"), L.T("agent.oauth_unknown", "Bu bağlantı süresi dolmuş ya da zaten kullanılmış. Apivator'dan yeniden deneyin."))
                : error is not null
                    ? (L.T("agent.oauth_failed_title", "Giriş tamamlanamadı"), description ?? error)
                    : (L.T("agent.oauth_done_title", "Giriş tamamlandı"), L.T("agent.oauth_done", "Apivator'a dönebilirsiniz; bu sekmeyi kapatabilirsiniz."));
            return Results.Content(CallbackPage(title, text), "text/html; charset=utf-8", statusCode: accepted ? 200 : 400);
        });

        return app;
    }

    /// <summary>Uygulamayı başlatır ve gerçek portu döner.</summary>
    public static async Task<int> StartAsync(WebApplication app, CancellationToken ct = default)
    {
        await app.StartAsync(ct);
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
        return new Uri(address).Port;
    }

    private static bool HasValidToken(HttpContext context, string expected) =>
        Matches(context.Request.Headers[AgentOptions.TokenHeader].ToString(), expected);

    private static bool Matches(string provided, string expected) =>
        provided.Length > 0 && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(provided), Encoding.UTF8.GetBytes(expected));

    /// <summary>WebSocket'e CORS uygulanmaz; köprüyü yalnızca uygulamanın kendi sayfası açabilsin.</summary>
    private static bool IsAllowedOrigin(HttpContext context, AgentOptions options)
    {
        var origin = context.Request.Headers.Origin.ToString();
        return origin.Length == 0 || options.AllowedOrigins.Contains(origin, StringComparer.OrdinalIgnoreCase);
    }

    private static IResult Problem(Error error) =>
        Results.Problem(
            detail: error.Message,
            statusCode: error.Type == ErrorType.Validation ? StatusCodes.Status400BadRequest : StatusCodes.Status500InternalServerError,
            extensions: new Dictionary<string, object?> { ["code"] = error.Code });

    private static string CallbackPage(string title, string text)
    {
        var encoder = HtmlEncoder.Create(System.Text.Unicode.UnicodeRanges.All);
        return $$$"""
            <!doctype html>
            <html lang="{{{Lang.Current}}}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>Apivator</title>
            <style>
              body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f6f7f7;color:#1c2321}
              main{max-width:420px;padding:32px;text-align:center}
              h1{font-size:20px;margin:0 0 8px}
              p{color:#5b6663;margin:0}
              @media (prefers-color-scheme:dark){body{background:#151918;color:#e7ecea}p{color:#a3aeab}}
            </style></head>
            <body><main><h1>{{{encoder.Encode(title)}}}</h1><p>{{{encoder.Encode(text)}}}</p></main></body></html>
            """;
    }
}

public sealed record OAuthSessionRequest(string State);
