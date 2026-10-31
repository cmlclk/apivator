using System.Text.Json;
using System.Text.Json.Nodes;
using Apivator.Application.Common.Localization;
using Apivator.Application.Forks;
using Apivator.Domain.Collections;
using Apivator.Domain.Forks;
using Apivator.Domain.Variables;

namespace Apivator.Application.GitSync;

/// <summary>Depodaki bir dosyanın içeriği. Boş/varsayılan alanlar yazılmaz (okunurken varsayılana döner).</summary>
internal sealed record GitFileDoc
{
    public int? Version { get; init; }

    public Guid? Id { get; init; }

    public string? Name { get; init; }

    public int? Order { get; init; }

    public string? Description { get; init; }

    public RequestAuth? Auth { get; init; }

    public IReadOnlyList<Variable>? Variables { get; init; }

    public ScriptSet? Scripts { get; init; }

    public RequestDefinition? Definition { get; init; }

    public IReadOnlyList<ExampleSnapshot>? Examples { get; init; }
}

/// <summary>
/// Eşitlenen öğe (collection ayarları, klasör ya da istek). <see cref="Content"/> karşılaştırmada kullanılan
/// kanonik metindir: ad (collection'da yok), üst klasör ve içerik; kimlik ve sıra dahil değildir.
/// </summary>
internal sealed record GitItem(string Key, ForkItemKind Kind, Guid Id, Guid? ParentId, int Order, GitFileDoc Doc, string Content)
{
    public const string CollectionKey = "collection";

    public string Name => Doc.Name ?? string.Empty;

    public static GitItem Create(ForkItemKind kind, Guid id, Guid? parentId, int order, GitFileDoc doc)
    {
        var key = kind == ForkItemKind.Collection ? CollectionKey : id.ToString();
        var comparable = doc with { Version = null, Id = null, Order = null, Name = kind == ForkItemKind.Collection ? null : doc.Name };
        var content = parentId?.ToString() + "\n" + GitJson.Write(comparable, indented: false);
        return new GitItem(key, kind, id, parentId, order, doc, content);
    }
}

/// <summary>Kanonik JSON: sabit alan sırası, girintili, varsayılan değerler yazılmaz.</summary>
internal static class GitJson
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly JsonSerializerOptions Indented = new(Options) { WriteIndented = true };

    private static readonly JsonObject DefaultDefinition = (JsonObject)JsonSerializer.SerializeToNode(RequestDefinition.Default, Options)!;
    private static readonly JsonObject DefaultAuth = (JsonObject)JsonSerializer.SerializeToNode(new RequestAuth(), Options)!;
    private static readonly JsonObject DefaultScripts = (JsonObject)JsonSerializer.SerializeToNode(ScriptSet.Empty, Options)!;

    public static string Write(GitFileDoc doc, bool indented = true)
    {
        var node = (JsonObject)JsonSerializer.SerializeToNode(doc, Options)!;
        Compact(node, "auth", DefaultAuth);
        Compact(node, "scripts", DefaultScripts);
        Compact(node, "definition", DefaultDefinition);
        if (node["examples"] is JsonArray examples)
        {
            foreach (var example in examples.OfType<JsonObject>())
            {
                // Konumsal kayıtta eksik alan null olur; bu yüzden istek boş da olsa yazılır.
                if (example["request"] is JsonObject request)
                {
                    Strip(request, DefaultDefinition);
                }
            }
        }

        var json = node.ToJsonString(indented ? Indented : Options);
        return indented ? json.Replace("\r\n", "\n", StringComparison.Ordinal) + "\n" : json;
    }

    public static GitFileDoc Read(string text) =>
        JsonSerializer.Deserialize<GitFileDoc>(text, Options) ?? throw new JsonException(L.T("git.empty_document", "Boş belge."));

    private static void Compact(JsonObject parent, string property, JsonObject defaults)
    {
        if (parent[property] is not JsonObject node)
        {
            return;
        }

        Strip(node, defaults);
        if (node.Count == 0)
        {
            parent.Remove(property);
        }
    }

    /// <summary>Varsayılanla aynı olan alanları (iç içe nesneler dahil) kaldırır; okurken varsayılana döner.</summary>
    private static void Strip(JsonObject node, JsonObject defaults)
    {
        foreach (var (key, value) in node.ToList())
        {
            if (!defaults.TryGetPropertyValue(key, out var fallback) || fallback is null)
            {
                continue;
            }

            if (value is JsonObject child && fallback is JsonObject childDefaults)
            {
                Strip(child, childDefaults);
                if (child.Count == 0)
                {
                    node.Remove(key);
                }
            }
            else if (JsonNode.DeepEquals(value, fallback))
            {
                node.Remove(key);
            }
        }
    }
}

/// <summary>Yerel veritabanı durumundan öğeler (gizli değerler yer tutucuya çevrilmiş).</summary>
internal static class GitLocalItems
{
    public static Dictionary<string, GitItem> From(ForkSide side)
    {
        var items = new Dictionary<string, GitItem>();
        var collection = side.Collection;
        Add(items, GitItem.Create(ForkItemKind.Collection, collection.Id, null, 0, new GitFileDoc
        {
            Version = 1,
            Id = collection.Id,
            Name = collection.Name,
            Description = Clean(collection.Description),
            Auth = GitSecrets.Strip(collection.Auth),
            Variables = collection.Variables.Count > 0 ? GitSecrets.Strip(collection.Variables) : null,
            Scripts = collection.Scripts,
        }));
        foreach (var folder in side.Folders.Values)
        {
            Add(items, GitItem.Create(ForkItemKind.Folder, folder.Id, folder.ParentFolderId, folder.SortOrder, new GitFileDoc
            {
                Id = folder.Id,
                Name = folder.Name,
                Order = folder.SortOrder,
                Description = Clean(folder.Description),
                Auth = GitSecrets.Strip(folder.Auth),
                Scripts = folder.Scripts,
            }));
        }

        foreach (var request in side.Requests.Values)
        {
            var snapshot = side.RequestSnapshot(request);
            Add(items, GitItem.Create(ForkItemKind.Request, request.Id, request.FolderId, request.SortOrder, new GitFileDoc
            {
                Id = request.Id,
                Name = request.Name,
                Order = request.SortOrder,
                Definition = GitSecrets.Strip(request.Definition),
                Examples = snapshot.Examples is { Count: > 0 } ? GitSecrets.Strip(snapshot.Examples) : null,
            }));
        }

        return items;
    }

    private static void Add(Dictionary<string, GitItem> items, GitItem item) => items[item.Key] = item;

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text;
}
