using Apivator.Application.Common;

namespace Apivator.Application.Collections;

public interface ICollectionService
{
    Task<Result<IReadOnlyList<CollectionTreeDto>>> ListAsync(Guid workspaceId, Guid userId, CancellationToken ct = default);

    Task<Result<CollectionTreeDto>> CreateAsync(Guid workspaceId, CreateCollectionRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<CollectionTreeDto>> UpdateAsync(Guid collectionId, UpdateCollectionRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> DeleteAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    Task<Result<FolderDto>> CreateFolderAsync(Guid collectionId, CreateFolderRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<FolderDto>> UpdateFolderAsync(Guid folderId, UpdateFolderRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> DeleteFolderAsync(Guid folderId, Guid userId, CancellationToken ct = default);

    Task<Result<ApiRequestDto>> CreateRequestAsync(Guid collectionId, CreateApiRequestRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<ApiRequestDto>> GetRequestAsync(Guid requestId, Guid userId, CancellationToken ct = default);

    /// <summary>Collection'daki tüm istekler, tanımlarıyla (çevrimdışı önbelleği tek seferde doldurmak için).</summary>
    Task<Result<IReadOnlyList<ApiRequestDto>>> ListRequestsAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    Task<Result<ApiRequestDto>> UpdateRequestAsync(Guid requestId, UpdateApiRequestRequest request, Guid userId, CancellationToken ct = default);


    Task<Result> DeleteRequestAsync(Guid requestId, Guid userId, CancellationToken ct = default);
}
