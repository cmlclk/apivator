using System.Text.Json;
using Apivator.Application.Abstractions;
using Apivator.Application.Forks;
using Apivator.Domain.Collections;
using Apivator.Domain.Forks;

namespace Apivator.Application.GitSync;

/// <summary>
/// Depodan alınan değişiklikleri yerel collection'a uygular (kaydetmez). Eşleşen öğeler kimliğini korur;
/// yer tutucu olarak gelen gizli değerlerin yerine yereldeki gerçek değer korunur.
/// </summary>
internal sealed class GitApplier(
    IApplicationDbContext db,
    ForkSide local,
    IReadOnlyDictionary<string, GitItem> remote,
    Guid userId,
    DateTimeOffset now)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public void Apply(IReadOnlyList<GitChange> changes)
    {
        foreach (var change in changes.Where(c => c.Kind == ForkItemKind.Collection && c.RemoteItem is not null))
        {
            UpdateCollection(change.RemoteItem!.Doc);
        }

        foreach (var change in changes.Where(c => c.Kind == ForkItemKind.Folder && c.RemoteItem is not null).OrderBy(c => Depth(c.RemoteItem!)))
        {
            UpsertFolder(change.RemoteItem!);
        }

        foreach (var change in changes.Where(c => c.Kind == ForkItemKind.Request))
        {
            if (change.RemoteItem is { } item)
            {
                UpsertRequest(item);
            }
            else if (local.Requests.Remove(Guid.Parse(change.Key), out var request))
            {
                local.Examples.Remove(request.Id);
                db.Requests.Remove(request);
            }
        }

        RemoveFolders(changes.Where(c => c.Kind == ForkItemKind.Folder && c.RemoteItem is null).Select(c => Guid.Parse(c.Key)));
    }

    private void UpdateCollection(GitFileDoc doc)
    {
        var collection = local.Collection;
        collection.Describe(doc.Description, now);
        collection.SetAuth(GitSecrets.Restore(doc.Auth ?? RequestAuth.Inherit, collection.Auth), now);
        collection.SetVariables(GitSecrets.Restore(doc.Variables ?? [], collection.Variables), now);
        collection.SetScripts(doc.Scripts ?? ScriptSet.Empty, now);
    }

    private void UpsertFolder(GitItem item)
    {
        var doc = item.Doc;
        var parent = ExistingFolder(item.ParentId);
        if (local.Folders.TryGetValue(item.Id, out var folder))
        {
            folder.Rename(item.Name);
            folder.SetAuth(GitSecrets.Restore(doc.Auth ?? RequestAuth.Inherit, folder.Auth));
            folder.SetScripts(doc.Scripts ?? ScriptSet.Empty);
            folder.Describe(doc.Description);
            if (folder.ParentFolderId != parent && parent != folder.Id && !IsDescendant(parent, folder.Id))
            {
                folder.MoveTo(local.Collection.Id, parent, item.Order);
            }

            return;
        }

        var created = Folder.Create(local.Collection.Id, parent, item.Name, item.Order, now);
        created.AssignId(item.Id);
        created.SetAuth(doc.Auth ?? RequestAuth.Inherit);
        created.SetScripts(doc.Scripts ?? ScriptSet.Empty);
        created.Describe(doc.Description);
        db.Folders.Add(created);
        local.Folders[created.Id] = created;
    }

    private void UpsertRequest(GitItem item)
    {
        var doc = item.Doc;
        var parent = ExistingFolder(item.ParentId);
        var incoming = doc.Definition ?? RequestDefinition.Default;
        var examples = doc.Examples ?? [];
        if (!local.Requests.TryGetValue(item.Id, out var request))
        {
            var created = ApiRequest.Create(local.Collection.Id, parent, item.Name, incoming, item.Order, userId, now);
            created.Restore(item.Id);
            db.Requests.Add(created);
            local.Requests[created.Id] = created;
            local.Examples[created.Id] = AddExamples(created.Id, examples);
            return;
        }

        var definition = GitSecrets.Restore(incoming, request.Definition);
        if (request.Name != item.Name || !SameJson(request.Definition, definition))
        {
            request.Update(item.Name, definition, userId, now);
        }

        if (request.FolderId != parent)
        {
            request.MoveTo(local.Collection.Id, parent, item.Order);
        }

        var current = local.RequestSnapshot(request).Examples ?? [];
        if (!SameJson(GitSecrets.Strip(current), examples))
        {
            foreach (var example in local.Examples.GetValueOrDefault(request.Id, []))
            {
                db.Examples.Remove(example);
            }

            local.Examples[request.Id] = AddExamples(request.Id, examples);
        }
    }

    private List<ResponseExample> AddExamples(Guid requestId, IReadOnlyList<ExampleSnapshot> examples)
    {
        var list = examples
            .Select((e, i) => ResponseExample.Create(requestId, e.Name, e.Status, e.Headers, e.Body, e.Request, i, now))
            .ToList();
        foreach (var example in list)
        {
            db.Examples.Add(example);
        }

        return list;
    }

    /// <summary>Silinen klasörler en derinden başlayarak; içlerinde kalan öğeler bir üst klasöre taşınır.</summary>
    private void RemoveFolders(IEnumerable<Guid> ids)
    {
        foreach (var id in ids.Where(local.Folders.ContainsKey).OrderByDescending(local.Depth))
        {
            var folder = local.Folders[id];
            foreach (var child in local.Folders.Values.Where(f => f.ParentFolderId == id))
            {
                child.MoveTo(local.Collection.Id, folder.ParentFolderId, child.SortOrder);
            }

            foreach (var request in local.Requests.Values.Where(r => r.FolderId == id))
            {
                request.MoveTo(local.Collection.Id, folder.ParentFolderId, request.SortOrder);
            }

            local.Folders.Remove(id);
            db.Folders.Remove(folder);
        }
    }

    /// <summary>Üst klasör yerelde yoksa (örn. alınması atlanmış) öğe kökte kalır.</summary>
    private Guid? ExistingFolder(Guid? id) => id is { } value && local.Folders.ContainsKey(value) ? value : null;

    private bool IsDescendant(Guid? candidate, Guid ancestor)
    {
        for (var guard = 0; candidate is { } id && guard < 100; guard++)
        {
            if (id == ancestor)
            {
                return true;
            }

            candidate = local.Folders.GetValueOrDefault(id)?.ParentFolderId;
        }

        return false;
    }

    private int Depth(GitItem item)
    {
        var depth = 0;
        for (var parent = item.ParentId; parent is { } id && remote.TryGetValue(id.ToString(), out var folder) && depth < 100; depth++)
        {
            parent = folder.ParentId;
        }

        return depth;
    }

    private static bool SameJson<T>(T a, T b) => JsonSerializer.Serialize(a, Json) == JsonSerializer.Serialize(b, Json);
}
