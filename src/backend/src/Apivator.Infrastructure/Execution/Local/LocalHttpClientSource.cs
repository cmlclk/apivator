using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using Apivator.Application.Common.Localization;
using Apivator.Infrastructure.Execution;

namespace Apivator.Infrastructure.Execution.Local;

/// <summary>
/// Masaüstü ajanının ve CLI'ın HTTP istemcisi: kullanıcının proxy, SSL ve istemci sertifikası ayarlarıyla kurulur. Ayarlar değişince
/// yeni bir bağlantı havuzu oluşturulur; süren istekler eski havuzla tamamlanır.
/// </summary>
public sealed class LocalHttpClientSource : IExecutionHttpClientSource, IDisposable
{
    private readonly object _gate = new();
    private SocketsHttpHandler _handler;

    public LocalHttpClientSource()
    {
        _handler = Build(new NetworkSettings(), [], []);
        Settings = new NetworkSettings();
    }

    public NetworkSettings Settings { get; private set; }

    public HttpClient CreateClient()
    {
        lock (_gate)
        {
            return new HttpClient(_handler, disposeHandler: false) { Timeout = Timeout.InfiniteTimeSpan };
        }
    }

    /// <summary>Ayarları doğrular ve uygular. Hata varsa hiçbiri uygulanmaz ve hatalar döner.</summary>
    public IReadOnlyList<string> Apply(NetworkSettings settings)
    {
        var errors = new List<string>();
        if (settings.ProxyMode == ProxyMode.Custom
            && (!Uri.TryCreate(settings.ProxyUrl, UriKind.Absolute, out var proxy) || proxy.Scheme is not ("http" or "https")))
        {
            errors.Add(L.T("network.proxy_format", "Proxy adresi http://sunucu:port biçiminde olmalı."));
        }

        var roots = new X509Certificate2Collection();
        foreach (var path in settings.CaCertificatePaths.Where(p => !string.IsNullOrWhiteSpace(p)))
        {
            if (!File.Exists(path))
            {
                errors.Add(L.T("network.ca_not_found", "CA sertifikası bulunamadı: {path}", ("path", path)));
                continue;
            }

            try
            {
                roots.AddRange(LoadCertificates(path));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException)
            {
                errors.Add(L.T("network.ca_unreadable", "CA sertifikası okunamadı ({path}). Dosya PEM, CRT ya da DER biçiminde olmalı.", ("path", path)));
            }
        }

        var clientCertificates = new List<(string Host, X509Certificate2 Certificate)>();
        foreach (var setting in settings.ClientCertificates)
        {
            if (string.IsNullOrWhiteSpace(setting.Host))
            {
                errors.Add(L.T("network.client_cert_host_empty", "İstemci sertifikası için host boş ({path}).", ("path", setting.Path)));
                continue;
            }

            var missing = new[] { setting.Path, setting.KeyPath }.FirstOrDefault(p => !string.IsNullOrWhiteSpace(p) && !File.Exists(p));
            if (missing is not null)
            {
                errors.Add(L.T("network.client_cert_not_found", "İstemci sertifikası dosyası bulunamadı ({host}): {path}", ("host", setting.Host), ("path", missing)));
                continue;
            }

            try
            {
                clientCertificates.Add((setting.Host.Trim(), LoadClientCertificate(setting)));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException or ArgumentException)
            {
                errors.Add(L.T("network.client_cert_load_failed", "İstemci sertifikası yüklenemedi ({host}): dosya biçimi geçersiz ya da şifre yanlış.", ("host", setting.Host)));
            }
        }

        if (errors.Count > 0)
        {
            return errors;
        }

        var handler = Build(settings, roots, clientCertificates);
        SocketsHttpHandler previous;
        lock (_gate)
        {
            previous = _handler;
            _handler = handler;
            Settings = settings;
        }

        // Süren istekler bitsin diye eski havuz bir süre sonra kapatılır.
        _ = Task.Delay(TimeSpan.FromMinutes(5)).ContinueWith(_ => previous.Dispose(), TaskScheduler.Default);
        return [];
    }

    public void Dispose()
    {
        lock (_gate)
        {
            _handler.Dispose();
        }
    }

