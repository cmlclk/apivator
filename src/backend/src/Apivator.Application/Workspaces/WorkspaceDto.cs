using Apivator.Domain.Workspaces;

namespace Apivator.Application.Workspaces;

public sealed record WorkspaceDto(
    Guid Id,
    string Name,
    WorkspaceType Type,
    WorkspaceRole Role,
    Guid OrganizationId,
    string OrganizationName);
