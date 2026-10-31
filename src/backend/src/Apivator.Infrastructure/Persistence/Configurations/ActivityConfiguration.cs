using Apivator.Domain.Access;
using Apivator.Domain.Activity;
using Apivator.Domain.Collections;
using Apivator.Domain.Comments;
using Apivator.Domain.Docs;
using Apivator.Domain.Environments;
using Apivator.Domain.Forks;
using Apivator.Domain.Mocks;
using Apivator.Domain.Monitors;
using Apivator.Domain.Workspaces;
using Apivator.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Apivator.Infrastructure.Persistence.Configurations;

internal sealed class ChangeLogEntryConfiguration : IEntityTypeConfiguration<ChangeLogEntry>
{
    public void Configure(EntityTypeBuilder<ChangeLogEntry> builder)
    {
        builder.ToTable("change_log");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.TargetType).HasConversion<string>().HasMaxLength(20);
        builder.Property(e => e.Action).HasConversion<string>().HasMaxLength(20);
        builder.Property(e => e.TargetName).HasMaxLength(ChangeLogEntry.NameMaxLength).IsRequired();
        builder.Property(e => e.Detail).HasMaxLength(ChangeLogEntry.NameMaxLength);
        builder.Property(e => e.UserName).HasMaxLength(ChangeLogEntry.NameMaxLength).IsRequired();
        builder.Property(e => e.Snapshot).HasColumnType("jsonb");
        builder.HasOne<Workspace>().WithMany().HasForeignKey(e => e.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        // Kişi silinse de kayıt kalır (adı UserName'de).
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.SetNull);

        // Etkinlik akışı (workspace, en yeni önce) ve tek hedefin geçmişi.
        builder.HasIndex(e => new { e.WorkspaceId, e.CreatedAt });
        builder.HasIndex(e => new { e.TargetId, e.CreatedAt });
    }
}

