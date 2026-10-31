using Apivator.Application.Account;
using Apivator.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Apivator.Infrastructure.Persistence.Configurations;

internal sealed class ApplicationUserConfiguration : IEntityTypeConfiguration<ApplicationUser>
{
    public void Configure(EntityTypeBuilder<ApplicationUser> builder)
    {
        builder.Property(u => u.DisplayName).HasMaxLength(80).IsRequired();
        builder.Property(u => u.PendingEmail).HasMaxLength(256);
        builder.Property(u => u.Preferences).HasJsonConversion(() => new UserPreferences()).HasDefaultValueSql("'{}'::jsonb");
        builder.Property(u => u.AuthenticatorKey).HasMaxLength(1000);
        builder.Property(u => u.RecoveryCodeHashes).HasJsonConversion<List<string>>(() => []).HasDefaultValueSql("'[]'::jsonb");
    }
}

internal sealed class SecurityEventConfiguration : IEntityTypeConfiguration<SecurityEvent>
{
    public void Configure(EntityTypeBuilder<SecurityEvent> builder)
    {
        builder.ToTable("security_events");
        builder.HasKey(e => e.Id);
        builder.Property(e => e.Kind).HasConversion<string>().HasMaxLength(40);
        builder.Property(e => e.Device).HasMaxLength(SecurityEvent.DeviceMaxLength);
        builder.Property(e => e.IpAddress).HasMaxLength(RefreshToken.IpAddressMaxLength);
        builder.Property(e => e.ActorName).HasMaxLength(200);
        builder.Property(e => e.Detail).HasMaxLength(SecurityEvent.DetailMaxLength);
        builder.HasIndex(e => new { e.UserId, e.CreatedAt });
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(e => e.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> builder)
    {
        builder.HasKey(t => t.Id);
        builder.Property(t => t.TokenHash).HasMaxLength(64).IsRequired();
        builder.Property(t => t.UserAgent).HasMaxLength(RefreshToken.UserAgentMaxLength);
        builder.Property(t => t.IpAddress).HasMaxLength(RefreshToken.IpAddressMaxLength);
        builder.Property(t => t.App).HasMaxLength(RefreshToken.AppMaxLength);
        builder.HasIndex(t => t.TokenHash).IsUnique();
        builder.HasIndex(t => t.UserId);
        builder.HasIndex(t => t.SessionId);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class UserAvatarConfiguration : IEntityTypeConfiguration<UserAvatar>
{
    public void Configure(EntityTypeBuilder<UserAvatar> builder)
    {
        builder.ToTable("user_avatars");
        builder.HasKey(a => a.UserId);
        builder.Property(a => a.ContentType).HasMaxLength(40).IsRequired();
        builder.HasOne<ApplicationUser>().WithOne().HasForeignKey<UserAvatar>(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
