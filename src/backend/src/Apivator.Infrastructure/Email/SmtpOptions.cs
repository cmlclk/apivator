using System.ComponentModel.DataAnnotations;

namespace Apivator.Infrastructure.Email;

public sealed class SmtpOptions
{
    public const string SectionName = "Smtp";

    /// <summary>Geliştirmede Mailpit (localhost:1025) kullanılır.</summary>
    [Required]
    public string Host { get; set; } = "localhost";

    [Range(1, 65535)]
    public int Port { get; set; } = 1025;

    public bool EnableSsl { get; set; }

    public string? UserName { get; set; }

    public string? Password { get; set; }

    [Required]
    [EmailAddress]
    public string FromAddress { get; set; } = "no-reply@apivator.local";

    public string FromName { get; set; } = "Apivator";
}
