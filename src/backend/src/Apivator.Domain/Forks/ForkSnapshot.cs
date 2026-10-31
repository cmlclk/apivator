using System.Text.Json.Serialization;
using Apivator.Domain.Collections;
using Apivator.Domain.Variables;

namespace Apivator.Domain.Forks;

[JsonConverter(typeof(JsonStringEnumConverter<ForkItemKind>))]
public enum ForkItemKind
{
    /// <summary>Collection düzeyindeki ayarlar (açıklama, yetkilendirme, değişkenler, script'ler); adı hariç.</summary>
    Collection,
    Folder,
    Request,
}

/// <summary>Örnek yanıtın karşılaştırılan hâli.</summary>
public sealed record ExampleSnapshot(string Name, int Status, IReadOnlyList<KeyValueItem> Headers, string Body, RequestDefinition Request);

/// <summary>
/// Bir öğenin karşılaştırma için anlık görüntüsü. <see cref="Parent"/> üst klasörün bağlantı anahtarıdır
/// (her iki tarafta aynı klasörü gösteren <see cref="ForkLink"/>'in kimliği, "link:{id}"); kökte null.
/// Alanlar öğe türüne göre dolar, diğerleri null kalır.
/// </summary>
public sealed record ForkSnapshot
{
    public string Name { get; init; } = string.Empty;

    public string? Parent { get; init; }

    public RequestDefinition? Definition { get; init; }

    public IReadOnlyList<ExampleSnapshot>? Examples { get; init; }

    public string? Description { get; init; }

    public RequestAuth? Auth { get; init; }

    public IReadOnlyList<Variable>? Variables { get; init; }

    public ScriptSet? Scripts { get; init; }

    public static string LinkKey(Guid linkId) => $"link:{linkId}";
}
