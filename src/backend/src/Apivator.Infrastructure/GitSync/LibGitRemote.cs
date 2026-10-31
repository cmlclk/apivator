using System.Text;
using Apivator.Application.Common.Localization;
using Apivator.Application.GitSync;
using LibGit2Sharp;
using LibGit2Sharp.Handlers;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.GitSync;

/// <summary>
/// libgit2 ile uzak depo işlemleri. Her işlem geçici bir çıplak depoda yapılır (çalışma kopyası yok): dalı çeker,
/// ağaçtan okur ya da yeni ağaç + commit üretip dala gönderir. Geçici dizin işlem bitince silinir.
/// </summary>
internal sealed class LibGitRemote : IGitRemote
{
    private readonly IOptions<GitSyncOptions> _options;

    public LibGitRemote(IOptions<GitSyncOptions> options, IHttpClientFactory clients)
    {
        _options = options;
        GuardedGit.Clients = clients;
        GuardedGit.Timeout = TimeSpan.FromSeconds(Math.Max(5, options.Value.HttpTimeoutSeconds));
        GuardedGit.MaxResponseBytes = Math.Max(1, options.Value.MaxFetchMegabytes) * 1024L * 1024;
        GuardedGit.EnsureRegistered();
    }

    private const long MaxFileBytes = 10 * 1024 * 1024;
    private const int MaxFiles = 20_000;

    public Task<GitRemoteTree> ReadAsync(GitRemoteSpec spec, string folderPath, CancellationToken ct = default) =>
        Task.Run(() => Guarded(spec, () => Read(spec, folderPath)), ct);

    public Task<string?> PushAsync(
        GitRemoteSpec spec,
        string folderPath,
        IReadOnlyDictionary<string, string> files,
        string? expectedHead,
        string message,
        GitAuthor author,
        CancellationToken ct = default) =>
        Task.Run(() => Guarded(spec, () => Push(spec, folderPath, files, expectedHead, message, author)), ct);

    private GitRemoteTree Read(GitRemoteSpec spec, string folder)
    {
        using var scratch = new Scratch(_options.Value.WorkDirectory);
        using var repo = scratch.Open();
        var tip = Fetch(repo, spec);
        return new GitRemoteTree(tip?.Sha, tip is null ? new Dictionary<string, string>() : ReadFiles(tip, folder));
    }

    private string? Push(GitRemoteSpec spec, string folder, IReadOnlyDictionary<string, string> files, string? expectedHead, string message, GitAuthor author)
    {
        using var scratch = new Scratch(_options.Value.WorkDirectory);
        using var repo = scratch.Open();
        var tip = Fetch(repo, spec);
        if (tip?.Sha != expectedHead)
        {
            throw new GitRemoteException(L.T("git.changed_meanwhile", "Depo bu sırada değişti. Önce \"Repodan al\" ile güncelleyin."));
        }

        var definition = tip is null ? new TreeDefinition() : TreeDefinition.From(tip);
        foreach (var existing in tip is null ? [] : ReadFiles(tip, folder).Keys.ToList())
        {
            definition.Remove(folder + "/" + existing);
        }

        foreach (var (path, content) in files)
        {
            var blob = repo.ObjectDatabase.CreateBlob(new MemoryStream(new UTF8Encoding(false).GetBytes(content)));
            definition.Add(folder + "/" + path, blob, Mode.NonExecutableFile);
        }

        var tree = repo.ObjectDatabase.CreateTree(definition);
        if (tip is not null && tree.Sha == tip.Tree.Sha)
        {
            return null;
        }

        var signature = new Signature(author.Name, author.Email, DateTimeOffset.UtcNow);
        var commit = repo.ObjectDatabase.CreateCommit(signature, signature, message, tree, tip is null ? [] : [tip], false);
        var branch = $"refs/heads/{spec.Branch}";
        repo.Refs.Add(branch, commit.Id);
        PushBranch(repo, spec, branch);
        return commit.Sha;
    }

