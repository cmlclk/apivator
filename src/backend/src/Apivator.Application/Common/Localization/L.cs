using System.Collections.Frozen;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Apivator.Application.Common.Localization;

/// <summary>
/// Sunucunun kullanıcıya gösterdiği metinler (Faz 8.2). Türkçe kaynak dildir ve kodda kalır:
/// <c>L.T("api_key.limit", "En fazla {max} etkin anahtarınız olabilir.", ("max", ApiKey.MaxActivePerUser))</c>.
/// Diğer diller <c>Localization/locales/&lt;dil&gt;/*.json</c> kataloglarından gelir (gömülü kaynak, düz
/// "kimlik": "metin" nesnesi). Katalogda olmayan metin önce İngilizce, o da yoksa Türkçe döner.
/// </summary>
/// <remarks>
/// Kimlik ve Türkçe metin düz dize sabiti olmalı (<c>$"..."</c> değil); <c>LocalizationTests</c> kodu tarayıp her
/// kimliğin katalogda aynı yer tutucularla karşılığı olduğunu denetler. Yer tutucu: <c>{ad}</c> ya da
/// <c>{ad:N0}</c> (biçim etkin dilin kültürüyle uygulanır). Metin <see cref="Lang.Current"/>'e göre çağrı anında
/// seçilir; bu yüzden metin taşıyan <c>static readonly</c> alanlar yerine özellik (<c>=&gt;</c>) kullanılır.
/// </remarks>
public static partial class L
{
    private const string FallbackLanguage = "en";

    private static readonly Lazy<FrozenDictionary<string, FrozenDictionary<string, string>>> Catalogs = new(Load);

    public static string T(string key, string turkish) => Format(Template(key, turkish), []);

    public static string T(string key, string turkish, params (string Name, object? Value)[] args) =>
        Format(Template(key, turkish), args);

    /// <summary>Kataloğu yükler ve dil başına kimlikleri döndürür (testler için).</summary>
    public static IReadOnlyDictionary<string, FrozenDictionary<string, string>> AllCatalogs() => Catalogs.Value;

    /// <summary>Metindeki yer tutucu adları (testler için).</summary>
    public static IReadOnlySet<string> Placeholders(string template) =>
        PlaceholderPattern().Matches(template).Select(m => m.Groups[1].Value).ToHashSet(StringComparer.Ordinal);

    private static string Template(string key, string turkish) =>
        Resolve(Catalogs.Value, Lang.Current, key, turkish);

    /// <summary>
    /// Metin seçimi: etkin dil → İngilizce → Türkçe (koddaki metin). Üçüncü dilde eksik metin İngilizce görünür.
    /// Katalog parametre olduğu için testler sahte katalogla dener.
    /// </summary>
    public static string Resolve(
        IReadOnlyDictionary<string, FrozenDictionary<string, string>> catalogs,
        string language,
        string key,
        string turkish)
    {
        if (language == Lang.Default)
        {
            return turkish;
        }

        foreach (var candidate in new[] { language, FallbackLanguage })
        {
            if (catalogs.TryGetValue(candidate, out var catalog) && catalog.TryGetValue(key, out var text))
            {
                return text;
            }
        }

        return turkish;
    }

    private static string Format(string template, (string Name, object? Value)[] args)
    {
        if (args.Length == 0)
        {
            return template;
        }

        var culture = Lang.Culture;
        return PlaceholderPattern().Replace(template, match =>
        {
            var name = match.Groups[1].Value;
            foreach (var (argName, value) in args)
            {
                if (argName == name)
                {
                    var format = match.Groups[2].Success ? match.Groups[2].Value : null;
                    return value is IFormattable formattable
                        ? formattable.ToString(format, culture)
                        : value?.ToString() ?? string.Empty;
                }
            }

            return match.Value;
        });
    }

    private static FrozenDictionary<string, FrozenDictionary<string, string>> Load()
    {
        const string prefix = "Apivator.Application.Localization.locales.";
        var assembly = typeof(L).Assembly;
        var result = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
        foreach (var name in assembly.GetManifestResourceNames().Where(n => n.StartsWith(prefix, StringComparison.Ordinal)))
        {
            // Apivator.Application.Localization.locales.en.collections.json → en
            var language = name[prefix.Length..].Split('.')[0];
            if (!result.TryGetValue(language, out var catalog))
            {
                result[language] = catalog = new Dictionary<string, string>(StringComparer.Ordinal);
            }

            using var stream = assembly.GetManifestResourceStream(name)!;
            using var document = JsonDocument.Parse(stream);
            foreach (var property in document.RootElement.EnumerateObject())
            {
                if (!catalog.TryAdd(property.Name, property.Value.GetString() ?? string.Empty))
                {
                    throw new InvalidOperationException($"Çeviri kimliği iki kez tanımlı: {language}/{property.Name} ({name}).");
                }
            }
        }

        return result.ToFrozenDictionary(
            pair => pair.Key,
            pair => pair.Value.ToFrozenDictionary(StringComparer.Ordinal),
            StringComparer.Ordinal);
    }

    [GeneratedRegex(@"\{([A-Za-z_][A-Za-z0-9_]*)(?::([^{}]+))?\}")]
    private static partial Regex PlaceholderPattern();
}
