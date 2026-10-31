using System.Text.Json;
using System.Text.Json.Nodes;
using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Environments;
using Apivator.Domain.Variables;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Import;

public sealed record ImportResult(
    string Kind,
    Guid Id,
    string Name,
    int Folders,
    int Requests,
    int Variables,
    int Examples,
    IReadOnlyList<string> Warnings);

public sealed record ExportFile(string FileName, JsonObject Content);

public interface IImportService
{
    /// <summary>Dosyanın collection mı environment mı olduğunu kendisi anlar.</summary>
    Task<Result<ImportResult>> ImportPostmanAsync(Guid workspaceId, JsonElement document, Guid userId, CancellationToken ct = default);

    /// <summary>
    /// OpenAPI/Swagger belgesini adresinden içe aktarır (belge, Swagger UI sayfası ya da sunucu adresi). Collection
    /// kaynağını hatırlar; sonradan "kaynaktan güncelle" ile güncellenebilir. Birden çok sürüm varsa seçenekler döner.
    /// </summary>
    Task<Result<UrlImportResponse>> ImportFromUrlAsync(Guid workspaceId, UrlImportRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<ExportFile>> ExportCollectionAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    /// <summary>Collection'ı OpenAPI 3.0.3 (JSON) belgesi olarak dışa aktarır.</summary>
    Task<Result<ExportFile>> ExportOpenApiAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    Task<Result<ExportFile>> ExportEnvironmentAsync(Guid environmentId, Guid userId, CancellationToken ct = default);
}

internal sealed class ImportService(IApplicationDbContext db, IWorkspaceAccess access, IApiSpecFetcher fetcher, TimeProvider clock) : IImportService
{
    public async Task<Result<ImportResult>> ImportPostmanAsync(Guid workspaceId, JsonElement document, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        var parser = new PostmanParser();

        if (PostmanParser.IsCollection(document))
        {
            var parsed = parser.ParseCollection(document);
            return await SaveCollectionAsync(workspaceId, parsed, parser.Warnings, parser.ExampleCount, userId, ct);
        }

        if (OpenApiParser.IsOpenApi3(document))
        {
            var openApi = new OpenApiParser(document);
            var parsedApi = openApi.Parse();
            return await SaveCollectionAsync(workspaceId, parsedApi, openApi.Warnings, openApi.ExampleCount, userId, ct);
        }

        if (HarParser.IsHar(document))
        {
            var har = new HarParser();
            var parsedHar = har.Parse(document);
            if (parsedHar.Items.Count == 0)
            {
                return Error.Validation("import.empty", L.T("import.empty", "HAR dosyasında içe aktarılacak bir API isteği bulunamadı."));
            }

            return await SaveCollectionAsync(workspaceId, parsedHar, har.Warnings, har.ExampleCount, userId, ct);
        }

        if (OpenApiParser.IsSwagger2(document))
        {
            var converted = ApiSpec.Normalize((JsonObject)JsonNode.Parse(document.GetRawText())!, documentUrl: null);
            if (!converted.IsSuccess)
            {
                return converted.Error!;
            }

            var swagger = new OpenApiParser(JsonSerializer.SerializeToElement(converted.Value));
            var parsedSwagger = swagger.Parse();
            return await SaveCollectionAsync(workspaceId, parsedSwagger, swagger.Warnings, swagger.ExampleCount, userId, ct);
        }

        if (PostmanParser.IsEnvironment(document))
        {
            var parsed = PostmanParser.ParseEnvironment(document);
            var (variables, invalid) = VariableRuleMessages.Clean(parsed.Variables);
            if (invalid is not null)
            {
                return Error.Validation("import.invalid", invalid);
            }

            var environment = WorkspaceEnvironment.Create(workspaceId, parsed.Name, variables, userId, clock.GetUtcNow());
            db.Environments.Add(environment);
            await db.SaveChangesAsync(ct);
            return new ImportResult("environment", environment.Id, environment.Name, 0, 0, variables.Count, 0, parser.Warnings);
        }

        return PostmanParser.IsLegacyV1(document)
            ? Error.Validation("import.unsupported", L.T("import.postman_v1", "Bu dosya Postman'in eski v1 formatında. Postman'den \"Collection v2.1\" olarak yeniden dışa aktarın."))
            : Error.Validation("import.unsupported", L.T("import.unsupported", "Dosya bir Postman collection'ı (v2.0/v2.1), environment'ı, OpenAPI 3 / Swagger 2.0 belgesi ya da HAR dosyası değil."));
    }

