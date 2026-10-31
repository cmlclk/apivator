using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Examples;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Variables;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Collections;

internal sealed class CollectionService(IApplicationDbContext db, IWorkspaceAccess access, TimeProvider clock) : ICollectionService
{
    private static Error CollectionNotFound => Error.NotFound("collection.not_found", L.T("collection.not_found", "Collection bulunamadı."));
    private static Error FolderNotFound => Error.NotFound("folder.not_found", L.T("folder.not_found", "Klasör bulunamadı."));
    private static Error RequestNotFound => Error.NotFound("request.not_found", L.T("request.not_found", "İstek bulunamadı."));
    private static Error ScriptTooLong => Error.Validation("validation", L.T("collection.script_too_long", "Bir script en fazla {max:N0} karakter olabilir.", ("max", ScriptSet.MaxLength)));

    private static Error DescriptionTooLong => Error.Validation("validation", L.T("collection.description_too_long", "Açıklama en fazla {max:N0} karakter olabilir.", ("max", RequestDefinition.DescriptionMaxLength)));

    public async Task<Result<IReadOnlyList<CollectionTreeDto>>> ListAsync(Guid workspaceId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var collections = await db.Collections.AsNoTracking()
            .Where(c => c.WorkspaceId == workspaceId)
            .OrderBy(c => c.Name)
            .ToListAsync(ct);

        var ids = collections.Select(c => c.Id).ToList();
        var folders = await db.Folders.AsNoTracking().Where(f => ids.Contains(f.CollectionId)).ToListAsync(ct);
        var requests = await db.Requests.AsNoTracking()
            .Where(r => ids.Contains(r.CollectionId))
            .Select(r => new { r.Id, r.CollectionId, r.FolderId, r.Name, r.Method, r.SortOrder, r.Kind, r.Version })
            .ToListAsync(ct);
        var requestIds = requests.Select(r => r.Id).ToList();
        var examples = await db.Examples.AsNoTracking()
            .Where(e => requestIds.Contains(e.RequestId))
            .OrderBy(e => e.SortOrder).ThenBy(e => e.CreatedAt)
            .Select(e => new ExampleSummaryDto(e.Id, e.RequestId, e.Name, e.Status))
            .ToListAsync(ct);
        var collectionOf = requests.ToDictionary(r => r.Id, r => r.CollectionId);
        var roles = await access.CollectionRolesAsync(workspaceId, userId, ct);
        var sources = await db.CollectionSources.AsNoTracking()
            .Where(s => ids.Contains(s.CollectionId))
            .Select(s => new { s.CollectionId, s.Url, Changed = s.ChangeDetectedAt != null })
            .ToDictionaryAsync(s => s.CollectionId, s => new CollectionSourceSummaryDto(s.Url, s.Changed), ct);

        return collections
            .Select(c => new CollectionTreeDto(
                c.Id,
                c.WorkspaceId,
                c.Name,
                c.Description,
                c.Auth,
                c.Variables,
                c.Scripts,
                folders.Where(f => f.CollectionId == c.Id).OrderBy(f => f.SortOrder).Select(ToDto).ToList(),
                requests.Where(r => r.CollectionId == c.Id)
                    .OrderBy(r => r.SortOrder)
                    .Select(r => new RequestSummaryDto(r.Id, r.FolderId, r.Name, r.Method, r.SortOrder, r.Kind, r.Version))
                    .ToList(),
                examples.Where(e => collectionOf[e.RequestId] == c.Id).ToList(),
                roles.TryGetValue(c.Id, out var role) ? role : null,
                c.EditingRestricted,
                sources.GetValueOrDefault(c.Id)))
            .ToList();
    }

    public async Task<Result<CollectionTreeDto>> CreateAsync(Guid workspaceId, CreateCollectionRequest request, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        if (NameError(request.Name, Collection.NameMaxLength) is { } invalid)
        {
            return invalid;
        }

        var collection = Collection.Create(workspaceId, request.Name, userId, clock.GetUtcNow());
        db.Collections.Add(collection);
        await db.SaveChangesAsync(ct);

        return new CollectionTreeDto(collection.Id, workspaceId, collection.Name, null, collection.Auth, collection.Variables, collection.Scripts, [], [], []);
    }

