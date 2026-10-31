using System.Collections.Frozen;
using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.RegularExpressions;
using Apivator.Application.Common.Localization;
using Xunit.Abstractions;

namespace Apivator.Api.IntegrationTests;

/// <summary>
/// Sunucu metinlerinin kataloğu (Faz 8.2): koddaki her <c>L.T("kimlik", "Türkçe")</c> çağrısının her dilde aynı yer
/// tutucularla karşılığı olmalı; katalogda kullanılmayan kimlik kalmamalı. Denetlenen diller katalog klasörlerinden
/// bulunur (yeni dil klasörü eklenince otomatik denetlenir); İngilizcede eksik anahtar hata, diğer dillerde uyarıdır.
/// </summary>
public partial class LocalizationTests(ITestOutputHelper output)
{
    /// <summary>Eksik anahtarı hata sayılan diller; diğer dillerde (klasörden bulunur) eksik anahtar yalnızca uyarıdır.</summary>
    private const string RequiredLanguage = "en";

    private static readonly string SourceRoot = FindSourceRoot();

    [Fact]
    public void EveryCall_HasCatalogEntry_WithSamePlaceholders()
    {
        var calls = Calls();
        Assert.NotEmpty(calls);
        var problems = new List<string>();
        foreach (var (language, catalog) in L.AllCatalogs())
        {
            var missingIsError = language == RequiredLanguage;
            foreach (var (key, (turkish, file)) in calls)
            {
                if (!catalog.TryGetValue(key, out var text) || string.IsNullOrWhiteSpace(text))
                {
                    var message = $"{language}: eksik '{key}' ({file})";
                    if (missingIsError)
                    {
                        problems.Add(message);
                    }
                    else
                    {
                        output.WriteLine($"UYARI {message}; çalışma anında {RequiredLanguage} metni gösterilir");
                    }
                }
                else if (!L.Placeholders(text).SetEquals(L.Placeholders(turkish)))
                {
                    problems.Add($"{language}: '{key}' yer tutucuları farklı ({string.Join(",", L.Placeholders(turkish))} ≠ {string.Join(",", L.Placeholders(text))})");
                }
            }

            problems.AddRange(catalog.Keys.Where(k => !calls.ContainsKey(k)).Select(k => $"{language}: kullanılmayan '{k}'"));
        }

        Assert.True(problems.Count == 0, string.Join('\n', problems));
    }

    [Fact]
    public void SameKey_IsNotUsedForDifferentTurkishText()
    {
        var conflicts = new List<string>();
        var seen = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (key, turkish, file) in RawCalls())
        {
            if (seen.TryGetValue(key, out var previous) && previous != turkish)
            {
                conflicts.Add($"'{key}': \"{previous}\" ≠ \"{turkish}\" ({file})");
            }

            seen.TryAdd(key, turkish);
        }

