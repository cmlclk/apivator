using Apivator.Application.Common.Localization;

namespace Apivator.Application.Account;

/// <summary>
/// User-Agent'tan oturum listesinde gösterilecek kısa ad üretir ("Chrome · Windows"). Tam bir ayrıştırıcı değildir;
/// yaygın tarayıcı ve işletim sistemlerini tanır, gerisi "Bilinmeyen cihaz" olur.
/// </summary>
public static class DeviceLabel
{
    public const string Web = "web";
    public const string Desktop = "desktop";
    public const string Cli = "cli";

    /// <summary>İstemcinin bildirdiği uygulama türü; tanınmayan değerler "web" sayılır.</summary>
    public static string NormalizeApp(string? app) => app?.Trim().ToLowerInvariant() switch
    {
        Desktop => Desktop,
        Cli => Cli,
        _ => Web,
    };

    public static string Describe(string? userAgent, string? app)
    {
        var os = OperatingSystem(userAgent);
        var normalized = NormalizeApp(app);

        if (normalized == Desktop)
        {
            var desktop = L.T("device.desktop", "Apivator Masaüstü");
            return os is null ? desktop : $"{desktop} · {os}";
        }

        if (normalized == Cli || (userAgent?.StartsWith("apivator-cli", StringComparison.OrdinalIgnoreCase) ?? false))
        {
            return "Apivator CLI";
        }

        var browser = Browser(userAgent);
        return (browser, os) switch
        {
            (null, null) => L.T("device.unknown", "Bilinmeyen cihaz"),
            (null, _) => os!,
            (_, null) => browser,
            _ => $"{browser} · {os}",
        };
    }

    private static string? Browser(string? ua)
    {
        if (string.IsNullOrWhiteSpace(ua))
        {
            return null;
        }

        // Sıra önemli: Edge ve Opera "Chrome", Chrome da "Safari" içerir.
        if (ua.Contains("Edg/", StringComparison.Ordinal) || ua.Contains("Edge/", StringComparison.Ordinal))
        {
            return "Edge";
        }

        if (ua.Contains("OPR/", StringComparison.Ordinal) || ua.Contains("Opera", StringComparison.Ordinal))
        {
            return "Opera";
        }

        if (ua.Contains("YaBrowser/", StringComparison.Ordinal))
        {
            return "Yandex";
        }

        if (ua.Contains("Firefox/", StringComparison.Ordinal) || ua.Contains("FxiOS/", StringComparison.Ordinal))
        {
            return "Firefox";
        }

        if (ua.Contains("Chrome/", StringComparison.Ordinal) || ua.Contains("CriOS/", StringComparison.Ordinal))
        {
            return "Chrome";
        }

        if (ua.Contains("Safari/", StringComparison.Ordinal))
        {
            return "Safari";
        }

        return null;
    }

    private static string? OperatingSystem(string? ua)
    {
        if (string.IsNullOrWhiteSpace(ua))
        {
            return null;
        }

        if (ua.Contains("Windows", StringComparison.Ordinal))
        {
            return "Windows";
        }

        if (ua.Contains("iPhone", StringComparison.Ordinal) || ua.Contains("iPad", StringComparison.Ordinal))
        {
            return "iOS";
        }

        if (ua.Contains("Mac OS X", StringComparison.Ordinal) || ua.Contains("Macintosh", StringComparison.Ordinal))
        {
            return "macOS";
        }

        if (ua.Contains("Android", StringComparison.Ordinal))
        {
            return "Android";
        }

        if (ua.Contains("CrOS", StringComparison.Ordinal))
        {
            return "ChromeOS";
        }

        if (ua.Contains("Linux", StringComparison.Ordinal))
        {
            return "Linux";
        }

        return null;
    }
}
