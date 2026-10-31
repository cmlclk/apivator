using System.ComponentModel.DataAnnotations;

namespace Apivator.Infrastructure.Execution;

public sealed class ProxyOptions
{
    public const string SectionName = "Proxy";

    /// <summary>
    /// true ise localhost ve özel ağ adreslerine (10.x, 192.168.x vb.) istek atılabilir. Sunucuda kapalı
    /// tutun; yalnızca gereken iç ağları <see cref="AllowedNetworks"/> ile açın.
    /// </summary>
    public bool AllowPrivateNetworks { get; set; }

    /// <summary>Özel ağ kapalıyken bile izin verilen CIDR blokları, ör. "10.20.0.0/16".</summary>
    public string[] AllowedNetworks { get; set; } = [];

    [Range(1, 600)]
    public int TimeoutSeconds { get; set; } = 30;

    [Range(1024, 200 * 1024 * 1024)]
    public int MaxResponseBytes { get; set; } = 10 * 1024 * 1024;

    /// <summary>Bir istekle gönderilebilecek dosyaların toplam boyutu (form-data ve binary body).</summary>
    [Range(0, 50 * 1024 * 1024)]
    public int MaxUploadBytes { get; set; } = 20 * 1024 * 1024;

    /// <summary>Akan bir yanıtın (SSE) en uzun dinlenme süresi.</summary>
    [Range(1, 24 * 60)]
    public int StreamMaxMinutes { get; set; } = 30;

    /// <summary>Bir WebSocket bağlantısının en uzun süresi.</summary>
    [Range(1, 24 * 60)]
    public int WebSocketMaxMinutes { get; set; } = 60;

    /// <summary>WebSocket'te tek mesajın en büyük boyutu (iki yönde de).</summary>
    [Range(1024, 50 * 1024 * 1024)]
    public int WebSocketMaxMessageBytes { get; set; } = 1024 * 1024;

    /// <summary>SSL hatası mesajına eklenen ipucu: "desktop" (ayarlara yönlendirir), "cli" (seçeneklere) ya da düz metin.</summary>
    public string? SslErrorHint { get; set; }
}
