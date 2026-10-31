using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Infrastructure.Email;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Identity;

/// <summary>Güvenlik geçmişine kayıt ekler (çağıranın SaveChanges'i ile yazılır) ve yeni cihaz uyarısı gönderir.</summary>
internal sealed class SecurityLog(
    AppDbContext db,
    ICurrentClient current,
    IEmailSender email,
    IOptions<AppOptions> appOptions,
    TimeProvider clock,
    ILogger<SecurityLog> logger)
{
    /// <summary>Kayıtlar bu süreden sonra silinir.</summary>
    public static readonly TimeSpan Retention = TimeSpan.FromDays(365);

    /// <summary>Yeni cihaz karşılaştırması bu süredeki girişlere bakar.</summary>
    private static readonly TimeSpan DeviceMemory = TimeSpan.FromDays(180);

    public SecurityEvent Add(
        Guid userId,
        SecurityEventKind kind,
        ClientInfo? client = null,
        Guid? actorId = null,
        string? actorName = null,
        string? detail = null)
    {
        // Yönetici işlemlerinde cihaz/IP yöneticinindir; üyenin geçmişinde karışıklık yaratmasın diye yazılmaz.
        var info = actorId is null ? client ?? current.Info : ClientInfo.Unknown;
        var entry = new SecurityEvent
        {
            UserId = userId,
            Kind = kind,
            CreatedAt = clock.GetUtcNow(),
            Device = info.UserAgent is null && info.App is null ? null : Clip(DeviceLabel.Describe(info.UserAgent, info.App), SecurityEvent.DeviceMaxLength),
            IpAddress = Clip(info.IpAddress, RefreshToken.IpAddressMaxLength),
            ActorId = actorId,
            ActorName = Clip(actorName, 200),
            Detail = Clip(detail, SecurityEvent.DetailMaxLength),
        };
        db.SecurityEvents.Add(entry);
        return entry;
    }

    /// <summary>
    /// Başarılı girişi kaydeder. Daha önce girişi olan bir hesapta bu cihazdan (tarayıcı + işletim sistemi ya da
    /// uygulama) son 180 günde giriş yoksa e-posta uyarısı gönderilir. Kayıt çağıranın SaveChanges'i ile yazılır.
    /// </summary>
    public async Task LoginSucceededAsync(ApplicationUser user, ClientInfo client, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var device = Clip(DeviceLabel.Describe(client.UserAgent, client.App), SecurityEvent.DeviceMaxLength);
        var since = now - DeviceMemory;
        var previous = await db.SecurityEvents.AsNoTracking()
            .Where(e => e.UserId == user.Id && e.Kind == SecurityEventKind.LoginSucceeded && e.CreatedAt > since)
            .Select(e => e.Device)
            .Distinct()
            .ToListAsync(ct);

        Add(user.Id, SecurityEventKind.LoginSucceeded, client);

        // Eski kayıtlar ara sıra temizlenir (her girişte en fazla bir sorgu).
        var cutoff = now - Retention;
        await db.SecurityEvents.Where(e => e.UserId == user.Id && e.CreatedAt < cutoff).ExecuteDeleteAsync(ct);

        if (previous.Count > 0 && !previous.Contains(device))
        {
            var link = appOptions.Value.PublicUrl.TrimEnd('/') + "/account?tab=security";
            try
            {
                await email.SendAsync(EmailTemplates.NewDeviceLogin(user.Email!, user.DisplayName, device ?? "bilinmeyen cihaz", client.IpAddress, now, link), ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Yeni cihaz uyarısı gönderilemedi.");
            }
        }
    }

    private static string? Clip(string? value, int max) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Length > max ? value[..max] : value;
}

/// <summary>HTTP dışı bağlamlar (arka plan işleri, testler) için.</summary>
internal sealed class UnknownClient : ICurrentClient
{
    public ClientInfo Info => ClientInfo.Unknown;
}

internal static class SecurityLogRegistration
{
    public static void AddSecurityLog(this Microsoft.Extensions.DependencyInjection.IServiceCollection services)
    {
        services.TryAddScoped<ICurrentClient, UnknownClient>();
        Microsoft.Extensions.DependencyInjection.ServiceCollectionServiceExtensions.AddScoped<SecurityLog>(services);
    }
}
