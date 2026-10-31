using Apivator.Application.Common;
using Apivator.Domain.Forks;

namespace Apivator.Application.GitSync;

/// <summary>
/// Bağlantı ayarları. <see cref="Token"/> boş bırakılırsa mevcut belirteç korunur; <see cref="ClearToken"/> onu siler.
/// Belirteç hiçbir yanıtta geri dönmez.
/// </summary>
public sealed record ConnectGitRequest(
    string RemoteUrl,
    string Branch,
    string? FolderPath = null,
    string? Username = null,
    string? Token = null,
    bool ClearToken = false);

/// <param name="Ahead">Son eşitlemeden beri yerelde değişen öğe sayısı (gönderilecekler).</param>
/// <param name="Behind">Son kontrolde uzakta değişen öğe sayısı (alınacaklar).</param>
public sealed record GitSyncDto(
    Guid Id,
    Guid CollectionId,
    string RemoteUrl,
    string Branch,
    string FolderPath,
    string? Username,
    bool HasToken,
    string? LastCommit,
    DateTimeOffset? LastSyncedAt,
    string? LastSyncedByName,
    string? RemoteHead,
    int Ahead,
    int Behind,
    DateTimeOffset? LastCheckedAt,
    string? LastError,
    int? CheckIntervalHours,
    DateTimeOffset ConnectedAt);

/// <param name="AcknowledgeSecrets">Olası gizli değer uyarısı görüldü; yine de gönder.</param>
public sealed record PushGitRequest(string? Message = null, bool AcknowledgeSecrets = false);

public sealed record GitPushResult(string? Commit, int Changed, bool NoChanges, GitSyncDto Status);

/// <summary>
/// Bir öğenin yerel ve uzak durumu (son eşitlemeye göre). <see cref="Key"/> çözüm anahtarıdır.
/// <see cref="Mine"/>/<see cref="Theirs"/> kanonik içerik (JSON); gizli değerler yer tutucudur.
/// </summary>
public sealed record GitChangeDto(
    string Key,
    ForkItemKind Kind,
    string Name,
    string Path,
    ForkChangeType? Local,
    ForkChangeType? Remote,
    bool Conflict,
    string? Mine,
    string? Theirs,
    string? Warning = null);

/// <summary>Uzakta değişenler (alınacaklar); yalnızca yerelde değişenler listelenmez.</summary>
public sealed record GitPullPreviewDto(string? RemoteHead, IReadOnlyList<GitChangeDto> Changes)
{
    public int Conflicts => Changes.Count(c => c.Conflict);
}

/// <param name="ExpectedHead">Önizlemedeki uzak commit; uzak bu arada değiştiyse işlem reddedilir.</param>
/// <param name="Resolutions">Anahtar → "theirs" (uzağınkini al), "mine" (benimkini koru) ya da "skip" (şimdilik dokunma).</param>
public sealed record PullGitRequest(string? ExpectedHead = null, IReadOnlyDictionary<string, string>? Resolutions = null);

public sealed record GitPullResult(int Applied, int Skipped, GitSyncDto Status);

public sealed record SetGitScheduleRequest(int? IntervalHours);

/// <summary>Uzak depoya erişim bilgisi (belirteç çözülmüş; yalnızca bellekte).</summary>
public sealed record GitRemoteSpec(string Url, string Branch, string? Username, string? Token);

/// <summary>Uzak dalın ucu (dal ya da depo boşsa null) ve klasördeki Apivator dosyaları (klasöre göreli yol → içerik).</summary>
public sealed record GitRemoteTree(string? Head, IReadOnlyDictionary<string, string> Files);

public sealed record GitAuthor(string Name, string Email);

/// <summary>Uzak depo işlemlerinin kullanıcıya gösterilebilir hatası.</summary>
public sealed class GitRemoteException(string message, string? detail = null, Exception? inner = null) : Exception(message, inner)
{
    /// <summary>Ham teknik ayrıntı; yalnızca workspace yöneticisine gösterilir.</summary>
    public string? Detail { get; } = detail;
}

/// <summary>Uzak depoyla çalışan altyapı (libgit2); testlerde yerel çıplak depoyla da çalışır.</summary>
public interface IGitRemote
{
    Task<GitRemoteTree> ReadAsync(GitRemoteSpec spec, string folderPath, CancellationToken ct = default);

    /// <summary>
    /// Klasördeki Apivator dosyalarını <paramref name="files"/> ile değiştirip commit'ler ve dala gönderir.
    /// Dal ucu <paramref name="expectedHead"/>'den farklıysa reddeder. Değişiklik yoksa null döner.
    /// </summary>
    Task<string?> PushAsync(
        GitRemoteSpec spec,
        string folderPath,
        IReadOnlyDictionary<string, string> files,
        string? expectedHead,
        string message,
        GitAuthor author,
        CancellationToken ct = default);
}

/// <summary>Adres kuralları: https (ayarla http), SSRF koruması (NetworkGuard).</summary>
public interface IGitRemoteGuard
{
    /// <summary>Kullanıcıya gösterilecek hata mesajı; geçerliyse null.</summary>
    Task<string?> ValidateAsync(string url, CancellationToken ct = default);
}

/// <summary>Erişim belirtecini şifreler (ASP.NET Data Protection).</summary>
public interface IGitSecretProtector
{
    string Protect(string secret);

    string? Unprotect(string protectedSecret);
}

public interface IGitSyncService
{
    Task<Result<GitSyncDto>> GetAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    /// <summary>Workspace yöneticisi bağlar ya da ayarları günceller.</summary>
    Task<Result<GitSyncDto>> ConnectAsync(Guid collectionId, ConnectGitRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> DisconnectAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    Task<Result<GitPushResult>> PushAsync(Guid collectionId, PushGitRequest request, Guid userId, CancellationToken ct = default);

    /// <summary>Uzak dalı çeker, son eşitlemeye göre farkı hesaplar (hiçbir şey değiştirmez).</summary>
    Task<Result<GitPullPreviewDto>> PreviewPullAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    Task<Result<GitPullResult>> PullAsync(Guid collectionId, PullGitRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<GitSyncDto>> SetScheduleAsync(Guid collectionId, SetGitScheduleRequest request, Guid userId, CancellationToken ct = default);
}

/// <summary>Zamanlayıcının çağırdığı otomatik uzak kontrol.</summary>
public interface IGitChecker
{
    Task CheckAsync(Guid syncId, CancellationToken ct = default);
}

/// <summary>Depoda Apivator'a ait dosyaları ayırt eder; diğer dosyalara hiç dokunulmaz.</summary>
public static class GitManagedFiles
{
    public const string CollectionFile = "collection.json";
    public const string FolderFile = "folder.json";
    public const string RequestSuffix = ".request.json";

    /// <summary>Klasöre göreli yol ("/" ayırıcılı) bu senkronun yönettiği bir dosya mı?</summary>
    public static bool IsManaged(string relativePath)
    {
        var name = relativePath[(relativePath.LastIndexOf('/') + 1)..];
        return name == FolderFile
            || name.EndsWith(RequestSuffix, StringComparison.Ordinal)
            || (name == CollectionFile && !relativePath.Contains('/', StringComparison.Ordinal));
    }
}

/// <summary>Collection başına kopyalar arası kilit (PostgreSQL advisory lock); gönderme/alma aynı anda tek örnekte çalışır.</summary>
public interface IGitLock
{
    Task<IAsyncDisposable> AcquireAsync(Guid collectionId, CancellationToken ct = default);
}
