using System.Security.Cryptography;
using Apivator.Application.GitSync;
using Microsoft.AspNetCore.DataProtection;

namespace Apivator.Infrastructure.GitSync;

/// <summary>Erişim belirtecini ASP.NET Data Protection ile şifreler; çözülemeyen (anahtarı kaybolmuş) değer yok sayılır.</summary>
internal sealed class GitSecretProtector(IDataProtectionProvider protection) : IGitSecretProtector
{
    public const string Purpose = "Apivator.GitSync.Token.v1";

    private readonly IDataProtector _protector = protection.CreateProtector(Purpose);

    public string Protect(string secret) => _protector.Protect(secret);

    public string? Unprotect(string protectedSecret)
    {
        try
        {
            return _protector.Unprotect(protectedSecret);
        }
        catch (CryptographicException)
        {
            return null;
        }
    }
}
