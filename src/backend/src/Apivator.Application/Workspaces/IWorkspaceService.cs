using Apivator.Application.Common;
using Apivator.Application.Teams;
using Apivator.Domain.Workspaces;

namespace Apivator.Application.Workspaces;

public sealed record CreateWorkspaceRequest(string Name);

public sealed record SetRoleRequest(WorkspaceRole Role);

public sealed record WorkspaceUserDto(Guid UserId, string DisplayName, string Email, WorkspaceRole Role);

public sealed record WorkspaceTeamDto(Guid TeamId, string Name, WorkspaceRole Role, int MemberCount);

/// <summary>
/// Workspace'in üyeleri: doğrudan eklenen kullanıcılar, takımlar ve (takım workspace'lerinde) organizasyon
/// yöneticileri — onlar her takım workspace'inde Admin sayılır.
/// </summary>
public sealed record WorkspaceMembersDto(
    IReadOnlyList<WorkspaceUserDto> Users,
    IReadOnlyList<WorkspaceTeamDto> Teams,
    IReadOnlyList<WorkspaceUserDto> OrganizationAdmins);

public interface IWorkspaceService
{
    Task<IReadOnlyList<WorkspaceDto>> ListForUserAsync(Guid userId, CancellationToken cancellationToken = default);

    Task<Result<WorkspaceDto>> CreateAsync(Guid organizationId, CreateWorkspaceRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> RenameAsync(Guid workspaceId, RenameRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> DeleteAsync(Guid workspaceId, Guid userId, CancellationToken ct = default);

    Task<Result<WorkspaceMembersDto>> MembersAsync(Guid workspaceId, Guid userId, CancellationToken ct = default);

    Task<Result> SetUserRoleAsync(Guid workspaceId, Guid memberId, SetRoleRequest request, Guid userId, CancellationToken ct = default);

    /// <summary>Admin başkasını çıkarabilir; herkes kendisi ayrılabilir.</summary>
    Task<Result> RemoveUserAsync(Guid workspaceId, Guid memberId, Guid userId, CancellationToken ct = default);

    Task<Result> SetTeamRoleAsync(Guid workspaceId, Guid teamId, SetRoleRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> RemoveTeamAsync(Guid workspaceId, Guid teamId, Guid userId, CancellationToken ct = default);
}
