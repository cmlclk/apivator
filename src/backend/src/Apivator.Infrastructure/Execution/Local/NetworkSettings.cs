using System.Text.Json.Serialization;

namespace Apivator.Infrastructure.Execution.Local;

[JsonConverter(typeof(JsonStringEnumConverter<ProxyMode>))]
public enum ProxyMode
{
    /// <summary>İşletim sisteminin proxy ayarı (Windows'ta İnternet Seçenekleri).</summary>
    System,

    /// <summary>Proxy kullanılmaz.</summary>
    None,

    /// <summary><see cref="NetworkSettings.ProxyUrl"/> kullanılır.</summary>
    Custom,
}

/// <summary>İstemci sertifikası: <see cref="Host"/> ile eşleşen sunuculara sunulur (ör. api.ornek.com, *.ornek.com).</summary>
public sealed record ClientCertificateSetting(string Host, string Path, string? KeyPath = null, string? Password = null);

/// <summary>Masaüstündeki istekler için ağ ayarları; arayüz uygulama açılırken ve değiştikçe ajana gönderir.</summary>
public sealed record NetworkSettings
{
    public ProxyMode ProxyMode { get; init; } = ProxyMode.System;

    public string? ProxyUrl { get; init; }

    public string? ProxyUsername { get; init; }

    public string? ProxyPassword { get; init; }

    /// <summary>Proxy'ye uğramayan adresler: localhost, *.local, 10.* gibi.</summary>
    public IReadOnlyList<string> ProxyBypass { get; init; } = [];

    /// <summary>false ise sunucu sertifikası doğrulanmaz (kendinden imzalı geliştirme sunucuları için).</summary>
    public bool VerifySsl { get; init; } = true;

    /// <summary>Güvenilecek ek kök/ara sertifikalar (PEM, CRT ya da DER dosyaları).</summary>
    public IReadOnlyList<string> CaCertificatePaths { get; init; } = [];

    public IReadOnlyList<ClientCertificateSetting> ClientCertificates { get; init; } = [];
}
