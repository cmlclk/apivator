using System.Text.Json;
using Apivator.Application.Abstractions;
using Apivator.Domain.Collections;
using Apivator.Domain.Forks;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Forks;

/// <summary>Fork karşılaştırmasında bir taraf (kaynak ya da fork): collection, klasörleri, istekleri ve örnekleri.</summary>
internal sealed class ForkSide
{
    private ForkSide(string name, Collection collection, List<Folder> folders, List<ApiRequest> requests, List<ResponseExample> examples)
    {
        Name = name;
        Collection = collection;
        Folders = folders.ToDictionary(f => f.Id);
        Requests = requests.ToDictionary(r => r.Id);
        Examples = examples.GroupBy(e => e.RequestId).ToDictionary(g => g.Key, g => g.ToList());
    }

    /// <summary>"source" ya da "fork": bağlanmamış öğelerin anahtar öneki.</summary>
    public string Name { get; }

    public Collection Collection { get; }

    public Dictionary<Guid, Folder> Folders { get; }

    public Dictionary<Guid, ApiRequest> Requests { get; }

    public Dictionary<Guid, List<ResponseExample>> Examples { get; }

    /// <summary>Bu taraftaki öğe kimliği → bağlantı kimliği (eşleşmiş öğeler için).</summary>
    public Dictionary<Guid, Guid> LinkOf { get; } = [];

    /// <summary>Takip edilen (değiştirilebilir) varlıklarla yükler.</summary>
    public static async Task<ForkSide> LoadAsync(IApplicationDbContext db, string name, Guid collectionId, CancellationToken ct)
    {
        var collection = await db.Collections.FirstAsync(c => c.Id == collectionId, ct);
        var folders = await db.Folders.Where(f => f.CollectionId == collectionId).ToListAsync(ct);
        var requests = await db.Requests.Where(r => r.CollectionId == collectionId).ToListAsync(ct);
        var requestIds = requests.Select(r => r.Id).ToList();
        var examples = await db.Examples.Where(e => requestIds.Contains(e.RequestId)).ToListAsync(ct);
        return new ForkSide(name, collection, folders, requests, examples);
    }

    public string Key(Guid itemId) => LinkOf.TryGetValue(itemId, out var link) ? ForkSnapshot.LinkKey(link) : $"{Name}:{itemId}";

    public string? ParentKey(Guid? folderId) => folderId is { } id && Folders.ContainsKey(id) ? Key(id) : null;

    public ForkSnapshot CollectionSnapshot() => new()
    {
        Description = Collection.Description ?? string.Empty,
        Auth = Collection.Auth,
        Variables = Collection.Variables,
        Scripts = Collection.Scripts,
    };

    public ForkSnapshot FolderSnapshot(Folder f) => new()
    {
        Name = f.Name,
        Parent = ParentKey(f.ParentFolderId),
        Auth = f.Auth,
        Scripts = f.Scripts,
        Description = f.Description,
    };

    public ForkSnapshot RequestSnapshot(ApiRequest r) => new()
    {
        Name = r.Name,
        Parent = ParentKey(r.FolderId),
        Definition = r.Definition,
        Examples = Examples.GetValueOrDefault(r.Id, [])
            .OrderBy(e => e.SortOrder).ThenBy(e => e.CreatedAt)
            .Select(e => new ExampleSnapshot(e.Name, e.Status, e.Headers, e.Body, e.Request))
            .ToList(),
    };

    public ForkSnapshot? Snapshot(ForkItemKind kind, Guid id) => kind switch
    {
        ForkItemKind.Collection => CollectionSnapshot(),
        ForkItemKind.Folder => Folders.TryGetValue(id, out var f) ? FolderSnapshot(f) : null,
        _ => Requests.TryGetValue(id, out var r) ? RequestSnapshot(r) : null,
    };

    public string? ItemName(ForkItemKind kind, Guid id) => kind switch
    {
        ForkItemKind.Collection => Collection.Name,
        ForkItemKind.Folder => Folders.TryGetValue(id, out var f) ? f.Name : null,
        _ => Requests.TryGetValue(id, out var r) ? r.Name : null,
    };

    /// <summary>Öğenin bulunduğu klasör yolu ("Kullanıcılar / Yönetim"); kökte boş.</summary>
    public string Path(Guid? folderId)
    {
        var names = new List<string>();
        var guard = 0;
        while (folderId is { } id && Folders.TryGetValue(id, out var folder) && guard++ < 50)
        {
            names.Add(folder.Name);
            folderId = folder.ParentFolderId;
        }

        names.Reverse();
        return string.Join(" / ", names);
    }

    public Guid? ParentOf(ForkItemKind kind, Guid id) => kind switch
    {
        ForkItemKind.Folder => Folders.TryGetValue(id, out var f) ? f.ParentFolderId : null,
        ForkItemKind.Request => Requests.TryGetValue(id, out var r) ? r.FolderId : null,
        _ => null,
    };

    /// <summary>Klasörün kökten derinliği (eklemeler üstten alta yapılsın diye).</summary>
    public int Depth(Guid folderId)
    {
        var depth = 0;
        var current = Folders.GetValueOrDefault(folderId)?.ParentFolderId;
        while (current is { } id && Folders.TryGetValue(id, out var parent) && depth < 50)
        {
            depth++;
            current = parent.ParentFolderId;
        }

        return depth;
    }
}

internal static class ForkSnapshots
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>İki anlık görüntü aynı mı (null'lar dahil).</summary>
    public static bool Same(ForkSnapshot? a, ForkSnapshot? b) =>
        a is null || b is null ? a is null && b is null : JsonSerializer.Serialize(a, Json) == JsonSerializer.Serialize(b, Json);
}