    private static SocketsHttpHandler Build(
        NetworkSettings settings,
        X509Certificate2Collection roots,
        List<(string Host, X509Certificate2 Certificate)> clientCertificates)
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = true,
            MaxAutomaticRedirections = 10,
            AutomaticDecompression = DecompressionMethods.All,
            UseCookies = false,
            PooledConnectionLifetime = TimeSpan.FromMinutes(2),
            // ASCII dışı header değerleri (ör. "Ayşe") Postman'deki gibi UTF-8 gönderilir; varsayılan davranış hata verir.
            RequestHeaderEncodingSelector = (_, _) => System.Text.Encoding.UTF8,
            ConnectTimeout = TimeSpan.FromSeconds(15),
        };

        switch (settings.ProxyMode)
        {
            case ProxyMode.None:
                handler.UseProxy = false;
                break;
            case ProxyMode.Custom:
                handler.UseProxy = true;
                handler.Proxy = new LocalProxy(
                    new Uri(settings.ProxyUrl!),
                    string.IsNullOrEmpty(settings.ProxyUsername) ? null : new NetworkCredential(settings.ProxyUsername, settings.ProxyPassword),
                    settings.ProxyBypass);
                break;
            default:
                handler.UseProxy = true; // Proxy null: işletim sisteminin ayarı (HttpClient.DefaultProxy).
                break;
        }

        handler.SslOptions.RemoteCertificateValidationCallback = (_, certificate, chain, errors) =>
            ValidateServerCertificate(settings.VerifySsl, roots, certificate, chain, errors);

        if (clientCertificates.Count > 0)
        {
            handler.SslOptions.LocalCertificateSelectionCallback = (_, targetHost, _, _, _) =>
                clientCertificates.FirstOrDefault(c => LocalProxy.Matches(c.Host, targetHost)).Certificate!;
        }

        return handler;
    }

    internal static bool ValidateServerCertificate(
        bool verify,
        X509Certificate2Collection roots,
        X509Certificate? certificate,
        X509Chain? chain,
        SslPolicyErrors errors)
    {
        if (!verify || errors == SslPolicyErrors.None)
        {
            return true;
        }

        // Yalnızca zincir hatası varsa ve kullanıcı CA eklediyse: o CA'larla yeniden dene. Ad uyuşmazlığı affedilmez.
        if (errors != SslPolicyErrors.RemoteCertificateChainErrors || roots.Count == 0 || certificate is null)
        {
            return false;
        }

        using var custom = new X509Chain();
        custom.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        custom.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        custom.ChainPolicy.CustomTrustStore.AddRange(roots);
        if (chain is not null)
        {
            foreach (var element in chain.ChainElements)
            {
                custom.ChainPolicy.ExtraStore.Add(element.Certificate);
            }
        }

        if (certificate is X509Certificate2 leaf)
        {
            return custom.Build(leaf);
        }

        using var loaded = X509CertificateLoader.LoadCertificate(certificate.GetRawCertData());
        return custom.Build(loaded);
    }

    private static X509Certificate2Collection LoadCertificates(string path)
    {
        var collection = new X509Certificate2Collection();
        var text = File.ReadAllText(path);
        if (text.Contains("-----BEGIN CERTIFICATE-----", StringComparison.Ordinal))
        {
            collection.ImportFromPem(text);
        }
        else
        {
            collection.Add(X509CertificateLoader.LoadCertificateFromFile(path));
        }

        return collection;
    }

    private static X509Certificate2 LoadClientCertificate(ClientCertificateSetting setting)
    {
        var extension = System.IO.Path.GetExtension(setting.Path).ToUpperInvariant();
        if (extension is ".PFX" or ".P12")
        {
            return X509CertificateLoader.LoadPkcs12FromFile(setting.Path, setting.Password);
        }

        using var pem = string.IsNullOrEmpty(setting.Password)
            ? X509Certificate2.CreateFromPemFile(setting.Path, setting.KeyPath)
            : X509Certificate2.CreateFromEncryptedPemFile(setting.Path, setting.Password, setting.KeyPath);

        // Windows TLS (SChannel), PEM'den gelen geçici anahtarı kullanamaz; PKCS#12 üzerinden yeniden yüklenir.
        return X509CertificateLoader.LoadPkcs12(pem.Export(X509ContentType.Pkcs12), null);
    }
}
