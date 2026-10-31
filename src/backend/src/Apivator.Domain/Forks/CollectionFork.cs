using Apivator.Domain.Common;

namespace Apivator.Domain.Forks;

/// <summary>
/// Bir collection'ın fork'u: fork collection'ı ile kaynağı arasındaki bağ. Öğeler <see cref="ForkLink"/> ile
/// eşleşir; her bağlantı son eşitlemedeki ortak hâli (taban) saklar, böylece hangi tarafın neyi değiştirdiği
/// (ve çakışmalar) üç yönlü karşılaştırmayla bulunur.
/// </summary>
public sealed class CollectionFork : Entity
{
    private CollectionFork()
    {
    }

    public Guid ForkCollectionId { get; private set; }

    public Guid SourceCollectionId { get; private set; }

    public Guid CreatedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>Kaynaktaki değişikliklerin fork'a en son çekildiği an.</summary>
    public DateTimeOffset? LastPulledAt { get; private set; }

    public static CollectionFork Create(Guid forkCollectionId, Guid sourceCollectionId, Guid userId, DateTimeOffset now) => new()
    {
        ForkCollectionId = forkCollectionId,
        SourceCollectionId = sourceCollectionId,
        CreatedById = userId,
        CreatedAt = now,
    };

    public void MarkPulled(DateTimeOffset now) => LastPulledAt = now;
}
