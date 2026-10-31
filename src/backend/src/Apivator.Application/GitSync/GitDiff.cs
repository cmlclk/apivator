using Apivator.Application.Common.Localization;
using Apivator.Application.Forks;
using Apivator.Domain.Collections;
using Apivator.Domain.Forks;

namespace Apivator.Application.GitSync;

/// <summary>Bir öğenin üç yönlü karşılaştırma sonucu: taban son eşitlemedeki ortak hâl.</summary>
internal sealed record GitChange(
    string Key,
    ForkItemKind Kind,
    string Name,
    string Path,
    ForkChangeType? Local,
    ForkChangeType? Remote,
    bool Conflict,
    GitItem? LocalItem,
    GitItem? RemoteItem)
{
    public GitChangeDto ToDto() => new(Key, Kind, Name, Path, Local, Remote, Conflict, LocalItem?.Content.Split((char)10, 2)[1], RemoteItem?.Content.Split((char)10, 2)[1], HostWarning());

    /// <summary>Alınan istekte sunucu değişiyorsa ve yerelde gizli değer taşıyan yetkilendirme varsa uyarı (yerel sır yeni sunucuya gider).</summary>
    private string? HostWarning()
    {
        var before = LocalItem?.Doc.Definition;
        var after = RemoteItem?.Doc.Definition;
        if (before is null || after is null || before.Auth.Type is AuthType.None || HostOfUrl(before.Url) == HostOfUrl(after.Url))
        {
            return null;
        }

        return L.T("git.host_warning",
            "Bu isteğin adresi {from} → {to} olarak değişiyor; yetkilendirme sırları yerelde saklanan gerçek değerlerle yeni sunucuya gönderilir.",
            ("from", HostOfUrl(before.Url)),
            ("to", HostOfUrl(after.Url)));
    }

    private static string HostOfUrl(string url)
    {
        var rest = url.Contains("://", StringComparison.Ordinal) ? url[(url.IndexOf("://", StringComparison.Ordinal) + 3)..] : url;
        var end = rest.IndexOfAny([(char)47, (char)63, (char)35]);
        return (end < 0 ? rest : rest[..end]).ToLowerInvariant();
    }
}

/// <summary>
/// Fork/merge ile aynı mantık (yerel = fork tarafı, uzak = kaynak tarafı): hâl tabandan farklıysa o taraf
/// değiştirmiştir; iki taraf da değiştirmiş ve birbirinden farklıysa çakışmadır. Taraflar aynı hâle gelmişse
/// (aynı değişiklik iki yerde yapılmış) değişiklik sayılmaz.
/// </summary>
internal static class GitDiff
{
    public static List<GitChange> Compare(
        IReadOnlyDictionary<string, GitItem> local,
        IReadOnlyDictionary<string, GitItem> remote,
        IReadOnlyDictionary<string, string> baseSnapshot)
    {
        var changes = new List<GitChange>();
        foreach (var key in local.Keys.Concat(remote.Keys).Concat(baseSnapshot.Keys).Distinct())
        {
            local.TryGetValue(key, out var l);
            remote.TryGetValue(key, out var r);
            baseSnapshot.TryGetValue(key, out var b);
            var localChange = ChangeOf(b, l);
            var remoteChange = key == GitItem.CollectionKey && r is null ? null : ChangeOf(b, r);
            if ((localChange is null && remoteChange is null) || l?.Content == r?.Content)
            {
                continue;
            }

            var shown = l ?? r!;
            changes.Add(new GitChange(
                key, shown.Kind, shown.Name, PathOf(shown, l is not null ? local : remote), localChange, remoteChange,
                localChange is not null && remoteChange is not null, l, r));
        }

        return [.. changes.OrderBy(c => c.Kind).ThenBy(c => c.Path, StringComparer.CurrentCulture).ThenBy(c => c.Name, StringComparer.CurrentCulture)];
    }

    /// <summary>Son eşitlemeden beri yerelde değişen öğe sayısı (ağ gerektirmez).</summary>
    public static int Ahead(IReadOnlyDictionary<string, GitItem> local, IReadOnlyDictionary<string, string> baseSnapshot) =>
        local.Keys.Concat(baseSnapshot.Keys).Distinct().Count(k => ChangeOf(baseSnapshot.GetValueOrDefault(k), local.GetValueOrDefault(k)) is not null);

    /// <summary>Eşitleme sonrası yeni taban: <paramref name="applied"/> öğeler uzaktaki hâliyle, diğerleri olduğu gibi.</summary>
    public static Dictionary<string, string> Rebase(
        IReadOnlyDictionary<string, string> baseSnapshot,
        IReadOnlyDictionary<string, GitItem> remote,
        IEnumerable<string> keys)
    {
        var result = new Dictionary<string, string>(baseSnapshot);
        foreach (var key in keys)
        {
            if (remote.TryGetValue(key, out var item))
            {
                result[key] = item.Content;
            }
            else
            {
                result.Remove(key);
            }
        }

        return result;
    }

    private static ForkChangeType? ChangeOf(string? @base, GitItem? current) =>
        current is null ? (@base is null ? null : ForkChangeType.Removed)
        : @base is null ? ForkChangeType.Added
        : current.Content == @base ? null : ForkChangeType.Modified;

    private static string PathOf(GitItem item, IReadOnlyDictionary<string, GitItem> side)
    {
        var names = new List<string>();
        var parent = item.ParentId;
        for (var guard = 0; parent is { } id && side.TryGetValue(id.ToString(), out var folder) && guard < 50; guard++)
        {
            names.Add(folder.Name);
            parent = folder.ParentId;
        }

        names.Reverse();
        return string.Join(" / ", names);
    }
}
