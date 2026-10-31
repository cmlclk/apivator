using Apivator.Domain.Organizations;
using Apivator.Infrastructure.Sso;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Apivator.Infrastructure.Persistence.Configurations;

internal sealed class OrganizationSsoConfiguration : IEntityTypeConfiguration<OrganizationSso>
{
    public void Configure(EntityTypeBuilder<OrganizationSso> builder)
    {
        builder.ToTable("organization_sso");
        builder.HasKey(s => s.Id);
        builder.HasIndex(s => s.OrganizationId).IsUnique();
        builder.Property(s => s.Authority).HasMaxLength(OrganizationSso.AuthorityMaxLength).IsRequired();
        builder.Property(s => s.ClientId).HasMaxLength(OrganizationSso.ClientIdMaxLength).IsRequired();
        builder.Property(s => s.ProtectedClientSecret).HasMaxLength(4000);
        builder.Property(s => s.DefaultRole).HasConversion<string>().HasMaxLength(20);
        builder.HasOne<Organization>().WithMany().HasForeignKey(s => s.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(s => s.Domains).WithOne().HasForeignKey(d => d.SsoId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(s => s.Domains).HasField("_domains").UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}

internal sealed class SsoDomainConfiguration : IEntityTypeConfiguration<SsoDomain>
{
    public void Configure(EntityTypeBuilder<SsoDomain> builder)
    {
        builder.ToTable("sso_domains");
        builder.HasKey(d => d.Id);
        builder.Property(d => d.Domain).HasMaxLength(SsoDomain.DomainMaxLength).IsRequired();
        builder.Property(d => d.VerificationToken).HasMaxLength(64).IsRequired();
        builder.Ignore(d => d.RecordValue);

        // Bir alan adını yalnızca bir organizasyon doğrulayabilir; doğrulanmamış eklemeler sahiplenme sayılmaz
        // (yoksa biri gerçek sahibinden önce ekleyip alan adını kilitleyebilirdi).
        builder.HasIndex(d => d.Domain).IsUnique().HasFilter("verified_at IS NOT NULL").HasDatabaseName("ux_sso_domains_verified_domain");
        builder.HasIndex(d => new { d.SsoId, d.Domain }).IsUnique();
    }
}

internal sealed class SsoLoginTicketConfiguration : IEntityTypeConfiguration<SsoLoginTicket>
{
    public void Configure(EntityTypeBuilder<SsoLoginTicket> builder)
    {
        builder.ToTable("sso_login_tickets");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.StateHash).HasMaxLength(64).IsRequired();
        builder.HasIndex(t => t.StateHash).IsUnique();
        builder.Property(t => t.ProtectedCodeVerifier).HasMaxLength(1000).IsRequired();
        builder.Property(t => t.Nonce).HasMaxLength(100).IsRequired();
        builder.Property(t => t.ClientChallenge).HasMaxLength(64).IsRequired();
        builder.Property(t => t.ReturnUrl).HasMaxLength(500);
        builder.Property(t => t.ClientState).HasMaxLength(200);
        builder.HasIndex(t => t.ExpiresAt);
        builder.HasOne<Organization>().WithMany().HasForeignKey(t => t.OrganizationId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class SsoLoginCodeConfiguration : IEntityTypeConfiguration<SsoLoginCode>
{
    public void Configure(EntityTypeBuilder<SsoLoginCode> builder)
    {
        builder.ToTable("sso_login_codes");
        builder.HasKey(c => c.Id);
        builder.Property(c => c.CodeHash).HasMaxLength(64).IsRequired();
        builder.HasIndex(c => c.CodeHash).IsUnique();
        builder.Property(c => c.ClientChallenge).HasMaxLength(64).IsRequired();
        builder.HasIndex(c => c.ExpiresAt);
        builder.HasOne<Identity.ApplicationUser>().WithMany().HasForeignKey(c => c.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}

internal sealed class SsoLinkRequestConfiguration : IEntityTypeConfiguration<SsoLinkRequest>
{
    public void Configure(EntityTypeBuilder<SsoLinkRequest> builder)
    {
        builder.ToTable("sso_link_requests");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.TokenHash).HasMaxLength(64).IsRequired();
        builder.HasIndex(r => r.TokenHash).IsUnique();
        builder.Property(r => r.LoginProvider).HasMaxLength(128).IsRequired();
        builder.Property(r => r.Subject).HasMaxLength(256).IsRequired();
        builder.HasIndex(r => r.ExpiresAt);
        builder.HasOne<Identity.ApplicationUser>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Organization>().WithMany().HasForeignKey(r => r.OrganizationId).OnDelete(DeleteBehavior.Cascade);
    }
}
