using System.Globalization;
using Apivator.Application.Account;

namespace Apivator.Application.Common.Localization;

/// <summary>
/// Etkin dil (Faz 8). HTTP isteklerinde ara katman, arka plan işlerinde (monitör, e-posta) çağıran taraf
/// <see cref="Use"/> ile belirler; belirlenmemişse Türkçe. İşletim sisteminin kültürüne bakılmaz.
/// </summary>
public static class Lang
{
    public const string Default = "tr";

    private static readonly AsyncLocal<string?> CurrentValue = new();

    private static readonly Dictionary<string, CultureInfo> Cultures = new(StringComparer.Ordinal)
    {
        ["tr"] = CultureInfo.GetCultureInfo("tr-TR"),
        ["en"] = CultureInfo.GetCultureInfo("en-US"),
    };

    public static IReadOnlyList<string> Supported => UserPreferences.Languages;

    public static string Current => CurrentValue.Value ?? Default;

    /// <summary>Sayı ve tarih biçimleri için etkin dilin kültürü.</summary>
    public static CultureInfo Culture => CultureOf(Current);

    public static CultureInfo CultureOf(string language) =>
        Cultures.TryGetValue(language, out var culture) ? culture : Cultures[Default];

    /// <summary>"en-US", "EN" gibi bir etiketi desteklenen dile çevirir; desteklenmiyorsa null.</summary>
    public static string? Match(string? tag)
    {
        if (string.IsNullOrWhiteSpace(tag))
        {
            return null;
        }

        var primary = tag.Trim().Split('-', '_')[0].ToLowerInvariant();
        return Supported.Contains(primary) ? primary : null;
    }

    /// <summary>
    /// Accept-Language başlığından ilk desteklenen dil (q değerine göre); yoksa null.
    /// </summary>
    public static string? FromAcceptLanguage(string? header)
    {
        if (string.IsNullOrWhiteSpace(header))
        {
            return null;
        }

        var best = (Language: (string?)null, Quality: -1.0);
        foreach (var part in header.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var pieces = part.Split(';', StringSplitOptions.TrimEntries);
            var quality = 1.0;
            foreach (var parameter in pieces.Skip(1))
            {
                if (parameter.StartsWith("q=", StringComparison.OrdinalIgnoreCase)
                    && double.TryParse(parameter[2..], NumberStyles.Float, CultureInfo.InvariantCulture, out var q))
                {
                    quality = q;
                }
            }

            if (quality > best.Quality && quality > 0 && Match(pieces[0]) is { } language)
            {
                best = (language, quality);
            }
        }

        return best.Language;
    }

    /// <summary>Bloğun sonuna kadar etkin dili değiştirir (geçersiz ya da null dil Türkçe sayılır).</summary>
    public static IDisposable Use(string? language)
    {
        var previous = CurrentValue.Value;
        CurrentValue.Value = Match(language) ?? Default;
        return new Restore(previous);
    }

    private sealed class Restore(string? previous) : IDisposable
    {
        public void Dispose() => CurrentValue.Value = previous;
    }
}
