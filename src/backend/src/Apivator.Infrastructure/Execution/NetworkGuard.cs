using System.Net;
using System.Net.Sockets;
using Apivator.Application.Common.Localization;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Execution;

/// <summary>
/// SSRF koruması: sunucu proxy'sinin hangi IP adreslerine bağlanabileceğine karar verir. Kontrol DNS
/// çözümlemesinden sonra, bağlantı anında yapılır; böylece DNS rebinding ile atlatılamaz.
/// </summary>
public sealed class NetworkGuard(IOptionsMonitor<ProxyOptions> options)
{
    private static readonly IPNetwork[] RestrictedNetworks =
    [
        IPNetwork.Parse("0.0.0.0/8"),
        IPNetwork.Parse("10.0.0.0/8"),
        IPNetwork.Parse("100.64.0.0/10"),
        IPNetwork.Parse("127.0.0.0/8"),
        IPNetwork.Parse("169.254.0.0/16"),
        IPNetwork.Parse("172.16.0.0/12"),
        IPNetwork.Parse("192.0.0.0/24"),
        IPNetwork.Parse("192.168.0.0/16"),
        IPNetwork.Parse("198.18.0.0/15"),
        IPNetwork.Parse("224.0.0.0/4"),
        IPNetwork.Parse("240.0.0.0/4"),
        IPNetwork.Parse("::/128"),
        IPNetwork.Parse("::1/128"),
        IPNetwork.Parse("fc00::/7"),
        IPNetwork.Parse("fe80::/10"),
        IPNetwork.Parse("ff00::/8"),
    ];

    /// <summary>Loopback, özel, link-local (bulut metadata servisi dahil), multicast vb. adresler.</summary>
    public static bool IsRestricted(IPAddress address)
    {
        var normalized = Normalize(address);
        return RestrictedNetworks.Any(n => n.BaseAddress.AddressFamily == normalized.AddressFamily && n.Contains(normalized));
    }

    public bool IsAllowed(IPAddress address)
    {
        if (!IsRestricted(address))
        {
            return true;
        }

        var current = options.CurrentValue;
        if (current.AllowPrivateNetworks)
        {
            return true;
        }

        var normalized = Normalize(address);
        // Tek ayarda virgülle ayrılmış liste de olabilir (ör. ortam değişkeni: "10.0.0.0/8, 192.168.10.0/24").
        foreach (var cidr in current.AllowedNetworks.SelectMany(n => n.Split([',', ';', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)))
        {
            if (IPNetwork.TryParse(cidr, out var network)
                && network.BaseAddress.AddressFamily == normalized.AddressFamily
                && network.Contains(normalized))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>IPv4'e eşlenmiş IPv6 adreslerini (::ffff:10.0.0.1) IPv4 olarak değerlendirir.</summary>
    private static IPAddress Normalize(IPAddress address) =>
        address.AddressFamily == AddressFamily.InterNetworkV6 && address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
}

public sealed class BlockedDestinationException(string host)
    : Exception(L.T("network.blocked", "'{host}' adresine istek atılmasına izin verilmiyor (özel/iç ağ adresi).", ("host", host)))
{
    public string Host { get; } = host;
}
