using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Apivator.Api.IntegrationTests;

/// <summary>
/// Dinamik değişkenlerin ortak sözleşmesi (src/shared/dynamic-variables.json). İstemci (packages/core
/// dynamicVariablesParity.test.ts) da aynı dosyaya karşı test edilir; doğrulayıcılar üreteçten bağımsız yazılmıştır.
/// </summary>
public static class DynamicVariableContract
{
    public sealed record Rule(
        string Name,
        string Pattern,
        string? Check,
        [property: JsonPropertyName("int")] double[]? IntRange,
        double[]? Number,
        string[]? Domains,
        double[]? SecondsFromNow);

    private sealed record ContractFile(List<Rule> Variables, List<string> Unresolved);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static readonly Lazy<ContractFile> File = new(() => JsonSerializer.Deserialize<ContractFile>(
        System.IO.File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "shared", "dynamic-variables.json")), Json)!);

    public static IReadOnlyList<Rule> Rules => File.Value.Variables;

    public static IReadOnlyList<string> Unresolved => File.Value.Unresolved;

    public static Rule Get(string name) => Rules.Single(r => r.Name == name);

    /// <summary>Kurala uymuyorsa nedeni ("biçim", "tckn"…), uyuyorsa null.</summary>
    public static string? Violation(Rule rule, string value, DateTimeOffset now)
    {
        if (!Regex.IsMatch(value, rule.Pattern))
        {
            return "biçim";
        }

        if (rule.Check is { } check && !(check switch
        {
            "tckn" => TcknValid(value),
            "iban" => IbanValid(value),
            "luhn" => LuhnValid(value),
            _ => false,
        }))
        {
            return check;
        }

        var number = double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ? n : double.NaN;
        if (rule.IntRange is [var imin, var imax] && !(number == Math.Floor(number) && number >= imin && number <= imax))
        {
            return "aralık";
        }

        if (rule.Number is [var min, var max] && !(number >= min && number <= max))
        {
            return "aralık";
        }

        if (rule.Domains is { } domains)
        {
            var host = value.Contains('@', StringComparison.Ordinal) ? value.Split('@')[1] : new Uri(value).Host;
            if (!domains.Any(d => host == d || host.EndsWith("." + d, StringComparison.Ordinal)))
            {
                return "alan adı";
            }
        }

        if (rule.SecondsFromNow is [var from, var to])
        {
            var at = Regex.IsMatch(value, "^[0-9]+$")
                ? DateTimeOffset.FromUnixTimeSeconds(long.Parse(value, CultureInfo.InvariantCulture))
                : DateTimeOffset.Parse(value, CultureInfo.InvariantCulture);
            var offset = (at - now).TotalSeconds;
            if (!(offset >= from && offset <= to))
            {
                return "zaman";
            }
        }

        return null;
    }

    private static bool TcknValid(string s)
    {
        var d = s.Select(c => c - '0').ToArray();
        var odd = d[0] + d[2] + d[4] + d[6] + d[8];
        var even = d[1] + d[3] + d[5] + d[7];
        return d[0] != 0 && d[9] == (((odd * 7) - even) % 10 + 10) % 10 && d[10] == d.Take(10).Sum() % 10;
    }

    private static bool LuhnValid(string s)
    {
        var sum = 0;
        for (var i = 0; i < s.Length; i++)
        {
            var n = s[s.Length - 1 - i] - '0';
            if (i % 2 == 1)
            {
                n = n * 2 > 9 ? (n * 2) - 9 : n * 2;
            }

            sum += n;
        }

        return sum % 10 == 0;
    }

    private static bool IbanValid(string s)
    {
        var rearranged = s[4..] + s[..4];
        var digits = string.Concat(rearranged.Select(c => char.IsLetter(c) ? (c - 'A' + 10).ToString(CultureInfo.InvariantCulture) : c.ToString()));
        var rest = 0;
        foreach (var c in digits)
        {
            rest = ((rest * 10) + (c - '0')) % 97;
        }

        return rest == 1;
    }
}
