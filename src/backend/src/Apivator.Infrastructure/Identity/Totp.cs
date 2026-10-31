using System.Security.Cryptography;
using System.Text;

namespace Apivator.Infrastructure.Identity;

/// <summary>
/// RFC 6238 TOTP (HMAC-SHA1, 30 sn, 6 hane) — Google Authenticator, Microsoft Authenticator, 1Password vb. ile uyumlu.
/// Saat kaymasına karşı bir önceki ve bir sonraki adım da kabul edilir; aynı adım ikinci kez kabul edilmez.
/// </summary>
public static class Totp
{
    public const int Digits = 6;
    public const int PeriodSeconds = 30;
    private const string Base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

    /// <summary>160 bit rastgele anahtar (Base32).</summary>
    public static string NewSecret() => Base32Encode(RandomNumberGenerator.GetBytes(20));

    public static long Step(DateTimeOffset time) => time.ToUnixTimeSeconds() / PeriodSeconds;

    public static string Code(string secret, long step)
    {
        Span<byte> counter = stackalloc byte[8];
        for (var i = 7; i >= 0; i--)
        {
            counter[i] = (byte)(step & 0xFF);
            step >>= 8;
        }

        // RFC 6238 / authenticator uygulamaları HMAC-SHA1 kullanır; HMAC'te SHA-1 çakışma zayıflığı geçerli değildir.
#pragma warning disable CA5350
        var hash = HMACSHA1.HashData(Base32Decode(secret), counter);
#pragma warning restore CA5350
        var offset = hash[^1] & 0x0F;
        var binary = ((hash[offset] & 0x7F) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
        return (binary % 1_000_000).ToString("D6", System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>Kod geçerliyse eşleşen zaman adımı; <paramref name="lastUsedStep"/> ve öncesi reddedilir (tekrar kullanım).</summary>
    public static long? Verify(string secret, string? code, DateTimeOffset now, long? lastUsedStep)
    {
        var digits = new string((code ?? string.Empty).Where(char.IsAsciiDigit).ToArray());
        if (digits.Length != Digits)
        {
            return null;
        }

        var current = Step(now);
        for (var step = current - 1; step <= current + 1; step++)
        {
            if (lastUsedStep is { } last && step <= last)
            {
                continue;
            }

            if (CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Code(secret, step)), Encoding.ASCII.GetBytes(digits)))
            {
                return step;
            }
        }

        return null;
    }

    /// <summary>Authenticator uygulamalarının okuduğu QR içeriği.</summary>
    public static string Uri(string secret, string account, string issuer) =>
        $"otpauth://totp/{System.Uri.EscapeDataString(issuer)}:{System.Uri.EscapeDataString(account)}"
        + $"?secret={secret}&issuer={System.Uri.EscapeDataString(issuer)}&algorithm=SHA1&digits={Digits}&period={PeriodSeconds}";

    public static string Base32Encode(ReadOnlySpan<byte> data)
    {
        var result = new StringBuilder((data.Length * 8 + 4) / 5);
        int buffer = 0, bits = 0;
        foreach (var b in data)
        {
            buffer = (buffer << 8) | b;
            bits += 8;
            while (bits >= 5)
            {
                result.Append(Base32Alphabet[(buffer >> (bits - 5)) & 31]);
                bits -= 5;
            }
        }

        if (bits > 0)
        {
            result.Append(Base32Alphabet[(buffer << (5 - bits)) & 31]);
        }

        return result.ToString();
    }

    public static byte[] Base32Decode(string text)
    {
        var clean = text.Trim().TrimEnd('=').Replace(" ", string.Empty, StringComparison.Ordinal).ToUpperInvariant();
        var output = new List<byte>(clean.Length * 5 / 8);
        int buffer = 0, bits = 0;
        foreach (var c in clean)
        {
            var value = Base32Alphabet.IndexOf(c, StringComparison.Ordinal);
            if (value < 0)
            {
                throw new FormatException("Geçersiz Base32 karakteri.");
            }

            buffer = (buffer << 5) | value;
            bits += 5;
            if (bits >= 8)
            {
                output.Add((byte)((buffer >> (bits - 8)) & 0xFF));
                bits -= 8;
            }
        }

        return [.. output];
    }
}
