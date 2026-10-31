namespace Apivator.Infrastructure.Identity;

/// <summary>Profil görseli; kullanıcı tablosu her sorguda büyümesin diye ayrı tabloda.</summary>
public sealed class UserAvatar
{
    public Guid UserId { get; set; }

    public string ContentType { get; set; } = string.Empty;

    public byte[] Data { get; set; } = [];

    public DateTimeOffset UpdatedAt { get; set; }
}
