using System.Text.Json;
using System.Text.Json.Nodes;
using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Comments;
using Apivator.Domain.Variables;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Import;

public interface ICollectionSourceService
{
    Task<Result<CollectionSourceDto>> GetAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    /// <summary>Otomatik kontrol aralığı (saat: 1, 6, 24) ya da null (kapalı).</summary>
    Task<Result<CollectionSourceDto>> ScheduleAsync(Guid collectionId, SourceScheduleRequest request, Guid userId, CancellationToken ct = default);

    /// <summary>Kaynak bağlantısını kaldırır; istekler olduğu gibi kalır.</summary>
    Task<Result> DisconnectAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    /// <summary>Belgeyi yeniden çeker ve son uygulanan belgeyle farkını (eklenen/değişen/kaldırılan uçlar) döner.</summary>
    Task<Result<SourceDiffDto>> PreviewAsync(Guid collectionId, SourcePreviewRequest request, Guid userId, CancellationToken ct = default);

    /// <summary>Önizlenen belgeden seçilen değişiklikleri uygular.</summary>
    Task<Result<SourceApplyResult>> ApplyAsync(Guid collectionId, SourceApplyRequest request, Guid userId, CancellationToken ct = default);
}

/// <summary>Zamanlayıcının çağırdığı otomatik kontrol.</summary>
public interface ISourceChecker
{
    /// <summary>Belgeyi çeker; son uygulanandan farklıysa işaretler ve kontrolü açan kişiye bildirim gönderir.</summary>
    Task CheckAsync(Guid sourceId, CancellationToken ct = default);
}

