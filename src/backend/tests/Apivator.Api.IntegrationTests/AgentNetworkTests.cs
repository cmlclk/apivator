using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Apivator.Agent;
using Apivator.Application.Execution;
using Apivator.Infrastructure.Execution.Local;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Server.Kestrel.Https;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Apivator.Api.IntegrationTests;

/// <summary>Masaüstü ajanının proxy, SSL ve istemci sertifikası ayarları; gerçek HTTPS sunucusu ve proxy ile.</summary>
public sealed class AgentNetworkTests : IAsyncLifetime
{
    private const string Token = "ag-ayarlari-tokeni-0123456789abcdefghij";
    private readonly string _dir = Directory.CreateTempSubdirectory("apivator-agent-net-").FullName;
    private readonly List<WebApplication> _apps = [];
    private HttpClient _agent = null!;
    private int _httpsPort;
    private int _proxyPort;
    private string _caPath = string.Empty;
    private string _clientPfx = string.Empty;
    private string _clientPem = string.Empty;
    private string _clientKey = string.Empty;

    public async Task InitializeAsync()
    {
        // Test CA'sı ve onunla imzalı, yalnızca "localhost" adına geçerli sunucu sertifikası.
        using var caKey = RSA.Create(2048);
        var caRequest = new CertificateRequest("CN=Apivator Test CA", caKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        caRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        caRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        using var ca = caRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(30));
        _caPath = Path.Combine(_dir, "ca.pem");
        await File.WriteAllTextAsync(_caPath, ca.ExportCertificatePem());

        using var serverKey = RSA.Create(2048);
        var serverRequest = new CertificateRequest("CN=localhost", serverKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName("localhost");
        serverRequest.CertificateExtensions.Add(san.Build());
        serverRequest.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension([new Oid("1.3.6.1.5.5.7.3.1")], false));
        using var signed = serverRequest.Create(ca, DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(10), [1, 2, 3, 4]);
        var serverCertificate = X509CertificateLoader.LoadPkcs12(signed.CopyWithPrivateKey(serverKey).Export(X509ContentType.Pkcs12), null);

        // İstemci sertifikası: PFX (şifreli) ve PEM (sertifika + anahtar) olarak.
        using var clientKey = RSA.Create(2048);
        var clientRequest = new CertificateRequest("CN=apivator-istemci", clientKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        clientRequest.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension([new Oid("1.3.6.1.5.5.7.3.2")], false));
        using var client = clientRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(10));
        _clientPfx = Path.Combine(_dir, "istemci.pfx");
        await File.WriteAllBytesAsync(_clientPfx, client.Export(X509ContentType.Pkcs12, "pfx-sifresi"));
        _clientPem = Path.Combine(_dir, "istemci.crt");
        _clientKey = Path.Combine(_dir, "istemci.key");
        await File.WriteAllTextAsync(_clientPem, client.ExportCertificatePem());
        await File.WriteAllTextAsync(_clientKey, clientKey.ExportPkcs8PrivateKeyPem());

        _httpsPort = await StartAsync(app => app.MapGet("/", (HttpContext context) =>
            Results.Text(context.Connection.ClientCertificate?.Subject ?? "sertifika-yok")), kestrel =>
            kestrel.UseHttps(https =>
            {
                https.ServerCertificate = serverCertificate;
                https.ClientCertificateMode = ClientCertificateMode.AllowCertificate;
                https.AllowAnyClientCertificate();
            }));

        // Basit HTTP proxy: mutlak adresli istekleri karşılar, Basic kimlik doğrulaması ister.
        _proxyPort = await StartAsync(app => app.Run(async context =>
        {
            var expected = "Basic " + Convert.ToBase64String(Encoding.UTF8.GetBytes("vekil:gizli"));
            if (context.Request.Headers.ProxyAuthorization != expected)
            {
                context.Response.StatusCode = StatusCodes.Status407ProxyAuthenticationRequired;
                context.Response.Headers.ProxyAuthenticate = "Basic realm=\"test\"";
                return;
            }

            await context.Response.WriteAsJsonAsync(new { via = "proxy", target = $"{context.Request.Host}{context.Request.Path}" });
        }), _ => { });

