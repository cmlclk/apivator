using System.ComponentModel.DataAnnotations;

namespace Apivator.Infrastructure.Identity;

public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    [Required]
    public string Issuer { get; set; } = "apivator";

    [Required]
    public string Audience { get; set; } = "apivator";

    /// <summary>HMAC-SHA256 imzalama anahtarı; en az 32 karakter.</summary>
    [Required]
    [MinLength(32)]
    public string SigningKey { get; set; } = string.Empty;

    [Range(1, 1440)]
    public int AccessTokenMinutes { get; set; } = 15;

    [Range(1, 365)]
    public int RefreshTokenDays { get; set; } = 14;
}
