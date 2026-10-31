using System.Text.RegularExpressions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Domain.GitSync;

namespace Apivator.Application.GitSync;

public sealed class GitSyncOptions
{
    public const string SectionName = "GitSync";

    /// <summary>Yalnızca geliştirme/test: http:// adreslerine izin verir.</summary>
    public bool AllowHttp { get; set; }

    /// <summary>Yalnızca test: file:// ve yerel yol adreslerine izin verir (SSRF denetimi atlanır).</summary>
    public bool AllowLocalRemotes { get; set; }

    /// <summary>Geçici çalışma dizini; boşsa sistemin geçici dizini altında "apivator-git".</summary>
    public string? WorkDirectory { get; set; }

    /// <summary>false ise otomatik uzak kontrol yapılmaz (testler zamanlayıcıyı kendileri tetikler).</summary>
    public bool SchedulerEnabled { get; set; } = true;

    public int PollSeconds { get; set; } = 60;

    public int MaxConcurrent { get; set; } = 2;

    /// <summary>Tek depo yanıtının üst sınırı (MB).</summary>
    public int MaxFetchMegabytes { get; set; } = 256;

    /// <summary>Tek git HTTP isteğinin (başlık + gövde) toplam süre sınırı, saniye.</summary>
    public int HttpTimeoutSeconds { get; set; } = 300;
}

/// <summary>Bağlantı ayarlarının doğrulanması ve düzgeleştirilmesi (sistem sınırı).</summary>
internal static partial class GitSyncSettings
{
    public const string DefaultFolder = "apivator";
    public const int TokenMaxLength = 2000;

    [GeneratedRegex(@"^[A-Za-z0-9._/\-]{1,200}$")]
    private static partial Regex BranchPattern();

    [GeneratedRegex(@"^[^<>:""|?*\\\x00-\x1f]+$")]
    private static partial Regex SegmentPattern();

    /// <summary>
    /// Depo adresini doğrular ve kanonik biçimini döner; yalnızca kanonik metin saklanır ve libgit2/HTTP'ye verilir.
    /// http(s) adreslerinde kullanıcı bilgisi (@), ters eğik çizgi, boşluk/denetim karakteri, sorgu/parça ve
    /// kanonik biçimden farklı yazımlar (ondalık/onaltılık/sekizlik IP, IPv4-eşlenmiş IPv6) reddedilir.
    /// </summary>
    public static (string Url, Error? Error) CanonicalUrl(string? url)
    {
        var value = url?.Trim() ?? string.Empty;
        if (value.Length == 0 || value.Length > CollectionGitSync.UrlMaxLength)
        {
            return ("", Error.Validation("git.url_invalid", L.T("git.url_required", "Depo adresi gerekli.")));
        }

        // "https:/host" gibi biçimler de Uri tarafından http(s) sayılır; bu yüzden şemaya Uri karar verir.
        var webLike = Uri.TryCreate(value, UriKind.Absolute, out var parsed) && parsed.Scheme is "http" or "https";
        if (!webLike)
        {
            return (value, null); // https dışı adresleri (yalnızca testte yerel yol) guard karara bağlar.
        }

        if (value.Any(c => c <= ' ' || c == '\u007f' || c is (char)92 or '@' or '?' or '#'))
        {
            return ("", Error.Validation("git.url_invalid", L.T("git.url_chars", "Depo adresi geçersiz karakter içeriyor. Kullanıcı adı/şifre yazmayın; erişim belirtecini ayrı alana girin.")));
        }

        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.Equals(uri.AbsoluteUri.TrimEnd('/'), value.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))
        {
            return ("", Error.Validation("git.url_invalid", L.T("git.url_canonical", "Depo adresi kanonik biçimde yazılmalı (örn. https://github.com/firma/depo.git).")));
        }

        if (uri.HostNameType == UriHostNameType.IPv6 && System.Net.IPAddress.TryParse(uri.DnsSafeHost, out var ip) && (ip.IsIPv4MappedToIPv6 || ip.ToString().StartsWith("::ffff:", StringComparison.OrdinalIgnoreCase)))
        {
            return ("", Error.Validation("git.url_invalid", L.T("git.url_ipv4_mapped", "IPv4-eşlenmiş IPv6 adresleri desteklenmiyor; IPv4 adresini doğrudan yazın.")));
        }

        return (uri.AbsoluteUri.TrimEnd('/'), null);
    }

    /// <summary>Adresin sunucusu (küçük harf, port dahil); çözümlenemezse null.</summary>
    public static string? HostOf(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" ? uri.Authority.ToLowerInvariant() : null;

    public static Error? ValidateBranch(string? branch)
    {
        var value = branch?.Trim() ?? string.Empty;
        var bad = !BranchPattern().IsMatch(value)
            || value.Contains("..", StringComparison.Ordinal)
            || value.Contains("//", StringComparison.Ordinal)
            || value.StartsWith('/') || value.EndsWith('/') || value.StartsWith('-') || value.StartsWith('.')
            || value.EndsWith(".lock", StringComparison.Ordinal) || value.EndsWith('.');
        return bad ? Error.Validation("git.branch_invalid", L.T("git.branch_invalid", "Dal adı geçersiz.")) : null;
    }

    /// <summary>"/" ile ayrılmış göreli klasör yolu; boşsa varsayılan. Geçersizse hata.</summary>
    public static (string Path, Error? Error) NormalizeFolder(string? folder)
    {
        var path = (folder ?? string.Empty).Replace('\\', '/').Trim().Trim('/');
        if (path.Length == 0)
        {
            return (DefaultFolder, null);
        }

        var segments = path.Split('/');
        var bad = path.Length > CollectionGitSync.PathMaxLength
            || segments.Any(s => s.Length == 0 || s is "." or ".." || s.Trim() != s || s.EndsWith('.')
                || s.Equals(".git", StringComparison.OrdinalIgnoreCase) || !SegmentPattern().IsMatch(s));
        return bad
            ? ("", Error.Validation("git.path_invalid", L.T("git.path_invalid", "Klasör yolu geçersiz; depo içinde göreli bir yol girin (örn. api/collections).")))
            : (path, null);
    }
}