internal sealed class CommentConfiguration : IEntityTypeConfiguration<Comment>
{
    public void Configure(EntityTypeBuilder<Comment> builder)
    {
        builder.ToTable("comments");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.TargetType).HasConversion<string>().HasMaxLength(20);
        builder.Property(c => c.Body).HasMaxLength(Comment.BodyMaxLength).IsRequired();
        builder.HasOne<Workspace>().WithMany().HasForeignKey(c => c.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(c => c.AuthorId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Comment>().WithMany().HasForeignKey(c => c.ParentId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(c => new { c.TargetId, c.CreatedAt });
        builder.HasIndex(c => c.WorkspaceId);
    }
}

internal sealed class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> builder)
    {
        builder.ToTable("notifications");
        builder.HasKey(n => n.Id);
        builder.Property(n => n.TargetType).HasConversion<string>().HasMaxLength(20);
        builder.Property(n => n.Kind).HasConversion<string>().HasMaxLength(30);
        builder.Property(n => n.TargetName).HasMaxLength(200).IsRequired();
        builder.Property(n => n.ActorName).HasMaxLength(200).IsRequired();
        builder.Property(n => n.Preview).HasMaxLength(Notification.PreviewMaxLength).IsRequired();
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(n => n.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Workspace>().WithMany().HasForeignKey(n => n.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Comment>().WithMany().HasForeignKey(n => n.CommentId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(n => new { n.UserId, n.CreatedAt });
    }
}

internal sealed class ApiKeyConfiguration : IEntityTypeConfiguration<ApiKey>
{
    public void Configure(EntityTypeBuilder<ApiKey> builder)
    {
        builder.ToTable("api_keys");
        builder.HasKey(k => k.Id);
        builder.Property(k => k.Name).HasMaxLength(ApiKey.NameMaxLength).IsRequired();
        builder.Property(k => k.Prefix).HasMaxLength(20).IsRequired();
        builder.Property(k => k.Hash).HasMaxLength(64).IsRequired();
        builder.HasIndex(k => k.Hash).IsUnique();
        builder.HasIndex(k => k.UserId);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(k => k.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class MockServerConfiguration : IEntityTypeConfiguration<MockServer>
{
    public void Configure(EntityTypeBuilder<MockServer> builder)
    {
        builder.ToTable("mock_servers");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Name).HasMaxLength(MockServer.NameMaxLength).IsRequired();
        builder.Property(m => m.Key).HasMaxLength(MockServer.KeyLength).IsRequired();
        builder.HasIndex(m => m.Key).IsUnique();
        builder.HasIndex(m => m.WorkspaceId);
        builder.HasIndex(m => m.CollectionId);
        builder.HasOne<Workspace>().WithMany().HasForeignKey(m => m.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Collection>().WithMany().HasForeignKey(m => m.CollectionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<WorkspaceEnvironment>().WithMany().HasForeignKey(m => m.EnvironmentId).OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class PublishedDocConfiguration : IEntityTypeConfiguration<PublishedDoc>
{
    public void Configure(EntityTypeBuilder<PublishedDoc> builder)
    {
        builder.ToTable("published_docs");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.Slug).HasMaxLength(PublishedDoc.SlugLength).IsRequired();
        builder.Property(d => d.Visibility).HasConversion<string>().HasMaxLength(20);
        builder.HasIndex(d => d.Slug).IsUnique();
        builder.HasIndex(d => d.CollectionId).IsUnique();
        builder.HasOne<Collection>().WithMany().HasForeignKey(d => d.CollectionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<WorkspaceEnvironment>().WithMany().HasForeignKey(d => d.EnvironmentId).OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class MockCallConfiguration : IEntityTypeConfiguration<MockCall>
{
    public void Configure(EntityTypeBuilder<MockCall> builder)
    {
        builder.ToTable("mock_calls");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Method).HasMaxLength(20).IsRequired();
        builder.Property(c => c.Path).HasMaxLength(MockCall.PathMaxLength).IsRequired();
        builder.Property(c => c.MatchedName).HasMaxLength(420);
        builder.Property(c => c.Error).HasMaxLength(500);
        builder.Property(c => c.RequestHeaders).HasJsonConversion<IReadOnlyList<KeyValueItem>>(() => []);
        builder.HasIndex(c => new { c.MockServerId, c.At });
        builder.HasOne<MockServer>().WithMany().HasForeignKey(c => c.MockServerId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class CollectionMonitorConfiguration : IEntityTypeConfiguration<CollectionMonitor>
{
    public void Configure(EntityTypeBuilder<CollectionMonitor> builder)
    {
        builder.ToTable("collection_monitors");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Name).HasMaxLength(CollectionMonitor.NameMaxLength).IsRequired();
        builder.Property(m => m.Schedule).HasMaxLength(CollectionMonitor.ScheduleMaxLength).IsRequired();
        builder.Property(m => m.TimeZone).HasMaxLength(100).IsRequired();
        builder.Property(m => m.WebhookUrl).HasMaxLength(CollectionMonitor.WebhookUrlMaxLength);
        builder.Property(m => m.WebhookKind).HasConversion<string>().HasMaxLength(20);
        builder.Property(m => m.NotifyMode).HasConversion<string>().HasMaxLength(20);
        builder.Property(m => m.Health).HasConversion<string>().HasMaxLength(20);
        builder.Property(m => m.LastError).HasMaxLength(500);
        builder.Property(m => m.NotifyEmails).HasJsonConversion<IReadOnlyList<string>>(() => []);
        builder.HasIndex(m => m.WorkspaceId);
        builder.HasIndex(m => m.CollectionId);
        // Zamanlayıcı yalnızca etkin ve zamanı gelmiş monitörleri arar.
        builder.HasIndex(m => m.NextRunAt).HasFilter("enabled");
        builder.HasOne<Workspace>().WithMany().HasForeignKey(m => m.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Collection>().WithMany().HasForeignKey(m => m.CollectionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<WorkspaceEnvironment>().WithMany().HasForeignKey(m => m.EnvironmentId).OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class CollectionForkConfiguration : IEntityTypeConfiguration<CollectionFork>
{
    public void Configure(EntityTypeBuilder<CollectionFork> builder)
    {
        builder.ToTable("collection_forks");
        builder.HasKey(f => f.Id);
        // Bir collection yalnızca bir kaynağın fork'u olabilir; collection ya da kaynağı silinince bağ da gider.
        builder.HasIndex(f => f.ForkCollectionId).IsUnique();
        builder.HasIndex(f => f.SourceCollectionId);
        builder.HasOne<Collection>().WithMany().HasForeignKey(f => f.ForkCollectionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Collection>().WithMany().HasForeignKey(f => f.SourceCollectionId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class ForkLinkConfiguration : IEntityTypeConfiguration<ForkLink>
{
    public void Configure(EntityTypeBuilder<ForkLink> builder)
    {
        builder.ToTable("fork_links");
        builder.HasKey(l => l.Id);
        builder.Property(l => l.Kind).HasConversion<string>().HasMaxLength(20);
        builder.Property(l => l.Base).HasJsonConversion<ForkSnapshot>(() => new ForkSnapshot());
        builder.HasIndex(l => l.ForkId);
        builder.HasOne<CollectionFork>().WithMany().HasForeignKey(l => l.ForkId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class MergeRequestConfiguration : IEntityTypeConfiguration<MergeRequest>
{
    public void Configure(EntityTypeBuilder<MergeRequest> builder)
    {
        builder.ToTable("merge_requests");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.Title).HasMaxLength(MergeRequest.TitleMaxLength).IsRequired();
        builder.Property(m => m.Description).HasMaxLength(MergeRequest.DescriptionMaxLength);
        builder.Property(m => m.Status).HasConversion<string>().HasMaxLength(20);
        builder.Property(m => m.Approvals).HasJsonConversion<IReadOnlyList<MergeApproval>>(() => []);
        builder.Property(m => m.MergedChanges).HasJsonConversion<IReadOnlyList<MergedChange>>(() => []);
        builder.HasIndex(m => new { m.SourceCollectionId, m.Status });
        builder.HasIndex(m => new { m.WorkspaceId, m.Status });
        builder.HasIndex(m => m.ForkCollectionId);
        // Fork bağı kaldırılırsa istek kapanır ama geçmişte kalır; kaynak collection silinirse istekler de gider.
        builder.HasOne<CollectionFork>().WithMany().HasForeignKey(m => m.ForkId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Collection>().WithMany().HasForeignKey(m => m.SourceCollectionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Workspace>().WithMany().HasForeignKey(m => m.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
    }
}
