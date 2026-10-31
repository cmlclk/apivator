using Apivator.Application.Account;

namespace Apivator.Infrastructure.Identity;

/// <summary>Kullanıcının güvenlik geçmişindeki bir kayıt (giriş, şifre değişikliği, 2FA, yönetici işlemi…).</summary>
public sealed class SecurityEvent
{
    public const int DeviceMaxLength = 120;
    public const int DetailMaxLength = 300;

    public Guid Id { get; set; } = Guid.CreateVersion7();

    public Guid UserId { get; set; }

    public SecurityEventKind Kind { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>"Chrome · Windows", "Apivator Masaüstü" gibi kısa cihaz adı.</summary>
    public string? Device { get; set; }

    public string? IpAddress { get; set; }

    /// <summary>İşlemi başkası yaptıysa (organizasyon yöneticisi).</summary>
    public Guid? ActorId { get; set; }

    public string? ActorName { get; set; }

    public string? Detail { get; set; }
}
