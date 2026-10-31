using Apivator.Application.Common;

namespace Apivator.Application.Environments;

public interface IEnvironmentService
{
    Task<Result<IReadOnlyList<EnvironmentDto>>> ListAsync(Guid workspaceId, Guid userId, CancellationToken ct = default);

    Task<Result<EnvironmentDto>> CreateAsync(Guid workspaceId, CreateEnvironmentRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<EnvironmentDto>> UpdateAsync(Guid environmentId, UpdateEnvironmentRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> DeleteAsync(Guid environmentId, Guid userId, CancellationToken ct = default);

    Task<Result<GlobalsDto>> GetGlobalsAsync(Guid workspaceId, Guid userId, CancellationToken ct = default);

    Task<Result<GlobalsDto>> UpdateGlobalsAsync(Guid workspaceId, UpdateGlobalsRequest request, Guid userId, CancellationToken ct = default);
}
