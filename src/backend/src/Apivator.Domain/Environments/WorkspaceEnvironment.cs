using Apivator.Domain.Common;
using Apivator.Domain.Variables;

namespace Apivator.Domain.Environments;

/// <summary>Geliştirme, test, canlı gibi bir ortamın değişken seti. (System.Environment ile karışmasın diye bu ad.)</summary>
public sealed class WorkspaceEnvironment : Entity
{
    public const int NameMaxLength = 120;

    private WorkspaceEnvironment()
    {
        Name = string.Empty;
    }

    public Guid WorkspaceId { get; private set; }

    public string Name { get; private set; }

    public IReadOnlyList<Variable> Variables { get; private set; } = [];

    public int Version { get; private set; }

    public Guid CreatedById { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static WorkspaceEnvironment Create(Guid workspaceId, string name, IReadOnlyList<Variable> variables, Guid userId, DateTimeOffset now) => new()
    {
        WorkspaceId = workspaceId,
        Name = Names.Clean(name, NameMaxLength),
        Variables = variables,
        Version = 1,
        CreatedById = userId,
        CreatedAt = now,
        UpdatedAt = now,
    };

    public void Update(string name, IReadOnlyList<Variable> variables, DateTimeOffset now)
    {
        Name = Names.Clean(name, NameMaxLength);
        Variables = variables;
        Version++;
        UpdatedAt = now;
    }
}
