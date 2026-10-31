using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using static Apivator.Application.Execution.DynamicValuesData;

namespace Apivator.Application.Execution;

/// <summary>
/// Postman'deki hazır dinamik değişkenler ({{$guid}}, {{$randomEmail}}…); her kullanımda yeniden üretilir.
/// İstemcideki üreteçle (packages/core/src/variables.ts + tools/fakeData.ts, Türkçe yerel ayar) aynı ad listesi,
/// biçim ve test-güvenli aralıklar; ortak sözleşme src/shared/dynamic-variables.json ile test edilir.
///
/// Güvenlik: e-posta yalnızca ayrılmış alan adlarına (RFC 2606), IP adresleri belgeleme bloklarına (RFC 5737 /
/// RFC 3849) gider; kart numaraları test önekleriyle, IBAN'lar atanmamış banka koduyla (999xx) üretilir. TCKN
/// algoritmaya uyar ama ayrılmış bir test aralığı yoktur. Rastgelelik kriptografik ve yansızdır.
/// </summary>
public static class DynamicValues
{
    private const string Lower = "abcdefghijklmnopqrstuvwxyz";
    private const string Upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    private const string Digits = "0123456789";
    private const string Symbols = "!@#$%&*?-_";
    private const int YearSeconds = 365 * 86_400;

    /// <summary>E-posta alan adları: yalnızca RFC 2606 ile ayrılmış olanlar.</summary>
    private static readonly string[] EmailDomains = ["example.com", "example.net", "example.org", "ornek.test"];

    /// <summary>Kart önekleri: 411111 (Visa test), 555555 (Mastercard test), 999999 (ISO 7812 "9" sektörü).</summary>
    private static readonly string[] CardPrefixes = ["411111", "555555", "999999"];

    /// <summary>RFC 5737 belgeleme blokları (TEST-NET-1/2/3).</summary>
    private static readonly string[] Ipv4Blocks = ["192.0.2", "198.51.100", "203.0.113"];

