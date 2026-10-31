using System.Text.Json;
using Apivator.Domain.Collections;
using Apivator.Domain.Environments;
using Apivator.Domain.History;
using Apivator.Domain.Monitors;
using Apivator.Domain.Runs;
using Apivator.Domain.Variables;
using Apivator.Domain.Workspaces;
using Apivator.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Apivator.Infrastructure.Persistence.Configurations;

internal static class JsonColumn
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    /// <summary>Bir record'u jsonb kolonunda saklar; değişiklik takibi içeriğe göre yapılır.</summary>
    public static PropertyBuilder<T> HasJsonConversion<T>(this PropertyBuilder<T> property, Func<T> fallback)
        where T : class => property
        .HasColumnType("jsonb")
        .HasConversion(
            v => JsonSerializer.Serialize(v, Options),
            s => JsonSerializer.Deserialize<T>(s, Options) ?? fallback(),
            new ValueComparer<T>(
                (a, b) => JsonSerializer.Serialize(a, Options) == JsonSerializer.Serialize(b, Options),
                v => JsonSerializer.Serialize(v, Options).GetHashCode(StringComparison.Ordinal),
                v => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(v, Options), Options)!));
}

internal sealed class CollectionConfiguration : IEntityTypeConfiguration<Collection>
{
    public void Configure(EntityTypeBuilder<Collection> builder)
    {
        builder.HasKey(c => c.Id);
        builder.Property(c => c.Auth).HasJsonConversion(() => RequestAuth.None);
        builder.Property(c => c.Variables).HasJsonConversion<IReadOnlyList<Variable>>(() => []);
        builder.Property(c => c.Scripts).HasJsonConversion(() => ScriptSet.Empty);
        builder.Property(c => c.Name).HasMaxLength(Collection.NameMaxLength).IsRequired();
        builder.HasOne<Workspace>().WithMany().HasForeignKey(c => c.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(c => c.CreatedById).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class CollectionAccessEntryConfiguration : IEntityTypeConfiguration<CollectionAccessEntry>
{
    public void Configure(EntityTypeBuilder<CollectionAccessEntry> builder)
    {
        builder.ToTable("collection_access");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Role).HasConversion<string>().HasMaxLength(20);
        builder.HasOne<Collection>().WithMany().HasForeignKey(e => e.CollectionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Apivator.Domain.Organizations.Team>().WithMany().HasForeignKey(e => e.TeamId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(e => e.CreatedById).OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(e => new { e.CollectionId, e.UserId }).IsUnique().HasFilter("user_id IS NOT NULL");
        builder.HasIndex(e => new { e.CollectionId, e.TeamId }).IsUnique().HasFilter("team_id IS NOT NULL");
        builder.HasIndex(e => e.UserId);
        builder.HasIndex(e => e.TeamId);
        builder.ToTable(t => t.HasCheckConstraint("ck_collection_access_subject", "(user_id IS NULL) <> (team_id IS NULL)"));
    }
}

internal sealed class CollectionSourceConfiguration : IEntityTypeConfiguration<CollectionSource>
{
    public void Configure(EntityTypeBuilder<CollectionSource> builder)
    {
        builder.ToTable("collection_sources");
        builder.HasKey(s => s.Id);
        builder.HasIndex(s => s.CollectionId).IsUnique();
        builder.Property(s => s.Url).HasMaxLength(CollectionSource.UrlMaxLength).IsRequired();
        builder.Property(s => s.Document).IsRequired();
        builder.Property(s => s.DocumentHash).HasMaxLength(64).IsRequired();
        builder.Property(s => s.PendingHash).HasMaxLength(64);
        builder.Property(s => s.NotifiedHash).HasMaxLength(64);
        builder.Property(s => s.DocumentVersion).HasMaxLength(100);
        builder.Property(s => s.LastCheckError).HasMaxLength(CollectionSource.ErrorMaxLength);
        // Zamanlayıcı yalnızca otomatik kontrolü açık olanları arar.
        builder.HasIndex(s => s.NextCheckAt).HasFilter("check_interval_hours IS NOT NULL");
        builder.HasOne<Collection>().WithMany().HasForeignKey(s => s.CollectionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(s => s.UpdatedById).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(s => s.CheckOwnerId).OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class FolderConfiguration : IEntityTypeConfiguration<Folder>
{
    public void Configure(EntityTypeBuilder<Folder> builder)
    {
        builder.HasKey(f => f.Id);
        builder.Property(f => f.Name).HasMaxLength(Folder.NameMaxLength).IsRequired();
        builder.Property(f => f.Description);
        builder.Property(f => f.Auth).HasJsonConversion(() => RequestAuth.Inherit);
        builder.Property(f => f.Scripts).HasJsonConversion(() => ScriptSet.Empty);
        builder.HasOne<Collection>().WithMany().HasForeignKey(f => f.CollectionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Folder>().WithMany().HasForeignKey(f => f.ParentFolderId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class ApiRequestConfiguration : IEntityTypeConfiguration<ApiRequest>
{
    public void Configure(EntityTypeBuilder<ApiRequest> builder)
    {
        builder.ToTable("requests");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Name).HasMaxLength(ApiRequest.NameMaxLength).IsRequired();
        builder.Property(r => r.Method).HasMaxLength(20).IsRequired();
        builder.Property(r => r.SourceKey).HasMaxLength(ApiRequest.SourceKeyMaxLength);
        builder.Property(r => r.Kind).HasConversion<string>().HasMaxLength(12);
        builder.Property(r => r.Version).IsConcurrencyToken();

        // İstek tanımı tek bir jsonb kolonunda; yeni alanlar (auth, script) migration gerektirmez.
        builder.Property(r => r.Definition).HasJsonConversion(() => RequestDefinition.Default);

        builder.HasOne<Collection>().WithMany().HasForeignKey(r => r.CollectionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Folder>().WithMany().HasForeignKey(r => r.FolderId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(r => r.UpdatedById).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class WorkspaceEnvironmentConfiguration : IEntityTypeConfiguration<WorkspaceEnvironment>
{
    public void Configure(EntityTypeBuilder<WorkspaceEnvironment> builder)
    {
        builder.ToTable("environments");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Name).HasMaxLength(WorkspaceEnvironment.NameMaxLength).IsRequired();
        builder.Property(e => e.Variables).HasJsonConversion<IReadOnlyList<Variable>>(() => []);
        builder.Property(e => e.Version).IsConcurrencyToken();
        builder.HasOne<Workspace>().WithMany().HasForeignKey(e => e.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(e => e.CreatedById).OnDelete(DeleteBehavior.Restrict);
    }
}

internal sealed class HistoryEntryConfiguration : IEntityTypeConfiguration<HistoryEntry>
{
    public void Configure(EntityTypeBuilder<HistoryEntry> builder)
    {
        builder.ToTable("request_history");
        builder.HasKey(h => h.Id);
        builder.Property(h => h.Method).HasMaxLength(20).IsRequired();
        builder.Property(h => h.Url).HasMaxLength(HistoryEntry.UrlMaxLength).IsRequired();
        builder.Property(h => h.Definition).HasJsonConversion(() => RequestDefinition.Default);
        builder.HasIndex(h => new { h.UserId, h.WorkspaceId, h.ExecutedAt });
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(h => h.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Workspace>().WithMany().HasForeignKey(h => h.WorkspaceId).OnDelete(DeleteBehavior.Cascade);

        // İstek silinirse geçmiş kalır, yalnızca bağlantı kopar.
        builder.HasOne<ApiRequest>().WithMany().HasForeignKey(h => h.RequestId).OnDelete(DeleteBehavior.SetNull);
    }
}

internal sealed class HistoryResponseConfiguration : IEntityTypeConfiguration<HistoryResponse>
{
    public void Configure(EntityTypeBuilder<HistoryResponse> builder)
    {
        builder.ToTable("request_history_responses");
        builder.HasKey(r => r.HistoryEntryId);
        builder.Property(r => r.Body).IsRequired();
        builder.Property(r => r.ContentType).HasMaxLength(HistoryResponse.ContentTypeMaxLength);
        builder.HasOne<HistoryEntry>().WithOne().HasForeignKey<HistoryResponse>(r => r.HistoryEntryId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class ResponseExampleConfiguration : IEntityTypeConfiguration<ResponseExample>
{
    public void Configure(EntityTypeBuilder<ResponseExample> builder)
    {
        builder.ToTable("response_examples");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Name).HasMaxLength(ResponseExample.NameMaxLength).IsRequired();
        builder.Property(e => e.Body).IsRequired();
        builder.Property(e => e.Headers).HasJsonConversion<IReadOnlyList<KeyValueItem>>(() => []);
        builder.Property(e => e.Request).HasJsonConversion(() => RequestDefinition.Default);
        builder.HasIndex(e => e.RequestId);
        builder.HasOne<ApiRequest>().WithMany().HasForeignKey(e => e.RequestId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class CollectionRunConfiguration : IEntityTypeConfiguration<CollectionRun>
{
    public void Configure(EntityTypeBuilder<CollectionRun> builder)
    {
        builder.ToTable("collection_runs");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Name).HasMaxLength(250).IsRequired();
        builder.Property(r => r.EnvironmentName).HasMaxLength(120);
        builder.Property(r => r.Status).HasConversion<string>().HasMaxLength(20);
        builder.Property(r => r.Origin).HasConversion<string>().HasMaxLength(20);
        builder.Property(r => r.Results).HasJsonConversion<IReadOnlyList<RunResultEntry>>(() => []);
        builder.HasIndex(r => new { r.WorkspaceId, r.StartedAt });
        builder.HasIndex(r => new { r.CollectionId, r.StartedAt });
        builder.HasIndex(r => new { r.MonitorId, r.StartedAt });
        builder.HasOne<CollectionMonitor>().WithMany().HasForeignKey(r => r.MonitorId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<Collection>().WithMany().HasForeignKey(r => r.CollectionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Workspace>().WithMany().HasForeignKey(r => r.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
