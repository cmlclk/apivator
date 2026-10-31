using Apivator.Application.Abstractions;
using Apivator.Domain.Collections;
using Apivator.Domain.Forks;

namespace Apivator.Application.Forks;

/// <summary>Bir öğenin karşılaştırma sonucu (iç kullanım: varlık kimlikleri ve bağlantıyla).</summary>
internal sealed record ForkItemChange(
    string Key,
    ForkItemKind Kind,
    ForkLink? Link,
    Guid? SourceId,
    Guid? ForkId,
    ForkSnapshot? Base,
    ForkSnapshot? Fork,
    ForkSnapshot? Source,
    ForkChangeType? ForkChange,
    ForkChangeType? SourceChange,
    bool Conflict,
    string Name,
    string Path)
{
    public ForkChangeDto ToDto() => new(Key, Kind, Name, Path, ForkChange, SourceChange, Conflict, Base, Fork, Source);
}

/// <summary>
/// Üç yönlü karşılaştırma ve uygulama. Her bağlantının tabanı son eşitlemedeki ortak hâldir: fork'taki hâl
/// tabandan farklıysa fork değiştirmiş, kaynaktaki farklıysa kaynak değiştirmiştir; ikisi de farklı ve
/// birbirinden de farklıysa çakışmadır.
/// </summary>
internal sealed class ForkEngine(IApplicationDbContext db)
{
    public const string SourceSide = "source";
    public const string ForkSide = "fork";

    public static List<ForkItemChange> Compare(ForkSide source, ForkSide fork, IReadOnlyList<ForkLink> links)
    {
        Index(source, fork, links);
        var changes = new List<ForkItemChange>();
        foreach (var link in links)
        {
            var sourceSnap = source.Snapshot(link.Kind, link.SourceItemId);
            var forkSnap = fork.Snapshot(link.Kind, link.ForkItemId);
            var forkChange = ChangeOf(link.Base, forkSnap);
            var sourceChange = ChangeOf(link.Base, sourceSnap);
            if (forkChange is null && sourceChange is null)
            {
                continue;
            }

            var conflict = forkChange is not null && sourceChange is not null && !ForkSnapshots.Same(forkSnap, sourceSnap);
            var (side, id) = forkSnap is not null ? (fork, link.ForkItemId) : sourceSnap is not null ? (source, link.SourceItemId) : (fork, link.ForkItemId);
            changes.Add(new ForkItemChange(
                ForkSnapshot.LinkKey(link.Id), link.Kind, link, link.SourceItemId, link.ForkItemId, link.Base, forkSnap, sourceSnap,
                forkChange, sourceChange, conflict,
                side.ItemName(link.Kind, id) ?? link.Base.Name, side.Path(side.ParentOf(link.Kind, id))));
        }

        changes.AddRange(Unlinked(fork, isFork: true));
        changes.AddRange(Unlinked(source, isFork: false));
        return [.. changes
            .OrderBy(c => c.Kind)
            .ThenBy(c => c.Path, StringComparer.CurrentCulture)
            .ThenBy(c => c.Name, StringComparer.CurrentCulture)];
    }

