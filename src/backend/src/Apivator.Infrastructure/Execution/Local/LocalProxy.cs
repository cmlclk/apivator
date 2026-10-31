using System.Net;

namespace Apivator.Infrastructure.Execution.Local;

/// <summary>Masaüstü ajanı ve CLI için özel proxy: joker karakterli hariç tutma listesiyle (localhost, *.local, 10.*).</summary>
public sealed class LocalProxy(Uri address, ICredentials? credentials, IReadOnlyList<string> bypass) : IWebProxy
{
    public ICredentials? Credentials { get; set; } = credentials;

    public Uri GetProxy(Uri destination) => address;

    public bool IsBypassed(Uri host) => bypass.Any(pattern => Matches(pattern.Trim(), host.Host));

    /// <summary>"*" herhangi bir karakter dizisi; büyük/küçük harf duyarsız; desen tüm adla eşleşmeli.</summary>
    public static bool Matches(string pattern, string host)
    {
        if (pattern.Length == 0)
        {
            return false;
        }

        var regex = "^" + System.Text.RegularExpressions.Regex.Escape(pattern).Replace("\\*", ".*", StringComparison.Ordinal) + "$";
        return System.Text.RegularExpressions.Regex.IsMatch(
            host, regex, System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(50));
    }
}
