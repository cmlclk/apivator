using Apivator.Application.Common;
using Apivator.Domain.Collections;

namespace Apivator.Application.Import;

/// <param name="Url">Belge, Swagger UI sayfası ya da yalnızca sunucu adresi.</param>
/// <param name="Headers">Korumalı belgeler için (ör. Authorization); yalnızca aynı sunucuya gönderilir, saklanmaz.</param>
public sealed record SpecFetchRequest(string Url, IReadOnlyList<KeyValueItem>? Headers = null);

/// <summary>
/// Ya belge (Url + Content: JSON/YAML metni) ya da kullanıcının seçeceği sürümler (Choices) döner.
/// Tried, denenen adresler (bulunamadığında kullanıcıya gösterilir).
/// </summary>
public sealed record SpecFetchResult(string? Url, string? Content, IReadOnlyList<SpecChoice>? Choices, IReadOnlyList<string> Tried)
{
    public static SpecFetchResult Document(string url, string content, IReadOnlyList<string> tried) => new(url, content, null, tried);

    public static SpecFetchResult Select(IReadOnlyList<SpecChoice> choices, IReadOnlyList<string> tried) => new(null, null, choices, tried);
}

/// <summary>
/// OpenAPI/Swagger belgesini adresinden çeker; gerekirse Swagger UI sayfasından ya da bilinen yollardan bulur.
/// Sunucuda SSRF korumalı istemciyle, masaüstü ajanında kullanıcının proxy/SSL ayarlarıyla çalışır.
/// </summary>
public interface IApiSpecFetcher
{
    Task<Result<SpecFetchResult>> FetchAsync(SpecFetchRequest request, CancellationToken ct = default);
}

/// <summary>Zamanı gelen kaynak kontrollerini çalıştırır (testler doğrudan çağırır).</summary>
public interface ISourceCheckScheduler
{
    Task<int> RunDueAsync(CancellationToken ct = default);
}
