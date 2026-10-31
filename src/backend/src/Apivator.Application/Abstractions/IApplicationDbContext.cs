using Apivator.Domain.Access;
using Apivator.Domain.Activity;
using Apivator.Domain.Audit;
using Apivator.Domain.Collections;
using Apivator.Domain.Comments;
using Apivator.Domain.Environments;
using Apivator.Domain.Forks;
using Apivator.Domain.History;
using Apivator.Domain.Mocks;
using Apivator.Domain.Monitors;
using Apivator.Domain.Organizations;
using Apivator.Domain.Runs;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Abstractions;

/// <summary>Kullanıcının iki adımlı doğrulama durumu (kimlik tablosundan salt okunur görünüm).</summary>
public sealed class UserTwoFactorRow
{
    public Guid UserId { get; init; }

    public bool Enabled { get; init; }

    /// <summary>SSO ile ikinci adımın kimlik sağlayıcıya bırakılıp bırakılmadığını anlamak için (alan adı).</summary>
    public string? Email { get; init; }
}

/// <summary>Kullanıcının dış kimlik bağlantısı (SSO); kimlik tablosundan salt okunur görünüm.</summary>
public sealed class UserLoginRow
{
    public Guid UserId { get; init; }

    public string LoginProvider { get; init; } = string.Empty;
}

public interface IApplicationDbContext
{
    /// <summary>SSO bağlantıları (2FA'nın kimlik sağlayıcıya bırakılması için).</summary>
    IQueryable<UserLoginRow> UserLogins { get; }

    /// <summary>Organizasyonların 2FA zorunluluğu için; sorgularda birleştirilebilir.</summary>
    IQueryable<UserTwoFactorRow> UserTwoFactor { get; }

    DbSet<Organization> Organizations { get; }

    DbSet<OrganizationMember> OrganizationMembers { get; }

    DbSet<Workspace> Workspaces { get; }

    DbSet<WorkspaceMember> WorkspaceMembers { get; }

    DbSet<WorkspaceTeam> WorkspaceTeams { get; }

    DbSet<Team> Teams { get; }

    DbSet<TeamMember> TeamMembers { get; }

    DbSet<Invitation> Invitations { get; }

    DbSet<Collection> Collections { get; }

    DbSet<CollectionAccessEntry> CollectionAccess { get; }

    DbSet<CollectionSource> CollectionSources { get; }

    DbSet<Folder> Folders { get; }

    DbSet<ApiRequest> Requests { get; }

    DbSet<WorkspaceEnvironment> Environments { get; }

    DbSet<HistoryEntry> History { get; }

    DbSet<HistoryResponse> HistoryResponses { get; }

    DbSet<ResponseExample> Examples { get; }

    DbSet<CollectionRun> Runs { get; }

    DbSet<ChangeLogEntry> ChangeLog { get; }

    DbSet<Comment> Comments { get; }

    DbSet<Notification> Notifications { get; }

    DbSet<ApiKey> ApiKeys { get; }

    DbSet<MockServer> MockServers { get; }

    DbSet<Domain.Docs.PublishedDoc> PublishedDocs { get; }

    DbSet<MockCall> MockCalls { get; }

    DbSet<CollectionMonitor> Monitors { get; }

    DbSet<CollectionFork> Forks { get; }

    DbSet<ForkLink> ForkLinks { get; }

    DbSet<Domain.GitSync.CollectionGitSync> GitSyncs { get; }

    DbSet<MergeRequest> MergeRequests { get; }

    DbSet<AuditEntry> AuditEntries { get; }

    DbSet<OrganizationSso> OrganizationSso { get; }

    DbSet<SsoDomain> SsoDomains { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
