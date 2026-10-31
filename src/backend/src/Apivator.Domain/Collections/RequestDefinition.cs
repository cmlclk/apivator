using System.Text.Json.Serialization;

namespace Apivator.Domain.Collections;

/// <summary>İsteğin türü: normal HTTP, Server-Sent Events akışı, WebSocket bağlantısı ya da gRPC çağrısı.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<RequestKind>))]
public enum RequestKind
{
    Http,
    Sse,
    WebSocket,
    Grpc,
}

/// <summary>gRPC isteğine yüklenmiş .proto dosyası.</summary>
public sealed record ProtoFile(string Name, string Content);

/// <summary>
/// gRPC isteğinin ayarları: çağrılacak metot ("/paket.Servis/Metot"), tanımların kaynağı (server reflection ya da
/// yüklenen .proto dosyaları), JSON mesaj ve isteğe bağlı süre sınırı. Metadata isteğin header'larıdır.
/// </summary>
public sealed record GrpcSettings
{
    public const int MaxProtoFiles = 100;

    public const int MaxProtoBytes = 2 * 1024 * 1024;

    public static GrpcSettings Empty => new();

    public string Method { get; init; } = string.Empty;

    public bool UseReflection { get; init; } = true;

    public IReadOnlyList<ProtoFile> ProtoFiles { get; init; } = [];

    public string Message { get; init; } = string.Empty;

    public double? DeadlineSeconds { get; init; }

    public GrpcSettings Normalize() => this with
    {
        Method = Method?.Trim() ?? string.Empty,
        ProtoFiles = ProtoFiles ?? [],
        Message = Message ?? string.Empty,
        DeadlineSeconds = DeadlineSeconds is > 0 ? DeadlineSeconds : null,
    };
}

/// <summary>WebSocket isteğinde kaydedilmiş, tek tıkla gönderilebilen mesaj.</summary>
public sealed record SavedMessage(string Name, string Body, bool Binary = false);

/// <summary>
/// Bir HTTP isteğinin kaydedilen hali. Query parametreleri URL'nin içindedir; istemci tablo ile URL'yi
/// senkron tutar. Veritabanında tek bir jsonb kolonunda saklanır, böylece yeni alanlar migration gerektirmez.
/// </summary>
public sealed record RequestDefinition
{
    public const int UrlMaxLength = 8192;

    public const int MaxSavedMessages = 50;

    public const int SavedMessageMaxLength = 256 * 1024;

    public const int ProtocolsMaxLength = 500;

    /// <summary>İstek, klasör ve collection açıklamalarının (Markdown) üst sınırı.</summary>
    public const int DescriptionMaxLength = 50_000;

    public static readonly IReadOnlySet<string> StandardMethods =
        new HashSet<string>(StringComparer.Ordinal) { "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS" };

    public RequestKind Kind { get; init; } = RequestKind.Http;

    /// <summary>Markdown açıklama; dokümantasyon sayfasında gösterilir.</summary>
    public string Description { get; init; } = string.Empty;

    public string Method { get; init; } = "GET";

    public string Url { get; init; } = string.Empty;

    public IReadOnlyList<KeyValueItem> Headers { get; init; } = [];

    public RequestBody Body { get; init; } = RequestBody.None;

    public RequestAuth Auth { get; init; } = RequestAuth.Inherit;

    public ScriptSet Scripts { get; init; } = ScriptSet.Empty;

    /// <summary>WebSocket: kaydedilmiş mesajlar.</summary>
    public IReadOnlyList<SavedMessage> Messages { get; init; } = [];

    /// <summary>WebSocket: virgülle ayrılmış alt protokoller (Sec-WebSocket-Protocol).</summary>
    public string Protocols { get; init; } = string.Empty;

    /// <summary>gRPC ayarları (Kind = Grpc).</summary>
    public GrpcSettings Grpc { get; init; } = GrpcSettings.Empty;

    public static RequestDefinition Default => new();

    /// <summary>Method adı büyük harfe çevrilir; özel method'lara (ör. PROPFIND) izin verilir.</summary>
    public RequestDefinition Normalize() => this with
    {
        Method = string.IsNullOrWhiteSpace(Method) ? "GET" : Method.Trim().ToUpperInvariant(),
        Url = Url?.Trim() ?? string.Empty,
        Description = Description?.Trim() ?? string.Empty,
        Headers = Headers ?? [],
        Body = Body ?? RequestBody.None,
        Auth = (Auth ?? RequestAuth.Inherit).WithoutSecrets(),
        Scripts = Scripts?.Normalize() ?? ScriptSet.Empty,
        Messages = Messages ?? [],
        Protocols = Protocols?.Trim() ?? string.Empty,
        Grpc = Grpc?.Normalize() ?? GrpcSettings.Empty,
    };
}
