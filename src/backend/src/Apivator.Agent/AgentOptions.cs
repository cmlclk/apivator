namespace Apivator.Agent;

/// <summary>Ajanın başlatma ayarları (komut satırı ve ortam değişkenlerinden).</summary>
public sealed class AgentOptions
{
    /// <summary>Her istekte <c>X-Apivator-Agent-Token</c> başlığında beklenen gizli değer.</summary>
    public required string Token { get; init; }

    /// <summary>0 ise işletim sistemi boş bir port seçer.</summary>
    public int Port { get; init; }

    /// <summary>Verilirse bu süreç sonlanınca ajan da kapanır (masaüstü uygulaması çökse bile ajan asılı kalmaz).</summary>
    public int? ParentProcessId { get; init; }

    /// <summary>Tarayıcıdan gelen isteklerde kabul edilen kökenler (Tauri penceresi, geliştirme sunucusu).</summary>
    public IReadOnlyList<string> AllowedOrigins { get; init; } = DefaultOrigins;

    public static readonly IReadOnlyList<string> DefaultOrigins =
    [
        "tauri://localhost",        // macOS / Linux
        "http://tauri.localhost",   // Windows
        "https://tauri.localhost",
        "http://localhost:5173",    // geliştirme (vite)
    ];

    public const string TokenHeader = "X-Apivator-Agent-Token";
    public const string TokenEnvironmentVariable = "APIVATOR_AGENT_TOKEN";
    public const string ReadyPrefix = "APIVATOR_AGENT_READY ";

    /// <summary>--port 0 --parent-pid 1234 --origin http://... ; token ortam değişkeninden okunur (komut satırında görünmesin).</summary>
    public static AgentOptions Parse(string[] args, Func<string, string?> environment)
    {
        int port = 0;
        int? parent = null;
        var origins = new List<string>();
        for (var i = 0; i < args.Length; i++)
        {
            string Next() => i + 1 < args.Length ? args[++i] : throw new ArgumentException($"{args[i]} için değer eksik.");
            switch (args[i])
            {
                case "--port":
                    port = int.Parse(Next(), System.Globalization.CultureInfo.InvariantCulture);
                    break;
                case "--parent-pid":
                    parent = int.Parse(Next(), System.Globalization.CultureInfo.InvariantCulture);
                    break;
                case "--origin":
                    origins.Add(Next());
                    break;
                default:
                    // ASP.NET'in kendi argümanları (--urls vb.) kullanılmıyor; bilinmeyenler yok sayılır.
                    break;
            }
        }

        var token = environment(TokenEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(token) || token.Length < 32)
        {
            throw new ArgumentException($"{TokenEnvironmentVariable} ortam değişkeni en az 32 karakter olmalı.");
        }

        return new AgentOptions
        {
            Token = token,
            Port = port,
            ParentProcessId = parent,
            AllowedOrigins = origins.Count > 0 ? [.. DefaultOrigins, .. origins] : DefaultOrigins,
        };
    }
}
