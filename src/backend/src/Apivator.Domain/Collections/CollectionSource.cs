using Apivator.Domain.Common;

namespace Apivator.Domain.Collections;

/// <summary>
/// Adresinden içe aktarılmış bir collection'ın kaynak OpenAPI belgesi. Son uygulanan belge saklanır; kaynaktan
/// güncellemede yeni belgeyle karşılaştırılarak hangi uçların eklendiği, değiştiği ya da kaldırıldığı bulunur.
/// Belgeye erişim için girilen header'lar saklanmaz.
/// </summary>
public sealed class CollectionSource : Entity
{
    public const int UrlMaxLength = 2000;
    public const int ErrorMaxLength = 500;

    /// <summary>Otomatik kontrol aralıkları (saat).</summary>
    public static readonly IReadOnlyList<int> CheckIntervals = [1, 6, 24];

    private CollectionSource()
    {
        Url = string.Empty;
        Document = string.Empty;
        DocumentHash = string.Empty;
    }

    public Guid CollectionId { get; private set; }

    public string Url { get; private set; }

    /// <summary>Belge masaüstü ajanıyla bu bilgisayardan çekildi (localhost/iç ağ); sunucu kendisi kontrol edemeyebilir.</summary>
    public bool Local { get; private set; }

    /// <summary>Son uygulanan belge (OpenAPI 3 JSON).</summary>
    public string Document { get; private set; }

    public string DocumentHash { get; private set; }

    public string? DocumentVersion { get; private set; }

    public DateTimeOffset ImportedAt { get; private set; }

    /// <summary>Kaynaktan en son güncelleme (ilk içe aktarmada ImportedAt).</summary>
    public DateTimeOffset UpdatedAt { get; private set; }

    public Guid UpdatedById { get; private set; }

    /// <summary>Önizlenen ya da kontrolde bulunan yeni belge; "uygula" bunu kullanır.</summary>
    public string? PendingDocument { get; private set; }

    public string? PendingHash { get; private set; }

    /// <summary>Otomatik kontrol aralığı (saat); null ise kapalı.</summary>
    public int? CheckIntervalHours { get; private set; }

    /// <summary>Otomatik kontrolü açan kullanıcı; değişiklik bildirimi ona gider.</summary>
    public Guid? CheckOwnerId { get; private set; }

    public DateTimeOffset? NextCheckAt { get; private set; }

    public DateTimeOffset? LockedUntil { get; private set; }

    public DateTimeOffset? LastCheckedAt { get; private set; }

    public string? LastCheckError { get; private set; }

    /// <summary>Otomatik kontrolün bulduğu, henüz uygulanmamış değişiklik.</summary>
    public DateTimeOffset? ChangeDetectedAt { get; private set; }

    /// <summary>Bildirimi gönderilen son belge özeti (aynı değişiklik için tekrar bildirim gitmez).</summary>
    public string? NotifiedHash { get; private set; }

    public static CollectionSource Create(
        Guid collectionId,
        string url,
        bool local,
        string document,
        string hash,
        string? version,
        Guid userId,
        DateTimeOffset now) => new()
        {
            CollectionId = collectionId,
            Url = url.Length > UrlMaxLength ? url[..UrlMaxLength] : url,
            Local = local,
            Document = document,
            DocumentHash = hash,
            DocumentVersion = Clip(version, 100),
            ImportedAt = now,
            UpdatedAt = now,
            UpdatedById = userId,
        };

    /// <summary>Yeni belge önizlendi; uygulanana kadar bekler.</summary>
    public void SetPending(string document, string hash, bool local, string url)
    {
        PendingDocument = document;
        PendingHash = hash;
        Local = local;
        Url = url.Length > UrlMaxLength ? url[..UrlMaxLength] : url;
    }

    /// <summary>Bekleyen belge uygulandı.</summary>
    public void Applied(string? version, Guid userId, DateTimeOffset now)
    {
        if (PendingDocument is null || PendingHash is null)
        {
            throw new InvalidOperationException("Uygulanacak belge yok.");
        }

        Document = PendingDocument;
        DocumentHash = PendingHash;
        DocumentVersion = Clip(version, 100);
        PendingDocument = null;
        PendingHash = null;
        ChangeDetectedAt = null;
        UpdatedAt = now;
        UpdatedById = userId;
    }

    public void Schedule(int? intervalHours, Guid userId, DateTimeOffset now)
    {
        if (intervalHours is { } hours && !CheckIntervals.Contains(hours))
        {
            throw new ArgumentOutOfRangeException(nameof(intervalHours));
        }

        CheckIntervalHours = intervalHours;
        CheckOwnerId = intervalHours is null ? null : userId;
        NextCheckAt = intervalHours is null ? null : now;
        LockedUntil = null;
        LastCheckError = null;
    }

    /// <summary>Otomatik kontrolün sonucu. changed: belge son uygulanandan farklı.</summary>
    public void Checked(DateTimeOffset now, string? hash, string? error)
    {
        LastCheckedAt = now;
        LastCheckError = Clip(error, ErrorMaxLength);
        NextCheckAt = CheckIntervalHours is { } hours ? now.AddHours(hours) : null;
        LockedUntil = null;
        if (hash is null)
        {
            return;
        }

        if (hash == DocumentHash)
        {
            ChangeDetectedAt = null;
        }
        else
        {
            ChangeDetectedAt ??= now;
        }
    }

    /// <summary>Bu değişiklik için daha önce bildirim gitmediyse true döner ve kaydeder.</summary>
    public bool ShouldNotify(string hash)
    {
        if (NotifiedHash == hash)
        {
            return false;
        }

        NotifiedHash = hash;
        return true;
    }

    private static string? Clip(string? value, int max) =>
        value is null ? null : value.Length > max ? value[..max] : value;
}
