using Apivator.Application.Abstractions;
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
using Apivator.Infrastructure.Identity;
using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Infrastructure.Persistence;

/// <summary>Uygulamanın veritabanı bağlamı (PostgreSQL). SQLite için <see cref="SqliteAppDbContext"/> kullanılır.</summary>
public class AppDbContext : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>, IApplicationDbContext, IDataProtectionKeyContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options)
        : base(options)
    {
    }

    /// <summary>Sağlayıcıya özgü alt sınıflar (ayrı migration seti) için.</summary>
    protected AppDbContext(DbContextOptions options)
        : base(options)
    {
    }

    public DbSet<Organization> Organizations => Set<Organization>();

    public DbSet<OrganizationMember> OrganizationMembers => Set<OrganizationMember>();

    public DbSet<Workspace> Workspaces => Set<Workspace>();

    public DbSet<WorkspaceMember> WorkspaceMembers => Set<WorkspaceMember>();

    public DbSet<WorkspaceTeam> WorkspaceTeams => Set<WorkspaceTeam>();

    public DbSet<Team> Teams => Set<Team>();

    public DbSet<TeamMember> TeamMembers => Set<TeamMember>();

    public DbSet<Invitation> Invitations => Set<Invitation>();

    public DbSet<Collection> Collections => Set<Collection>();

    public DbSet<CollectionAccessEntry> CollectionAccess => Set<CollectionAccessEntry>();

    public DbSet<CollectionSource> CollectionSources => Set<CollectionSource>();

    public DbSet<Folder> Folders => Set<Folder>();

    public DbSet<ApiRequest> Requests => Set<ApiRequest>();

    public DbSet<WorkspaceEnvironment> Environments => Set<WorkspaceEnvironment>();

    public DbSet<HistoryEntry> History => Set<HistoryEntry>();

    public DbSet<HistoryResponse> HistoryResponses => Set<HistoryResponse>();

    public DbSet<ResponseExample> Examples => Set<ResponseExample>();

    public DbSet<CollectionRun> Runs => Set<CollectionRun>();

    public DbSet<ChangeLogEntry> ChangeLog => Set<ChangeLogEntry>();

    public DbSet<Comment> Comments => Set<Comment>();

    public DbSet<Notification> Notifications => Set<Notification>();

    public DbSet<ApiKey> ApiKeys => Set<ApiKey>();

    public DbSet<MockServer> MockServers => Set<MockServer>();

    public DbSet<Domain.Docs.PublishedDoc> PublishedDocs => Set<Domain.Docs.PublishedDoc>();

    public DbSet<MockCall> MockCalls => Set<MockCall>();

    public DbSet<CollectionMonitor> Monitors => Set<CollectionMonitor>();

    public DbSet<CollectionFork> Forks => Set<CollectionFork>();

    public DbSet<ForkLink> ForkLinks => Set<ForkLink>();

    public DbSet<Domain.GitSync.CollectionGitSync> GitSyncs => Set<Domain.GitSync.CollectionGitSync>();

    public DbSet<MergeRequest> MergeRequests => Set<MergeRequest>();

    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();

    public DbSet<OrganizationSso> OrganizationSso => Set<OrganizationSso>();

    public DbSet<SsoDomain> SsoDomains => Set<SsoDomain>();

    public DbSet<Sso.SsoLoginTicket> SsoLoginTickets => Set<Sso.SsoLoginTicket>();

    public DbSet<Sso.SsoLoginCode> SsoLoginCodes => Set<Sso.SsoLoginCode>();

    public DbSet<Sso.SsoLinkRequest> SsoLinkRequests => Set<Sso.SsoLinkRequest>();

    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();

    public DbSet<UserAvatar> UserAvatars => Set<UserAvatar>();

    public DbSet<SecurityEvent> SecurityEvents => Set<SecurityEvent>();

    public IQueryable<UserTwoFactorRow> UserTwoFactor => Users.AsNoTracking().Select(u => new UserTwoFactorRow { UserId = u.Id, Enabled = u.TwoFactorEnabled, Email = u.Email });

    IQueryable<UserLoginRow> IApplicationDbContext.UserLogins =>
        UserLogins.AsNoTracking().Select(l => new UserLoginRow { UserId = l.UserId, LoginProvider = l.LoginProvider });

    public DbSet<DataProtectionKey> DataProtectionKeys => Set<DataProtectionKey>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);
        builder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
        builder.ApplySnakeCaseNames();
    }
}
