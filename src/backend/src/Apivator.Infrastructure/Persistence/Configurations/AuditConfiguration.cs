using Apivator.Domain.Audit;
using Apivator.Domain.Organizations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Apivator.Infrastructure.Persistence.Configurations;

internal sealed class AuditEntryConfiguration : IEntityTypeConfiguration<AuditEntry>
{
    public void Configure(EntityTypeBuilder<AuditEntry> builder)
    {
        builder.ToTable("audit_log");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Action).HasMaxLength(AuditEntry.ActionMaxLength).IsRequired();
        builder.Property(e => e.ActorName).HasMaxLength(AuditEntry.NameMaxLength).IsRequired();
        builder.Property(e => e.ActorEmail).HasMaxLength(AuditEntry.EmailMaxLength);
        builder.Property(e => e.IpAddress).HasMaxLength(AuditEntry.IpAddressMaxLength);
        builder.Property(e => e.Device).HasMaxLength(AuditEntry.DeviceMaxLength);
        builder.Property(e => e.TargetType).HasMaxLength(AuditEntry.ActionMaxLength).IsRequired();
        builder.Property(e => e.TargetName).HasMaxLength(AuditEntry.NameMaxLength).IsRequired();
        builder.Property(e => e.WorkspaceName).HasMaxLength(AuditEntry.NameMaxLength);
        builder.Property(e => e.Data).HasJsonConversion<IReadOnlyDictionary<string, string>>(() => new Dictionary<string, string>());

        // Kişi, workspace ya da takım silinse de kayıt kalır (adları kayıtta); yalnızca organizasyon silinince gider.
        builder.HasOne<Organization>().WithMany().HasForeignKey(e => e.OrganizationId).OnDelete(DeleteBehavior.Cascade);

        // Liste (en yeni önce, sayfalı) ve olay türüne göre süzme.
        builder.HasIndex(e => new { e.OrganizationId, e.CreatedAt, e.Id });
        builder.HasIndex(e => new { e.OrganizationId, e.Action });

        // Saklama süresi temizliği (AuditRetention) tüm organizasyonlarda tarihe göre siler.
        builder.HasIndex(e => e.CreatedAt);
    }
}
