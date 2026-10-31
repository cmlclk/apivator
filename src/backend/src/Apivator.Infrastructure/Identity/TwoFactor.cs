using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;

namespace Apivator.Infrastructure.Identity;

/// <summary>
/// İki adımlı doğrulama yardımcıları: TOTP anahtarının şifrelenmesi, kod/yedek kod doğrulaması ve girişteki
/// kısa ömürlü "ikinci adım" belirteci.
/// </summary>
internal sealed class TwoFactor(IDataProtectionProvider protection, TimeProvider clock)
{
    public const string Issuer = "Apivator";
    public const int RecoveryCodeCount = 10;
    public static readonly TimeSpan ChallengeLifetime = TimeSpan.FromMinutes(5);

    private const string RecoveryAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";

    private readonly IDataProtector _keys = protection.CreateProtector("Apivator.Authenticator.v1");
    private readonly ITimeLimitedDataProtector _challenges = protection.CreateProtector("Apivator.TwoFactorLogin.v1").ToTimeLimitedDataProtector();

    public enum Outcome
    {
        Invalid,
        Totp,
        RecoveryCode,
    }

    public string ProtectKey(string secret) => _keys.Protect(secret);

    public string? Secret(ApplicationUser user)
    {
        if (user.AuthenticatorKey is null)
        {
            return null;
        }

        try
        {
            return _keys.Unprotect(user.AuthenticatorKey);
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    /// <summary>
    /// Authenticator kodu ya da (izin verilirse) yedek kod. Doğruysa kullanıcı güncellenir: TOTP adımı kaydedilir
    /// (aynı kod tekrar kullanılamaz), kullanılan yedek kod silinir. Kaydetmek çağırana kalır.
    /// </summary>
    public Outcome Verify(ApplicationUser user, string? code, bool allowRecovery)
    {
        var normalized = Normalize(code);
        if (normalized.Length == Totp.Digits && normalized.All(char.IsAsciiDigit))
        {
            if (Secret(user) is not { } secret)
            {
                return Outcome.Invalid;
            }

            var step = Totp.Verify(secret, normalized, clock.GetUtcNow(), user.LastTotpStep);
            if (step is null)
            {
                return Outcome.Invalid;
            }

            user.LastTotpStep = step;
            return Outcome.Totp;
        }

        if (!allowRecovery || normalized.Length != 10)
        {
            return Outcome.Invalid;
        }

        var hash = Hash(normalized);
        var index = user.RecoveryCodeHashes.FindIndex(h => CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(h), Encoding.ASCII.GetBytes(hash)));
        if (index < 0)
        {
            return Outcome.Invalid;
        }

        user.RecoveryCodeHashes = [.. user.RecoveryCodeHashes.Where((_, i) => i != index)];
        return Outcome.RecoveryCode;
    }

    /// <summary>Yeni yedek kodlar ("abcde-fghjk"); yalnızca özetleri saklanır.</summary>
    public static (List<string> Codes, List<string> Hashes) NewRecoveryCodes()
    {
        var codes = new List<string>();
        for (var i = 0; i < RecoveryCodeCount; i++)
        {
            var chars = new char[10];
            for (var j = 0; j < chars.Length; j++)
            {
                chars[j] = RecoveryAlphabet[RandomNumberGenerator.GetInt32(RecoveryAlphabet.Length)];
            }

            codes.Add($"{new string(chars, 0, 5)}-{new string(chars, 5, 5)}");
        }

        return (codes, codes.Select(c => Hash(Normalize(c))).ToList());
    }

    public string CreateChallenge(ApplicationUser user) =>
        _challenges.Protect($"{user.Id}|{user.SecurityStamp}", ChallengeLifetime);

    /// <summary>Belirteç geçerliyse kullanıcı kimliği ve güvenlik damgası (şifre değişince damga değişir, belirteç düşer).</summary>
    public (Guid UserId, string Stamp)? ReadChallenge(string? token)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return null;
        }

        try
        {
            var parts = _challenges.Unprotect(token).Split('|', 2);
            return parts.Length == 2 && Guid.TryParse(parts[0], out var id) ? (id, parts[1]) : null;
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    private static string Normalize(string? code) =>
        new string((code ?? string.Empty).Where(char.IsAsciiLetterOrDigit).ToArray()).ToLowerInvariant();

    private static string Hash(string normalized) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.ASCII.GetBytes(normalized)));
}
