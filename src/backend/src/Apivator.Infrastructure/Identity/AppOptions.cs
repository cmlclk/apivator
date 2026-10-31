using System.ComponentModel.DataAnnotations;

namespace Apivator.Infrastructure.Identity;

public sealed class AppOptions
{
    public const string SectionName = "App";

    /// <summary>Web arayüzünün adresi; e-postadaki doğrulama ve şifre sıfırlama linkleri buna göre üretilir.</summary>
    [Required]
    [Url]
    public string PublicUrl { get; set; } = "http://localhost:5173";
}
