using Apivator.Domain.Collections;
using Apivator.Domain.GitSync;
using Apivator.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Apivator.Infrastructure.Persistence.Configurations;

internal sealed class CollectionGitSyncConfiguration : IEntityTypeConfiguration<CollectionGitSync>
{
    public void Configure(EntityTypeBuilder<CollectionGitSync> builder)
    {
        builder.ToTable("collection_git_syncs");
        builder.HasKey(s => s.Id);
        builder.HasIndex(s => s.CollectionId).IsUnique();
        builder.Property(s => s.RemoteUrl).HasMaxLength(CollectionGitSync.UrlMaxLength).IsRequired();
        builder.Property(s => s.Branch).HasMaxLength(CollectionGitSync.BranchMaxLength).IsRequired();
        builder.Property(s => s.FolderPath).HasMaxLength(CollectionGitSync.PathMaxLength).IsRequired();
        builder.Property(s => s.Username).HasMaxLength(CollectionGitSync.UsernameMaxLength);
        builder.Property(s => s.ProtectedToken).HasMaxLength(8000);
        builder.Property(s => s.BaseSnapshot).HasJsonConversion<IReadOnlyDictionary<string, string>>(() => new Dictionary<string, string>());
        builder.Property(s => s.LastCommit).HasMaxLength(64);
        builder.Property(s => s.RemoteHead).HasMaxLength(64);
        builder.Property(s => s.LastError).HasMaxLength(CollectionGitSync.ErrorMaxLength);
        // Zamanlayıcı yalnızca otomatik kontrolü açık olanları arar.
        builder.HasIndex(s => s.NextCheckAt).HasFilter("check_interval_hours IS NOT NULL");
        builder.HasOne<Collection>().WithMany().HasForeignKey(s => s.CollectionId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(s => s.ConnectedById).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(s => s.LastSyncedById).OnDelete(DeleteBehavior.SetNull);
    }
}
