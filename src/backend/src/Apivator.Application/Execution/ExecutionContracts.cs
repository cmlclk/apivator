using Apivator.Domain.Collections;

namespace Apivator.Application.Execution;

/// <summary>
/// Gönderilecek istek. <paramref name="Variables"/> verilirse {{değişken}}'ler sunucuda, pre-request script'lerinden
/// sonra çözülür; verilmezse istek çözülmüş kabul edilir. <paramref name="Auth"/> mirası istemcide çözülmüş gelir;
/// türü Inherit ise yetkilendirme uygulanmaz.
/// </summary>
public sealed record ExecuteHttpRequest(
    string Method,
    string Url,
    IReadOnlyList<KeyValueItem>? Headers,
    RequestBody? Body,
    int? TimeoutMs = null,
    RequestAuth? Auth = null,
    IReadOnlyList<ExecuteFile>? Files = null,
    IReadOnlyList<string>? PreRequestScripts = null,
    IReadOnlyList<string>? PostResponseScripts = null,
    ExecutionVariables? Variables = null,
    ExecutionInfo? Info = null);

/// <summary>
/// İstekle gönderilecek dosya içeriği. <see cref="Index"/> body.form içindeki alanın sırasıdır;
/// binary body için <see cref="BinaryIndex"/> (-1) kullanılır.
/// </summary>
public sealed record ExecuteFile(int Index, string FileName, string? ContentType, string ContentBase64)
{
    public const int BinaryIndex = -1;
}

/// <summary>
/// Değişken kapsamlarının bu kullanıcıdaki etkin değerleri (güncel değer yoksa başlangıç değeri). Yanıtta,
/// script'lerin yaptığı değişikliklerden sonraki hâlleri döner; istemci farkı kendi güncel değerlerine yazar.
/// </summary>
public sealed record ExecutionVariables
{
    public Dictionary<string, string>? Environment { get; init; }

    public Dictionary<string, string>? Collection { get; init; }

    public Dictionary<string, string>? Globals { get; init; }

    /// <summary>Collection runner'da o iterasyonun veri satırı (salt okunur).</summary>
    public Dictionary<string, string>? Data { get; init; }

    public string? EnvironmentName { get; init; }
}

/// <summary>Script'lerdeki <c>pm.info</c> için.</summary>
public sealed record ExecutionInfo(string? RequestName = null, string? RequestId = null, int Iteration = 0, int IterationCount = 1);

public sealed record HttpHeaderDto(string Key, string Value);

public sealed record ExecuteError(string Code, string Message);

public sealed record TestResultDto(string Name, string Status, string? Error = null)
{
    public const string Passed = "passed";
    public const string Failed = "failed";
    public const string Skipped = "skipped";
}

/// <summary><c>console.log</c> çıktısı ya da script hatası. Phase: "prerequest" veya "test".</summary>
public sealed record ConsoleEntryDto(string Level, string Message, string Phase);

/// <summary>Hedefe gerçekten giden istek (değişkenler çözülmüş, yetkilendirme uygulanmış); konsolda gösterilir.</summary>
public sealed record SentRequestDto(string Method, string Url, IReadOnlyList<HttpHeaderDto> Headers, string? Body);

/// <summary>
/// Hedef sunucunun yanıtı. Hedefe ulaşılamadıysa <see cref="Error"/> doludur ve <see cref="Status"/> boştur;
/// bu durumda da API 200 döner, çünkü Apivator'ın kendisi hata vermemiştir.
/// </summary>
public sealed record ExecuteHttpResponse(
    int? Status,
    string? StatusText,
    IReadOnlyList<HttpHeaderDto> Headers,
    string Body,
    string BodyEncoding,
    long Size,
    bool Truncated,
    double TimeMs,
    string? FinalUrl,
    ExecuteError? Error)
{
    public IReadOnlyList<TestResultDto> Tests { get; init; } = [];

    public IReadOnlyList<ConsoleEntryDto> Console { get; init; } = [];

    /// <summary>Script'lerden sonraki değişken değerleri; istekte değişken gönderilmediyse boş.</summary>
    public ExecutionVariables? Variables { get; init; }

    /// <summary><c>pm.execution.setNextRequest</c> çağrıldıysa dolu; Value boşsa runner durur.</summary>
    public NextRequestDto? NextRequest { get; init; }

    /// <summary>Pre-request script'i <c>pm.execution.skipRequest()</c> çağırdı; istek gönderilmedi.</summary>
    public bool Skipped { get; init; }

    public SentRequestDto? Request { get; init; }

    public static ExecuteHttpResponse Failed(string code, string message, double timeMs = 0) =>
        new(null, null, [], string.Empty, "text", 0, false, timeMs, null, new ExecuteError(code, message));
}

public sealed record NextRequestDto(string? Value);

public interface IRequestExecutor
{
    Task<ExecuteHttpResponse> ExecuteAsync(ExecuteHttpRequest request, CancellationToken cancellationToken = default);
}

/// <summary>
/// İsteği script'leriyle birlikte çalıştırır: pre-request script'leri → değişken çözümleme → HTTP → post-response
/// script'leri.
/// </summary>
public interface IRequestPipeline
{
    Task<ExecuteHttpResponse> RunAsync(ExecuteHttpRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// Script çalıştırmadan değişkenleri çözer ve gerekiyorsa OAuth 2.0 token'ını alır (akan istekler ve
    /// WebSocket için). Gönderilemeyecekse hata döner.
    /// </summary>
    Task<(ExecuteHttpRequest? Request, ExecuteHttpResponse? Failure)> PrepareAsync(ExecuteHttpRequest request, CancellationToken cancellationToken = default);
}
