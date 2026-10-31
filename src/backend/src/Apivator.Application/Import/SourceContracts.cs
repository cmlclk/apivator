using Apivator.Domain.Collections;

namespace Apivator.Application.Import;

/// <param name="Url">Belge, Swagger UI sayfası ya da sunucu adresi.</param>
/// <param name="Headers">Korumalı belgeler için; saklanmaz.</param>
/// <param name="Document">Masaüstü ajanının bu bilgisayardan çektiği belge metni; varsa sunucu adrese gitmez.</param>
public sealed record UrlImportRequest(string Url, IReadOnlyList<KeyValueItem>? Headers = null, string? Document = null);

/// <summary>Ya içe aktarma sonucu ya da seçilecek sürümler.</summary>
public sealed record UrlImportResponse(ImportResult? Result, IReadOnlyList<SpecChoice>? Choices);

public sealed record CollectionSourceDto(
    string Url,
    bool Local,
    string? Version,
    DateTimeOffset ImportedAt,
    DateTimeOffset UpdatedAt,
    int? CheckIntervalHours,
    DateTimeOffset? LastCheckedAt,
    string? LastCheckError,
    DateTimeOffset? ChangeDetectedAt);

public sealed record SourceScheduleRequest(int? CheckIntervalHours);

/// <param name="Document">Masaüstünde ajanla çekilen belge metni.</param>
/// <param name="Url">Document ile birlikte: belgenin çekildiği (yönlendirme sonrası) adres.</param>
public sealed record SourcePreviewRequest(IReadOnlyList<KeyValueItem>? Headers = null, string? Document = null, string? Url = null);

/// <summary>Kaynaktaki bir uç: eklenen, değişen ya da kaldırılan.</summary>
/// <param name="Key">Belgedeki kimlik ("GET /pets/{id}"); uygulanacakları seçerken kullanılır.</param>
/// <param name="Fields">Değişen bölümler (Adres, Header'lar, Gövde…).</param>
/// <param name="Notes">Yerel değişikliklerle ilgili uyarılar.</param>
public sealed record SourceChangeDto(
    string Key,
    string Method,
    string Path,
    string Name,
    string? Folder,
    Guid? RequestId,
    IReadOnlyList<string> Fields,
    IReadOnlyList<string> Notes);

/// <param name="Hash">Önizlenen belgenin özeti; uygularken geri gönderilir.</param>
public sealed record SourceDiffDto(
    string Hash,
    string Url,
    string? FromVersion,
    string? ToVersion,
    IReadOnlyList<SourceChangeDto> Added,
    IReadOnlyList<SourceChangeDto> Changed,
    IReadOnlyList<SourceChangeDto> Removed,
    IReadOnlyList<string> NewVariables,
    IReadOnlyList<string> Warnings);

/// <param name="Keys">Uygulanacak değişikliklerin anahtarları (eklenen, değişen ve kaldırılanlardan).</param>
public sealed record SourceApplyRequest(string Hash, IReadOnlyList<string> Keys);

public sealed record SourceApplyResult(int Added, int Updated, int Removed, int Variables, CollectionSourceDto Source);
