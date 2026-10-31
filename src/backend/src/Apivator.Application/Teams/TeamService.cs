using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Organizations;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Teams;

public interface ITeamService
{
    Task<Result<IReadOnlyList<TeamDto>>> ListAsync(Guid organizationId, Guid userId, CancellationToken ct = default);

    Task<Result<TeamDto>> CreateAsync(Guid organizationId, CreateTeamRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> RenameAsync(Guid teamId, RenameRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> DeleteAsync(Guid teamId, Guid userId, CancellationToken ct = default);

    Task<Result<TeamDto>> AddMemberAsync(Guid teamId, AddTeamMemberRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<TeamDto>> RemoveMemberAsync(Guid teamId, Guid memberId, Guid userId, CancellationToken ct = default);
}

/// <summary>Takımları organizasyon yöneticileri yönetir; üyeler görebilir.</summary>
internal sealed class TeamService(IApplicationDbContext db, IOrganizationAccess organizations, IUserDirectory users, TimeProvider clock) : ITeamService
{
    private static Error TeamNotFound => Error.NotFound("team.not_found", L.T("team.not_found", "Takım bulunamadı."));

    public async Task<Result<IReadOnlyList<TeamDto>>> ListAsync(Guid organizationId, Guid userId, CancellationToken ct = default)
    {
        var found = await organizations.RequireAsync(organizationId, userId, OrganizationRole.Member, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        var teams = await db.Teams.AsNoTracking().Include(t => t.Members).Where(t => t.OrganizationId == organizationId).OrderBy(t => t.Name).ToListAsync(ct);
        var profiles = await users.UsersAsync(teams.SelectMany(t => t.Members.Select(m => m.UserId)), ct);
        return teams.Select(t => ToDto(t, profiles)).ToList();
    }

    public async Task<Result<TeamDto>> CreateAsync(Guid organizationId, CreateTeamRequest request, Guid userId, CancellationToken ct = default)
    {
        var found = await organizations.RequireAsync(organizationId, userId, OrganizationRole.Admin, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        if (found.Value.IsPersonal)
        {
            return TeamValidation.PersonalOrganization;
        }

        if (TeamValidation.Name(request.Name, Team.NameMaxLength, "Takım") is { } invalid)
        {
            return invalid;
        }

        if (await db.Teams.AnyAsync(t => t.OrganizationId == organizationId && t.Name == request.Name.Trim(), ct))
        {
            return Error.Conflict("team.duplicate", L.T("team.duplicate", "Bu adla bir takım zaten var."));
        }

        var team = Team.Create(organizationId, request.Name, clock.GetUtcNow());
        db.Teams.Add(team);
        await db.SaveChangesAsync(ct);
        return new TeamDto(team.Id, team.Name, []);
    }

    public async Task<Result> RenameAsync(Guid teamId, RenameRequest request, Guid userId, CancellationToken ct = default)
    {
        var (team, error) = await ManageableAsync(teamId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        if (TeamValidation.Name(request.Name, Team.NameMaxLength, "Takım") is { } invalid)
        {
            return invalid;
        }

        if (await db.Teams.AnyAsync(t => t.OrganizationId == team!.OrganizationId && t.Id != teamId && t.Name == request.Name.Trim(), ct))
        {
            return Error.Conflict("team.duplicate", L.T("team.duplicate", "Bu adla bir takım zaten var."));
        }

        team!.Rename(request.Name);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result> DeleteAsync(Guid teamId, Guid userId, CancellationToken ct = default)
    {
        var (team, error) = await ManageableAsync(teamId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        db.Teams.Remove(team!);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<TeamDto>> AddMemberAsync(Guid teamId, AddTeamMemberRequest request, Guid userId, CancellationToken ct = default)
    {
        var (team, error) = await ManageableAsync(teamId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        if (!await db.OrganizationMembers.AnyAsync(m => m.OrganizationId == team!.OrganizationId && m.UserId == request.UserId, ct))
        {
            return Error.Validation("team.not_org_member", L.T("team.not_org_member", "Takıma yalnızca organizasyon üyeleri eklenebilir."));
        }

        team!.AddMember(request.UserId, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return ToDto(team, await users.UsersAsync(team.Members.Select(m => m.UserId), ct));
    }

    public async Task<Result<TeamDto>> RemoveMemberAsync(Guid teamId, Guid memberId, Guid userId, CancellationToken ct = default)
    {
        var (team, error) = await ManageableAsync(teamId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        team!.RemoveMember(memberId);
        await db.SaveChangesAsync(ct);
        return ToDto(team, await users.UsersAsync(team.Members.Select(m => m.UserId), ct));
    }

    private async Task<(Team? Team, Error? Error)> ManageableAsync(Guid teamId, Guid userId, CancellationToken ct)
    {
        var team = await db.Teams.Include(t => t.Members).FirstOrDefaultAsync(t => t.Id == teamId, ct);
        if (team is null)
        {
            return (null, TeamNotFound);
        }

        var found = await organizations.RequireAsync(team.OrganizationId, userId, OrganizationRole.Admin, ct);
        return found.IsSuccess ? (team, null) : (null, found.Error == OrganizationAccess.NotFound ? TeamNotFound : found.Error);
    }

    private static TeamDto ToDto(Team team, IReadOnlyDictionary<Guid, UserSummary> profiles) => new(
        team.Id,
        team.Name,
        team.Members
            .Where(m => profiles.ContainsKey(m.UserId))
            .Select(m => new TeamMemberDto(m.UserId, profiles[m.UserId].DisplayName, profiles[m.UserId].Email))
            .OrderBy(m => m.DisplayName, StringComparer.CurrentCulture)
            .ToList());
}
