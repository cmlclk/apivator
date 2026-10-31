using System.Security.Cryptography;
using System.Text;
using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.Teams;

public interface IOrganizationService
{
    Task<IReadOnlyList<OrganizationDto>> ListAsync(Guid userId, CancellationToken ct = default);

    Task<Result<OrganizationDto>> CreateAsync(CreateOrganizationRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> RenameAsync(Guid organizationId, RenameRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> SetLanguageAsync(Guid organizationId, SetOrganizationLanguageRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<OrganizationMembersDto>> MembersAsync(Guid organizationId, Guid userId, CancellationToken ct = default);

    Task<Result> ChangeRoleAsync(Guid organizationId, Guid memberId, ChangeOrganizationRoleRequest request, Guid userId, CancellationToken ct = default);

    /// <summary>Yönetici başkasını çıkarabilir; herkes kendisi ayrılabilir (sahip hariç).</summary>
    Task<Result> RemoveMemberAsync(Guid organizationId, Guid memberId, Guid userId, CancellationToken ct = default);

    Task<Result<InvitationDto>> InviteAsync(Guid organizationId, InviteRequest request, Guid userId, CancellationToken ct = default);

    Task<Result> RevokeInvitationAsync(Guid invitationId, Guid userId, CancellationToken ct = default);

    /// <summary>Yeni bir token ile yeniden gönderir (eski bağlantı geçersiz olur).</summary>
    Task<Result<InvitationDto>> ResendInvitationAsync(Guid invitationId, Guid userId, CancellationToken ct = default);

    Task<Result<InvitationPreviewDto>> PreviewInvitationAsync(string token, CancellationToken ct = default);

    /// <summary>E-postadaki bağlantıyla kabul: oturumdaki kullanıcının e-postası davetle aynı olmalı.</summary>
    Task<Result<AcceptedInvitationDto>> AcceptByTokenAsync(string token, Guid userId, CancellationToken ct = default);

    /// <summary>Uygulama içinden kabul: e-posta eşleşmeli ve doğrulanmış olmalı (bağlantı olmadığı için).</summary>
    Task<Result<AcceptedInvitationDto>> AcceptByIdAsync(Guid invitationId, Guid userId, CancellationToken ct = default);

    Task<IReadOnlyList<MyInvitationDto>> MyInvitationsAsync(Guid userId, CancellationToken ct = default);
}

internal sealed class OrganizationService(
    IApplicationDbContext db,
    IOrganizationAccess organizations,
    IWorkspaceAccess workspaces,
    IUserDirectory users,
    IInvitationSender sender,
    TimeProvider clock) : IOrganizationService
{
    public const string DefaultWorkspaceName = "Genel";

    private static Error InvitationNotFound => Error.NotFound("invitation.not_found", L.T("invitation.not_found", "Davet bulunamadı."));

    private static Error LanguageInvalid => Error.Validation("validation", L.T("organization.language_invalid", "Desteklenmeyen dil."));

    public async Task<IReadOnlyList<OrganizationDto>> ListAsync(Guid userId, CancellationToken ct = default) =>
        await db.Organizations.AsNoTracking()
            .Where(o => o.Members.Any(m => m.UserId == userId))
            .OrderBy(o => !o.IsPersonal).ThenBy(o => o.Name)
            .Select(o => new OrganizationDto(o.Id, o.Name, o.IsPersonal, o.Members.First(m => m.UserId == userId).Role, o.Members.Count, o.RequireTwoFactor, o.DefaultLanguage))
            .ToListAsync(ct);

    public async Task<Result<OrganizationDto>> CreateAsync(CreateOrganizationRequest request, Guid userId, CancellationToken ct = default)
    {
        if (TeamValidation.Name(request.Name, Organization.NameMaxLength, "Organizasyon") is { } invalid)
        {
            return invalid;
        }

        var now = clock.GetUtcNow();
        var organization = Organization.Create(request.Name, userId, isPersonal: false, now);
        organization.SetDefaultLanguage(Lang.Current);
        organization.AddWorkspace(DefaultWorkspaceName, WorkspaceType.Team, userId, now);
        db.Organizations.Add(organization);
        await db.SaveChangesAsync(ct);
        return new OrganizationDto(organization.Id, organization.Name, false, OrganizationRole.Owner, 1, false, organization.DefaultLanguage);
    }

    public async Task<Result> RenameAsync(Guid organizationId, RenameRequest request, Guid userId, CancellationToken ct = default)
    {
        var found = await organizations.RequireAsync(organizationId, userId, OrganizationRole.Admin, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        if (TeamValidation.Name(request.Name, Organization.NameMaxLength, "Organizasyon") is { } invalid)
        {
            return invalid;
        }

        found.Value.Rename(request.Name);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result> SetLanguageAsync(Guid organizationId, SetOrganizationLanguageRequest request, Guid userId, CancellationToken ct = default)
    {
        var found = await organizations.RequireAsync(organizationId, userId, OrganizationRole.Admin, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        var language = Lang.Match(request.Language);
        if (language is null || !Lang.Supported.Contains(request.Language.Trim(), StringComparer.OrdinalIgnoreCase))
        {
            return LanguageInvalid;
        }

        found.Value.SetDefaultLanguage(language);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<OrganizationMembersDto>> MembersAsync(Guid organizationId, Guid userId, CancellationToken ct = default)
    {
        var found = await organizations.RequireAsync(organizationId, userId, OrganizationRole.Member, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        var organization = found.Value;
        var profiles = await users.UsersAsync(organization.Members.Select(m => m.UserId), ct);
        var isAdmin = organization.RoleOf(userId) >= OrganizationRole.Admin;
        var members = organization.Members
            .Where(m => profiles.ContainsKey(m.UserId))
            .Select(m => new OrganizationMemberDto(
                m.UserId,
                profiles[m.UserId].DisplayName,
                profiles[m.UserId].Email,
                m.Role,
                m.JoinedAt,
                isAdmin ? profiles[m.UserId].TwoFactorEnabled : null))
            .OrderByDescending(m => m.Role).ThenBy(m => m.DisplayName, StringComparer.CurrentCulture)
            .ToList();

        var invitations = organization.RoleOf(userId) >= OrganizationRole.Admin
            ? await InvitationsAsync(organizationId, ct)
            : [];
        return new OrganizationMembersDto(members, invitations);
    }

    public async Task<Result> ChangeRoleAsync(Guid organizationId, Guid memberId, ChangeOrganizationRoleRequest request, Guid userId, CancellationToken ct = default)
    {
        var found = await organizations.RequireAsync(organizationId, userId, OrganizationRole.Admin, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        var organization = found.Value;
        var target = organization.RoleOf(memberId);
        if (target is null)
        {
            return Error.NotFound("organization.member_not_found", L.T("organization.member_not_found", "Üye bulunamadı."));
        }

        if (request.Role == OrganizationRole.Owner)
        {
            if (organization.OwnerId != userId)
            {
                return Error.Forbidden("organization.forbidden", L.T("organization.ownership_transfer", "Sahipliği yalnızca organizasyon sahibi devredebilir."));
            }

            if (memberId != userId)
            {
                organization.TransferOwnership(memberId);
            }
        }
        else if (target == OrganizationRole.Owner)
        {
            return Error.Validation("organization.owner", L.T("organization.owner_role", "Sahibin rolü değiştirilemez; önce sahipliği devretmelidir."));
        }
        else
        {
            organization.ChangeRole(memberId, request.Role);
        }

        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result> RemoveMemberAsync(Guid organizationId, Guid memberId, Guid userId, CancellationToken ct = default)
    {
        var self = memberId == userId;
        var found = await organizations.RequireAsync(organizationId, userId, self ? OrganizationRole.Member : OrganizationRole.Admin, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        var organization = found.Value;
        if (organization.RoleOf(memberId) is null)
        {
            return Error.NotFound("organization.member_not_found", L.T("organization.member_not_found", "Üye bulunamadı."));
        }

        if (organization.IsPersonal || memberId == organization.OwnerId)
        {
            return Error.Validation(
                "organization.owner",
                self
                    ? L.T("organization.owner_leave", "Sahip organizasyondan ayrılamaz; önce sahipliği başka bir üyeye devredin.")
                    : L.T("organization.owner_remove", "Organizasyon sahibi çıkarılamaz."));
        }

        organization.RemoveMember(memberId);

        // Organizasyondaki workspace ve takım üyelikleri de kalkar.
        var workspaceIds = await db.Workspaces.Where(w => w.OrganizationId == organizationId).Select(w => w.Id).ToListAsync(ct);
        db.WorkspaceMembers.RemoveRange(await db.WorkspaceMembers.Where(m => m.UserId == memberId && workspaceIds.Contains(m.WorkspaceId)).ToListAsync(ct));
        var teamIds = await db.Teams.Where(t => t.OrganizationId == organizationId).Select(t => t.Id).ToListAsync(ct);
        db.TeamMembers.RemoveRange(await db.TeamMembers.Where(m => m.UserId == memberId && teamIds.Contains(m.TeamId)).ToListAsync(ct));

        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<InvitationDto>> InviteAsync(Guid organizationId, InviteRequest request, Guid userId, CancellationToken ct = default)
    {
        var found = await organizations.RequireAsync(organizationId, userId, OrganizationRole.Admin, ct);
        if (!found.IsSuccess)
        {
            return found.Error!;
        }

        var organization = found.Value;
        if (organization.IsPersonal)
        {
            return TeamValidation.PersonalOrganization;
        }

        if (TeamValidation.Email(request.Email) is { } invalid)
        {
            return invalid;
        }

        if (request.Role == OrganizationRole.Owner)
        {
            return Error.Validation("validation", L.T("invitation.owner_role", "Davetle sahip atanamaz; sahiplik üyeler arasında devredilir."));
        }

        if (request.Language is not null && Lang.Match(request.Language) is null)
        {
            return LanguageInvalid;
        }

        var email = Invitation.NormalizeEmail(request.Email);
        if (await users.FindByEmailAsync(email, ct) is { } existing && organization.RoleOf(existing.Id) is not null)
        {
            return Error.Conflict("invitation.already_member", L.T("invitation.already_member", "Bu kişi zaten organizasyonun üyesi."));
        }

        string? workspaceName = null;
        if (request.WorkspaceId is { } workspaceId)
        {
            var workspace = await db.Workspaces.AsNoTracking().FirstOrDefaultAsync(w => w.Id == workspaceId && w.OrganizationId == organizationId, ct);
            if (workspace is null || workspace.Type != WorkspaceType.Team)
            {
                return Error.Validation("validation", L.T("invitation.workspace_invalid", "Davet edilen workspace bu organizasyonun bir takım workspace'i olmalı."));
            }

            if (await workspaces.RequireAsync(workspaceId, userId, WorkspaceRole.Admin, ct) is { } denied)
            {
                return denied;
            }

            workspaceName = workspace.Name;
        }

        // Aynı kişiye bekleyen eski davetler geçersiz olur; tek geçerli bağlantı kalır.
        var now = clock.GetUtcNow();
        foreach (var old in await db.Invitations.Where(i => i.OrganizationId == organizationId && i.Email == email && i.AcceptedAt == null && i.RevokedAt == null).ToListAsync(ct))
        {
            old.Revoke(now);
        }

        var token = NewToken();
        var invitation = Invitation.Create(organizationId, email, request.Role, request.WorkspaceId, request.WorkspaceRole, Hash(token), userId, now, Lang.Match(request.Language));
        db.Invitations.Add(invitation);
        await db.SaveChangesAsync(ct);

        var inviter = (await users.DisplayNamesAsync([userId], ct)).GetValueOrDefault(userId, string.Empty);
        await sender.SendAsync(new InvitationEmail(email, organization.Name, inviter, workspaceName, token, Lang.Match(request.Language) ?? organization.DefaultLanguage), ct);
        return ToDto(invitation, workspaceName, inviter, now);
    }

    public async Task<Result> RevokeInvitationAsync(Guid invitationId, Guid userId, CancellationToken ct = default)
    {
        var invitation = await db.Invitations.FirstOrDefaultAsync(i => i.Id == invitationId, ct);
        if (invitation is null)
        {
            return InvitationNotFound;
        }

        var found = await organizations.RequireAsync(invitation.OrganizationId, userId, OrganizationRole.Admin, ct);
        if (!found.IsSuccess)
        {
            return found.Error == OrganizationAccess.NotFound ? InvitationNotFound : found.Error!;
        }

        invitation.Revoke(clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<InvitationDto>> ResendInvitationAsync(Guid invitationId, Guid userId, CancellationToken ct = default)
    {
        var invitation = await db.Invitations.AsNoTracking().FirstOrDefaultAsync(i => i.Id == invitationId, ct);
        if (invitation is null || invitation.AcceptedAt is not null)
        {
            return InvitationNotFound;
        }

        return await InviteAsync(
            invitation.OrganizationId,
            new InviteRequest(invitation.Email, invitation.Role, invitation.WorkspaceId, invitation.WorkspaceRole, invitation.Language),
            userId,
            ct);
    }

    public async Task<Result<InvitationPreviewDto>> PreviewInvitationAsync(string token, CancellationToken ct = default)
    {
        var invitation = await ByTokenAsync(token, ct);
        if (invitation is null)
        {
            return InvitationNotFound;
        }

        var organization = await db.Organizations.AsNoTracking().FirstAsync(o => o.Id == invitation.OrganizationId, ct);
        var workspaceName = invitation.WorkspaceId is { } wid
            ? await db.Workspaces.AsNoTracking().Where(w => w.Id == wid).Select(w => w.Name).FirstOrDefaultAsync(ct)
            : null;
        var inviter = (await users.DisplayNamesAsync([invitation.InvitedById], ct)).GetValueOrDefault(invitation.InvitedById, string.Empty);
        var accountExists = await users.FindByEmailAsync(invitation.Email, ct) is not null;
        return new InvitationPreviewDto(organization.Name, inviter, invitation.Email, workspaceName, StatusOf(invitation, clock.GetUtcNow()), accountExists);
    }

    public async Task<Result<AcceptedInvitationDto>> AcceptByTokenAsync(string token, Guid userId, CancellationToken ct = default)
    {
        var invitation = await ByTokenAsync(token, ct, tracked: true);
        return invitation is null ? InvitationNotFound : await AcceptAsync(invitation, userId, requireConfirmedEmail: false, ct);
    }

    public async Task<Result<AcceptedInvitationDto>> AcceptByIdAsync(Guid invitationId, Guid userId, CancellationToken ct = default)
    {
        var invitation = await db.Invitations.FirstOrDefaultAsync(i => i.Id == invitationId, ct);
        return invitation is null ? InvitationNotFound : await AcceptAsync(invitation, userId, requireConfirmedEmail: true, ct);
    }

    public async Task<IReadOnlyList<MyInvitationDto>> MyInvitationsAsync(Guid userId, CancellationToken ct = default)
    {
        var me = (await users.UsersAsync([userId], ct)).GetValueOrDefault(userId);
        if (me is null)
        {
            return [];
        }

        var now = clock.GetUtcNow();
        var email = Invitation.NormalizeEmail(me.Email);
        var pending = await (
                from i in db.Invitations.AsNoTracking()
                join o in db.Organizations.AsNoTracking() on i.OrganizationId equals o.Id
                where i.Email == email && i.AcceptedAt == null && i.RevokedAt == null && i.ExpiresAt > now
                      && !o.Members.Any(m => m.UserId == userId)
                orderby i.CreatedAt descending
                select new { Invitation = i, OrganizationName = o.Name })
            .ToListAsync(ct);

        var inviters = await users.DisplayNamesAsync(pending.Select(p => p.Invitation.InvitedById), ct);
        var workspaceIds = pending.Where(p => p.Invitation.WorkspaceId != null).Select(p => p.Invitation.WorkspaceId!.Value).ToList();
        var workspaceNames = await db.Workspaces.AsNoTracking().Where(w => workspaceIds.Contains(w.Id)).ToDictionaryAsync(w => w.Id, w => w.Name, ct);
        return pending.Select(p => new MyInvitationDto(
                p.Invitation.Id,
                p.Invitation.OrganizationId,
                p.OrganizationName,
                inviters.GetValueOrDefault(p.Invitation.InvitedById, string.Empty),
                p.Invitation.WorkspaceId is { } wid ? workspaceNames.GetValueOrDefault(wid) : null,
                p.Invitation.CreatedAt,
                p.Invitation.ExpiresAt))
            .ToList();
    }

    private async Task<Result<AcceptedInvitationDto>> AcceptAsync(Invitation invitation, Guid userId, bool requireConfirmedEmail, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var status = StatusOf(invitation, now);
        if (status != InvitationStatus.Pending)
        {
            return Error.Validation(
                "invitation.not_pending",
                status switch
                {
                    InvitationStatus.Expired => L.T("invitation.expired", "Davetin süresi dolmuş. Yöneticiden yeniden göndermesini isteyin."),
                    InvitationStatus.Accepted => L.T("invitation.already_accepted", "Bu davet zaten kabul edilmiş."),
                    _ => L.T("invitation.revoked", "Bu davet geri alınmış."),
                });
        }

        var me = (await users.UsersAsync([userId], ct)).GetValueOrDefault(userId);
        if (me is null || Invitation.NormalizeEmail(me.Email) != invitation.Email)
        {
            return Error.Forbidden("invitation.email_mismatch", L.T("invitation.email_mismatch", "Bu davet {email} adresine gönderilmiş. O adresle giriş yapın.", ("email", invitation.Email)));
        }

        if (requireConfirmedEmail && !me.EmailConfirmed)
        {
            return Error.Forbidden("invitation.email_unconfirmed", L.T("invitation.email_unconfirmed", "Daveti kabul etmek için önce e-posta adresinizi doğrulayın ya da e-postadaki davet bağlantısını kullanın."));
        }

        var organization = await db.Organizations.Include(o => o.Members).FirstAsync(o => o.Id == invitation.OrganizationId, ct);
        var joined = organization.RoleOf(userId) is null;
        if (joined)
        {
            organization.AddMember(userId, invitation.Role, now);
        }

        if (invitation.WorkspaceId is { } workspaceId
            && await db.Workspaces.Include(w => w.Members).FirstOrDefaultAsync(w => w.Id == workspaceId, ct) is { } workspace)
        {
            var role = invitation.WorkspaceRole ?? WorkspaceRole.Editor;
            if (workspace.RoleOf(userId) is not { } current || current < role)
            {
                workspace.SetMemberRole(userId, role, now);
            }
        }

        invitation.Accept(userId, now);
        await db.SaveChangesAsync(ct);
        if (joined)
        {
            // Yeni üyenin başlangıç dili: kendi tercihi yoksa organizasyonun varsayılan dili (Faz 8.2).
            await users.SetLanguageIfUnsetAsync(userId, organization.DefaultLanguage, ct);
        }

        return new AcceptedInvitationDto(invitation.OrganizationId, invitation.WorkspaceId);
    }

    private async Task<IReadOnlyList<InvitationDto>> InvitationsAsync(Guid organizationId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var list = await db.Invitations.AsNoTracking()
            .Where(i => i.OrganizationId == organizationId && i.AcceptedAt == null && i.RevokedAt == null)
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync(ct);
        var inviters = await users.DisplayNamesAsync(list.Select(i => i.InvitedById), ct);
        var workspaceIds = list.Where(i => i.WorkspaceId != null).Select(i => i.WorkspaceId!.Value).ToList();
        var names = await db.Workspaces.AsNoTracking().Where(w => workspaceIds.Contains(w.Id)).ToDictionaryAsync(w => w.Id, w => w.Name, ct);
        return list.Select(i => ToDto(i, i.WorkspaceId is { } wid ? names.GetValueOrDefault(wid) : null, inviters.GetValueOrDefault(i.InvitedById, string.Empty), now)).ToList();
    }

    private async Task<Invitation?> ByTokenAsync(string token, CancellationToken ct, bool tracked = false)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 200)
        {
            return null;
        }

        var hash = Hash(token);
        var query = tracked ? db.Invitations : db.Invitations.AsNoTracking();
        return await query.FirstOrDefaultAsync(i => i.TokenHash == hash, ct);
    }

    private static InvitationDto ToDto(Invitation i, string? workspaceName, string inviter, DateTimeOffset now) =>
        new(i.Id, i.Email, i.Role, i.WorkspaceId, workspaceName, i.WorkspaceRole, inviter, i.CreatedAt, i.ExpiresAt, StatusOf(i, now));

    private static InvitationStatus StatusOf(Invitation i, DateTimeOffset now) =>
        i.AcceptedAt is not null ? InvitationStatus.Accepted
        : i.RevokedAt is not null ? InvitationStatus.Revoked
        : i.ExpiresAt <= now ? InvitationStatus.Expired
        : InvitationStatus.Pending;

    private static string NewToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    internal static string Hash(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
