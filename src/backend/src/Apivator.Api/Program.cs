using System.Threading.RateLimiting;
using Apivator.Api.Endpoints;
using Apivator.Api.Infrastructure;
using Apivator.Api.Realtime;
using Apivator.Application;
using Apivator.Application.Abstractions;
using Apivator.Application.Realtime;
using Apivator.Infrastructure;
using Apivator.Infrastructure.Identity;
using Apivator.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

// Yalnızca test/geliştirme için olan güvensiz ayarlar üretimde açılamaz (http kimlik sağlayıcı, yerel ya da http Git deposu).
if (builder.Environment.IsProduction())
{
    string[] unsafeSettings = ["Sso:AllowInsecureAuthority", "GitSync:AllowHttp", "GitSync:AllowLocalRemotes"];
    if (unsafeSettings.FirstOrDefault(key => builder.Configuration.GetValue(key, false)) is { } enabled)
    {
        throw new InvalidOperationException($"{enabled} üretim ortamında açılamaz; yalnızca test ve geliştirme içindir.");
    }
}

builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);

// Canlı kanal: değişiklik olayları ve kimin çevrimiçi olduğu. Birden fazla API sunucusu çalışıyorsa olaylar
// Redis üzerinden tüm sunuculara dağıtılır.
// Ortak düzenleme güncellemeleri (ör. büyük bir body) varsayılan 32 KB sınırını aşabilir.
var signalR = builder.Services.AddSignalR(options => options.MaximumReceiveMessageSize = 2_000_000);
var redis = builder.Configuration["Redis:ConnectionString"];
if (!string.IsNullOrWhiteSpace(redis))
{
    signalR.AddStackExchangeRedis(redis, options => options.Configuration.ChannelPrefix = RedisChannel.Literal("apivator"));

    // Çevrimiçi listesi de sunucular arasında paylaşılır (PresenceTracker).
    builder.Services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redis));
}

builder.Services.AddSingleton(sp => new PresenceTracker(sp.GetService<IConnectionMultiplexer>(), TimeProvider.System));
builder.Services.AddCollaboration();
builder.Services.AddHostedService<PresenceRefresher>();
builder.Services.AddSingleton<IRealtimeNotifier, SignalRNotifier>();

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
builder.Services.AddScoped<Apivator.Application.Account.ICurrentClient, CurrentClient>();

// Varsayılan şema isteğe göre seçer: "apv_" ile başlayan anahtar ya da X-Api-Key → API anahtarı, değilse JWT.
builder.Services
    .AddAuthentication("Smart")
    .AddPolicyScheme("Smart", "Smart", options => options.ForwardDefaultSelector = context =>
        ApiKeyAuthenticationHandler.ReadKey(context.Request) is not null ? ApiKeyAuthenticationHandler.SchemeName : JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer()
    .AddScheme<AuthenticationSchemeOptions, ApiKeyAuthenticationHandler>(ApiKeyAuthenticationHandler.SchemeName, null);
builder.Services
    .AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
    .Configure<IOptions<JwtOptions>>((options, jwtOptions) =>
    {
        var jwt = jwtOptions.Value;
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = TokenService.CreateSigningKey(jwt.SigningKey),
            ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            NameClaimType = JwtRegisteredClaimNames.Name,
        };

        // WebSocket ve SSE başlık taşıyamaz; canlı kanalda token sorgu dizgisinde gelir.
        options.Events = new JwtBearerEvents
        {
            // Kapatılan oturumun ("Oturumlar" sayfası, şifre değişikliği) access token'ı da süresini beklemeden
            // geçersiz olur. Sonuç kısa süre önbelleklenir; her istekte veritabanına gidilmez.
            OnTokenValidated = async context =>
            {
                if (Guid.TryParse(context.Principal?.FindFirst(TokenService.SessionClaim)?.Value, out var sessionId)
                    && !await context.HttpContext.RequestServices.GetRequiredService<Apivator.Application.Account.IAccountService>()
                        .IsSessionActiveAsync(sessionId, context.HttpContext.RequestAborted))
                {
                    context.Fail("Oturum kapatılmış.");
                }
            },
            OnMessageReceived = context =>
            {
                var token = context.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token) && context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                {
                    context.Token = token;
                }

                return Task.CompletedTask;
            },
        };
    });
