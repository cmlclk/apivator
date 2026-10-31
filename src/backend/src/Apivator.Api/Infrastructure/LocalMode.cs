using System.Net;
using System.Security.Cryptography;
using Apivator.Api.Realtime;
using Apivator.Application.Common.Localization;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace Apivator.Api.Infrastructure;

/// <summary>
/// Yerel mod (<c>LocalMode:Enabled</c>): API masaüstü uygulamasının içinde, tek kişi için çalışır. Giriş yok; istekler
/// uygulamanın her açılışta ürettiği <c>LocalMode:Token</c> ile doğrulanır. Yalnızca 127.0.0.1'de dinler, CORS yalnızca
/// uygulama kökenlerine açıktır, ekip uçları (organizasyon, takım, davet, SSO, 2FA, ortak düzenleme…) kapalıdır.
/// </summary>
internal static class LocalMode
{
    public const string ReadyPrefix = "APIVATOR_API_READY ";

    /// <summary>Masaüstü uygulamasının kökenleri (Windows/Linux ve macOS WebView'ları).</summary>
    private static readonly string[] AppOrigins = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"];

    // Yerel modda kapalı uçlar: ekip, giriş/kayıt/e-posta, hesap güvenliği ve ortak düzenleme. Organizasyon listesi
    // (yalnızca GET /api/organizations) açık kalır: arayüz kişisel organizasyonu buradan bulur.
    private static readonly string[] BlockedPrefixes =
    [
        "/api/auth", "/api/teams", "/api/invitations", "/api/me/invitations", "/api/me/api-keys", "/api/me/2fa",
        "/api/me/email", "/api/me/password", "/api/me/sessions", "/api/me/security-events", "/api/me/deletion",
        WorkspaceHub.Path,
    ];

    public static bool IsEnabled(IConfiguration configuration) => configuration.GetValue("LocalMode:Enabled", false);

    /// <summary>
    /// Yerel modun ayarlarını uygular: token denetimi, yalnızca loopback'te dinleme, yerel varsayılanlar (imza anahtarı,
    /// e-postasız çalışma, açılışta migration).
    /// </summary>
    public static void Configure(WebApplicationBuilder builder)
    {
        var configuration = builder.Configuration;
        if (configuration["LocalMode:Token"] is not { Length: >= 32 })
        {
            throw new InvalidOperationException("LocalMode:Token en az 32 karakter olmalı (masaüstü uygulaması her açılışta üretir).");
        }

        var defaults = new Dictionary<string, string?>
        {
            // JWT kullanılmaz; seçenek doğrulaması geçsin diye her açılışta rastgele bir anahtar.
            ["Jwt:SigningKey"] = string.IsNullOrEmpty(configuration["Jwt:SigningKey"]) ? Convert.ToHexString(RandomNumberGenerator.GetBytes(32)) : null,
            // Hesap e-postası yok (local@apivator.local); bildirimler gönderilmez, loga yazılır.
            ["Email:Mode"] = "Console",
            ["Database:MigrateOnStartup"] = "true",
            ["Database:Provider"] = string.IsNullOrEmpty(configuration["Database:Provider"]) ? "Sqlite" : null,
            // Kişisel kullanım: runner ve monitörler kullanıcının kendi ağındaki (localhost, LAN) servislere gidebilmeli.
            ["Proxy:AllowPrivateNetworks"] = "true",
            // DNS rebinding: başka bir adla gelen istek (ör. kötü niyetli bir sitenin alan adı) reddedilir.
            ["AllowedHosts"] = "localhost;127.0.0.1",
        };
        configuration.AddInMemoryCollection(defaults.Where(pair => pair.Value is not null));

        var port = configuration.GetValue("LocalMode:Port", 0);
        builder.WebHost.ConfigureKestrel(kestrel => kestrel.Listen(IPAddress.Loopback, port));
        builder.Services.AddHostedService<ParentProcessWatcher>();
    }

    public static string[] AllowedOrigins(IConfiguration configuration) =>
        configuration.GetSection("LocalMode:AllowedOrigins").Get<string[]>() is { Length: > 0 } configured ? configured : AppOrigins;

    /// <summary>Kapalı uçlara gelen istekleri 404 ile yanıtlar.</summary>
    public static IApplicationBuilder UseLocalModeGate(this IApplicationBuilder app) => app.Use(async (context, next) =>
    {
        if (IsBlocked(context.Request))
        {
            await Results.Problem(
                    detail: L.T("local_mode.unavailable", "Bu özellik kişisel kullanımda (yerel mod) yok."),
                    statusCode: StatusCodes.Status404NotFound,
                    extensions: new Dictionary<string, object?> { ["code"] = "local_mode.unavailable" })
                .ExecuteAsync(context);
            return;
        }

        await next(context);
    });

    internal static bool IsBlocked(HttpRequest request)
    {
        var path = request.Path;
        if (BlockedPrefixes.Any(prefix => path.StartsWithSegments(prefix, StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        if (path.StartsWithSegments("/api/organizations", StringComparison.OrdinalIgnoreCase, out var rest))
        {
            return (rest.HasValue && rest.Value != "/") || !HttpMethods.IsGet(request.Method);
        }

        // Workspace paylaşımı (üyeler, takımlar) ekip özelliği; ad değiştirme açık.
        return path.StartsWithSegments("/api/workspaces", StringComparison.OrdinalIgnoreCase, out var workspace)
            && workspace.Value?.Contains("/members", StringComparison.OrdinalIgnoreCase) == true;
    }

    /// <summary>
    /// Sunucu dinlemeye başlayınca stdout'a <c>APIVATOR_API_READY {"port":12345}</c> yazar; masaüstü uygulaması portu
    /// buradan öğrenir (<c>LocalMode:Port</c> = 0 ise işletim sistemi boş bir port seçer).
    /// </summary>
    public static void AnnounceReady(WebApplication app) => app.Lifetime.ApplicationStarted.Register(() =>
    {
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()?.Addresses.FirstOrDefault();
        if (address is not null && Uri.TryCreate(address, UriKind.Absolute, out var uri))
        {
            Console.Out.WriteLine($"{ReadyPrefix}{{\"port\":{uri.Port}}}");
            Console.Out.Flush();
        }
    });
}

/// <summary>Masaüstü uygulaması kapanır ya da çökerse (<c>LocalMode:ParentPid</c>) API de kapanır.</summary>
internal sealed class ParentProcessWatcher(IConfiguration configuration, IHostApplicationLifetime lifetime) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (configuration.GetValue<int?>("LocalMode:ParentPid") is not { } pid)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            if (!IsAlive(pid))
            {
                lifetime.StopApplication();
                return;
            }
        }
    }

    private static bool IsAlive(int pid)
    {
        try
        {
            using var process = System.Diagnostics.Process.GetProcessById(pid);
            return !process.HasExited;
        }
        catch (ArgumentException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }
}
