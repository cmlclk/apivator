using Apivator.Domain.Variables;
using Apivator.Domain.Workspaces;
using Apivator.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Apivator.Infrastructure.Persistence.Configurations;

internal sealed class WorkspaceConfiguration : IEntityTypeConfiguration<Workspace>
{
    public void Configure(EntityTypeBuilder<Workspace> builder)
    {
        builder.HasKey(w => w.Id);
        builder.Property(w => w.Name).HasMaxLength(Workspace.NameMaxLength).IsRequired();
        builder.Property(w => w.Type).HasConversion<string>().HasMaxLength(20);
        builder.Property(w => w.Globals).HasJsonConversion<IReadOnlyList<Variable>>(() => []);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(w => w.CreatedById).OnDelete(DeleteBehavior.Restrict);

        builder.HasMany(w => w.Members).WithOne().HasForeignKey(m => m.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(w => w.Members).UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.HasMany(w => w.Teams).WithOne().HasForeignKey(t => t.WorkspaceId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(w => w.Teams).UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}

internal sealed class WorkspaceTeamConfiguration : IEntityTypeConfiguration<WorkspaceTeam>
{
    public void Configure(EntityTypeBuilder<WorkspaceTeam> builder)
    {
        builder.ToTable("workspace_teams");
        builder.HasKey(t => new { t.WorkspaceId, t.TeamId });
        builder.Property(t => t.Role).HasConversion<string>().HasMaxLength(20);
        builder.HasOne<Apivator.Domain.Organizations.Team>().WithMany().HasForeignKey(t => t.TeamId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(t => t.TeamId);
    }
}

internal sealed class WorkspaceMemberConfiguration : IEntityTypeConfiguration<WorkspaceMember>
{
    public void Configure(EntityTypeBuilder<WorkspaceMember> builder)
    {
        builder.HasKey(m => new { m.WorkspaceId, m.UserId });
        builder.Property(m => m.Role).HasConversion<string>().HasMaxLength(20);
        builder.HasOne<ApplicationUser>().WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(m => m.UserId);
    }
}
