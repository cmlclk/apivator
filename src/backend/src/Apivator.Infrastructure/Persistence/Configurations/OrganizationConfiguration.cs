using Apivator.Domain.Organizations;
using Apivator.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Apivator.Infrastructure.Persistence.Configurations;

internal sealed class OrganizationConfiguration : IEntityTypeConfiguration<Organization>
{
    public void Configure(EntityTypeBuilder<Organization> builder)
    {
        builder.HasKey(o => o.Id);
        builder.Property(o => o.Name).HasMaxLength(Organization.NameMaxLength).IsRequired();
        builder.Property(o => o.Slug).HasMaxLength(80).IsRequired();
        builder.HasIndex(o => o.Slug).IsUnique();
        builder.Property(o => o.DefaultLanguage).HasMaxLength(8).IsRequired().HasDefaultValue("tr");

        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(o => o.OwnerId).OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(o => o.Members).WithOne().HasForeignKey(m => m.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(o => o.Workspaces).WithOne().HasForeignKey(w => w.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(o => o.Members).UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.Navigation(o => o.Workspaces).UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}

internal sealed class OrganizationMemberConfiguration : IEntityTypeConfiguration<OrganizationMember>
{
    public void Configure(EntityTypeBuilder<OrganizationMember> builder)
    {
        builder.HasKey(m => new { m.OrganizationId, m.UserId });
        builder.Property(m => m.Role).HasConversion<string>().HasMaxLength(20);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(m => m.UserId);
    }
}

internal sealed class TeamConfiguration : IEntityTypeConfiguration<Team>
{
    public void Configure(EntityTypeBuilder<Team> builder)
    {
        builder.ToTable("teams");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).HasMaxLength(Team.NameMaxLength).IsRequired();
        builder.HasIndex(t => new { t.OrganizationId, t.Name }).IsUnique();
        builder.HasOne<Organization>().WithMany().HasForeignKey(t => t.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        builder.HasMany(t => t.Members).WithOne().HasForeignKey(m => m.TeamId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(t => t.Members).UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}

internal sealed class TeamMemberConfiguration : IEntityTypeConfiguration<TeamMember>
{
    public void Configure(EntityTypeBuilder<TeamMember> builder)
    {
        builder.ToTable("team_members");
        builder.HasKey(m => new { m.TeamId, m.UserId });
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(m => m.UserId);
    }
}

internal sealed class InvitationConfiguration : IEntityTypeConfiguration<Invitation>
{
    public void Configure(EntityTypeBuilder<Invitation> builder)
    {
        builder.ToTable("invitations");
        builder.HasKey(i => i.Id);
        builder.Property(i => i.Email).HasMaxLength(256).IsRequired();
        builder.Property(i => i.TokenHash).HasMaxLength(64).IsRequired();
        builder.Property(i => i.Role).HasConversion<string>().HasMaxLength(20);
        builder.Property(i => i.WorkspaceRole).HasConversion<string>().HasMaxLength(20);
        builder.Property(i => i.Language).HasMaxLength(8);
        builder.HasIndex(i => i.TokenHash).IsUnique();
        builder.HasIndex(i => new { i.OrganizationId, i.Email });
        builder.HasIndex(i => i.Email);
        builder.HasOne<Organization>().WithMany().HasForeignKey(i => i.OrganizationId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<Apivator.Domain.Workspaces.Workspace>().WithMany().HasForeignKey(i => i.WorkspaceId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(i => i.InvitedById).OnDelete(DeleteBehavior.Cascade);
    }
}