    public async Task<Result<CollectionTreeDto>> UpdateAsync(Guid collectionId, UpdateCollectionRequest request, Guid userId, CancellationToken ct = default)
    {
        var (collection, error) = await LoadCollectionAsync(collectionId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        var now = clock.GetUtcNow();
        if (request.Name is not null)
        {
            if (NameError(request.Name, Collection.NameMaxLength) is { } invalid)
            {
                return invalid;
            }

            collection!.Rename(request.Name, now);
        }

        if (request.Description is not null)
        {
            if (request.Description.Length > RequestDefinition.DescriptionMaxLength)
            {
                return DescriptionTooLong;
            }

            collection!.Describe(request.Description, now);
        }

        if (request.Auth is not null)
        {
            collection!.SetAuth(request.Auth, now);
        }

        if (request.Scripts is not null)
        {
            if (request.Scripts.IsTooLong)
            {
                return ScriptTooLong;
            }

            collection!.SetScripts(request.Scripts, now);
        }

        if (request.Variables is not null)
        {
            var (variables, invalid) = VariableRuleMessages.Clean(request.Variables);
            if (invalid is not null)
            {
                return Error.Validation("validation", invalid);
            }

            collection!.SetVariables(variables, now);
        }

        await db.SaveChangesAsync(ct);
        return new CollectionTreeDto(collection!.Id, collection.WorkspaceId, collection.Name, collection.Description, collection.Auth, collection.Variables, collection.Scripts, [], [], []);
    }

    public async Task<Result> DeleteAsync(Guid collectionId, Guid userId, CancellationToken ct = default)
    {
        var (collection, error) = await LoadCollectionAsync(collectionId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        db.Collections.Remove(collection!);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<FolderDto>> CreateFolderAsync(Guid collectionId, CreateFolderRequest request, Guid userId, CancellationToken ct = default)
    {
        var (collection, error) = await LoadCollectionAsync(collectionId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        if (NameError(request.Name, Folder.NameMaxLength) is { } invalid)
        {
            return invalid;
        }

        if (request.ParentFolderId is { } parentId
            && !await db.Folders.AnyAsync(f => f.Id == parentId && f.CollectionId == collection!.Id, ct))
        {
            return FolderNotFound;
        }

        var sortOrder = await NextSortOrderAsync(collection!.Id, request.ParentFolderId, ct);
        var folder = Folder.Create(collection.Id, request.ParentFolderId, request.Name, sortOrder, clock.GetUtcNow());
        db.Folders.Add(folder);
        await db.SaveChangesAsync(ct);
        return ToDto(folder);
    }

    public async Task<Result<FolderDto>> UpdateFolderAsync(Guid folderId, UpdateFolderRequest request, Guid userId, CancellationToken ct = default)
    {
        var (folder, error) = await LoadFolderAsync(folderId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        if (request.Name is not null)
        {
            if (NameError(request.Name, Folder.NameMaxLength) is { } invalid)
            {
                return invalid;
            }

            folder!.Rename(request.Name);
        }

        if (request.Auth is not null)
        {
            folder!.SetAuth(request.Auth);
        }

        if (request.Scripts is not null)
        {
            if (request.Scripts.IsTooLong)
            {
                return ScriptTooLong;
            }

            folder!.SetScripts(request.Scripts);
        }

        if (request.Description is not null)
        {
            if (request.Description.Length > RequestDefinition.DescriptionMaxLength)
            {
                return DescriptionTooLong;
            }

            folder!.Describe(request.Description);
        }

        await db.SaveChangesAsync(ct);
        return ToDto(folder!);
    }

    public async Task<Result> DeleteFolderAsync(Guid folderId, Guid userId, CancellationToken ct = default)
    {
        var (folder, error) = await LoadFolderAsync(folderId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        // Alt klasörler ve içlerindeki istekler veritabanında cascade ile silinir.
        db.Folders.Remove(folder!);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<ApiRequestDto>> CreateRequestAsync(Guid collectionId, CreateApiRequestRequest request, Guid userId, CancellationToken ct = default)
    {
        var (collection, error) = await LoadCollectionAsync(collectionId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        if (NameError(request.Name, ApiRequest.NameMaxLength) is { } invalidName)
        {
            return invalidName;
        }

        var definition = request.Definition ?? RequestDefinition.Default;
        if (DefinitionError(definition) is { } invalidDefinition)
        {
            return invalidDefinition;
        }

        if (request.FolderId is { } folderId
            && !await db.Folders.AnyAsync(f => f.Id == folderId && f.CollectionId == collection!.Id, ct))
        {
            return FolderNotFound;
        }

        var sortOrder = await NextSortOrderAsync(collection!.Id, request.FolderId, ct);
        var entity = ApiRequest.Create(collection.Id, request.FolderId, request.Name, definition, sortOrder, userId, clock.GetUtcNow());
        db.Requests.Add(entity);
        await db.SaveChangesAsync(ct);
        return ToDto(entity);
    }

    public async Task<Result<IReadOnlyList<ApiRequestDto>>> ListRequestsAsync(Guid collectionId, Guid userId, CancellationToken ct = default)
    {
        var (_, error) = await LoadCollectionAsync(collectionId, userId, WorkspaceRole.Viewer, ct);
        if (error is not null)
        {
            return error;
        }

        var requests = await db.Requests.AsNoTracking()
            .Where(r => r.CollectionId == collectionId)
            .OrderBy(r => r.SortOrder).ThenBy(r => r.CreatedAt)
            .ToListAsync(ct);
        return requests.Select(ToDto).ToList();
    }

    public async Task<Result<ApiRequestDto>> GetRequestAsync(Guid requestId, Guid userId, CancellationToken ct = default)
    {
        var (entity, error) = await LoadRequestAsync(requestId, userId, WorkspaceRole.Viewer, ct);
        return error is not null ? error : ToDto(entity!);
    }

    public async Task<Result<ApiRequestDto>> UpdateRequestAsync(Guid requestId, UpdateApiRequestRequest request, Guid userId, CancellationToken ct = default)
    {
        var (entity, error) = await LoadRequestAsync(requestId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        if (NameError(request.Name, ApiRequest.NameMaxLength) is { } invalidName)
        {
            return invalidName;
        }

        if (request.Definition is null)
        {
            return Error.Validation("validation", L.T("request.definition_required", "İstek tanımı zorunludur."));
        }

        if (DefinitionError(request.Definition) is { } invalidDefinition)
        {
            return invalidDefinition;
        }

        if (entity!.Version != request.Version)
        {
            return Error.Conflict(
                "request.version_conflict",
                L.T("request.version_conflict", "Bu istek siz açtıktan sonra başka biri tarafından değiştirildi. Güncel hâlini yükleyip tekrar deneyin."));
        }

        entity.Update(request.Name, request.Definition, userId, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return ToDto(entity);
    }

    public async Task<Result> DeleteRequestAsync(Guid requestId, Guid userId, CancellationToken ct = default)
    {
        var (entity, error) = await LoadRequestAsync(requestId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        db.Requests.Remove(entity!);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    private async Task<(Collection? Collection, Error? Error)> LoadCollectionAsync(Guid collectionId, Guid userId, WorkspaceRole minimum, CancellationToken ct)
    {
        var collection = await db.Collections.FirstOrDefaultAsync(c => c.Id == collectionId, ct);
        if (collection is null)
        {
            return (null, CollectionNotFound);
        }

        var denied = await access.RequireCollectionAsync(collection.Id, userId, minimum, ct);
        return denied is null ? (collection, null) : (null, denied == WorkspaceAccess.NotFound ? CollectionNotFound : denied);
    }

    private async Task<(Folder? Folder, Error? Error)> LoadFolderAsync(Guid folderId, Guid userId, CancellationToken ct)
    {
        var folder = await db.Folders.FirstOrDefaultAsync(f => f.Id == folderId, ct);
        if (folder is null)
        {
            return (null, FolderNotFound);
        }

        var (_, error) = await LoadCollectionAsync(folder.CollectionId, userId, WorkspaceRole.Editor, ct);
        return error is null ? (folder, null) : (null, error == CollectionNotFound ? FolderNotFound : error);
    }

    private async Task<(ApiRequest? Request, Error? Error)> LoadRequestAsync(Guid requestId, Guid userId, WorkspaceRole minimum, CancellationToken ct)
    {
        var entity = await db.Requests.FirstOrDefaultAsync(r => r.Id == requestId, ct);
        if (entity is null)
        {
            return (null, RequestNotFound);
        }

        var (_, error) = await LoadCollectionAsync(entity.CollectionId, userId, minimum, ct);
        return error is null ? (entity, null) : (null, error == CollectionNotFound ? RequestNotFound : error);
    }

    private async Task<int> NextSortOrderAsync(Guid collectionId, Guid? folderId, CancellationToken ct)
    {
        var maxFolder = await db.Folders
            .Where(f => f.CollectionId == collectionId && f.ParentFolderId == folderId)
            .MaxAsync(f => (int?)f.SortOrder, ct) ?? -1;
        var maxRequest = await db.Requests
            .Where(r => r.CollectionId == collectionId && r.FolderId == folderId)
            .MaxAsync(r => (int?)r.SortOrder, ct) ?? -1;
        return Math.Max(maxFolder, maxRequest) + 1;
    }

    private static Error? NameError(string? name, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            var required = L.T("collection.name_required", "Ad boş olamaz.");
            return Error.Validation("validation", required, new Dictionary<string, string[]> { ["name"] = [required] });
        }

        return name.Trim().Length > maxLength
            ? TooLongName(maxLength)
            : null;
    }

    private static Error TooLongName(int maxLength)
    {
        var message = L.T("collection.name_max_length", "Ad en fazla {max} karakter olabilir.", ("max", maxLength));
        return Error.Validation("validation", message, new Dictionary<string, string[]> { ["name"] = [message] });
    }

    private static Error? DefinitionError(RequestDefinition definition)
    {
        if (definition.Scripts?.IsTooLong == true)
        {
            return ScriptTooLong;
        }

        if (definition.Description is { Length: > RequestDefinition.DescriptionMaxLength })
        {
            return DescriptionTooLong;
        }

        if (definition.Url is { Length: > RequestDefinition.UrlMaxLength })
        {
            return Error.Validation("validation", L.T("request.url_max_length", "URL en fazla {max} karakter olabilir.", ("max", RequestDefinition.UrlMaxLength)));
        }

        if (definition.Messages is { Count: > RequestDefinition.MaxSavedMessages })
        {
            return Error.Validation("validation", L.T("request.messages_max", "En fazla {max} mesaj kaydedilebilir.", ("max", RequestDefinition.MaxSavedMessages)));
        }

        if (definition.Messages?.Any(m => m is null || m.Body is null || m.Body.Length > RequestDefinition.SavedMessageMaxLength || (m.Name?.Length ?? 0) > 200) == true)
        {
            return Error.Validation("validation", L.T("request.message_too_long", "Kayıtlı mesajlardan biri çok uzun."));
        }

        if (definition.Protocols is { Length: > RequestDefinition.ProtocolsMaxLength })
        {
            return Error.Validation("validation", L.T("request.protocols_too_long", "Alt protokol listesi çok uzun."));
        }

        if (definition.Grpc is { } grpc)
        {
            var files = grpc.ProtoFiles ?? [];
            if (files.Count > GrpcSettings.MaxProtoFiles
                || files.Any(f => f is null || f.Content is null || f.Name is null || f.Name.Length > 300)
                || files.Sum(f => (long)(f?.Content?.Length ?? 0)) > GrpcSettings.MaxProtoBytes)
            {
                return Error.Validation("validation", L.T("request.grpc_proto_limit", "En fazla {files} .proto dosyası, toplam {mb} MB kaydedilebilir.", ("files", GrpcSettings.MaxProtoFiles), ("mb", GrpcSettings.MaxProtoBytes / 1024 / 1024)));
            }

            if (grpc.Message is { Length: > RequestDefinition.SavedMessageMaxLength } || grpc.Method is { Length: > 500 })
            {
                return Error.Validation("validation", L.T("request.grpc_too_long", "gRPC mesajı ya da metot adı çok uzun."));
            }
        }

        var method = definition.Method?.Trim() ?? string.Empty;
        return method.Length is 0 or > 20 || !method.All(char.IsAsciiLetter)
            ? Error.Validation("validation", L.T("request.invalid_method", "Geçersiz HTTP method."))
            : null;
    }

    private static FolderDto ToDto(Folder f) => new(f.Id, f.ParentFolderId, f.Name, f.SortOrder, f.Auth, f.Scripts, f.Description);

    private static ApiRequestDto ToDto(ApiRequest r) =>
        new(r.Id, r.CollectionId, r.FolderId, r.Name, r.Definition, r.Version, r.UpdatedAt);
}