    private static Commit? Fetch(Repository repo, GitRemoteSpec spec)
    {
        repo.Network.Remotes.Add("origin", spec.Url);
        var tracking = $"refs/remotes/origin/{spec.Branch}";
        var fetch = new FetchOptions { CredentialsProvider = Credentials(spec) };
        fetch.ProxyOptions.ProxyType = ProxyType.None;
        if (spec.Url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
        {
            fetch.Depth = 1; // yalnızca uç commit; geçmiş indirilmez
        }

        Commands.Fetch(repo, "origin", [$"+refs/heads/{spec.Branch}:{tracking}"], fetch, null);
        return repo.Refs[tracking]?.ResolveToDirectReference()?.Target as Commit;
    }

    private static void PushBranch(Repository repo, GitRemoteSpec spec, string branch)
    {
        string? rejected = null;
        var push = new PushOptions { CredentialsProvider = Credentials(spec), OnPushStatusError = e => rejected = e.Message };
        push.ProxyOptions.ProxyType = ProxyType.None;
        repo.Network.Push(repo.Network.Remotes["origin"], $"{branch}:{branch}", push);
        if (rejected is not null)
        {
            throw new GitRemoteException(L.T("git.push_rejected", "Depo gönderimi reddetti: {reason}", ("reason", rejected)));
        }
    }

    private static Dictionary<string, string> ReadFiles(Commit commit, string folder)
    {
        var files = new Dictionary<string, string>(StringComparer.Ordinal);
        if (commit[folder]?.Target is Tree root)
        {
            Walk(root, string.Empty, files);
        }

        return files;
    }

    private static void Walk(Tree tree, string prefix, Dictionary<string, string> files)
    {
        foreach (var entry in tree)
        {
            if (entry.Target is Tree child)
            {
                Walk(child, prefix + entry.Name + "/", files);
            }
            else if (entry.Target is Blob blob && GitManagedFiles.IsManaged(prefix + entry.Name))
            {
                if (files.Count >= MaxFiles || blob.Size > MaxFileBytes)
                {
                    throw new GitRemoteException(L.T("git.entry_too_large", "'{path}' çok büyük ya da klasörde çok fazla dosya var.", ("path", prefix + entry.Name)));
                }

                using var reader = new StreamReader(blob.GetContentStream(), new UTF8Encoding(false), true);
                files[prefix + entry.Name] = reader.ReadToEnd();
            }
        }
    }

    private static CredentialsHandler Credentials(GitRemoteSpec spec)
    {
        var attempts = 0;
        return (_, _, _) =>
        {
            // libgit2 yanlış belirteçle sonsuza dek yeniden dener; ikinci istekte vazgeçilir.
            if (spec.Token is null || ++attempts > 1)
            {
                throw new GitRemoteException(L.T("git.auth_failed", "Depoya erişilemedi: kimlik doğrulama başarısız. Erişim belirtecini ve izinlerini kontrol edin."));
            }

            return new UsernamePasswordCredentials { Username = string.IsNullOrEmpty(spec.Username) ? "git" : spec.Username, Password = spec.Token };
        };
    }

    /// <summary>libgit2 hatalarını kullanıcıya gösterilebilir (etkin dilde) hataya çevirir; belirteç mesajlara sızmaz.</summary>
    private static T Guarded<T>(GitRemoteSpec spec, Func<T> action)
    {
        var context = new GitHttpAuth(spec.Username, spec.Token);
        GuardedGit.Auth.Value = context;
        try
        {
            return action();
        }
        catch (GitRemoteException)
        {
            throw;
        }
        catch (Exception ex) when (ex is LibGit2SharpException or InvalidOperationException)
        {
            var message = context.Failure is { Length: > 0 } failure && ex.Message.Contains("no error", StringComparison.OrdinalIgnoreCase) ? failure : ex.Message;
            var text = spec.Token is { Length: > 0 } token ? message.Replace(token, "***", StringComparison.Ordinal) : message;
            throw new GitRemoteException(Translate(text), text, ex);
        }
        finally
        {
            GuardedGit.Auth.Value = null;
        }
    }

    private static readonly string[] OwnMarkers = ["izin verilmiyor", "çok büyük", "aren't allowed", "is too large"];

    private static string Translate(string message)
    {
        var lower = message.ToLowerInvariant();
        if (lower.Contains("authentication", StringComparison.Ordinal) || lower.Contains("401", StringComparison.Ordinal) || lower.Contains("403", StringComparison.Ordinal))
        {
            return L.T("git.auth_failed", "Depoya erişilemedi: kimlik doğrulama başarısız. Erişim belirtecini ve izinlerini kontrol edin.");
        }

        if (lower.Contains("404", StringComparison.Ordinal) || lower.Contains("not found", StringComparison.Ordinal) || lower.Contains("repository", StringComparison.Ordinal))
        {
            return L.T("git.not_found", "Depo bulunamadı ya da erişim yok. Adresi ve belirteç izinlerini kontrol edin.");
        }

        if (lower.Contains("connection failed", StringComparison.Ordinal))
        {
            return L.T("git.unreachable", "Depoya bağlanılamadı ya da yanıt vermedi.");
        }

        // Kendi mesajlarımız olduğu gibi gösterilir; libgit2 metni yalnızca ayrıntıda (yöneticiye) kalır.
        return OwnMarkers.Any(marker => message.Contains(marker, StringComparison.Ordinal)) ? message : L.T("git.failed", "Git işlemi başarısız.");
    }

    internal static string WorkRoot(string? configured) =>
        string.IsNullOrWhiteSpace(configured) ? Path.Combine(Path.GetTempPath(), "apivator-git") : configured;

    /// <summary>Git nesne dosyaları salt okunurdur; Windows'ta silmeden önce öznitelik temizlenir.</summary>
    internal static void DeleteScratch(string path)
    {
        try
        {
            foreach (var file in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
            {
                File.SetAttributes(file, FileAttributes.Normal);
            }

            Directory.Delete(path, recursive: true);
        }
        catch (IOException)
        {
            // Geçici dizin; açılıştaki temizlik sonra siler.
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    /// <summary>İşlem boyunca yaşayan geçici çıplak depo.</summary>
    private sealed class Scratch : IDisposable
    {
        private readonly string _path;

        public Scratch(string? root)
        {
            _path = Path.Combine(WorkRoot(root), Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_path);
        }

        public Repository Open() => new(Repository.Init(_path, isBare: true));

        public void Dispose() => DeleteScratch(_path);
    }
}