    /// <summary>
    /// <paramref name="from"/> tarafındaki değişiklikleri <paramref name="to"/> tarafına uygular. Çakışmada
    /// <paramref name="resolutions"/> kimin kazanacağını söyler ("source" ya da "fork"); çözülmemiş çakışma
    /// varsa hiçbir şey yapılmaz ve anahtarları döner. Başarıda uygulanan değişiklikler döner.
    /// </summary>
    public async Task<(IReadOnlyList<ForkItemChange> Applied, IReadOnlyList<string> Unresolved)> ApplyAsync(
        CollectionFork forkEntity,
        ForkSide from,
        ForkSide to,
        List<ForkLink> links,
        IReadOnlyDictionary<string, string>? resolutions,
        Guid userId,
        DateTimeOffset now,
        CancellationToken ct)
    {
        var source = from.Name == SourceSide ? from : to;
        var fork = from.Name == SourceSide ? to : from;
        var changes = Compare(source, fork, links);
        bool FromChanged(ForkItemChange c) => (from.Name == SourceSide ? c.SourceChange : c.ForkChange) is not null;

        var relevant = changes.Where(FromChanged).ToList();
        var unresolved = relevant
            .Where(c => c.Conflict && !(resolutions?.TryGetValue(c.Key, out var w) == true && w is SourceSide or ForkSide))
            .Select(c => c.Key)
            .ToList();
        if (unresolved.Count > 0)
        {
            return ([], unresolved);
        }

        // Çakışmada "to" tarafı kazandıysa uygulanmaz; yalnızca taban güncellenir.
        var toApply = relevant.Where(c => !c.Conflict || resolutions![c.Key] == from.Name).ToList();
        var applier = new Applier(db, forkEntity, from, to, links, userId, now);
        await applier.RunAsync(toApply, ct);

        // Taban = kaynaktaki son hâl. Fork'un korunan değişiklikleri böylece "fork'ta değişmiş" görünmeye devam eder.
        Index(source, fork, links);
        foreach (var change in relevant)
        {
            var link = change.Link is not null ? links.FirstOrDefault(l => l.Id == change.Link.Id) : applier.CreatedLinkFor(change.Key);
            if (link is null)
            {
                continue;
            }

            var sourceSnap = source.Snapshot(link.Kind, link.SourceItemId);
            var forkSnap = fork.Snapshot(link.Kind, link.ForkItemId);
            if (sourceSnap is null || forkSnap is null)
            {
                // Bir tarafta yok: bağ kalkar; diğer taraftaki öğe "yalnızca orada var" görünür.
                links.Remove(link);
                db.ForkLinks.Remove(link);
                continue;
            }

            link.Rebase(sourceSnap);
        }

        return (toApply, []);
    }

    private static void Index(ForkSide source, ForkSide fork, IReadOnlyList<ForkLink> links)
    {
        source.LinkOf.Clear();
        fork.LinkOf.Clear();
        foreach (var link in links)
        {
            source.LinkOf[link.SourceItemId] = link.Id;
            fork.LinkOf[link.ForkItemId] = link.Id;
        }
    }

    private static ForkChangeType? ChangeOf(ForkSnapshot @base, ForkSnapshot? current) =>
        current is null ? ForkChangeType.Removed : ForkSnapshots.Same(@base, current) ? null : ForkChangeType.Modified;

    private static IEnumerable<ForkItemChange> Unlinked(ForkSide side, bool isFork)
    {
        foreach (var folder in side.Folders.Values.Where(f => !side.LinkOf.ContainsKey(f.Id)))
        {
            var snap = side.FolderSnapshot(folder);
            yield return new ForkItemChange(
                side.Key(folder.Id), ForkItemKind.Folder, null, isFork ? null : folder.Id, isFork ? folder.Id : null, null,
                isFork ? snap : null, isFork ? null : snap, isFork ? ForkChangeType.Added : null, isFork ? null : ForkChangeType.Added,
                false, folder.Name, side.Path(folder.ParentFolderId));
        }

        foreach (var request in side.Requests.Values.Where(r => !side.LinkOf.ContainsKey(r.Id)))
        {
            var snap = side.RequestSnapshot(request);
            yield return new ForkItemChange(
                side.Key(request.Id), ForkItemKind.Request, null, isFork ? null : request.Id, isFork ? request.Id : null, null,
                isFork ? snap : null, isFork ? null : snap, isFork ? ForkChangeType.Added : null, isFork ? null : ForkChangeType.Added,
                false, request.Name, side.Path(request.FolderId));
        }
    }

