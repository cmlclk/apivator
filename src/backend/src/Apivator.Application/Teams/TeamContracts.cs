using System.Text.Json.Serialization;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;

namespace Apivator.Application.Teams;

public sealed record OrganizationDto(Guid Id, string Name, bool IsPersonal, OrganizationRole Role, int MemberCount, bool RequireTwoFactor = false, string DefaultLanguage = "tr");

public sealed record CreateOrganizationRequest(string Name);

public sealed record RenameRequest(string Name);

/// <summary>Organizasyonun varsayılan dili ("tr", "en"); yalnızca yöneticiler değiştirir.</summary>
public sealed record SetOrganizationLanguageRequest(string Language);

/// <param name="TwoFactorEnabled">Yalnızca yöneticilere gösterilir; diğerlerine null.</param>
public sealed record OrganizationMemberDto(Guid UserId, string DisplayName, string Email, OrganizationRole Role, DateTimeOffset JoinedAt, bool? TwoFactorEnabled = null);

[JsonConverter(typeof(JsonStringEnumConverter<InvitationStatus>))]
public enum InvitationStatus
{
    Pending,
    Expired,
    Accepted,
    Revoked,
}

public sealed record InvitationDto(
    Guid Id,
    string Email,
    OrganizationRole Role,
    Guid? WorkspaceId,
    string? WorkspaceName,
    WorkspaceRole? WorkspaceRole,
    string InvitedByName,
    DateTimeOffset CreatedAt,
    DateTimeOffset ExpiresAt,
    InvitationStatus Status);

/// <summary>Üyeler herkes tarafından görülür; bekleyen davetler yalnızca yöneticilere döner.</summary>
public sealed record OrganizationMembersDto(IReadOnlyList<OrganizationMemberDto> Members, IReadOnlyList<InvitationDto> Invitations);

public sealed record InviteRequest(string Email, OrganizationRole Role = OrganizationRole.Member, Guid? WorkspaceId = null, WorkspaceRole? WorkspaceRole = null, string? Language = null);

/// <summary>Owner verilirse sahiplik devredilir (yalnızca sahip yapabilir).</summary>
public sealed record ChangeOrganizationRoleRequest(OrganizationRole Role);

/// <summary>Bağlantıyı açan herkes görebilir (oturum gerekmez); kabul için oturum gerekir.</summary>
public sealed record InvitationPreviewDto(string OrganizationName, string InvitedByName, string Email, string? WorkspaceName, InvitationStatus Status, bool AccountExists);

public sealed record MyInvitationDto(Guid Id, Guid OrganizationId, string OrganizationName, string InvitedByName, string? WorkspaceName, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt);

public sealed record AcceptInvitationRequest(string Token);

public sealed record AcceptedInvitationDto(Guid OrganizationId, Guid? WorkspaceId);

public sealed record TeamMemberDto(Guid UserId, string DisplayName, string Email);

public sealed record TeamDto(Guid Id, string Name, IReadOnlyList<TeamMemberDto> Members);

public sealed record CreateTeamRequest(string Name);

public sealed record AddTeamMemberRequest(Guid UserId);