    private static readonly Dictionary<string, Func<string>> Generators = new(StringComparer.Ordinal)
    {
        ["$guid"] = Uuid,
        ["$randomUUID"] = Uuid,
        ["$timestamp"] = () => DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture),
        ["$isoTimestamp"] = () => Iso(DateTimeOffset.UtcNow),
        ["$randomInt"] = () => Int(1001).ToString(CultureInfo.InvariantCulture),
        ["$randomBoolean"] = () => Int(2) == 1 ? "true" : "false",
        ["$randomAlphaNumeric"] = () => Pick(Lower + Digits).ToString(),
        ["$randomFirstName"] = () => Person().First,
        ["$randomLastName"] = () => Person().Last,
        ["$randomFullName"] = FullName,
        ["$randomUserName"] = UserName,
        ["$randomEmail"] = Email,
        ["$randomExampleEmail"] = Email,
        ["$randomPhoneNumber"] = Phone,
        ["$randomWord"] = () => Pick(Words),
        ["$randomWords"] = () => $"{Pick(Words)} {Pick(Words)} {Pick(Words)}",
        ["$randomCity"] = () => Pick(Cities).Name,
        ["$randomStreetAddress"] = Address,
        ["$randomColor"] = () => Pick(ColorNames),
        ["$randomHexColor"] = () => "#" + Int(0x1000000).ToString("x6", CultureInfo.InvariantCulture),
        ["$randomUrl"] = () => $"https://{Fold(Pick(Words))}.example.com/{Fold(Pick(Words))}",
        ["$randomIP"] = () => $"{Pick(Ipv4Blocks)}.{Between(1, 254)}",
        ["$randomIPV6"] = Ipv6,
        ["$randomPrice"] = () => (Int(100_000) / 100m).ToString("0.##", CultureInfo.InvariantCulture),
        ["$randomDatePast"] = () => Iso(DateTimeOffset.UtcNow.AddSeconds(-Int(YearSeconds))),
        ["$randomDateFuture"] = () => Iso(DateTimeOffset.UtcNow.AddSeconds(1 + Int(YearSeconds))),
        ["$randomCompanyName"] = Company,
        ["$randomJobTitle"] = () => Pick(JobTitles),
        ["$randomPassword"] = Password,
        ["$randomTckn"] = Tckn,
        ["$randomIban"] = Iban,
        ["$randomBankAccountIban"] = Iban,
        ["$randomCreditCardNumber"] = CardNumber,
    };

    /// <summary>Desteklenen adlar (ör. "$randomEmail").</summary>
    public static IReadOnlyCollection<string> Names => Generators.Keys;

    /// <summary>Dinamik değişkenin yeni değeri; bilinmeyen adda null.</summary>
    public static string? Generate(string name) => Generators.TryGetValue(name, out var generate) ? generate() : null;

    private static int Int(int max) => RandomNumberGenerator.GetInt32(max);

    private static int Between(int min, int max) => min + Int(max - min + 1);

    private static T Pick<T>(IReadOnlyList<T> items) => items[Int(items.Count)];

    private static char Pick(string chars) => chars[Int(chars.Length)];

    private static string RandomDigits(int count)
    {
        var builder = new StringBuilder(count);
        for (var i = 0; i < count; i++)
        {
            builder.Append((char)('0' + Int(10)));
        }

        return builder.ToString();
    }

    private static string Iso(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    private static (string First, string Last) Person() =>
        (Pick(Int(2) == 0 ? FemaleNames : MaleNames), Pick(LastNames));

    /// <summary>Türkçe harfleri ASCII'ye indirger, harf/rakam dışını atar ("Şükrü" → "sukru").</summary>
    private static string Fold(string text)
    {
        var builder = new StringBuilder(text.Length);
        foreach (var ch in text)
        {
            var folded = ch switch
            {
                'Ç' or 'ç' => 'c',
                'Ğ' or 'ğ' => 'g',
                'I' or 'ı' or 'İ' => 'i',
                'Ö' or 'ö' => 'o',
                'Ş' or 'ş' => 's',
                'Ü' or 'ü' => 'u',
                _ => char.ToLowerInvariant(ch),
            };
            if (folded is (>= 'a' and <= 'z') or (>= '0' and <= '9'))
            {
                builder.Append(folded);
            }
        }

        return builder.ToString();
    }

    private static string Uuid() => Guid.NewGuid().ToString();

    private static string FullName()
    {
        var (first, last) = Person();
        return $"{first} {last}";
    }

    private static string UserName()
    {
        var (first, last) = Person();
        return $"{Fold(first)}.{Fold(last)}{Int(100)}";
    }

    private static string Email()
    {
        var (first, last) = Person();
        return $"{Fold(first)}.{Fold(last)}{Int(1000)}@{Pick(EmailDomains)}";
    }

    /// <summary>Yalnızca biçim (+90 5xx); Türkiye'de kurgu için ayrılmış bir mobil aralık yoktur.</summary>
    private static string Phone() =>
        $"+90 5{Pick("0345")}{RandomDigits(1)} {RandomDigits(3)} {RandomDigits(2)} {RandomDigits(2)}";

    private static string Address()
    {
        var city = Pick(Cities);
        var street = Pick(Streets);
        var type = Pick(StreetTypes);
        var district = Pick(city.Districts);
        var postalCode = city.PostalPrefix + RandomDigits(5 - city.PostalPrefix.Length);
        return $"{Pick(Neighborhoods)} Mah. {street} {type} No: {Between(1, 180)}, {postalCode} {district}/{city.Name}";
    }

    /// <summary>RFC 3849 belgeleme öneki 2001:db8::/32.</summary>
    private static string Ipv6() =>
        "2001:db8:" + string.Join(':', Enumerable.Range(0, 6).Select(_ => Int(0x10000).ToString("x", CultureInfo.InvariantCulture)));

    private static string Company()
    {
        var head = Int(2) == 0 ? Person().Last : Pick(CompanyWords);
        return $"{head} {Pick(CompanySectors)} {Pick(CompanySuffixes)}";
    }

    /// <summary>14 karakter; en az bir büyük harf, küçük harf, rakam ve sembol; karıştırılmış.</summary>
    private static string Password()
    {
        var chars = new List<char> { Pick(Upper), Pick(Lower), Pick(Digits), Pick(Symbols) };
        const string pool = Upper + Lower + Digits + Symbols;
        while (chars.Count < 14)
        {
            chars.Add(Pick(pool));
        }

        for (var i = chars.Count - 1; i > 0; i--)
        {
            var j = Int(i + 1);
            (chars[i], chars[j]) = (chars[j], chars[i]);
        }

        return new string([.. chars]);
    }

    /// <summary>TCKN: 11 hane, ilk hane 0 değil; 10. hane = (tek sıralar×7 − çift sıralar) mod 10, 11. hane = ilk 10'un toplamı mod 10.</summary>
    private static string Tckn()
    {
        var d = new int[11];
        d[0] = 1 + Int(9);
        for (var i = 1; i < 9; i++)
        {
            d[i] = Int(10);
        }

        var odd = d[0] + d[2] + d[4] + d[6] + d[8];
        var even = d[1] + d[3] + d[5] + d[7];
        d[9] = (((odd * 7) - even) % 10 + 10) % 10;
        d[10] = d.Take(10).Sum() % 10;
        return string.Concat(d);
    }

    /// <summary>Luhn (mod 10) kontrol hanesi: <paramref name="payload"/> sonuna eklenecek hane.</summary>
    internal static int LuhnCheckDigit(string payload)
    {
        var sum = 0;
        for (var i = 0; i < payload.Length; i++)
        {
            var n = payload[payload.Length - 1 - i] - '0';
            if (i % 2 == 0)
            {
                n *= 2;
                if (n > 9)
                {
                    n -= 9;
                }
            }

            sum += n;
        }

        return (10 - (sum % 10)) % 10;
    }

    private static string CardNumber()
    {
        var prefix = Pick(CardPrefixes);
        var payload = prefix + RandomDigits(15 - prefix.Length);
        return payload + LuhnCheckDigit(payload).ToString(CultureInfo.InvariantCulture);
    }

    /// <summary>ISO 7064 mod 97; harfler A=10 … Z=35.</summary>
    internal static int Mod97(string text)
    {
        var rest = 0;
        foreach (var ch in text)
        {
            var part = ch >= 'A' ? (ch - 55).ToString(CultureInfo.InvariantCulture) : ch.ToString();
            foreach (var digit in part)
            {
                rest = ((rest * 10) + (digit - '0')) % 97;
            }
        }

        return rest;
    }

    /// <summary>
    /// TR IBAN: TR + 2 kontrol + 5 banka kodu + 1 rezerv (0) + 16 hesap. Banka kodu 99900–99999: TCMB'nin atadığı
    /// EFT kodları bu aralıkta değildir, numara gerçek bir hesaba karşılık gelmez.
    /// </summary>
    private static string Iban()
    {
        var bban = "999" + RandomDigits(2) + "0" + RandomDigits(16);
        var check = 98 - Mod97(bban + "TR00");
        return "TR" + check.ToString("00", CultureInfo.InvariantCulture) + bban;
    }
}
