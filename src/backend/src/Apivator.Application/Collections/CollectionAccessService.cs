using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Collections;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Collections;

public enum CollectionAccessSubject
{
    User,
    Team,
}

/// <param name="WorkspaceRole">Kişinin (ya da takımın) workspace'teki rolü; takım workspace'e eklenmemişse null.</param>
public sealed record CollectionAccessEntryDto(
    Guid Id,
    CollectionAccessSubject Kind,
    Guid SubjectId,
    string Name,
    string? Email,
    WorkspaceRole Role,
    WorkspaceRole? WorkspaceRole);

public sealed record CollectionAccessDto(
    Guid CollectionId,
    bool EditingRestricted,
    bool CanManage,
    WorkspaceRole MyRole,
    IReadOnlyList<CollectionAccessEntryDto> Entries);

public sealed record CollectionAccessInput(Guid? UserId, Guid? TeamId, WorkspaceRole Role);

public sealed record UpdateCollectionAccessRequest(bool EditingRestricted, IReadOnlyList<CollectionAccessInput>? Entries);

public interface ICollectionAccessService
{
    /// <summary>Collection'ın rollerini gösterir; workspace'in her üyesi görebilir.</summary>
    Task<Result<CollectionAccessDto>> GetAsync(Guid collectionId, Guid userId, CancellationToken ct = default);

    /// <summary>Kısıtlamayı ve rol listesini bütünüyle değiştirir; yalnızca workspace yöneticileri.</summary>
    Task<Result<CollectionAccessDto>> UpdateAsync(Guid collectionId, UpdateCollectionAccessRequest request, Guid userId, CancellationToken ct = default);
}

internal sealed class CollectionAccessService(IApplicationDbContext db, IWorkspaceAccess access, IUserDirectory users, TimeProvider clock) : ICollectionAccessService
{
    private static Error CollectionNotFound => Error.NotFound("collection.not_found", L.T("collection.not_found", "Collection bulunamadı."));
    private static Error AdminOnly => Error.Forbidden("collection.access_admin_only", L.T("collection.access_admin_only", "Collection rollerini yalnızca workspace yöneticileri değiştirebilir."));

    public async Task<Result<CollectionAccessDto>> GetAsync(Guid collectionId, Guid userId, CancellationToken ct = default)
    {
        var collection = await db.Collections.AsNoTracking().FirstOrDefaultAsync(c => c.Id == collectionId, ct);
        if (collection is null || await access.RoleAsync(collection.WorkspaceId, userId, ct) is not { } role)
        {
            return CollectionNotFound;
        }

        return await ToDtoAsync(collection, userId, role, ct);
    }

