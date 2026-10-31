using System.Security.Cryptography;
using System.Text.Json.Serialization;
using Apivator.Domain.Common;

namespace Apivator.Domain.Docs;

/// <summary>Yayınlanan dokümantasyonu kimin görebileceği.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<DocVisibility>))]
public enum DocVisibility
{
    /// <summary>Yalnızca collection'ın organizasyonunun üyeleri (oturum açmış olarak).</summary>
    Organization,

    /// <summary>Bağlantıyı bilen herkes; oturum gerekmez.</summary>
    Public,
}

/// <summary>
/// Bir collection'ın yayınlanmış API dokümantasyonu. Sayfa her açılışta collection'ın güncel hâlinden üretilir
/// (anlık görüntü değildir); adres <c>/docs/{Slug}</c>. Değişken değerleri seçilen environment'ın paylaşılan
/// başlangıç değerlerinden gelir, gizli değerler hiçbir zaman gösterilmez.
/// </summary>
public sealed class PublishedDoc : Entity
{
    public const int SlugLength = 14;

    private const string SlugAlphabet = "abcdefghijkmnpqrstuvwxyz23456789";

    private PublishedDoc()
    {
        Slug = string.Empty;
    }

    public Guid CollectionId { get; private set; }

    /// <summary>Adreste kullanılan, tahmin edilemeyen kimlik.</summary>
    public string Slug { get; private set; }

    public DocVisibility Visibility { get; private set; }

    /// <summary>Örneklerdeki {{değişken}}'lerin çözüleceği environment (isteğe bağlı).</summary>
    public Guid? EnvironmentId { get; private set; }

    public Guid PublishedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static PublishedDoc Create(Guid collectionId, DocVisibility visibility, Guid? environmentId, Guid userId, DateTimeOffset now) => new()
    {
        CollectionId = collectionId,
        Slug = NewSlug(),
        Visibility = visibility,
        EnvironmentId = environmentId,
        PublishedById = userId,
        CreatedAt = now,
        UpdatedAt = now,
    };

    public void Update(DocVisibility visibility, Guid? environmentId, Guid userId, DateTimeOffset now)
    {
        Visibility = visibility;
        EnvironmentId = environmentId;
        PublishedById = userId;
        UpdatedAt = now;
    }

    /// <summary>Bağlantı sızdıysa yenisi üretilir; eski adres hemen çalışmaz olur.</summary>
    public void RegenerateSlug(DateTimeOffset now)
    {
        Slug = NewSlug();
        UpdatedAt = now;
    }

    /// <summary>Collection başka bir workspace'e taşınınca environment seçimi geçersiz olur.</summary>
    public void ClearEnvironment(DateTimeOffset now)
    {
        EnvironmentId = null;
        UpdatedAt = now;
    }

    public static bool IsWellFormedSlug(string? slug) =>
        slug is { Length: SlugLength } && slug.All(c => SlugAlphabet.Contains(c, StringComparison.Ordinal));

    private static string NewSlug()
    {
        Span<char> chars = stackalloc char[SlugLength];
        for (var i = 0; i < chars.Length; i++)
        {
            chars[i] = SlugAlphabet[RandomNumberGenerator.GetInt32(SlugAlphabet.Length)];
        }

        return new string(chars);
    }
}