        var agent = AgentHost.Build(new AgentOptions { Token = Token });
        _apps.Add(agent);
        var agentPort = await AgentHost.StartAsync(agent);
        _agent = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{agentPort}") };
        _agent.DefaultRequestHeaders.Add(AgentOptions.TokenHeader, Token);
    }

    public async Task DisposeAsync()
    {
        _agent.Dispose();
        foreach (var app in _apps)
        {
            await app.DisposeAsync();
        }

        Directory.Delete(_dir, recursive: true);
    }

    private async Task<int> StartAsync(Action<WebApplication> map, Action<Microsoft.AspNetCore.Server.Kestrel.Core.ListenOptions> listen)
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(k => k.Listen(IPAddress.Loopback, 0, listen));
        var app = builder.Build();
        map(app);
        await app.StartAsync();
        _apps.Add(app);
        return new Uri(app.Urls.First()).Port;
    }

    private async Task<HttpStatusCode> ApplyAsync(NetworkSettings settings) =>
        (await _agent.PutAsJsonAsync("/settings", settings)).StatusCode;

    private async Task<ExecuteHttpResponse> GetAsync(string url) =>
        await (await _agent.PostAsJsonAsync("/execute", new ExecuteHttpRequest("GET", url, null, null))).ReadAsync<ExecuteHttpResponse>();

    [Fact]
    public async Task SelfSignedServer_FailsByDefault_PassesWithCaOrWhenVerificationIsOff()
    {
        var url = $"https://localhost:{_httpsPort}/";

        var strict = await GetAsync(url);
        Assert.Equal("ssl", strict.Error?.Code);
        Assert.Contains("Ayarlar > SSL", strict.Error!.Message, StringComparison.Ordinal);

        Assert.Equal(HttpStatusCode.NoContent, await ApplyAsync(new NetworkSettings { CaCertificatePaths = [_caPath] }));
        Assert.Equal((200, "sertifika-yok"), ((await GetAsync(url)).Status, (await GetAsync(url)).Body));

        // CA güvenilir olsa da ad uyuşmazlığı affedilmez (sertifika yalnızca "localhost" için).
        Assert.Equal("ssl", (await GetAsync($"https://127.0.0.1:{_httpsPort}/")).Error?.Code);

        Assert.Equal(HttpStatusCode.NoContent, await ApplyAsync(new NetworkSettings { VerifySsl = false }));
        Assert.Equal(200, (await GetAsync($"https://127.0.0.1:{_httpsPort}/")).Status);
    }

    [Fact]
    public async Task ClientCertificate_IsPresentedOnlyToMatchingHosts()
    {
        Assert.Equal(HttpStatusCode.NoContent, await ApplyAsync(new NetworkSettings
        {
            VerifySsl = false,
            ClientCertificates = [new ClientCertificateSetting("localhost", _clientPfx, Password: "pfx-sifresi")],
        }));
        Assert.Equal("CN=apivator-istemci", (await GetAsync($"https://localhost:{_httpsPort}/")).Body);
        Assert.Equal("sertifika-yok", (await GetAsync($"https://127.0.0.1:{_httpsPort}/")).Body);

        // PEM sertifika + ayrı anahtar dosyası, joker karakterli host.
        Assert.Equal(HttpStatusCode.NoContent, await ApplyAsync(new NetworkSettings
        {
            VerifySsl = false,
            ClientCertificates = [new ClientCertificateSetting("127.0.0.*", _clientPem, _clientKey)],
        }));
        Assert.Equal("CN=apivator-istemci", (await GetAsync($"https://127.0.0.1:{_httpsPort}/")).Body);
    }

    [Fact]
    public async Task CustomProxy_WithCredentials_AndBypassList()
    {
        var proxy = $"http://127.0.0.1:{_proxyPort}";

        Assert.Equal(HttpStatusCode.NoContent, await ApplyAsync(new NetworkSettings { ProxyMode = ProxyMode.Custom, ProxyUrl = proxy }));
        Assert.Equal(407, (await GetAsync("http://hedef.test/siparis")).Status);

        Assert.Equal(HttpStatusCode.NoContent, await ApplyAsync(new NetworkSettings
        {
            ProxyMode = ProxyMode.Custom,
            ProxyUrl = proxy,
            ProxyUsername = "vekil",
            ProxyPassword = "gizli",
            ProxyBypass = ["*.yerel"],
        }));
        var proxied = await GetAsync("http://hedef.test/siparis");
        Assert.Equal("hedef.test/siparis", JsonDocument.Parse(proxied.Body).RootElement.GetProperty("target").GetString());

        // Hariç tutulan ad proxy'ye gitmez; doğrudan çözülmeye çalışılır (ve çözülemez).
        Assert.Equal("dns", (await GetAsync("http://servis.yerel/")).Error?.Code);

        var shown = await _agent.GetFromJsonAsync<NetworkSettings>("/settings");
        Assert.Equal(("vekil", null), (shown!.ProxyUsername, shown.ProxyPassword));
    }

    [Fact]
    public async Task InvalidSettings_AreRejected_AndPreviousSettingsStay()
    {
        Assert.Equal(HttpStatusCode.NoContent, await ApplyAsync(new NetworkSettings { VerifySsl = false }));

        var response = await _agent.PutAsJsonAsync("/settings", new NetworkSettings
        {
            ProxyMode = ProxyMode.Custom,
            ProxyUrl = "sunucu:8080",
            CaCertificatePaths = [Path.Combine(_dir, "yok.pem")],
            ClientCertificates = [new ClientCertificateSetting("localhost", _clientPfx, Password: "yanlis")],
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("errors");
        Assert.Collection(
            errors.EnumerateArray().Select(e => e.GetString()!),
            e => Assert.StartsWith("Proxy adresi", e, StringComparison.Ordinal),
            e => Assert.StartsWith("CA sertifikası bulunamadı", e, StringComparison.Ordinal),
            e => Assert.EndsWith("dosya biçimi geçersiz ya da şifre yanlış.", e, StringComparison.Ordinal));

        Assert.False((await _agent.GetFromJsonAsync<NetworkSettings>("/settings"))!.VerifySsl);
    }

    [Theory]
    [InlineData("*.local", "api.local", true)]
    [InlineData("*.local", "local", false)]
    [InlineData("10.*", "10.1.2.3", true)]
    [InlineData("localhost", "LOCALHOST", true)]
    [InlineData("api.example.com", "api.example.com.evil", false)]
    public void BypassPatterns_MatchWholeHostNames(string pattern, string host, bool expected) =>
        Assert.Equal(expected, LocalProxy.Matches(pattern, host));
}
