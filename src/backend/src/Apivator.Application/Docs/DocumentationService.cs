using System.Text.RegularExpressions;
using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Docs;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Docs;

internal sealed partial class DocumentationService(
    IApplicationDbContext db,
    IWorkspaceAccess access,
    IUserDirectory users,
    IPublicLinks links,
    TimeProvider clock) : IDocumentationService
{
    /// <summary>Örnek yanıt gövdeleri sayfada bu boyutta kesilir (tam hâli uygulamada).</summary>
    public const int ExampleBodyLimit = 64 * 1024;

    public const string Masked = "••••••";

    private static Error NotFound => Error.NotFound("docs.not_found", L.T("docs.not_found", "Doküman bulunamadı."));
    private static Error LoginRequired => Error.Unauthorized("docs.login_required", L.T("docs.login_required", "Bu doküman organizasyon içinde yayınlanmış; görmek için oturum açın."));
    private static Error PublicNeedsAdmin => Error.Forbidden("docs.public_forbidden", L.T("docs.public_forbidden", "Dokümanı herkese açık yayınlamak için workspace yöneticisi olmalısınız."));
    private static Error EnvironmentNotFound => Error.Validation("docs.environment_not_found", L.T("docs.environment_not_found", "Seçilen environment bu workspace'te yok."));

    public async Task<Result<DocumentationDto>> GetAsync(Guid collectionId, Guid? environmentId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireCollectionAsync(collectionId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        return await BuildAsync(collectionId, environmentId, ct) is { } doc ? doc : EnvironmentNotFound;
    }

    public async Task<Result<DocPublicationDto?>> GetPublicationAsync(Guid collectionId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireCollectionAsync(collectionId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var doc = await db.PublishedDocs.AsNoTracking().FirstOrDefaultAsync(d => d.CollectionId == collectionId, ct);
        return doc is null ? Result<DocPublicationDto?>.Success(null) : await ToDtoAsync(doc, ct);
    }

    public async Task<Result<DocPublicationDto>> PublishAsync(Guid collectionId, PublishDocRequest request, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireCollectionAsync(collectionId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        var workspaceId = await db.Collections.Where(c => c.Id == collectionId).Select(c => c.WorkspaceId).FirstAsync(ct);
        if (request.Visibility == DocVisibility.Public && await access.RoleAsync(workspaceId, userId, ct) != WorkspaceRole.Admin)
        {
            return PublicNeedsAdmin;
        }

        if (request.EnvironmentId is { } envId && !await db.Environments.AnyAsync(e => e.Id == envId && e.WorkspaceId == workspaceId, ct))
        {
            return EnvironmentNotFound;
        }

        var now = clock.GetUtcNow();
        var doc = await db.PublishedDocs.FirstOrDefaultAsync(d => d.CollectionId == collectionId, ct);
        if (doc is null)
        {
            doc = PublishedDoc.Create(collectionId, request.Visibility, request.EnvironmentId, userId, now);
            db.PublishedDocs.Add(doc);
        }
        else
        {
            doc.Update(request.Visibility, request.EnvironmentId, userId, now);
        }

        await db.SaveChangesAsync(ct);
        return await ToDtoAsync(doc, ct);
    }

    public async Task<Result<DocPublicationDto>> RegenerateLinkAsync(Guid collectionId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireCollectionAsync(collectionId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        var doc = await db.PublishedDocs.FirstOrDefaultAsync(d => d.CollectionId == collectionId, ct);
        if (doc is null)
        {
            return NotFound;
        }

        doc.RegenerateSlug(clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return await ToDtoAsync(doc, ct);
    }

    public async Task<Result> UnpublishAsync(Guid collectionId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireCollectionAsync(collectionId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        var doc = await db.PublishedDocs.FirstOrDefaultAsync(d => d.CollectionId == collectionId, ct);
        if (doc is not null)
        {
            db.PublishedDocs.Remove(doc);
            await db.SaveChangesAsync(ct);
        }

        return Result.Success();
    }

    public async Task<Result<DocumentationDto>> GetPublishedAsync(string slug, Guid? userId, CancellationToken ct = default)
    {
        if (!PublishedDoc.IsWellFormedSlug(slug))
        {
            return NotFound;
        }

        var doc = await db.PublishedDocs.AsNoTracking().FirstOrDefaultAsync(d => d.Slug == slug, ct);
        if (doc is null)
        {
            return NotFound;
        }

        if (doc.Visibility == DocVisibility.Organization)
        {
            if (userId is not { } uid)
            {
                return LoginRequired;
            }

            var organizationId = await db.Collections.Where(c => c.Id == doc.CollectionId)
                .Join(db.Workspaces, c => c.WorkspaceId, w => w.Id, (c, w) => w.OrganizationId)
                .FirstAsync(ct);
            if (!await db.OrganizationMembers.AnyAsync(m => m.OrganizationId == organizationId && m.UserId == uid, ct))
            {
                // Başka organizasyonun dokümanının varlığı sızdırılmaz.
                return NotFound;
            }
        }

        return await BuildAsync(doc.CollectionId, doc.EnvironmentId, ct) is { } result ? result : NotFound;
    }

    private async Task<DocPublicationDto> ToDtoAsync(PublishedDoc doc, CancellationToken ct)
    {
        var environmentName = doc.EnvironmentId is { } envId
            ? await db.Environments.Where(e => e.Id == envId).Select(e => e.Name).FirstOrDefaultAsync(ct)
            : null;
        var names = await users.DisplayNamesAsync([doc.PublishedById], ct);
        return new DocPublicationDto(
            doc.Slug,
            links.Docs(doc.Slug),
            doc.Visibility,
            doc.EnvironmentId,
            environmentName,
            names.GetValueOrDefault(doc.PublishedById, "?"),
            doc.CreatedAt,
            doc.UpdatedAt);
    }

    /// <summary>Environment verilip bulunamazsa null.</summary>
    private async Task<DocumentationDto?> BuildAsync(Guid collectionId, Guid? environmentId, CancellationToken ct)
    {
        var collection = await db.Collections.AsNoTracking().FirstAsync(c => c.Id == collectionId, ct);
        var workspaceName = await db.Workspaces.Where(w => w.Id == collection.WorkspaceId).Select(w => w.Name).FirstAsync(ct);
        var environment = environmentId is { } envId
            ? await db.Environments.AsNoTracking().FirstOrDefaultAsync(e => e.Id == envId && e.WorkspaceId == collection.WorkspaceId, ct)
            : null;
        if (environmentId is not null && environment is null)
        {
            return null;
        }

        var folders = await db.Folders.AsNoTracking().Where(f => f.CollectionId == collectionId).ToListAsync(ct);
        var requests = await db.Requests.AsNoTracking().Where(r => r.CollectionId == collectionId).ToListAsync(ct);
        var requestIds = requests.Select(r => r.Id).ToList();
        var examples = (await db.Examples.AsNoTracking()
                .Where(e => requestIds.Contains(e.RequestId))
                .OrderBy(e => e.SortOrder).ThenBy(e => e.CreatedAt)
                .ToListAsync(ct))
            .ToLookup(e => e.RequestId);
        var folderById = folders.ToDictionary(f => f.Id);

        var variables = collection.Variables.Where(v => v.Enabled && !string.IsNullOrWhiteSpace(v.Key))
            .Select(v => new DocVariableDto(v.Key, v.IsSecret ? string.Empty : v.Value, v.IsSecret, "collection"))
            .ToList();
        if (environment is not null)
        {
            // Environment'taki aynı adlı değişken collection'dakini ezer (gönderimdeki sırayla aynı).
            foreach (var v in environment.Variables.Where(v => v.Enabled && !string.IsNullOrWhiteSpace(v.Key)))
            {
                variables.RemoveAll(x => x.Key == v.Key);
                variables.Add(new DocVariableDto(v.Key, v.IsSecret ? string.Empty : v.Value, v.IsSecret, "environment"));
            }
        }

        var docRequests = requests
            .Select(r => new DocRequestDto(
                r.Id,
                r.FolderId,
                r.Name,
                r.SortOrder,
                r.Definition.Kind,
                r.Definition.Method,
                MaskUrl(r.Definition.Url),
                r.Definition.Description,
                MaskHeaders(r.Definition.Headers.Where(h => h.Enabled && !string.IsNullOrWhiteSpace(h.Key))),
                r.Definition.Body,
                AuthSummary(r.Definition.Auth, r.FolderId, folderById, collection.Auth),
                r.Definition.Kind == RequestKind.Grpc ? r.Definition.Grpc.Method : null,
                examples[r.Id].Select(e => new DocExampleDto(
                    e.Id,
                    e.Name,
                    e.Status,
                    e.Headers,
                    e.Body.Length > ExampleBodyLimit ? e.Body[..ExampleBodyLimit] : e.Body,
                    e.Body.Length > ExampleBodyLimit,
                    string.IsNullOrEmpty(e.Request.Url) ? null : MaskUrl(e.Request.Url),
                    e.Request.Body.Mode is BodyMode.Raw or BodyMode.GraphQL && e.Request.Body.Raw.Length > 0 ? Clip(e.Request.Body.Raw) : null)).ToList()))
            .ToList();

        var updatedAt = requests.Select(r => r.UpdatedAt).Append(collection.UpdatedAt).Max();
        return new DocumentationDto(
            collection.Id,
            collection.Name,
            collection.Description,
            workspaceName,
            Summary(collection.Auth.Type == AuthType.Inherit ? RequestAuth.None : collection.Auth, null),
            environment?.Name,
            variables,
            folders.Select(f => new DocFolderDto(f.Id, f.ParentFolderId, f.Name, f.Description, f.SortOrder)).ToList(),
            docRequests,
            updatedAt);
    }

    private static string Clip(string text) => text.Length > ExampleBodyLimit ? text[..ExampleBodyLimit] : text;

    private static DocAuthDto AuthSummary(RequestAuth auth, Guid? folderId, Dictionary<Guid, Folder> folders, RequestAuth collectionAuth)
    {
        if (auth.Type != AuthType.Inherit)
        {
            return Summary(auth, null);
        }

        // Miras: en yakın üst klasör, yoksa collection (gönderimdeki kuralla aynı).
        var current = folderId;
        for (var guard = 0; current is { } id && guard < 50 && folders.TryGetValue(id, out var folder); guard++)
        {
            if (folder.Auth.Type != AuthType.Inherit)
            {
                return Summary(folder.Auth, folder.Name);
            }

            current = folder.ParentFolderId;
        }

        return collectionAuth.Type is AuthType.Inherit or AuthType.None
            ? Summary(RequestAuth.None, null)
            : Summary(collectionAuth, "collection");
    }

    /// <summary>Gizli olmayan ayrıntı: anahtarın adı ve yeri, OAuth akışı ve token adresi, AWS bölgesi/servisi.</summary>
    private static DocAuthDto Summary(RequestAuth auth, string? source) => auth.Type switch
    {
        AuthType.Bearer => new(auth.Type, "Authorization: Bearer <token>", source),
        AuthType.Basic => new(auth.Type, L.T("docs.auth_basic", "Authorization: Basic <kullanıcı:parola>"), source),
        AuthType.ApiKey => new(
            auth.Type,
            auth.ApiKeyIn == ApiKeyLocation.Query ? L.T("docs.auth_api_key_query", "?{name}=<anahtar> (query)", ("name", auth.ApiKeyName)) : L.T("docs.auth_api_key_header", "{name}: <anahtar> (header)", ("name", auth.ApiKeyName)),
            source),
        AuthType.OAuth2 => new(
            auth.Type,
            string.Join(" · ", new[]
            {
                auth.OAuth2GrantType.ToString(),
                auth.OAuth2TokenUrl.Length > 0 ? $"token: {auth.OAuth2TokenUrl}" : null,
                auth.OAuth2Scope.Length > 0 ? $"scope: {auth.OAuth2Scope}" : null,
            }.Where(p => p is not null)),
            source),
        AuthType.AwsSigV4 => new(auth.Type, $"{auth.AwsService} · {auth.AwsRegion}", source),
        _ => new(auth.Type, null, source),
    };

    /// <summary>Hassas adlı header'ların değeri maskelenir; yalnızca {{değişken}} olan değer (adı göründüğü için) kalır.</summary>
    internal static IReadOnlyList<KeyValueItem> MaskHeaders(IEnumerable<KeyValueItem> headers) =>
        [.. headers.Select(h => IsSensitive(h.Key) && !IsVariableOnly(h.Value) ? h with { Value = Masked } : h)];

    /// <summary>Hassas adlı query parametrelerinin değeri maskelenir.</summary>
    internal static string MaskUrl(string url)
    {
        var q = url.IndexOf('?', StringComparison.Ordinal);
        if (q < 0)
        {
            return url;
        }

        var hash = url.IndexOf('#', q);
        var query = hash < 0 ? url[(q + 1)..] : url[(q + 1)..hash];
        var parts = query.Split('&').Select(p =>
        {
            var eq = p.IndexOf('=', StringComparison.Ordinal);
            if (eq < 0)
            {
                return p;
            }

            var key = Uri.UnescapeDataString(p[..eq]);
            var value = p[(eq + 1)..];
            return IsSensitive(key) && !IsVariableOnly(Uri.UnescapeDataString(value)) ? $"{p[..eq]}={Masked}" : p;
        });
        return url[..(q + 1)] + string.Join('&', parts) + (hash < 0 ? string.Empty : url[hash..]);
    }

    private static bool IsSensitive(string key)
    {
        var k = key.Trim().ToLowerInvariant().Replace("-", string.Empty, StringComparison.Ordinal).Replace("_", string.Empty, StringComparison.Ordinal);
        return k is "authorization" or "proxyauthorization" or "cookie" or "setcookie" or "xapikey" or "apikey" or "key" or "sig" or "signature"
            || k.Contains("token", StringComparison.Ordinal)
            || k.Contains("secret", StringComparison.Ordinal)
            || k.Contains("password", StringComparison.Ordinal)
            || k.Contains("apikey", StringComparison.Ordinal);
    }

    private static bool IsVariableOnly(string value) => VariableOnly().IsMatch(value);

    [GeneratedRegex(@"^\s*(Bearer\s+|Basic\s+)?\{\{[^{}]+\}\}\s*$", RegexOptions.IgnoreCase)]
    private static partial Regex VariableOnly();
}