builder.Services.AddAuthorization();

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(RateLimitPolicies.Auth, context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = context.RequestServices.GetRequiredService<IConfiguration>().GetValue("RateLimiting:AuthPermitPerMinute", 20),
            Window = TimeSpan.FromMinutes(1),
        }));

    options.AddPolicy(RateLimitPolicies.Session, context => RateLimitPartition.GetFixedWindowLimiter(
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = context.RequestServices.GetRequiredService<IConfiguration>().GetValue("RateLimiting:SessionPermitPerMinute", 600),
            Window = TimeSpan.FromMinutes(1),
        }));

    // Proxy kötüye kullanımını sınırlamak için kullanıcı başına.
    options.AddPolicy(RateLimitPolicies.Execute, context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = context.RequestServices.GetRequiredService<IConfiguration>().GetValue("RateLimiting:ExecutePermitPerMinute", 120),
            Window = TimeSpan.FromMinutes(1),
        }));

    // Collection runner: kullanıcı başına dakikada en fazla birkaç çalıştırma.
    options.AddPolicy(RateLimitPolicies.Runs, context => RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = context.RequestServices.GetRequiredService<IConfiguration>().GetValue("RateLimiting:RunsPermitPerMinute", 10),
            Window = TimeSpan.FromMinutes(1),
        }));

    // Yayınlanmış dokümanlar herkese açık olabilir: ziyaretçi (IP) başına.
    options.AddPolicy(RateLimitPolicies.Docs, context => RateLimitPartition.GetFixedWindowLimiter(
        "docs:" + (context.Connection.RemoteIpAddress?.ToString() ?? "unknown"),
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = context.RequestServices.GetRequiredService<IConfiguration>().GetValue("RateLimiting:DocsPermitPerMinute", 120),
            Window = TimeSpan.FromMinutes(1),
        }));

    // Mock sunucuları: herkese açık olabildikleri için mock başına (adresteki anahtar).
    options.AddPolicy(RateLimitPolicies.Mock, context => RateLimitPartition.GetFixedWindowLimiter(
        "mock:" + (context.Request.RouteValues["key"] as string ?? "unknown"),
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = context.RequestServices.GetRequiredService<IConfiguration>().GetValue("RateLimiting:MockPermitPerMinute", 600),
            Window = TimeSpan.FromMinutes(1),
        }));
});

builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<UnhandledExceptionHandler>();
builder.Services.AddOpenApi();

builder.Services.AddHealthChecks().AddDbContextCheck<AppDbContext>("postgres", tags: ["ready"]);

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
    // Önünde kaç ters proxy var (ör. Caddy + nginx = 2). İstemci IP'si hız sınırı ve loglar için buradan okunur.
    options.ForwardLimit = builder.Configuration.GetValue("ForwardedHeaders:ForwardLimit", 1);
});

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy
        .WithOrigins(allowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());

    // Mock'lar geliştirilen her uygulamadan (her origin'den) çağrılabilmeli; cookie taşınmaz.
    options.AddPolicy(MockEndpoints.CorsPolicy, policy => policy
        .AllowAnyOrigin()
        .AllowAnyHeader()
        .AllowAnyMethod()
        .WithExposedHeaders("*")
        .SetPreflightMaxAge(TimeSpan.FromMinutes(10)));
});

var app = builder.Build();

// Kubernetes (Helm): veritabanı şeması kurulum/güncelleme öncesi ayrı bir iş (Job) olarak güncellenir; birden çok
// API örneği aynı anda migration çalıştırmaz. Sunucu ve arka plan servisleri başlamaz; hata olursa çıkış kodu 0 olmaz.
if (args.Contains("--migrate-only", StringComparer.Ordinal))
{
    await using var migrationScope = app.Services.CreateAsyncScope();
    await migrationScope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
    app.Logger.LogInformation("Veritabanı şeması güncel.");
    return;
}

app.UseForwardedHeaders();
app.UseRequestLanguage();
app.UseRequestLogging();
app.UseExceptionHandler();
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseUserLanguage();
app.UseApiKeyRestrictions();
// Kimlik doğrulamadan sonra: kullanıcı başına sınırlar ("sub" claim'i) ancak böyle çalışır; önce olursa
// herkes IP'ye göre aynı kotayı paylaşır (proxy arkasında tüm kullanıcılar).
app.UseRateLimiter();

app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false, ResponseWriter = HealthResponse.WriteAsync });
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains("ready"), ResponseWriter = HealthResponse.WriteAsync });

app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });
app.MapHub<WorkspaceHub>(WorkspaceHub.Path);
app.MapWebSocketProxy();
app.MapGrpcProxy();

var api = app.MapGroup("/api");

// İstemcinin "sunucu yine ulaşılabilir mi" yoklaması (çevrimdışı mod); /api altında olduğu için web proxy'sinden geçer.
api.MapGet("/ping", () => Results.NoContent()).AllowAnonymous().ExcludeFromDescription();
api.MapAuthEndpoints();
api.MapMeEndpoints();
api.MapAccountEndpoints();
api.MapWorkspaceEndpoints();
api.MapOrganizationEndpoints();
api.MapCollectionEndpoints();
api.MapEnvironmentEndpoints();
api.MapHistoryEndpoints();
api.MapImportEndpoints();
api.MapExampleEndpoints();
api.MapRunEndpoints();
api.MapActivityEndpoints();
api.MapApiKeyEndpoints();
api.MapOAuth2Endpoints();
api.MapExecuteEndpoints();
api.MapMockEndpoints();
api.MapDocumentationEndpoints();
api.MapMonitorEndpoints();
api.MapForkEndpoints();
api.MapGitSyncEndpoints();
api.MapAuditEndpoints();
api.MapSsoEndpoints();
app.MapMockRuntime();

if (app.Configuration.GetValue("Database:MigrateOnStartup", false))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
}

await app.RunAsync();

/// <summary>Entegrasyon testlerinde WebApplicationFactory için görünür olmalı.</summary>
public partial class Program;