    public async Task<Result<CollectionAccessDto>> UpdateAsync(Guid collectionId, UpdateCollectionAccessRequest request, Guid userId, CancellationToken ct = default)
    {
        var collection = await db.Collections.FirstOrDefaultAsync(c => c.Id == collectionId, ct);
        if (collection is null || await access.RoleAsync(collection.WorkspaceId, userId, ct) is not { } role)
        {
            return CollectionNotFound;
        }

        if (role != WorkspaceRole.Admin)
        {
            return AdminOnly;
        }

        var workspace = await db.Workspaces.AsNoTracking().FirstAsync(w => w.Id == collection.WorkspaceId, ct);
        var inputs = request.Entries ?? [];
        if (workspace.Type == WorkspaceType.Personal && (request.EditingRestricted || inputs.Count > 0))
        {
            return Error.Validation("collection.access_personal", L.T("collection.access_personal", "Kişisel workspace'te collection rolleri kullanılamaz; collection'ı bir takım workspace'ine taşıyın."));
        }

        if (inputs.Count > CollectionAccessEntry.MaxPerCollection)
        {
            return Error.Validation("collection.access_too_many", L.T("collection.access_too_many", "Bir collection'da en fazla {max} rol kaydı olabilir.", ("max", CollectionAccessEntry.MaxPerCollection)));
        }

        if (inputs.Any(i => (i.UserId is null) == (i.TeamId is null)))
        {
            return Error.Validation("collection.access_subject", L.T("collection.access_subject", "Her kayıt bir kullanıcıyı ya da bir takımı göstermeli."));
        }

        if (inputs.Any(i => !CollectionAccessEntry.IsAssignable(i.Role)))
        {
            return Error.Validation("collection.access_role", L.T("collection.access_role", "Collection rolü Viewer ya da Editor olabilir."));
        }

        if (inputs.Where(i => i.UserId is not null).GroupBy(i => i.UserId).Any(g => g.Count() > 1)
            || inputs.Where(i => i.TeamId is not null).GroupBy(i => i.TeamId).Any(g => g.Count() > 1))
        {
            return Error.Validation("collection.access_duplicate", L.T("collection.access_duplicate", "Aynı kişi ya da takım listede bir kez yer alabilir."));
        }

        // Kişiler workspace'e erişebilmeli (kayıt erişim vermez); yöneticiler zaten her collection'da yöneticidir.
        var userIds = inputs.Where(i => i.UserId is not null).Select(i => i.UserId!.Value).ToList();
        var summaries = await users.UsersAsync(userIds, ct);
        foreach (var id in userIds)
        {
            var name = summaries.TryGetValue(id, out var s) ? s.DisplayName : L.T("collection.access_unknown_user", "Bu kullanıcı");
            switch (await access.RoleAsync(collection.WorkspaceId, id, ct))
            {
                case null:
                    return Error.Validation("collection.access_not_member", L.T("collection.access_not_member", "{name} bu workspace'e erişemiyor; önce workspace'e ekleyin.", ("name", name)));
                case WorkspaceRole.Admin:
                    return Error.Validation("collection.access_admin", L.T("collection.access_admin", "{name} workspace yöneticisi; yöneticiler her collection'ı düzenleyebilir.", ("name", name)));
            }
        }

        var teamIds = inputs.Where(i => i.TeamId is not null).Select(i => i.TeamId!.Value).ToList();
        var validTeams = await db.Teams.AsNoTracking()
            .Where(t => teamIds.Contains(t.Id) && t.OrganizationId == workspace.OrganizationId)
            .Select(t => t.Id).ToListAsync(ct);
        if (validTeams.Count != teamIds.Count)
        {
            return Error.Validation("collection.access_team", L.T("collection.access_team", "Takım bulunamadı ya da bu organizasyona ait değil."));
        }

        var now = clock.GetUtcNow();
        var existing = await db.CollectionAccess.Where(e => e.CollectionId == collectionId).ToListAsync(ct);
        foreach (var entry in existing)
        {
            var match = inputs.FirstOrDefault(i => (entry.UserId is not null && i.UserId == entry.UserId) || (entry.TeamId is not null && i.TeamId == entry.TeamId));
            if (match is null)
            {
                db.CollectionAccess.Remove(entry);
            }
            else if (match.Role != entry.Role)
            {
                entry.ChangeRole(match.Role);
            }
        }

        foreach (var input in inputs)
        {
            if (existing.Any(e => (e.UserId is not null && e.UserId == input.UserId) || (e.TeamId is not null && e.TeamId == input.TeamId)))
            {
                continue;
            }

            db.CollectionAccess.Add(input.UserId is { } u
                ? CollectionAccessEntry.ForUser(collectionId, u, input.Role, userId, now)
                : CollectionAccessEntry.ForTeam(collectionId, input.TeamId!.Value, input.Role, userId, now));
        }

        if (collection.EditingRestricted != request.EditingRestricted)
        {
            collection.RestrictEditing(request.EditingRestricted, now);
        }

        await db.SaveChangesAsync(ct);
        return await ToDtoAsync(collection, userId, role, ct);
    }

    private async Task<CollectionAccessDto> ToDtoAsync(Collection collection, Guid userId, WorkspaceRole workspaceRole, CancellationToken ct)
    {
        var entries = await db.CollectionAccess.AsNoTracking()
            .Where(e => e.CollectionId == collection.Id)
            .OrderBy(e => e.CreatedAt)
            .ToListAsync(ct);
        var people = await users.UsersAsync(entries.Where(e => e.UserId is not null).Select(e => e.UserId!.Value), ct);
        var teamIds = entries.Where(e => e.TeamId is not null).Select(e => e.TeamId!.Value).ToList();
        var teams = await db.Teams.AsNoTracking().Where(t => teamIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Name, ct);
        var teamRoles = await db.WorkspaceTeams.AsNoTracking()
            .Where(t => t.WorkspaceId == collection.WorkspaceId && teamIds.Contains(t.TeamId))
            .ToDictionaryAsync(t => t.TeamId, t => t.Role, ct);

        var result = new List<CollectionAccessEntryDto>(entries.Count);
        foreach (var e in entries)
        {
            if (e.UserId is { } u)
            {
                var person = people.GetValueOrDefault(u);
                result.Add(new CollectionAccessEntryDto(
                    e.Id, CollectionAccessSubject.User, u, person?.DisplayName ?? L.T("collection.access_deleted_user", "Silinmiş kullanıcı"), person?.Email, e.Role,
                    await access.RoleAsync(collection.WorkspaceId, u, ct)));
            }
            else
            {
                var t = e.TeamId!.Value;
                result.Add(new CollectionAccessEntryDto(
                    e.Id, CollectionAccessSubject.Team, t, teams.GetValueOrDefault(t, L.T("collection.access_deleted_team", "Silinmiş takım")), null, e.Role,
                    teamRoles.TryGetValue(t, out var r) ? r : null));
            }
        }

        var myRole = await access.CollectionRoleAsync(collection.Id, userId, ct) ?? workspaceRole;
        return new CollectionAccessDto(collection.Id, collection.EditingRestricted, workspaceRole == WorkspaceRole.Admin, myRole, result);
    }
}
