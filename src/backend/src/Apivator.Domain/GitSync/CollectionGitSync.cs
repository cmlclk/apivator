using Apivator.Domain.Common;

namespace Apivator.Domain.GitSync;

/// <summary>
/// Bir collection'ın Git deposuna bağlantısı. Erişim belirteci şifreli saklanır ve hiçbir yerde geri
/// döndürülmez. <see cref="BaseSnapshot"/> son eşitlemedeki ortak hâldir (öğe kimliği → kanonik içerik);
/// üç yönlü karşılaştırmanın tabanı olarak kullanılır.
/// </summary>
public sealed class CollectionGitSync : Entity
{
    public const int UrlMaxLength = 2000;
    public const int BranchMaxLength = 200;
    public const int PathMaxLength = 300;
    public const int UsernameMaxLength = 100;
    public const int ErrorMaxLength = 500;
    public const int CommitMessageMaxLength = 500;

    /// <summary>Otomatik uzak kontrol aralıkları (saat).</summary>
    public static readonly IReadOnlyList<int> CheckIntervals = [1, 6, 24];

    private CollectionGitSync()
    {
        RemoteUrl = string.Empty;
        Branch = string.Empty;
        FolderPath = string.Empty;
        BaseSnapshot = new Dictionary<string, string>();
    }

    public Guid CollectionId { get; private set; }

    public string RemoteUrl { get; private set; }

    public string Branch { get; private set; }

    /// <summary>Depoda collection dosyalarının durduğu klasör (kökten göreli, "/" ile).</summary>
    public string FolderPath { get; private set; }

    public string? Username { get; private set; }

    /// <summary>Data Protection ile şifreli erişim belirteci; null ise belirteç yok.</summary>
    public string? ProtectedToken { get; private set; }

    /// <summary>Son eşitlemedeki ortak hâl: öğe kimliği → kanonik içerik (JSON).</summary>
    public IReadOnlyDictionary<string, string> BaseSnapshot { get; private set; }

    /// <summary>Son eşitlenen commit; henüz eşitlenmediyse null.</summary>
    public string? LastCommit { get; private set; }

    public DateTimeOffset? LastSyncedAt { get; private set; }

    public Guid? LastSyncedById { get; private set; }

    /// <summary>Son kontrolde uzak dalın ucu ve tabana göre uzakta değişen öğe sayısı.</summary>
    public string? RemoteHead { get; private set; }

    public int Behind { get; private set; }

    public DateTimeOffset? LastCheckedAt { get; private set; }

    public string? LastError { get; private set; }

    public Guid ConnectedById { get; private set; }

    public DateTimeOffset ConnectedAt { get; private set; }

    /// <summary>Otomatik uzak kontrol aralığı (saat); null ise kapalı.</summary>
    public int? CheckIntervalHours { get; private set; }

    public DateTimeOffset? NextCheckAt { get; private set; }

    public DateTimeOffset? LockedUntil { get; private set; }

    public static CollectionGitSync Create(
        Guid collectionId,
        string remoteUrl,
        string branch,
        string folderPath,
        string? username,
        string? protectedToken,
        Guid userId,
        DateTimeOffset now) => new()
        {
            CollectionId = collectionId,
            RemoteUrl = remoteUrl,
            Branch = branch,
            FolderPath = folderPath,
            Username = username,
            ProtectedToken = protectedToken,
            ConnectedById = userId,
            ConnectedAt = now,
        };

    /// <summary>
    /// Bağlantı ayarlarını değiştirir. Depo, dal ya da klasör değişirse eski taban geçersiz olur; eşitleme sıfırdan başlar.
    /// <paramref name="protectedToken"/> null ise mevcut belirteç korunur; ancak sunucu (host) değiştiyse silinir.
    /// </summary>
    public void Reconfigure(string remoteUrl, string branch, string folderPath, string? username, string? protectedToken, bool hostChanged = false)
    {
        var moved = remoteUrl != RemoteUrl || branch != Branch || folderPath != FolderPath;
        RemoteUrl = remoteUrl;
        Branch = branch;
        FolderPath = folderPath;
        Username = username;
        if (hostChanged && protectedToken is null)
        {
            // Belirteç başka bir sunucuya sızmasın: sunucu değişince yeni belirteç girilmedikçe silinir.
            ProtectedToken = null;
        }

        if (protectedToken is not null)
        {
            ProtectedToken = protectedToken;
        }

        if (moved)
        {
            BaseSnapshot = new Dictionary<string, string>();
            LastCommit = null;
            LastSyncedAt = null;
            RemoteHead = null;
            Behind = 0;
        }

        LastError = null;
        ConsecutiveFailures = 0;
    }

    public void ClearToken() => ProtectedToken = null;

    /// <summary>Başarılı eşitleme (gönderme ya da alma): yeni taban ve commit.</summary>
    public void Synced(IReadOnlyDictionary<string, string> snapshot, string? commit, int behind, Guid userId, DateTimeOffset now)
    {
        BaseSnapshot = snapshot;
        LastCommit = commit;
        RemoteHead = commit;
        Behind = behind;
        LastSyncedAt = now;
        LastSyncedById = userId;
        LastCheckedAt = now;
        LastError = null;
        ConsecutiveFailures = 0;
    }

    /// <summary>Uzak dal kontrol edildi.</summary>
    public void Checked(string? head, int behind, DateTimeOffset now)
    {
        RemoteHead = head;
        Behind = behind;
        LastCheckedAt = now;
        LastError = null;
        ConsecutiveFailures = 0;
        NextCheckAt = CheckIntervalHours is { } hours ? now.AddHours(hours) : null;
        LockedUntil = null;
    }

    /// <summary>Üst üste bu kadar hatadan sonra otomatik kontrol kapatılır.</summary>
    public const int MaxConsecutiveFailures = 5;

    public int ConsecutiveFailures { get; private set; }

    /// <param name="disabledNotice">Otomatik kontrol kapanırsa hata metninin başına eklenen, çağıranın dilinde bildirim.</param>
    public void Failed(string error, DateTimeOffset now, string? disabledNotice = null)
    {
        ConsecutiveFailures++;
        var disable = CheckIntervalHours is not null && ConsecutiveFailures >= MaxConsecutiveFailures;
        if (disable)
        {
            CheckIntervalHours = null;
        }

        var text = disable ? (disabledNotice ?? "Otomatik kontrol üst üste hata nedeniyle kapatıldı.") + " " + error : error;
        LastError = text.Length > ErrorMaxLength ? text[..ErrorMaxLength] : text;

        LastCheckedAt = now;
        NextCheckAt = CheckIntervalHours is { } hours ? now.AddHours(hours) : null;
        LockedUntil = null;
    }

    public void Schedule(int? intervalHours, DateTimeOffset now)
    {
        if (intervalHours is { } hours && !CheckIntervals.Contains(hours))
        {
            throw new ArgumentOutOfRangeException(nameof(intervalHours));
        }

        CheckIntervalHours = intervalHours;
        NextCheckAt = intervalHours is null ? null : now;
        LockedUntil = null;
    }
}