    /// <summary>Değişiklikleri hedef tarafın varlıklarına uygular (kaydetmez).</summary>
    private sealed class Applier(
        IApplicationDbContext db,
        CollectionFork forkEntity,
        ForkSide from,
        ForkSide to,
        List<ForkLink> links,
        Guid userId,
        DateTimeOffset now)
    {
        private readonly Dictionary<Guid, Guid> _createdFolders = [];
        private readonly Dictionary<string, ForkLink> _createdLinks = [];

        public ForkLink? CreatedLinkFor(string key) => _createdLinks.GetValueOrDefault(key);

        public async Task RunAsync(IReadOnlyList<ForkItemChange> changes, CancellationToken ct)
        {
            foreach (var change in changes.Where(c => c.Kind == ForkItemKind.Collection))
            {
                var snap = FromSnap(change)!;
                to.Collection.Describe(string.IsNullOrEmpty(snap.Description) ? null : snap.Description, now);
                to.Collection.SetAuth(snap.Auth ?? RequestAuth.Inherit, now);
                to.Collection.SetVariables(snap.Variables ?? [], now);
                to.Collection.SetScripts(snap.Scripts ?? ScriptSet.Empty, now);
            }

            // Klasörler üstten alta: önce üst klasör oluşsun ki alttakiler ona bağlansın.
            var folderChanges = changes.Where(c => c.Kind == ForkItemKind.Folder && FromSnap(c) is not null)
                .OrderBy(c => FromId(c) is { } id ? from.Depth(id) : 0)
                .ToList();
            foreach (var change in folderChanges)
            {
                UpsertFolder(change);
            }

            foreach (var change in changes.Where(c => c.Kind == ForkItemKind.Request && FromSnap(c) is not null))
            {
                await UpsertRequestAsync(change, ct);
            }

            foreach (var change in changes.Where(c => c.Kind == ForkItemKind.Request && FromSnap(c) is null))
            {
                if (ToId(change) is { } id && to.Requests.Remove(id, out var request))
                {
                    to.Examples.Remove(id);
                    db.Requests.Remove(request);
                }
            }

            // Silinen klasörler en derinden başlayarak; içlerinde kalan (silinmeyen) öğeler bir üst klasöre taşınır.
            var removedFolders = changes.Where(c => c.Kind == ForkItemKind.Folder && FromSnap(c) is null)
                .Select(ToId).OfType<Guid>().Where(to.Folders.ContainsKey)
                .OrderByDescending(to.Depth)
                .ToList();
            foreach (var id in removedFolders)
            {
                var folder = to.Folders[id];
                foreach (var child in to.Folders.Values.Where(f => f.ParentFolderId == id))
                {
                    child.MoveTo(to.Collection.Id, folder.ParentFolderId, child.SortOrder);
                }

                foreach (var request in to.Requests.Values.Where(r => r.FolderId == id))
                {
                    request.MoveTo(to.Collection.Id, folder.ParentFolderId, request.SortOrder);
                }

                to.Folders.Remove(id);
                db.Folders.Remove(folder);
            }
        }

        private ForkSnapshot? FromSnap(ForkItemChange c) => from.Name == SourceSide ? c.Source : c.Fork;

        private Guid? FromId(ForkItemChange c) => from.Name == SourceSide ? c.SourceId : c.ForkId;

        /// <summary>Hedef taraftaki karşılık (bağlantıdan); yoksa null.</summary>
        private Guid? ToId(ForkItemChange c)
        {
            var id = to.Name == SourceSide ? c.SourceId : c.ForkId;
            return c.Link is null ? null : id;
        }

        private Guid? ResolveParent(string? key)
        {
            if (key is null)
            {
                return null;
            }

            if (key.StartsWith("link:", StringComparison.Ordinal) && Guid.TryParse(key[5..], out var linkId))
            {
                var link = links.FirstOrDefault(l => l.Id == linkId);
                var id = link is null ? (Guid?)null : to.Name == SourceSide ? link.SourceItemId : link.ForkItemId;
                return id is { } existing && to.Folders.ContainsKey(existing) ? existing : null;
            }

            var prefix = from.Name + ":";
            return key.StartsWith(prefix, StringComparison.Ordinal) && Guid.TryParse(key[prefix.Length..], out var fromId)
                && _createdFolders.TryGetValue(fromId, out var created)
                ? created
                : null;
        }

        private int NextSortOrder(Guid? parent) =>
            Math.Max(
                to.Folders.Values.Where(f => f.ParentFolderId == parent).Select(f => f.SortOrder).DefaultIfEmpty(-1).Max(),
                to.Requests.Values.Where(r => r.FolderId == parent).Select(r => r.SortOrder).DefaultIfEmpty(-1).Max()) + 1;

        private void UpsertFolder(ForkItemChange change)
        {
            var snap = FromSnap(change)!;
            var parent = ResolveParent(snap.Parent);
            if (ToId(change) is { } id && to.Folders.TryGetValue(id, out var folder))
            {
                folder.Rename(snap.Name);
                folder.SetAuth(snap.Auth ?? RequestAuth.Inherit);
                folder.SetScripts(snap.Scripts ?? ScriptSet.Empty);
                folder.Describe(snap.Description);
                if (folder.ParentFolderId != parent && parent != folder.Id)
                {
                    folder.MoveTo(to.Collection.Id, parent, NextSortOrder(parent));
                }

                return;
            }

            var created = Folder.Create(to.Collection.Id, parent, snap.Name, NextSortOrder(parent), now);
            created.SetAuth(snap.Auth ?? RequestAuth.Inherit);
            created.SetScripts(snap.Scripts ?? ScriptSet.Empty);
            created.Describe(snap.Description);
            db.Folders.Add(created);
            to.Folders[created.Id] = created;
            if (FromId(change) is { } fromId)
            {
                _createdFolders[fromId] = created.Id;
            }

            Link(change, ForkItemKind.Folder, created.Id);
        }

        private async Task UpsertRequestAsync(ForkItemChange change, CancellationToken ct)
        {
            var snap = FromSnap(change)!;
            var parent = ResolveParent(snap.Parent);
            var definition = snap.Definition ?? RequestDefinition.Default;
            if (ToId(change) is { } id && to.Requests.TryGetValue(id, out var request))
            {
                if (request.Name != snap.Name || !ForkSnapshots.Same(new ForkSnapshot { Definition = request.Definition }, new ForkSnapshot { Definition = definition }))
                {
                    request.Update(snap.Name, definition, userId, now);
                }

                if (request.FolderId != parent)
                {
                    request.MoveTo(to.Collection.Id, parent, NextSortOrder(parent));
                }

                var current = to.RequestSnapshot(request);
                if (!ForkSnapshots.Same(new ForkSnapshot { Examples = current.Examples }, new ForkSnapshot { Examples = snap.Examples }))
                {
                    foreach (var example in to.Examples.GetValueOrDefault(request.Id, []))
                    {
                        db.Examples.Remove(example);
                    }

                    to.Examples[request.Id] = AddExamples(request.Id, snap.Examples);
                }

                return;
            }

            var created = ApiRequest.Create(to.Collection.Id, parent, snap.Name, definition, NextSortOrder(parent), userId, now);
            db.Requests.Add(created);
            to.Requests[created.Id] = created;
            to.Examples[created.Id] = AddExamples(created.Id, snap.Examples);
            Link(change, ForkItemKind.Request, created.Id);
            await Task.CompletedTask;
        }

        private List<ResponseExample> AddExamples(Guid requestId, IReadOnlyList<ExampleSnapshot>? examples)
        {
            var list = (examples ?? [])
                .Select((e, i) => ResponseExample.Create(requestId, e.Name, e.Status, e.Headers, e.Body, e.Request, i, now))
                .ToList();
            foreach (var example in list)
            {
                db.Examples.Add(example);
            }

            return list;
        }

        /// <summary>Yeni oluşturulan hedef öğeyi kaynağıyla bağlar (ya da hedefte silinmişse bağı yeniler).</summary>
        private void Link(ForkItemChange change, ForkItemKind kind, Guid toItemId)
        {
            var fromId = FromId(change)!.Value;
            var (sourceId, forkId) = to.Name == SourceSide ? (toItemId, fromId) : (fromId, toItemId);
            if (change.Link is { } existing)
            {
                existing.Relink(sourceId, forkId);
                return;
            }

            var link = ForkLink.Create(Guid.CreateVersion7(), forkEntity.Id, kind, sourceId, forkId, new ForkSnapshot());
            links.Add(link);
            db.ForkLinks.Add(link);
            _createdLinks[change.Key] = link;
        }
    }
}
