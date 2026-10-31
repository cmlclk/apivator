using System.Net;
using Apivator.Infrastructure.Execution;

namespace Apivator.Api.IntegrationTests;

public class NetworkGuardTests
{
    [Theory]
    [InlineData("127.0.0.1", true)]
    [InlineData("10.1.2.3", true)]
    [InlineData("172.16.0.1", true)]
    [InlineData("172.31.255.255", true)]
    [InlineData("192.168.0.10", true)]
    [InlineData("169.254.169.254", true)]
    [InlineData("100.64.0.1", true)]
    [InlineData("::1", true)]
    [InlineData("fd00::1", true)]
    [InlineData("fe80::1", true)]
    [InlineData("::ffff:10.0.0.1", true)] // IPv4'e eşlenmiş IPv6 ile atlatma denemesi
    [InlineData("8.8.8.8", false)]
    [InlineData("172.32.0.1", false)]
    [InlineData("2606:4700:4700::1111", false)]
    public void IsRestricted_ClassifiesAddresses(string address, bool restricted) =>
        Assert.Equal(restricted, NetworkGuard.IsRestricted(IPAddress.Parse(address)));

    [Theory]
    [InlineData("10.20.1.5", true)]
    [InlineData("192.168.10.7", true)]
    [InlineData("192.168.11.7", false)]
    [InlineData("10.21.0.1", false)]
    public void AllowedNetworks_AcceptCommaSeparatedListInOneSetting(string address, bool allowed)
    {
        // Ortam değişkeninden tek değer olarak gelir: Proxy__AllowedNetworks__0="10.20.0.0/16, 192.168.10.0/24"
        var options = new ProxyOptions { AllowedNetworks = ["10.20.0.0/16, 192.168.10.0/24", ""] };
        var guard = new NetworkGuard(new StaticOptions(options));
        Assert.Equal(allowed, guard.IsAllowed(IPAddress.Parse(address)));
    }

    private sealed class StaticOptions(ProxyOptions value) : Microsoft.Extensions.Options.IOptionsMonitor<ProxyOptions>
    {
        public ProxyOptions CurrentValue => value;

        public ProxyOptions Get(string? name) => value;

        public IDisposable? OnChange(Action<ProxyOptions, string?> listener) => null;
    }
}
