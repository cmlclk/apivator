using Apivator.Application.Common;
using Apivator.Domain.Collections;
using Apivator.Domain.Docs;

namespace Apivator.Application.Docs;

/// <summary>Dokümanda gösterilen değişken; gizli olanların değeri hiçbir zaman gönderilmez.</summary>
public sealed record DocVariableDto(string Key, string Value, bool IsSecret, string Source);

/// <summary>
/// Yetkilendirmenin gizli olmayan özeti: tür, nereye konduğu (ör. "X-Api-Key header'ı") ve nereden miras alındığı
/// (collection, klasör adı ya da istek).
/// </summary>
public sealed record DocAuthDto(AuthType Type, string? Detail, string? Source);

public sealed record DocFolderDto(Guid Id, Guid? ParentFolderId, string Name, string? Description, int SortOrder);

public sealed record DocExampleDto(
    Guid Id,
    string Name,
    int Status,
    IReadOnlyList<KeyValueItem> Headers,
    string Body,
    bool BodyTruncated,
    string? RequestUrl,
    string? RequestBody);

public sealed record DocRequestDto(
    Guid Id,
    Guid? FolderId,
    string Name,
    int SortOrder,
    RequestKind Kind,
    string Method,
    string Url,
    string Description,
    IReadOnlyList<KeyValueItem> Headers,
    RequestBody Body,
    DocAuthDto Auth,
    string? GrpcMethod,
    IReadOnlyList<DocExampleDto> Examples);

/// <summary>
/// Collection'ın dokümantasyonu: açıklamalar, klasör ağacı, istekler (gizli header/parametre değerleri maskeli,
/// script'ler hariç), örnek yanıtlar ve değişkenler.
/// </summary>
public sealed record DocumentationDto(
    Guid CollectionId,
    string Name,
    string? Description,
    string WorkspaceName,
    DocAuthDto Auth,
    string? EnvironmentName,
    IReadOnlyList<DocVariableDto> Variables,
    IReadOnlyList<DocFolderDto> Folders,
    IReadOnlyList<DocRequestDto> Requests,
    DateTimeOffset UpdatedAt);

public sealed record DocPublicationDto(
    string Slug,
    string Url,
    DocVisibility Visibility,
    Guid? EnvironmentId,
    string? EnvironmentName,
    string PublishedBy,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record PublishDocRequest(DocVisibility Visibility, Guid? EnvironmentId);

public interface IDocumentationService
{
    /// <summary>Uygulama içi görünüm: collection'ı görebilen herkes; environment isteğe bağlı.</summary>
    Task<Result<DocumentationDto>> GetAsync(Guid collectionId, Guid? environmentId, Guid userId, CancellationToken ct = default);

    /// <summary>Yayın bilgisi; yayınlanmamışsa null.</summary>
    Task<Result<DocPublicationDto?>> GetPublicationAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    /// <summary>Yayınlar ya da ayarlarını değiştirir (collection'ı düzenleyebilen; herkese açık için workspace yöneticisi).</summary>
    Task<Result<DocPublicationDto>> PublishAsync(Guid collectionId, PublishDocRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<DocPublicationDto>> RegenerateLinkAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    Task<Result> UnpublishAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    /// <summary>
    /// Yayınlanmış doküman. Herkese açıksa oturum gerekmez; organizasyona açıksa organizasyon üyesi olmayan (ya da
    /// oturum açmamış) kişiye "bulunamadı"/"oturum gerekli" denir.
    /// </summary>
    Task<Result<DocumentationDto>> GetPublishedAsync(string slug, Guid? userId, CancellationToken ct = default);
}