        Assert.True(conflicts.Count == 0, string.Join('\n', conflicts));
    }

    [Fact]
    public void Calls_UsePlainLiterals()
    {
        // $"..." ya da değişkenle çağrılırsa katalog denetlenemez ve çeviri bulunamaz.
        var bad = SourceFiles()
            .SelectMany(file => NonLiteralCall().Matches(File.ReadAllText(file)).Select(m => $"{Path.GetFileName(file)}: {m.Value}"))
            .ToList();
        Assert.True(bad.Count == 0, string.Join('\n', bad));
    }

    [Fact]
    public void Resolve_FallsBackToEnglishThenTurkish()
    {
        var catalogs = new Dictionary<string, FrozenDictionary<string, string>>
        {
            ["en"] = new Dictionary<string, string> { ["a"] = "English A", ["b"] = "English B" }.ToFrozenDictionary(),
            ["de"] = new Dictionary<string, string> { ["a"] = "Deutsch A" }.ToFrozenDictionary(),
        };

        Assert.Equal("Deutsch A", L.Resolve(catalogs, "de", "a", "Türkçe A"));
        Assert.Equal("English B", L.Resolve(catalogs, "de", "b", "Türkçe B"));
        Assert.Equal("Türkçe C", L.Resolve(catalogs, "de", "c", "Türkçe C"));
        Assert.Equal("English B", L.Resolve(catalogs, "fr", "b", "Türkçe B"));
        Assert.Equal("Türkçe A", L.Resolve(catalogs, "tr", "a", "Türkçe A"));
    }

    [Fact]
    public void Format_UsesActiveLanguage()
    {
        using (Lang.Use("en"))
        {
            Assert.Equal("An unexpected error occurred.", L.T("api.unexpected", "Beklenmeyen bir hata oluştu."));
            Assert.Equal("a 1,500 b", L.T("test.none", "a {n:N0} b", ("n", 1500)));
        }

        Assert.Equal("Beklenmeyen bir hata oluştu.", L.T("api.unexpected", "Beklenmeyen bir hata oluştu."));
        Assert.Equal("a 1.500 b {x}", L.T("test.none", "a {n:N0} b {x}", ("n", 1500)));
    }

    [Theory]
    [InlineData("en-US,en;q=0.9", "en")]
    [InlineData("de-DE, en;q=0.5, tr;q=0.8", "tr")]
    [InlineData("de-DE", null)]
    [InlineData("", null)]
    [InlineData("EN", "en")]
    public void AcceptLanguage_PicksBestSupported(string header, string? expected) =>
        Assert.Equal(expected, Lang.FromAcceptLanguage(header));

    private static Dictionary<string, (string Turkish, string File)> Calls()
    {
        var result = new Dictionary<string, (string, string)>(StringComparer.Ordinal);
        foreach (var (key, turkish, file) in RawCalls())
        {
            result.TryAdd(key, (turkish, file));
        }

        return result;
    }

    private static IEnumerable<(string Key, string Turkish, string File)> RawCalls() =>
        SourceFiles().SelectMany(file => LiteralCall().Matches(File.ReadAllText(file))
            .Select(m => (m.Groups[1].Value, Regex.Unescape(m.Groups[2].Value), Path.GetFileName(file))));

    private static IEnumerable<string> SourceFiles() =>
        Directory.EnumerateFiles(SourceRoot, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !f.EndsWith($"{Path.DirectorySeparatorChar}L.cs", StringComparison.Ordinal));

    // Derleme anındaki kaynak yolu: --artifacts-path ile çıktı depo dışında olsa da kaynak bulunur.
    private static string FindSourceRoot([CallerFilePath] string thisFile = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(thisFile)!, "..", "..", "src"));

    // L.T("kimlik", "Türkçe metin" — kimlik ve metin düz dize sabiti.
    [GeneratedRegex("""\bL\.T\(\s*"([^"\\]+)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*[,)]""")]
    private static partial Regex LiteralCall();

    [GeneratedRegex("""\bL\.T\(\s*(?!"[^"\\]+"\s*,\s*"(?:[^"\\]|\\.)*"\s*[,)])[^\n]{0,80}""")]
    private static partial Regex NonLiteralCall();
}

[Collection(ApiCollection.Name)]
public class LocalizedResponseTests(ApivatorApiFactory factory)
{
    [Theory]
    [InlineData("en-US,en;q=0.9", "Incorrect email or password.")]
    [InlineData("tr", "E-posta veya şifre hatalı.")]
    [InlineData(null, "E-posta veya şifre hatalı.")]
    public async Task ProblemDetail_FollowsAcceptLanguage(string? acceptLanguage, string expected)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/login")
        {
            Content = JsonContent.Create(new { email = "yok-" + Guid.NewGuid().ToString("N") + "@example.com", password = "Yanlis-Sifre-123" }),
        };
        if (acceptLanguage is not null)
        {
            request.Headers.TryAddWithoutValidation("Accept-Language", acceptLanguage);
        }

        var response = await factory.CreateClient().SendAsync(request);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(expected, body.RootElement.GetProperty("detail").GetString());
        Assert.Equal("auth.invalid_credentials", body.RootElement.GetProperty("code").GetString());
    }
}
