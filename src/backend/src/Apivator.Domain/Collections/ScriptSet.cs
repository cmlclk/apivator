namespace Apivator.Domain.Collections;

/// <summary>
/// Bir istek, klasör ya da collection'ın script'leri (JavaScript, Postman <c>pm</c> API'si). Gönderimde
/// collection → klasörler → istek sırasıyla çalışır.
/// </summary>
public sealed record ScriptSet
{
    public const int MaxLength = 100_000;

    public static readonly ScriptSet Empty = new();

    /// <summary>İstek gönderilmeden önce çalışır; değişken atayabilir, isteği değiştirebilir.</summary>
    public string PreRequest { get; init; } = string.Empty;

    /// <summary>Yanıt geldikten sonra çalışır (Postman'deki "Tests"); <c>pm.test</c> ile doğrulama yapar.</summary>
    public string PostResponse { get; init; } = string.Empty;

    public bool IsEmpty => string.IsNullOrWhiteSpace(PreRequest) && string.IsNullOrWhiteSpace(PostResponse);

    public ScriptSet Normalize() => new() { PreRequest = PreRequest ?? string.Empty, PostResponse = PostResponse ?? string.Empty };

    public bool IsTooLong => (PreRequest?.Length ?? 0) > MaxLength || (PostResponse?.Length ?? 0) > MaxLength;
}
