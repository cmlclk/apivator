using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Teams;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Workspaces;

internal sealed class WorkspaceService(
    IApplicationDbContext db,
    IWorkspaceAccess access,
    IOrganizationAccess organizations,
    IUserDirectory users,
    TimeProvider clock) : IWorkspaceService
{
    public async Task<IReadOnlyList<WorkspaceDto>> ListForUserAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var roles = await EffectiveRoles.ForUserAsync(db, userId, null, cancellationToken);
        var ids = roles.Keys.ToList();
        var workspaces = await (
                from workspace in db.Workspaces.AsNoTracking()
                join organization in db.Organizations on workspace.OrganizationId equals organization.Id
                where ids.Contains(workspace.Id)
                select new { workspace.Id, workspace.Name, workspace.Type, OrganizationId = organization.Id, OrganizationName = organization.Name })
            .ToListAsync(cancellationToken);

        return workspaces
            .Select(w => new WorkspaceDto(w.Id, w.Name, w.Type, roles[w.Id], w.OrganizationId, w.OrganizationName))
            .OrderBy(w => w.Type).ThenBy(w => w.OrganizationName, StringComparer.CurrentCulture).ThenBy(w => w.Name, StringComparer.CurrentCulture)
            .ToList();
    }

    public async Task<Result<WorkspaceDto>> CreateAsync(Guid organizationId, CreateWorkspaceRequest request, Guid userId, CancellationToken ct = default)
    {
        var found = await organizations.RequireAsync(organizationId, userId, OrganizationRole.Member, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        var organization = found.Value;
        if (organization.IsPersonal)
        {
            return TeamValidation.PersonalOrganization;
        }

        if (TeamValidation.Name(request.Name, Workspace.NameMaxLength, "Workspace") is { } invalid)
        {
            return invalid;
        }

        var workspace = organization.AddWorkspace(request.Name, WorkspaceType.Team, userId, clock.GetUtcNow());
        db.Workspaces.Add(workspace);
        await db.SaveChangesAsync(ct);
        return new WorkspaceDto(workspace.Id, workspace.Name, workspace.Type, WorkspaceRole.Admin, organization.Id, organization.Name);
    }

    public async Task<Result> RenameAsync(Guid workspaceId, RenameRequest request, Guid userId, CancellationToken ct = default)
    {
        var (workspace, error) = await AdminWorkspaceAsync(workspaceId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        if (TeamValidation.Name(request.Name, Workspace.NameMaxLength, "Workspace") is { } invalid)
        {
            return invalid;
        }

        workspace!.Rename(request.Name);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result> DeleteAsync(Guid workspaceId, Guid userId, CancellationToken ct = default)
    {
        var (workspace, error) = await AdminWorkspaceAsync(workspaceId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        if (workspace!.Type == WorkspaceType.Personal)
        {
            return Error.Validation("workspace.personal", L.T("workspace.personal_delete", "Kişisel workspace silinemez."));
        }

        // Collection'lar, environment'lar, geçmiş ve raporlar veritabanında kademeli silinir.
        db.Workspaces.Remove(workspace);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<WorkspaceMembersDto>> MembersAsync(Guid workspaceId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var workspace = await db.Workspaces.AsNoTracking().Include(w => w.Members).Include(w => w.Teams).FirstAsync(w => w.Id == workspaceId, ct);
        var admins = workspace.Type == WorkspaceType.Team
            ? await db.OrganizationMembers.AsNoTracking()
                // Rol metin olarak saklanır; SQL'de >= alfabetik karşılaştırır, bu yüzden açıkça listelenir.
                .Where(m => m.OrganizationId == workspace.OrganizationId && (m.Role == OrganizationRole.Admin || m.Role == OrganizationRole.Owner))
                .Select(m => m.UserId)
                .ToListAsync(ct)
            : [];
        var profiles = await users.UsersAsync(workspace.Members.Select(m => m.UserId).Concat(admins), ct);

        var teamIds = workspace.Teams.Select(t => t.TeamId).ToList();
        var teams = await db.Teams.AsNoTracking()
            .Where(t => teamIds.Contains(t.Id))
            .Select(t => new { t.Id, t.Name, Count = t.Members.Count })
            .ToDictionaryAsync(t => t.Id, ct);

        WorkspaceUserDto User(Guid id, WorkspaceRole role) => new(id, profiles[id].DisplayName, profiles[id].Email, role);
        return new WorkspaceMembersDto(
            workspace.Members.Where(m => profiles.ContainsKey(m.UserId)).Select(m => User(m.UserId, m.Role))
                .OrderByDescending(u => u.Role).ThenBy(u => u.DisplayName, StringComparer.CurrentCulture).ToList(),
            workspace.Teams.Where(t => teams.ContainsKey(t.TeamId)).Select(t => new WorkspaceTeamDto(t.TeamId, teams[t.TeamId].Name, t.Role, teams[t.TeamId].Count))
                .OrderBy(t => t.Name, StringComparer.CurrentCulture).ToList(),
            admins.Where(profiles.ContainsKey).Select(id => User(id, WorkspaceRole.Admin)).ToList());
    }

    public async Task<Result> SetUserRoleAsync(Guid workspaceId, Guid memberId, SetRoleRequest request, Guid userId, CancellationToken ct = default)
    {
        var (workspace, error) = await AdminWorkspaceAsync(workspaceId, userId, ct, teamOnly: true);
        if (error is not null)
        {
            return error;
        }

        if (!await db.OrganizationMembers.AnyAsync(m => m.OrganizationId == workspace!.OrganizationId && m.UserId == memberId, ct))
        {
            return Error.Validation("workspace.not_org_member", L.T("workspace.not_org_member", "Önce kişiyi organizasyona davet edin; workspace'e yalnızca organizasyon üyeleri eklenebilir."));
        }

        workspace!.SetMemberRole(memberId, request.Role, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result> RemoveUserAsync(Guid workspaceId, Guid memberId, Guid userId, CancellationToken ct = default)
    {
        if (memberId == userId)
        {
            var workspace = await db.Workspaces.Include(w => w.Members).FirstOrDefaultAsync(w => w.Id == workspaceId, ct);
            if (workspace is null || await access.RoleAsync(workspaceId, userId, ct) is null)
            {
                return WorkspaceAccess.NotFound;
            }

            if (workspace.Type == WorkspaceType.Personal)
            {
                return Error.Validation("workspace.personal", L.T("workspace.personal_leave", "Kişisel workspace'ten ayrılamazsınız."));
            }

            workspace.RemoveMember(userId);
            await db.SaveChangesAsync(ct);
            return Result.Success();
        }

        var (target, error) = await AdminWorkspaceAsync(workspaceId, userId, ct, teamOnly: true);
        if (error is not null)
        {
            return error;
        }

        target!.RemoveMember(memberId);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result> SetTeamRoleAsync(Guid workspaceId, Guid teamId, SetRoleRequest request, Guid userId, CancellationToken ct = default)
    {
        var (workspace, error) = await AdminWorkspaceAsync(workspaceId, userId, ct, teamOnly: true);
        if (error is not null)
        {
            return error;
        }

        if (!await db.Teams.AnyAsync(t => t.Id == teamId && t.OrganizationId == workspace!.OrganizationId, ct))
        {
            return Error.NotFound("team.not_found", L.T("team.not_found", "Takım bulunamadı."));
        }

        workspace!.SetTeamRole(teamId, request.Role);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result> RemoveTeamAsync(Guid workspaceId, Guid teamId, Guid userId, CancellationToken ct = default)
    {
        var (workspace, error) = await AdminWorkspaceAsync(workspaceId, userId, ct, teamOnly: true);
        if (error is not null)
        {
            return error;
        }

        workspace!.RemoveTeam(teamId);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    private async Task<(Workspace? Workspace, Error? Error)> AdminWorkspaceAsync(Guid workspaceId, Guid userId, CancellationToken ct, bool teamOnly = false)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Admin, ct) is { } denied)
        {
            return (null, denied);
        }

        var workspace = await db.Workspaces.Include(w => w.Members).Include(w => w.Teams).FirstAsync(w => w.Id == workspaceId, ct);
        return teamOnly && workspace.Type == WorkspaceType.Personal
            ? (null, Error.Validation("workspace.personal", L.T("workspace.personal_share", "Kişisel workspace paylaşılamaz. Bir organizasyonda takım workspace'i oluşturun.")))
            : (workspace, null);
    }
}
