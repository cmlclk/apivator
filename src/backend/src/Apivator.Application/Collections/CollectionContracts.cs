using Apivator.Application.Examples;
using Apivator.Domain.Collections;
using Apivator.Domain.Variables;
using Apivator.Domain.Workspaces;

namespace Apivator.Application.Collections;

public sealed record CreateCollectionRequest(string Name);

/// <summary>Boş bırakılan alanlar değişmez.</summary>
public sealed record UpdateCollectionRequest(string? Name, string? Description, RequestAuth? Auth = null, IReadOnlyList<Variable>? Variables = null, ScriptSet? Scripts = null);

public sealed record CreateFolderRequest(string Name, Guid? ParentFolderId);

/// <summary>Boş bırakılan alanlar değişmez.</summary>
public sealed record UpdateFolderRequest(string? Name, RequestAuth? Auth = null, ScriptSet? Scripts = null, string? Description = null);

public sealed record CreateApiRequestRequest(string Name, Guid? FolderId, RequestDefinition? Definition);

/// <summary><paramref name="Version"/> son okunan sürümdür; arada başkası kaydettiyse 409 döner.</summary>
public sealed record UpdateApiRequestRequest(string Name, RequestDefinition Definition, int Version);

/// <summary>
/// <paramref name="SortOrder"/> hedefteki kardeşler arasındaki yeni sıradır (0'dan). <paramref name="CollectionId"/>
/// boşsa istek kendi collection'ında kalır; doluysa aynı workspace'teki o collection'a taşınır.
/// </summary>
public sealed record MoveApiRequestRequest(Guid? FolderId, int SortOrder, Guid? CollectionId = null);

/// <summary>Klasörü başka bir üst klasöre / collection'a taşır; alt klasörler ve istekler onunla gider.</summary>
public sealed record MoveFolderRequest(Guid? ParentFolderId, int SortOrder, Guid? CollectionId = null);

public sealed record FolderDto(Guid Id, Guid? ParentFolderId, string Name, int SortOrder, RequestAuth Auth, ScriptSet Scripts, string? Description = null);

public sealed record RequestSummaryDto(Guid Id, Guid? FolderId, string Name, string Method, int SortOrder, RequestKind Kind = RequestKind.Http, int Version = 0);

/// <summary>Collection ve içeriği düz listeler halinde; istemci ağacı ParentFolderId/FolderId ile kurar.</summary>
public sealed record CollectionTreeDto(
    Guid Id,
    Guid WorkspaceId,
    string Name,
    string? Description,
    RequestAuth Auth,
    IReadOnlyList<Variable> Variables,
    ScriptSet Scripts,
    IReadOnlyList<FolderDto> Folders,
    IReadOnlyList<RequestSummaryDto> Requests,
    IReadOnlyList<ExampleSummaryDto> Examples,
    WorkspaceRole? Role = null,
    bool EditingRestricted = false,
    CollectionSourceSummaryDto? Source = null);

/// <summary>Collection adresten içe aktarıldıysa kaynağı; ChangeDetected: otomatik kontrol değişiklik buldu.</summary>
public sealed record CollectionSourceSummaryDto(string Url, bool ChangeDetected);

public sealed record ApiRequestDto(
    Guid Id,
    Guid CollectionId,
    Guid? FolderId,
    string Name,
    RequestDefinition Definition,
    int Version,
    DateTimeOffset UpdatedAt);