    public async Task<Result<UrlImportResponse>> ImportFromUrlAsync(Guid workspaceId, UrlImportRequest request, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        var loaded = await LoadSpecAsync(fetcher, request.Url, request.Headers, request.Document, ct);
        if (!loaded.IsSuccess)
        {
            return loaded.Error!;
        }

        if (loaded.Value.Choices is { } choices)
        {
            return new UrlImportResponse(null, choices);
        }

        var spec = loaded.Value;
        var parser = new OpenApiParser(JsonSerializer.SerializeToElement(spec.Document!));
        var parsed = parser.Parse();
        var saved = await SaveCollectionAsync(workspaceId, parsed, parser.Warnings, parser.ExampleCount, userId, ct, collectionId =>
            db.CollectionSources.Add(CollectionSource.Create(
                collectionId,
                spec.Url!,
                local: request.Document is not null,
                ApiSpec.Serialize(spec.Document!),
                ApiSpec.Hash(spec.Document!),
                ApiSpec.DocumentVersion(spec.Document!),
                userId,
                clock.GetUtcNow())));
        return saved.IsSuccess ? new UrlImportResponse(saved.Value, null) : saved.Error!;
    }

    /// <summary>Çekilmiş ya da adresten çekilen belge: OpenAPI 3'e çevrilmiş hali ve adresi, ya da sürüm seçenekleri.</summary>
    internal sealed record LoadedSpec(string? Url, JsonObject? Document, IReadOnlyList<SpecChoice>? Choices);

    internal static async Task<Result<LoadedSpec>> LoadSpecAsync(
        IApiSpecFetcher fetcher,
        string url,
        IReadOnlyList<KeyValueItem>? headers,
        string? document,
        CancellationToken ct)
    {
        string text;
        string finalUrl;
        if (document is not null)
        {
            if (document.Length > ApiSpec.MaxBytes)
            {
                return Error.Validation("spec.too_large", L.T("spec.too_large", "Belge {mb} MB sınırını aşıyor.", ("mb", ApiSpec.MaxBytes / 1024 / 1024)));
            }

            text = document;
            finalUrl = url.Trim();
        }
        else
        {
            var fetched = await fetcher.FetchAsync(new SpecFetchRequest(url, headers), ct);
            if (!fetched.IsSuccess)
            {
                return fetched.Error!;
            }

            if (fetched.Value.Choices is { } choices)
            {
                return new LoadedSpec(null, null, choices);
            }

            text = fetched.Value.Content!;
            finalUrl = fetched.Value.Url!;
        }

        if (!Uri.TryCreate(finalUrl, UriKind.Absolute, out var documentUri) || documentUri.Scheme is not ("http" or "https"))
        {
            return Error.Validation("spec.url", L.T("spec.url", "Geçerli bir http(s) adresi girin."));
        }

        var spec = ApiSpec.Read(text, documentUri);
        return spec.IsSuccess ? new LoadedSpec(documentUri.ToString(), spec.Value, null) : spec.Error!;
    }

    public Task<Result<ExportFile>> ExportCollectionAsync(Guid collectionId, Guid userId, CancellationToken ct = default) =>
        ExportAsync(collectionId, userId, (c, f, r, e) => new ExportFile($"{c.Name}.postman_collection.json", PostmanExporter.Collection(c, f, r, e)), ct);

    public Task<Result<ExportFile>> ExportOpenApiAsync(Guid collectionId, Guid userId, CancellationToken ct = default) =>
        ExportAsync(collectionId, userId, (c, f, r, e) => new ExportFile($"{c.Name}.openapi.json", OpenApiExporter.Export(c, f, r, e)), ct);

