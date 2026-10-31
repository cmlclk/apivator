using Apivator.Domain.Variables;

namespace Apivator.Application.Environments;

public sealed record EnvironmentDto(
    Guid Id,
    Guid WorkspaceId,
    string Name,
    IReadOnlyList<Variable> Variables,
    int Version,
    DateTimeOffset UpdatedAt);

public sealed record CreateEnvironmentRequest(string Name, IReadOnlyList<Variable>? Variables = null);

/// <summary><paramref name="Version"/> son okunan sürüm; arada başkası kaydettiyse 409 döner.</summary>
public sealed record UpdateEnvironmentRequest(string Name, IReadOnlyList<Variable> Variables, int Version);

public sealed record GlobalsDto(Guid WorkspaceId, IReadOnlyList<Variable> Variables);

public sealed record UpdateGlobalsRequest(IReadOnlyList<Variable> Variables);
