namespace Apivator.Domain.Audit;

/// <summary>
/// Denetim kaydındaki olay kodları. Dışa aktarılan dosyalarda ve SIEM entegrasyonlarında anahtar olarak kullanılır;
/// bu yüzden değiştirilmez, yalnızca yenisi eklenir. Arayüzdeki Türkçe karşılıklar istemcidedir.
/// </summary>
public static class AuditActions
{
    public const string OrganizationCreated = "organization.created";
    public const string OrganizationRenamed = "organization.renamed";
    public const string OrganizationOwnershipTransferred = "organization.ownership_transferred";
    public const string OrganizationTwoFactorRequired = "organization.two_factor_required";
    public const string OrganizationTwoFactorOptional = "organization.two_factor_optional";

    public const string MemberAdded = "member.added";
    public const string MemberRoleChanged = "member.role_changed";
    public const string MemberRemoved = "member.removed";
    public const string MemberLeft = "member.left";
    public const string MemberAccountDeleted = "member.account_deleted";
    public const string MemberSessionsRevoked = "member.sessions_revoked";
    public const string MemberPasswordResetSent = "member.password_reset_sent";

    public const string InvitationSent = "invitation.sent";
    public const string InvitationRevoked = "invitation.revoked";
    public const string InvitationAccepted = "invitation.accepted";

    public const string TeamCreated = "team.created";
    public const string TeamRenamed = "team.renamed";
    public const string TeamDeleted = "team.deleted";
    public const string TeamMemberAdded = "team.member_added";
    public const string TeamMemberRemoved = "team.member_removed";

    public const string WorkspaceCreated = "workspace.created";
    public const string WorkspaceRenamed = "workspace.renamed";
    public const string WorkspaceDeleted = "workspace.deleted";
    public const string WorkspaceMemberAdded = "workspace.member_added";
    public const string WorkspaceMemberRoleChanged = "workspace.member_role_changed";
    public const string WorkspaceMemberRemoved = "workspace.member_removed";
    public const string WorkspaceTeamAdded = "workspace.team_added";
    public const string WorkspaceTeamRoleChanged = "workspace.team_role_changed";
    public const string WorkspaceTeamRemoved = "workspace.team_removed";

    public const string CollectionDeleted = "collection.deleted";
    public const string CollectionMovedIn = "collection.moved_in";
    public const string CollectionMovedOut = "collection.moved_out";
    public const string CollectionEditingRestricted = "collection.editing_restricted";
    public const string CollectionEditingUnrestricted = "collection.editing_unrestricted";
    public const string CollectionAccessGranted = "collection.access_granted";
    public const string CollectionAccessChanged = "collection.access_changed";
    public const string CollectionAccessRemoved = "collection.access_removed";

    public const string MockCreated = "mock.created";
    public const string MockDeleted = "mock.deleted";
    public const string MockVisibilityChanged = "mock.visibility_changed";
    public const string MockKeyRegenerated = "mock.key_regenerated";

    public const string DocsPublished = "docs.published";
    public const string DocsVisibilityChanged = "docs.visibility_changed";
    public const string DocsLinkRegenerated = "docs.link_regenerated";
    public const string DocsUnpublished = "docs.unpublished";

    public const string GitConnected = "git.connected";
    public const string GitDisconnected = "git.disconnected";
    public const string GitPushed = "git.pushed";
    public const string GitPulled = "git.pulled";

    public const string MonitorCreated = "monitor.created";
    public const string MonitorDeleted = "monitor.deleted";

    public const string ApiKeyCreated = "api_key.created";
    public const string ApiKeyRevoked = "api_key.revoked";

    public const string AuditExported = "audit.exported";

    public const string SsoConfigured = "sso.configured";
    public const string SsoEnabled = "sso.enabled";
    public const string SsoDisabled = "sso.disabled";
    public const string SsoEnforced = "sso.enforced";
    public const string SsoUnenforced = "sso.unenforced";
    public const string SsoDomainAdded = "sso.domain_added";
    public const string SsoDomainVerified = "sso.domain_verified";
    public const string SsoDomainRemoved = "sso.domain_removed";
    public const string SsoDomainUnverified = "sso.domain_unverified";
    public const string SsoLogin = "sso.login";
    public const string SsoLoginFailed = "sso.login_failed";
    public const string SsoAccountLinked = "sso.account_linked";
    public const string SsoLinkRequested = "sso.link_requested";
    public const string SsoUnverifiedAccountRetired = "sso.unverified_account_retired";
    public const string SsoUserProvisioned = "sso.user_provisioned";
}
