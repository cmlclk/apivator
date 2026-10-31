using System.Security.Cryptography;
using Apivator.Domain.Common;

namespace Apivator.Domain.Mocks;

/// <summary>
/// Bir collection'ın kayıtlı örnek yanıtlarını (Example) dış dünyaya sunan sahte sunucu. Adresi
/// <c>/mock/{Key}/...</c>; gelen istek method, yol, query, header ve body'ye göre en uygun örnekle eşleştirilir.
/// Gizli (private) mock'lar yalnızca workspace üyesinin API anahtarıyla çağrılabilir.
/// </summary>
public sealed class MockServer : Entity
{
    public const int NameMaxLength = 120;
    public const int MaxDelayMs = 60_000;
    public const int MaxPerWorkspace = 50;
    public const int KeyLength = 16;

    private const string KeyAlphabet = "abcdefghijkmnpqrstuvwxyz23456789";

    private MockServer()
    {
        Name = string.Empty;
        Key = string.Empty;
    }

    public Guid WorkspaceId { get; private set; }

    public Guid CollectionId { get; private set; }

    /// <summary>Örnek URL'lerindeki {{değişken}}'leri çözmek için kullanılan environment (isteğe bağlı).</summary>
    public Guid? EnvironmentId { get; private set; }

    public string Name { get; private set; }

    /// <summary>Adreste kullanılan, tahmin edilemeyen kısa kimlik.</summary>
    public string Key { get; private set; }

    public bool IsPrivate { get; private set; }

    /// <summary>Her yanıttan önce beklenecek süre (ağ gecikmesi simülasyonu).</summary>
    public int DelayMs { get; private set; }

    public bool Enabled { get; private set; }

    public Guid CreatedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static MockServer Create(
        Guid workspaceId,
        Guid collectionId,
        Guid? environmentId,
        string name,
        bool isPrivate,
        int delayMs,
        Guid userId,
        DateTimeOffset now) => new()
        {
            WorkspaceId = workspaceId,
            CollectionId = collectionId,
            EnvironmentId = environmentId,
            Name = Names.Clean(name, NameMaxLength),
            Key = NewKey(),
            IsPrivate = isPrivate,
            DelayMs = ClampDelay(delayMs),
            Enabled = true,
            CreatedById = userId,
            CreatedAt = now,
            UpdatedAt = now,
        };

    public void Update(string name, Guid? environmentId, bool isPrivate, int delayMs, bool enabled, DateTimeOffset now)
    {
        Name = Names.Clean(name, NameMaxLength);
        EnvironmentId = environmentId;
        IsPrivate = isPrivate;
        DelayMs = ClampDelay(delayMs);
        Enabled = enabled;
        UpdatedAt = now;
    }

    /// <summary>Collection başka bir workspace'e taşındığında mock da onunla gider.</summary>
    public void MoveTo(Guid workspaceId, DateTimeOffset now)
    {
        WorkspaceId = workspaceId;
        EnvironmentId = null;
        UpdatedAt = now;
    }

    /// <summary>Adres sızdıysa yenisi üretilir; eski adres hemen çalışmaz olur.</summary>
    public void RegenerateKey(DateTimeOffset now)
    {
        Key = NewKey();
        UpdatedAt = now;
    }

    public static bool IsWellFormedKey(string? key) =>
        key is { Length: KeyLength } && key.All(c => KeyAlphabet.Contains(c, StringComparison.Ordinal));

    private static int ClampDelay(int delayMs) => Math.Clamp(delayMs, 0, MaxDelayMs);

    private static string NewKey()
    {
        Span<char> chars = stackalloc char[KeyLength];
        for (var i = 0; i < chars.Length; i++)
        {
            chars[i] = KeyAlphabet[RandomNumberGenerator.GetInt32(KeyAlphabet.Length)];
        }

        return new string(chars);
    }
}
