using Apivator.Domain.Common;

namespace Apivator.Domain.Collections;

/// <summary>Collection'a kaydedilmiş bir istek.</summary>
public sealed class ApiRequest : Entity
{
    public const int NameMaxLength = 200;
    public const int SourceKeyMaxLength = 600;

    private ApiRequest()
    {
        Name = string.Empty;
        Definition = RequestDefinition.Default;
    }

    public Guid CollectionId { get; private set; }

    public Guid? FolderId { get; private set; }

    public string Name { get; private set; }

    public int SortOrder { get; private set; }

    public RequestDefinition Definition { get; private set; }

    /// <summary>Ağaç görünümünde tanımın tamamını yüklemeden method rozetini göstermek için ayrı kolon.</summary>
    public string Method { get; private set; } = "GET";

    /// <summary>Ağaçta WebSocket/SSE rozetini göstermek için ayrı kolon (tanımdaki Kind'ın kopyası).</summary>
    public RequestKind Kind { get; private set; } = RequestKind.Http;

    /// <summary>OpenAPI kaynağından geldiyse belgedeki kimliği ("GET /pets/{id}"); kaynaktan güncellemede eşleşir.</summary>
    public string? SourceKey { get; private set; }

    /// <summary>Her kaydetmede artar; eşzamanlı düzenlemede üzerine yazmayı önler (optimistic concurrency).</summary>
    public int Version { get; private set; }

    public Guid UpdatedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static ApiRequest Create(
        Guid collectionId,
        Guid? folderId,
        string name,
        RequestDefinition definition,
        int sortOrder,
        Guid userId,
        DateTimeOffset now) => new()
        {
            CollectionId = collectionId,
            FolderId = folderId,
            Name = Names.Clean(name, NameMaxLength),
            Definition = definition.Normalize(),
            Method = definition.Normalize().Method,
            Kind = definition.Kind,
            SortOrder = sortOrder,
            Version = 1,
            UpdatedById = userId,
            CreatedAt = now,
            UpdatedAt = now,
        };

    public void Update(string name, RequestDefinition definition, Guid userId, DateTimeOffset now)
    {
        Name = Names.Clean(name, NameMaxLength);
        Definition = definition.Normalize();
        Method = Definition.Method;
        Kind = Definition.Kind;
        Version++;
        UpdatedById = userId;
        UpdatedAt = now;
    }

    public void LinkSource(string? key) =>
        SourceKey = key is null ? null : key.Length > SourceKeyMaxLength ? key[..SourceKeyMaxLength] : key;

    /// <summary>Başka bir klasöre ya da (aynı workspace'teki) başka bir collection'a taşır.</summary>
    public void MoveTo(Guid collectionId, Guid? folderId, int sortOrder)
    {
        CollectionId = collectionId;
        FolderId = folderId;
        SortOrder = sortOrder;
        Version++;
    }

    /// <summary>Silinmiş bir isteği aynı kimlikle geri getirirken (bağlantılar ve yorumlar eşleşmeye devam eder).</summary>
    public void Restore(Guid originalId) => Id = originalId;

    /// <summary>Kardeşler yeniden sıralanırken kullanılır; içerik değişmediği için sürüm artmaz.</summary>
    public void SetSortOrder(int sortOrder) => SortOrder = sortOrder;
}
