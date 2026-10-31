using Apivator.Domain.Common;

namespace Apivator.Domain.Forks;

/// <summary>Kaynaktaki bir öğe ile fork'taki karşılığı ve son eşitlemedeki ortak hâlleri (taban).</summary>
public sealed class ForkLink : Entity
{
    private ForkLink()
    {
        Base = new ForkSnapshot();
    }

    public Guid ForkId { get; private set; }

    public ForkItemKind Kind { get; private set; }

    public Guid SourceItemId { get; private set; }

    public Guid ForkItemId { get; private set; }

    public ForkSnapshot Base { get; private set; }

    public static ForkLink Create(Guid forkId, ForkItemKind kind, Guid sourceItemId, Guid forkItemId, ForkSnapshot snapshot) => new()
    {
        ForkId = forkId,
        Kind = kind,
        SourceItemId = sourceItemId,
        ForkItemId = forkItemId,
        Base = snapshot,
    };

    /// <summary>Kimliği önceden verilir: yeni eklenen klasörün altındaki öğeler bu anahtara bağlanır.</summary>
    public static ForkLink Create(Guid id, Guid forkId, ForkItemKind kind, Guid sourceItemId, Guid forkItemId, ForkSnapshot snapshot)
    {
        var link = Create(forkId, kind, sourceItemId, forkItemId, snapshot);
        link.Id = id;
        return link;
    }

    public void Rebase(ForkSnapshot snapshot) => Base = snapshot;

    /// <summary>Bir tarafta silinen öğe diğer taraftan geri getirildiğinde yeni kimliğine bağlanır.</summary>
    public void Relink(Guid sourceItemId, Guid forkItemId)
    {
        SourceItemId = sourceItemId;
        ForkItemId = forkItemId;
    }
}
