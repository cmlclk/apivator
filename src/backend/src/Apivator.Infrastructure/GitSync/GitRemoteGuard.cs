using System.Net;
using System.Net.Sockets;
using Apivator.Application.Common.Localization;
using Apivator.Application.GitSync;
using Apivator.Infrastructure.Execution;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.GitSync;

/// <summary>
/// Depo adresi kuralı: yalnızca https (ayarla http), sunucu adı çözülür ve her adres <see cref="NetworkGuard"/>'dan
/// geçer (özel/iç ağlar yalnızca Proxy:AllowedNetworks izin veriyorsa). Çözümleme ile bağlantı arasında adres
/// değişebilir (DNS rebinding); libgit2 kendi çözümlemesini yaptığından bu koruma bağlantı anında değil işlem öncesindedir.
/// </summary>
internal sealed class GitRemoteGuard(NetworkGuard network, IOptions<GitSyncOptions> options) : IGitRemoteGuard
{
    public async Task<string?> ValidateAsync(string url, CancellationToken ct = default)
    {
        var value = url.Trim();
        var settings = options.Value;
        if (settings.AllowLocalRemotes && (Path.IsPathRooted(value) || value.StartsWith("file://", StringComparison.OrdinalIgnoreCase)))
        {
            return null;
        }

        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || !(uri.Scheme == Uri.UriSchemeHttps || (settings.AllowHttp && uri.Scheme == Uri.UriSchemeHttp))
            || !value.StartsWith(uri.Scheme + "://", StringComparison.OrdinalIgnoreCase))
        {
            return L.T("git.address_scheme", "Depo adresi https:// ile başlamalı (GitHub, GitLab, Azure DevOps, Gitea, Bitbucket). SSH adresleri desteklenmiyor.");
        }

        return await CheckHostAsync(uri.DnsSafeHost, ct);
    }

    private async Task<string?> CheckHostAsync(string host, CancellationToken ct)
    {
        IPAddress[] addresses;
        try
        {
            addresses = IPAddress.TryParse(host, out var ip) ? [ip] : await Dns.GetHostAddressesAsync(host, ct);
        }
        catch (SocketException)
        {
            return L.T("git.host_unresolved", "'{host}' adresi çözümlenemedi.", ("host", host));
        }

        return addresses.Length == 0 || addresses.Any(a => !network.IsAllowed(a))
            ? L.T("git.host_blocked", "'{host}' adresine bağlanılmasına izin verilmiyor (özel/iç ağ adresi).", ("host", host))
            : null;
    }
}