    private async Task<Result<ExportFile>> ExportAsync(
        Guid collectionId,
        Guid userId,
        Func<Collection, List<Folder>, List<ApiRequest>, List<ResponseExample>, ExportFile> export,
        CancellationToken ct)
    {
        var notFound = Error.NotFound("collection.not_found", L.T("collection.not_found", "Collection bulunamadı."));
        var collection = await db.Collections.AsNoTracking().FirstOrDefaultAsync(c => c.Id == collectionId, ct);
        if (collection is null || await access.RequireAsync(collection.WorkspaceId, userId, WorkspaceRole.Viewer, ct) is not null)
        {
            return notFound;
        }

        var folders = await db.Folders.AsNoTracking().Where(f => f.CollectionId == collectionId).ToListAsync(ct);
        var requests = await db.Requests.AsNoTracking().Where(r => r.CollectionId == collectionId).ToListAsync(ct);
        var requestIds = requests.Select(r => r.Id).ToList();
        var examples = await db.Examples.AsNoTracking()
            .Where(e => requestIds.Contains(e.RequestId))
            .OrderBy(e => e.SortOrder).ThenBy(e => e.CreatedAt)
            .ToListAsync(ct);
        return export(collection, folders, requests, examples);
    }

    public async Task<Result<ExportFile>> ExportEnvironmentAsync(Guid environmentId, Guid userId, CancellationToken ct = default)
    {
        var environment = await db.Environments.AsNoTracking().FirstOrDefaultAsync(e => e.Id == environmentId, ct);
        if (environment is null || await access.RequireAsync(environment.WorkspaceId, userId, WorkspaceRole.Viewer, ct) is not null)
        {
            return Error.NotFound("environment.not_found", L.T("environment.not_found", "Environment bulunamadı."));
        }

        return new ExportFile($"{environment.Name}.postman_environment.json", PostmanExporter.Environment(environment));
    }

    /// <summary>Tüm collection tek SaveChanges ile (tek transaction) yazılır: ya tamamı ya hiçbiri.</summary>
    private async Task<Result<ImportResult>> SaveCollectionAsync(
        Guid workspaceId,
        ParsedCollection parsed,
        IReadOnlyList<string> warnings,
        int exampleCount,
        Guid userId,
        CancellationToken ct,
        Action<Guid>? beforeSave = null)
    {
        var (variables, invalid) = VariableRuleMessages.Clean(parsed.Variables);
        if (invalid is not null)
        {
            return Error.Validation("import.invalid", invalid);
        }

        var now = clock.GetUtcNow();
        var collection = Collection.Create(workspaceId, parsed.Name, userId, now);
        collection.SetAuth(parsed.Auth, now);
        collection.SetVariables(variables, now);
        collection.SetScripts(parsed.Scripts, now);
        if (!string.IsNullOrWhiteSpace(parsed.Description))
        {
            collection.Describe(parsed.Description, now);
        }

        db.Collections.Add(collection);

        var folderCount = 0;
        var requestCount = 0;

        void Add(IReadOnlyList<ParsedItem> items, Guid? parentId)
        {
            var order = 0;
            foreach (var item in items)
            {
                switch (item)
                {
                    case ParsedFolder f:
                        var folder = Folder.Create(collection.Id, parentId, f.Name, order++, now);
                        folder.SetAuth(f.Auth);
                        folder.SetScripts(f.Scripts);
                        folder.Describe(f.Description);
                        db.Folders.Add(folder);
                        folderCount++;
                        Add(f.Children, folder.Id);
                        break;
                    case ParsedRequest r:
                        var request = ApiRequest.Create(collection.Id, parentId, r.Name, r.Definition, order++, userId, now);
                        request.LinkSource(r.SourceKey);
                        db.Requests.Add(request);
                        requestCount++;
                        for (var i = 0; i < r.Examples.Count; i++)
                        {
                            var e = r.Examples[i];
                            db.Examples.Add(ResponseExample.Create(request.Id, e.Name, e.Status, e.Headers, e.Body, e.Request, i, now));
                        }

                        break;
                }
            }
        }

        Add(parsed.Items, null);
        beforeSave?.Invoke(collection.Id);
        await db.SaveChangesAsync(ct);

        return new ImportResult("collection", collection.Id, collection.Name, folderCount, requestCount, variables.Count, exampleCount, warnings);
    }
}