/// <summary>
/// Kaynaktan güncelleme. Fark, son uygulanan belge ile yeni belge arasında hesaplanır (kullanıcının yerel
/// düzenlemeleri "değişiklik" sayılmaz). Uygularken yalnızca belgede değişen bölümlere dokunulur: eklenen/kaldırılan
/// header ve query parametreleri tek tek işlenir, kullanıcının eklediği header'lar, script'ler ve örnekler korunur;
/// yerelde değiştirilmiş ad ve açıklama korunur; yerelde değiştirilmiş gövde ya da yetkilendirme üzerine yazılır
/// (önizlemede uyarılır).
/// </summary>
internal sealed class CollectionSourceService(
    IApplicationDbContext db,
    IWorkspaceAccess access,
    IApiSpecFetcher fetcher,
    IUserDirectory users,
    TimeProvider clock) : ICollectionSourceService, ISourceChecker
{
    private static Error NotFound => Error.NotFound("source.not_found", L.T("source.not_found", "Bu collection bir kaynak adresine bağlı değil."));
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<Result<CollectionSourceDto>> GetAsync(Guid collectionId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireCollectionAsync(collectionId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var source = await db.CollectionSources.AsNoTracking().FirstOrDefaultAsync(s => s.CollectionId == collectionId, ct);
        return source is null ? NotFound : ToDto(source);
    }

    public async Task<Result<CollectionSourceDto>> ScheduleAsync(Guid collectionId, SourceScheduleRequest request, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireCollectionAsync(collectionId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        if (request.CheckIntervalHours is { } hours && !CollectionSource.CheckIntervals.Contains(hours))
        {
            return Error.Validation("source.interval", L.T("source.interval", "Kontrol aralığı 1, 6 ya da 24 saat olabilir."));
        }

        var source = await db.CollectionSources.FirstOrDefaultAsync(s => s.CollectionId == collectionId, ct);
        if (source is null)
        {
            return NotFound;
        }

        source.Schedule(request.CheckIntervalHours, userId, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return ToDto(source);
    }

    public async Task<Result> DisconnectAsync(Guid collectionId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireCollectionAsync(collectionId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        var source = await db.CollectionSources.FirstOrDefaultAsync(s => s.CollectionId == collectionId, ct);
        if (source is null)
        {
            return NotFound;
        }

        db.CollectionSources.Remove(source);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<SourceDiffDto>> PreviewAsync(Guid collectionId, SourcePreviewRequest request, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireCollectionAsync(collectionId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        var source = await db.CollectionSources.FirstOrDefaultAsync(s => s.CollectionId == collectionId, ct);
        if (source is null)
        {
            return NotFound;
        }

        var url = request.Document is not null && !string.IsNullOrWhiteSpace(request.Url) ? request.Url : source.Url;
        var loaded = await ImportService.LoadSpecAsync(fetcher, url, request.Headers, request.Document, ct);
        if (!loaded.IsSuccess)
        {
            return source.Local && request.Document is null
                ? Error.Validation(loaded.Error!.Code, L.T("source.local_update_hint", "{message} Bu kaynak masaüstü uygulamasından alınmıştı; güncellemeyi orada yapın.", ("message", loaded.Error.Message)))
                : loaded.Error!;
        }

        if (loaded.Value.Choices is not null)
        {
            return Error.Validation("source.choices", L.T("source.choices", "Kaynak adresi artık bir belge değil, sürüm listesi döndürüyor. Bağlantıyı kaldırıp belgeyi yeniden içe aktarın."));
        }

        var document = loaded.Value.Document!;
        var hash = ApiSpec.Hash(document);
        source.SetPending(ApiSpec.Serialize(document), hash, request.Document is not null, loaded.Value.Url!);

        var diff = await DiffAsync(collectionId, source.Document, document, ct);
        await db.SaveChangesAsync(ct);

        return new SourceDiffDto(
            hash,
            source.Url,
            source.DocumentVersion,
            ApiSpec.DocumentVersion(document),
            [.. diff.Added.Select(a => a.Dto)],
            [.. diff.Changed.Select(c => c.Dto)],
            [.. diff.Removed.Select(r => r.Dto)],
            diff.NewVariables.Select(v => v.Key).ToList(),
            diff.Warnings);
    }

    public async Task<Result<SourceApplyResult>> ApplyAsync(Guid collectionId, SourceApplyRequest request, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireCollectionAsync(collectionId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        var collection = await db.Collections.FirstOrDefaultAsync(c => c.Id == collectionId, ct);
        var source = await db.CollectionSources.FirstOrDefaultAsync(s => s.CollectionId == collectionId, ct);
        if (collection is null || source is null)
        {
            return NotFound;
        }

        if (source.PendingDocument is null || source.PendingHash != request.Hash)
        {
            return Error.Conflict("source.stale", L.T("source.stale", "Önizleme güncel değil (belge yeniden çekilmiş). Değişiklikleri tekrar getirin."));
        }

        var document = ApiSpec.Deserialize(source.PendingDocument);
        var diff = await DiffAsync(collectionId, source.Document, document, ct);
        var selected = request.Keys.ToHashSet(StringComparer.Ordinal);
        var now = clock.GetUtcNow();

        // Yeni değişkenler (yol parametreleri, yetkilendirme) her zaman eklenir; mevcut değerlere dokunulmaz.
        var variables = 0;
        if (diff.NewVariables.Count > 0)
        {
            var (merged, invalid) = VariableRuleMessages.Clean(collection.Variables.Concat(diff.NewVariables));
            if (invalid is null)
            {
                variables = merged.Count - collection.Variables.Count;
                collection.SetVariables(merged, now);
            }
        }

        var updated = 0;
        foreach (var change in diff.Changed.Where(c => selected.Contains(c.Dto.Key)))
        {
            await ApplyChangeAsync(change, userId, now, ct);
            updated++;
        }

        var removed = 0;
        foreach (var gone in diff.Removed.Where(r => selected.Contains(r.Dto.Key)))
        {
            db.Requests.Remove(gone.Request);
            removed++;
        }

        var added = await AddAsync(collectionId, diff.Added.Where(a => selected.Contains(a.Dto.Key)).ToList(), userId, now, ct);

        // Seçilmeyen değişiklikler de "görüldü" sayılır: bir sonraki fark bu belgeye göre hesaplanır.
        source.Applied(ApiSpec.DocumentVersion(document), userId, now);
        await db.SaveChangesAsync(ct);
        return new SourceApplyResult(added, updated, removed, variables, ToDto(source));
    }

    public async Task CheckAsync(Guid sourceId, CancellationToken ct = default)
    {
        var source = await db.CollectionSources.FirstOrDefaultAsync(s => s.Id == sourceId, ct);
        if (source?.CheckIntervalHours is null)
        {
            return;
        }

        // Zamanlanmış kontrolde istek bağlamı yok: metinler kontrolü kuran kişinin dilinde üretilir.
        using var language = source.CheckOwnerId is { } checkOwner ? Lang.Use(await users.PreferredLanguageAsync(checkOwner, ct)) : null;
        var loaded = await ImportService.LoadSpecAsync(fetcher, source.Url, null, null, ct);
        var now = clock.GetUtcNow();
        if (!loaded.IsSuccess || loaded.Value.Choices is not null)
        {
            var message = loaded.IsSuccess ? L.T("source.check_choices", "Kaynak adresi bir belge yerine sürüm listesi döndürüyor.") : loaded.Error!.Message;
            source.Checked(now, null, source.Local ? L.T("source.check_local", "{message} (Belge masaüstünden alınmıştı; sunucu bu adrese erişemiyor olabilir.)", ("message", message)) : message);
            await db.SaveChangesAsync(ct);
            return;
        }

        var document = loaded.Value.Document!;
        var hash = ApiSpec.Hash(document);
        source.Checked(now, hash, null);
        if (hash != source.DocumentHash && source.CheckOwnerId is { } owner && source.ShouldNotify(hash))
        {
            var collection = await db.Collections.AsNoTracking().FirstAsync(c => c.Id == source.CollectionId, ct);
            var diff = await DiffAsync(source.CollectionId, source.Document, document, ct);
            var parts = new List<string>();
            if (diff.Added.Count > 0)
            {
                parts.Add(L.T("source.part_added", "{count} yeni", ("count", diff.Added.Count)));
            }

            if (diff.Changed.Count > 0)
            {
                parts.Add(L.T("source.part_changed", "{count} değişen", ("count", diff.Changed.Count)));
            }

            if (diff.Removed.Count > 0)
            {
                parts.Add(L.T("source.part_removed", "{count} kaldırılan", ("count", diff.Removed.Count)));
            }

            var summary = parts.Count > 0
                ? L.T("source.summary_parts", "{parts} uç", ("parts", string.Join(", ", parts)))
                : L.T("source.summary_no_diff", "Belge değişti (uçlarda fark yok)");
            db.Notifications.Add(Notification.ForSourceChange(
                owner,
                collection.WorkspaceId,
                collection.Id,
                collection.Name,
                L.T("source.change_notification", "{summary}. Kaynaktan güncelleyerek uygulayabilirsiniz.", ("summary", summary)),
                now));
        }

        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------------------------------- fark

    private sealed record Operation(ParsedRequest Request, string? Folder);

    private sealed record Added(SourceChangeDto Dto, Operation Operation);

    private sealed record Changed(SourceChangeDto Dto, ApiRequest Request, Operation Old, Operation New, HashSet<string> Fields);

    private sealed record Removed(SourceChangeDto Dto, ApiRequest Request);

    private sealed record Diff(List<Added> Added, List<Changed> Changed, List<Removed> Removed, List<Variable> NewVariables, List<string> Warnings);

    private static string FieldAddress => L.T("source.field_address", "Adres");
    private static string FieldQuery => L.T("source.field_query", "Query parametreleri");
    private static string FieldHeaders => L.T("source.field_headers", "Header'lar");
    private static string FieldBody => L.T("source.field_body", "Gövde");
    private static string FieldAuth => L.T("source.field_auth", "Yetkilendirme");
    private static string FieldDescription => L.T("source.field_description", "Açıklama");
    private static string FieldName => L.T("source.field_name", "Ad");
    private static string FieldExamples => L.T("source.field_examples", "Örnek yanıtlar");

    private async Task<Diff> DiffAsync(Guid collectionId, string oldJson, JsonObject newDocument, CancellationToken ct)
    {
        var oldParser = new OpenApiParser(JsonSerializer.SerializeToElement(ApiSpec.Deserialize(oldJson)));
        var oldParsed = oldParser.Parse();
        var newParser = new OpenApiParser(JsonSerializer.SerializeToElement(newDocument));
        var newParsed = newParser.Parse();
        var oldOps = Operations(oldParsed);
        var newOps = Operations(newParsed);

        var requests = await db.Requests
            .Where(r => r.CollectionId == collectionId && r.SourceKey != null)
            .ToListAsync(ct);
        var current = requests.GroupBy(r => r.SourceKey!, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First(), StringComparer.Ordinal);
        var folders = await db.Folders.AsNoTracking().Where(f => f.CollectionId == collectionId).ToDictionaryAsync(f => f.Id, f => f.Name, ct);
        string? FolderOf(ApiRequest r) => r.FolderId is { } id && folders.TryGetValue(id, out var name) ? name : null;

        var added = new List<Added>();
        var changed = new List<Changed>();
        foreach (var (key, operation) in newOps)
        {
            if (!oldOps.TryGetValue(key, out var previous))
            {
                if (!current.ContainsKey(key))
                {
                    added.Add(new Added(Dto(key, operation.Request, operation.Folder, null, [], []), operation));
                }

                continue;
            }

            if (!current.TryGetValue(key, out var request))
            {
                continue; // kullanıcı silmiş
            }

            var fields = Compare(previous.Request, operation.Request);
            var notes = new List<string>();
            if (fields.Contains(FieldName) && request.Name != previous.Request.Name)
            {
                fields.Remove(FieldName);
                notes.Add(L.T("source.note_name", "Ad yerelde değiştirildiği için korunur."));
            }

            if (fields.Contains(FieldDescription) && request.Definition.Description != previous.Request.Definition.Description)
            {
                fields.Remove(FieldDescription);
                notes.Add(L.T("source.note_description", "Açıklama yerelde değiştirildiği için korunur."));
            }

            if (fields.Contains(FieldBody) && Same(request.Definition.Body, previous.Request.Definition.Body) is false)
            {
                notes.Add(L.T("source.note_body", "Gövde yerelde değiştirilmiş; uygulanırsa belgedeki örnekle değişir."));
            }

            if (fields.Contains(FieldAuth) && Same(request.Definition.Auth, previous.Request.Definition.Auth) is false)
            {
                notes.Add(L.T("source.note_auth", "Yetkilendirme yerelde değiştirilmiş; uygulanırsa belgedekiyle değişir."));
            }

            if (fields.Count == 0)
            {
                continue;
            }

            var order = new[] { FieldAddress, FieldName, FieldQuery, FieldHeaders, FieldBody, FieldAuth, FieldDescription, FieldExamples };
            changed.Add(new Changed(
                Dto(key, operation.Request, FolderOf(request), request.Id, [.. order.Where(fields.Contains)], notes),
                request,
                previous,
                operation,
                fields));
        }

        var removed = new List<Removed>();
        foreach (var (key, operation) in oldOps)
        {
            if (!newOps.ContainsKey(key) && current.TryGetValue(key, out var request))
            {
                removed.Add(new Removed(Dto(key, operation.Request, FolderOf(request), request.Id, [], []) with { Name = request.Name }, request));
            }
        }

        var collection = await db.Collections.AsNoTracking().FirstAsync(c => c.Id == collectionId, ct);
        var newVariables = newParsed.Variables
            .Where(v => collection.Variables.All(c => c.Key != v.Key))
            .ToList();

        var warnings = newParser.Warnings.Where(w => !oldParser.Warnings.Contains(w)).ToList();
        return new Diff(added, changed, removed, newVariables, warnings);
    }

    private static SourceChangeDto Dto(string key, ParsedRequest request, string? folder, Guid? requestId, IReadOnlyList<string> fields, IReadOnlyList<string> notes)
    {
        var space = key.IndexOf(' ', StringComparison.Ordinal);
        return new SourceChangeDto(key, key[..space], key[(space + 1)..], request.Name, folder, requestId, fields, notes);
    }

    /// <summary>Belgedeki işlemler: kimlik → istek ve (etiketten gelen) klasör adı.</summary>
    private static Dictionary<string, Operation> Operations(ParsedCollection parsed)
    {
        var result = new Dictionary<string, Operation>(StringComparer.Ordinal);
        void Walk(IEnumerable<ParsedItem> items, string? folder)
        {
            foreach (var item in items)
            {
                switch (item)
                {
                    case ParsedFolder f:
                        Walk(f.Children, folder ?? f.Name);
                        break;
                    case ParsedRequest { SourceKey: { } key } r:
                        result.TryAdd(key, new Operation(r, folder));
                        break;
                }
            }
        }

        Walk(parsed.Items, null);
        return result;
    }

    private static HashSet<string> Compare(ParsedRequest a, ParsedRequest b)
    {
        var fields = new HashSet<string>(StringComparer.Ordinal);
        var x = a.Definition;
        var y = b.Definition;
        if (x.Method != y.Method || PathOf(x.Url) != PathOf(y.Url))
        {
            fields.Add(FieldAddress);
        }

        if (!QueryOf(x.Url).SequenceEqual(QueryOf(y.Url)))
        {
            fields.Add(FieldQuery);
        }

        if (Same(x.Headers, y.Headers) is false)
        {
            fields.Add(FieldHeaders);
        }

        if (Same(x.Body, y.Body) is false)
        {
            fields.Add(FieldBody);
        }

        if (Same(x.Auth, y.Auth) is false)
        {
            fields.Add(FieldAuth);
        }

        if (x.Description != y.Description)
        {
            fields.Add(FieldDescription);
        }

        if (a.Name != b.Name)
        {
            fields.Add(FieldName);
        }

        if (Same(a.Examples.Select(e => new { e.Name, e.Status, e.Body }), b.Examples.Select(e => new { e.Name, e.Status, e.Body })) is false)
        {
            fields.Add(FieldExamples);
        }

        return fields;
    }

    private static bool Same<T>(T a, T b) => JsonSerializer.Serialize(a, Json) == JsonSerializer.Serialize(b, Json);

    // ------------------------------------------------------------------------------------------- uygulama

    private async Task ApplyChangeAsync(Changed change, Guid userId, DateTimeOffset now, CancellationToken ct)
    {
        var request = change.Request;
        var current = request.Definition;
        var before = change.Old.Request.Definition;
        var after = change.New.Request.Definition;
        var fields = change.Fields;

        var path = PathOf(current.Url);
        var method = current.Method;
        if (fields.Contains(FieldAddress))
        {
            path = PathOf(after.Url);
            method = after.Method;
        }

        var query = QueryOf(current.Url);
        if (fields.Contains(FieldQuery))
        {
            query = MergePairs(
                query,
                QueryOf(before.Url),
                QueryOf(after.Url),
                StringComparer.Ordinal);
        }

        var headers = current.Headers;
        if (fields.Contains(FieldHeaders))
        {
            headers = MergePairs(
                current.Headers.Select(h => (h.Key, h.Value)).ToList(),
                before.Headers.Select(h => (h.Key, h.Value)).ToList(),
                after.Headers.Select(h => (h.Key, h.Value)).ToList(),
                StringComparer.OrdinalIgnoreCase)
                .Select(pair =>
                    current.Headers.FirstOrDefault(h => string.Equals(h.Key, pair.Key, StringComparison.OrdinalIgnoreCase)) is { } existing
                        ? existing with { Value = pair.Value }
                        : after.Headers.First(h => string.Equals(h.Key, pair.Key, StringComparison.OrdinalIgnoreCase)))
                .ToList();
        }

        var url = fields.Contains(FieldAddress) || fields.Contains(FieldQuery)
            ? query.Count > 0 ? $"{path}?{string.Join('&', query.Select(p => $"{p.Key}={p.Value}"))}" : path
            : current.Url;
        var definition = current with
        {
            Method = method,
            Url = url,
            Headers = headers,
            Body = fields.Contains(FieldBody) ? after.Body : current.Body,
            Auth = fields.Contains(FieldAuth) ? after.Auth : current.Auth,
            Description = fields.Contains(FieldDescription) ? after.Description : current.Description,
        };
        var name = fields.Contains(FieldName) ? change.New.Request.Name : request.Name;
        request.Update(name, definition, userId, now);

        if (fields.Contains(FieldExamples))
        {
            var existing = await db.Examples.Where(e => e.RequestId == request.Id).Select(e => new { e.Name, e.Status, e.SortOrder }).ToListAsync(ct);
            var order = existing.Count == 0 ? 0 : existing.Max(e => e.SortOrder) + 1;
            foreach (var example in change.New.Request.Examples)
            {
                if (!existing.Any(e => e.Name == example.Name && e.Status == example.Status))
                {
                    db.Examples.Add(ResponseExample.Create(request.Id, example.Name, example.Status, example.Headers, example.Body, definition, order++, now));
                }
            }
        }
    }

    private async Task<int> AddAsync(Guid collectionId, List<Added> items, Guid userId, DateTimeOffset now, CancellationToken ct)
    {
        if (items.Count == 0)
        {
            return 0;
        }

        var folders = await db.Folders.Where(f => f.CollectionId == collectionId && f.ParentFolderId == null).ToListAsync(ct);
        var folderOrder = folders.Count == 0 ? 0 : folders.Max(f => f.SortOrder) + 1;
        var counts = await db.Requests.Where(r => r.CollectionId == collectionId)
            .GroupBy(r => r.FolderId)
            .Select(g => new { FolderId = g.Key, Max = g.Max(r => r.SortOrder) })
            .ToListAsync(ct);
        var next = counts.ToDictionary(c => c.FolderId ?? Guid.Empty, c => c.Max + 1);

        foreach (var item in items)
        {
            Guid? folderId = null;
            if (item.Operation.Folder is { } folderName)
            {
                var folder = folders.FirstOrDefault(f => f.Name == folderName);
                if (folder is null)
                {
                    folder = Folder.Create(collectionId, null, folderName, folderOrder++, now);
                    db.Folders.Add(folder);
                    folders.Add(folder);
                }

                folderId = folder.Id;
            }

            var slot = folderId ?? Guid.Empty;
            var order = next.GetValueOrDefault(slot);
            next[slot] = order + 1;

            var parsed = item.Operation.Request;
            var request = ApiRequest.Create(collectionId, folderId, parsed.Name, parsed.Definition, order, userId, now);
            request.LinkSource(parsed.SourceKey);
            db.Requests.Add(request);
            for (var i = 0; i < parsed.Examples.Count; i++)
            {
                var e = parsed.Examples[i];
                db.Examples.Add(ResponseExample.Create(request.Id, e.Name, e.Status, e.Headers, e.Body, e.Request, i, now));
            }
        }

        return items.Count;
    }

    /// <summary>
    /// Belgedeki değişikliği (önce → sonra) mevcut listeye uygular: belgede eklenen anahtar eklenir, kaldırılan
    /// çıkarılır; değeri değişen anahtar yalnızca kullanıcı değerini değiştirmediyse güncellenir.
    /// </summary>
    private static List<(string Key, string Value)> MergePairs(
        List<(string Key, string Value)> current,
        List<(string Key, string Value)> before,
        List<(string Key, string Value)> after,
        StringComparer comparer)
    {
        string? Find(List<(string Key, string Value)> list, string key) =>
            list.Where(p => comparer.Equals(p.Key, key)).Select(p => p.Value).FirstOrDefault();

        var result = new List<(string Key, string Value)>();
        foreach (var pair in current)
        {
            var wasInSpec = Find(before, pair.Key);
            var nowInSpec = Find(after, pair.Key);
            if (wasInSpec is not null && nowInSpec is null)
            {
                continue; // belgeden kaldırıldı
            }

            result.Add(wasInSpec is not null && nowInSpec is not null && pair.Value == wasInSpec ? (pair.Key, nowInSpec) : pair);
        }

        foreach (var pair in after)
        {
            if (Find(before, pair.Key) is null && Find(result, pair.Key) is null)
            {
                result.Add(pair);
            }
        }

        return result;
    }

    private static string PathOf(string url)
    {
        var index = url.IndexOf('?', StringComparison.Ordinal);
        return index < 0 ? url : url[..index];
    }

    private static List<(string Key, string Value)> QueryOf(string url)
    {
        var index = url.IndexOf('?', StringComparison.Ordinal);
        if (index < 0)
        {
            return [];
        }

        return url[(index + 1)..]
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part =>
            {
                var eq = part.IndexOf('=', StringComparison.Ordinal);
                return eq < 0 ? (part, string.Empty) : (part[..eq], part[(eq + 1)..]);
            })
            .ToList();
    }

    internal static CollectionSourceDto ToDto(CollectionSource source) => new(
        source.Url,
        source.Local,
        source.DocumentVersion,
        source.ImportedAt,
        source.UpdatedAt,
        source.CheckIntervalHours,
        source.LastCheckedAt,
        source.LastCheckError,
        source.ChangeDetectedAt);
}
