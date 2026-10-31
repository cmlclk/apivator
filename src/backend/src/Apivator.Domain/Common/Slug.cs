using System.Globalization;
using System.Text;

namespace Apivator.Domain.Common;

/// <summary>URL'de kullanılabilecek, Türkçe karakterleri dönüştüren kısa ad üretir.</summary>
public static class Slug
{
    public const int MaxLength = 64;

    public static string From(string value)
    {
        ArgumentNullException.ThrowIfNull(value);

        var builder = new StringBuilder(value.Length);
        var lastWasDash = true;

        foreach (var raw in value.Trim().ToLower(CultureInfo.GetCultureInfo("tr-TR")))
        {
            var c = raw switch
            {
                'ç' => 'c',
                'ğ' => 'g',
                'ı' => 'i',
                'ö' => 'o',
                'ş' => 's',
                'ü' => 'u',
                'â' => 'a',
                'î' => 'i',
                'û' => 'u',
                _ => raw,
            };

            if (c is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                builder.Append(c);
                lastWasDash = false;
            }
            else if (!lastWasDash)
            {
                builder.Append('-');
                lastWasDash = true;
            }

            if (builder.Length >= MaxLength)
            {
                break;
            }
        }

        var slug = builder.ToString().Trim('-');
        return slug.Length == 0 ? "workspace" : slug;
    }
}
