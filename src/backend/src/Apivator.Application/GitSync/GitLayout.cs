using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Apivator.Application.Common.Localization;
using Apivator.Domain.Collections;
using Apivator.Domain.Forks;

namespace Apivator.Application.GitSync;

/// <summary>
/// Depo düzeni: <c>collection.json</c>, her klasör için dizin + <c>folder.json</c>, her istek için
/// <c>{ad}.request.json</c> (örnekler istek dosyasının içinde). Yazma deterministiktir: aynı durum her zaman aynı
/// dosyaları üretir. Okurken üst klasör dizin yapısından bulunur; dosya taşımak klasör değiştirmek demektir.
/// </summary>
internal static class GitLayout
{
    private const int MaxNameLength = 80;
    private static readonly System.Text.RegularExpressions.Regex GitSpecial = new(@"^(?:\.git|git~\d|gitmod~\d|gitign~\d|gitatt~\d)", System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1));
    private static readonly char[] Invalid = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    private static readonly HashSet<string> Reserved = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };

    public static Dictionary<string, string> Build(IReadOnlyDictionary<string, GitItem> items)
    {
        var files = new Dictionary<string, string>(StringComparer.Ordinal);
        if (items.TryGetValue(GitItem.CollectionKey, out var collection))
        {
            files[GitManagedFiles.CollectionFile] = GitJson.Write(collection.Doc);
        }

        var children = items.Values.Where(i => i.Kind != ForkItemKind.Collection).ToLookup(i => i.ParentId);
        Emit(null, string.Empty, children, files, GitManagedFiles.CollectionFile);
        return files;
    }

    private static void Emit(Guid? parentId, string dir, ILookup<Guid?, GitItem> children, Dictionary<string, string> files, string reserved)
    {
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { reserved };
        foreach (var item in children[parentId].OrderBy(i => i.Name, StringComparer.Ordinal).ThenBy(i => i.Id))
        {
            if (item.Kind == ForkItemKind.Folder)
            {
                var name = Unique(Sanitize(item.Name), string.Empty, item.Id, used);
                var path = dir + name;
                files[path + "/" + GitManagedFiles.FolderFile] = GitJson.Write(item.Doc);
                Emit(item.Id, path + "/", children, files, GitManagedFiles.FolderFile);
            }
            else
            {
                var name = Unique(Sanitize(item.Name), GitManagedFiles.RequestSuffix, item.Id, used);
                files[dir + name + GitManagedFiles.RequestSuffix] = GitJson.Write(item.Doc);
            }
        }
    }

    /// <summary>Aynı dizinde (büyük/küçük harf duyarsız) çakışan adlara kimliğin başı eklenir.</summary>
    private static string Unique(string name, string suffix, Guid id, HashSet<string> used)
    {
        var candidate = name;
        if (!used.Add(candidate + suffix))
        {
            candidate = $"{name}~{id.ToString("N")[..8]}";
            used.Add(candidate + suffix);
        }

        return candidate;
    }

    internal static string Sanitize(string name)
    {
        var chars = name.Select(c => c < ' ' || Invalid.Contains(c) ? '_' : c).ToArray();
        var clean = new string(chars).Trim().TrimEnd('.', ' ');
        if (clean.Length > MaxNameLength)
        {
            clean = clean[..MaxNameLength].TrimEnd('.', ' ');
        }

        if (clean.Length == 0)
        {
            return "adsiz";
        }

        // .git*, 8.3 kısa adları (git~1) ve Windows aygıt adları depo meta verisi/aygıt olarak yorumlanır; başa "_" eklenir.
        var special = Reserved.Contains(clean.Split((char)46)[0]) || GitSpecial.IsMatch(clean);
        return special ? "_" + clean : clean;
    }

    /// <summary>Dosyaları öğelere çevirir; okunamayan dosya ya da çift kimlik için Türkçe hata döner.</summary>
    public static (Dictionary<string, GitItem> Items, string? Error) Parse(IReadOnlyDictionary<string, string> files)
    {
        var items = new Dictionary<string, GitItem>();
        try
        {
            var folderIds = ParseFolders(files, items);
            if (files.TryGetValue(GitManagedFiles.CollectionFile, out var text))
            {
                var doc = Read(GitManagedFiles.CollectionFile, text);
                Add(items, GitItem.Create(ForkItemKind.Collection, doc.Id ?? Guid.Empty, null, 0, Normalize(doc)));
            }

            foreach (var (path, content) in files.Where(f => f.Key.EndsWith(GitManagedFiles.RequestSuffix, StringComparison.Ordinal)).OrderBy(f => f.Key, StringComparer.Ordinal))
            {
                Add(items, ParseRequest(path, content, folderIds));
            }

            return (items, null);
        }
        catch (InvalidDataException ex)
        {
            return ([], ex.Message);
        }
    }

    private static GitItem ParseRequest(string path, string content, Dictionary<string, Guid?> folderIds)
    {
        var doc = Read(path, content);
        var id = doc.Id ?? FromPath(path);
        var name = string.IsNullOrWhiteSpace(doc.Name) ? FileName(path)[..^GitManagedFiles.RequestSuffix.Length] : doc.Name;
        var order = doc.Order ?? 0;
        return GitItem.Create(ForkItemKind.Request, id, folderIds.GetValueOrDefault(DirOf(path)), order, doc with
        {
            Id = id,
            Name = name,
            Order = order,
            Definition = (doc.Definition ?? RequestDefinition.Default).Normalize(),
            Examples = doc.Examples is { Count: > 0 } ? doc.Examples : null,
        });
    }

    private static Dictionary<string, Guid?> ParseFolders(IReadOnlyDictionary<string, string> files, Dictionary<string, GitItem> items)
    {
        // Klasör dizinleri: folder.json olanlar ve (dosyası olmasa da) içinde dosya bulunanların üst dizinleri.
        var dirs = new HashSet<string>(StringComparer.Ordinal);
        foreach (var path in files.Keys.Where(p => p.Contains('/', StringComparison.Ordinal)))
        {
            for (var dir = DirOf(path); dir.Length > 0; dir = DirOf(dir))
            {
                dirs.Add(dir);
            }
        }

        var ids = new Dictionary<string, Guid?> { [string.Empty] = null };
        foreach (var dir in dirs.OrderBy(d => d.Count(c => c == '/')).ThenBy(d => d, StringComparer.Ordinal))
        {
            var path = dir + "/" + GitManagedFiles.FolderFile;
            var doc = files.TryGetValue(path, out var text) ? Read(path, text) : new GitFileDoc();
            var id = doc.Id ?? FromPath(dir);
            var order = doc.Order ?? 0;
            var name = string.IsNullOrWhiteSpace(doc.Name) ? dir[(dir.LastIndexOf('/') + 1)..] : doc.Name;
            ids[dir] = id;
            Add(items, GitItem.Create(ForkItemKind.Folder, id, ids[DirOf(dir)], order, Normalize(doc with { Id = id, Name = name, Order = order })));
        }

        return ids;
    }

    private static GitFileDoc Normalize(GitFileDoc doc) => doc with
    {
        Auth = doc.Auth is null || doc.Auth.Type == AuthType.Inherit ? null : doc.Auth.WithoutSecrets(),
        Scripts = doc.Scripts is null || doc.Scripts.IsEmpty ? null : doc.Scripts.Normalize(),
        Description = string.IsNullOrWhiteSpace(doc.Description) ? null : doc.Description,
        Variables = doc.Variables is { Count: > 0 } ? doc.Variables : null,
    };

    private static void Add(Dictionary<string, GitItem> items, GitItem item)
    {
        if (!items.TryAdd(item.Key, item))
        {
            throw new InvalidDataException(L.T("git.duplicate_id", "Aynı kimlik ({id}) birden çok dosyada kullanılmış.", ("id", item.Id)));
        }
    }

    private static GitFileDoc Read(string path, string text)
    {
        try
        {
            return GitJson.Read(text);
        }
        catch (JsonException ex)
        {
            throw new InvalidDataException(L.T("git.file_unreadable", "'{path}' okunamadı: {error}", ("path", path), ("error", ex.Message)), ex);
        }
    }

    private static string DirOf(string path)
    {
        var index = path.LastIndexOf('/');
        return index < 0 ? string.Empty : path[..index];
    }

    private static string FileName(string path) => path[(path.LastIndexOf('/') + 1)..];

    /// <summary>Kimliği olmayan (elle yazılmış) dosya için yoldan türetilen kararlı kimlik.</summary>
    private static Guid FromPath(string path)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes("apivator-git:" + path));
        return new Guid(hash.AsSpan(0, 16));
    }
}
