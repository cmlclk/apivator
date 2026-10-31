using System.Net.Sockets;
using System.Security.Authentication;
using Apivator.Application.Common.Localization;

namespace Apivator.Infrastructure.Execution;

/// <summary>Bağlantı hatalarının kullanıcıya gösterilen açıklaması (HTTP, akış ve gRPC çağrıları ortak).</summary>
internal static class NetworkErrors
{
    public static (string Code, string Message) Describe(HttpRequestException ex, Uri uri, string? sslHint)
    {
        for (Exception? inner = ex; inner is not null; inner = inner.InnerException)
        {
            switch (inner)
            {
                case BlockedDestinationException blocked:
                    return ("blocked", blocked.Message + " " + L.T("network.blocked_hint", "Yöneticiniz Proxy:AllowedNetworks ayarıyla izin verebilir."));
                case SocketException { SocketErrorCode: SocketError.HostNotFound or SocketError.NoData or SocketError.TryAgain }:
                    return ("dns", L.T("network.dns", "'{host}' adresi çözümlenemedi (DNS).", ("host", uri.Host)));
                case SocketException { SocketErrorCode: SocketError.ConnectionRefused }:
                    return ("connection_refused", L.T("network.connection_refused", "{host}:{port} bağlantıyı reddetti. Sunucu çalışıyor mu?", ("host", uri.Host), ("port", uri.Port)));
                case SocketException socket:
                    return ("network", L.T("network.error", "Bağlantı hatası: {message}", ("message", socket.Message)));
                case AuthenticationException:
                    return ("ssl", L.T("network.ssl", "SSL/TLS doğrulaması başarısız oldu (sertifika geçersiz veya güvenilmeyen).{hint}", ("hint", SslHint(sslHint))));
            }
        }

        return ("network", ex.Message);
    }

    /// <summary>
    /// <see cref="ProxyOptions.SslErrorHint"/>: "desktop" ve "cli" etkin dilde ipucuna çevrilir, başka değer olduğu gibi eklenir.
    /// </summary>
    private static string? SslHint(string? hint) => hint switch
    {
        "desktop" => " " + L.T("network.ssl_hint_desktop", "Ayarlar > SSL'den bu sunucunun CA sertifikasını ekleyebilir ya da doğrulamayı kapatabilirsiniz."),
        "cli" => " " + L.T("network.ssl_hint_cli", "Kendi sertifikanızsa --ca-cert ile ekleyin ya da --insecure kullanın."),
        _ => hint,
    };
}
