using Apivator.Domain.Access;
using Apivator.Domain.Audit;
using Apivator.Domain.Collections;
using Apivator.Domain.Docs;
using Apivator.Domain.Mocks;
using Apivator.Domain.Monitors;
using Apivator.Domain.Organizations;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Apivator.Infrastructure.Audit;

/// <summary>
/// Yönetimle ilgili değişiklikleri (üyelik, rol, takım, workspace, collection erişimi, yayın, mock, API anahtarı…)
/// aynı kaydetme içinde denetim kaydına yazar. Değişiklik izleyicisinden çıkarıldığı için servislerin unutması
/// mümkün değildir; kayıt ve değişiklik birlikte kaydedilir ya da hiçbiri kaydedilmez. Bir üst öğe aynı
/// kaydetmede eklenip silindiğinde (organizasyon açma, workspace silme, üyeyi çıkarma) alt kayıtlar tekrar yazılmaz.
/// </summary>
internal sealed class AuditInterceptor(AuditActorSource actors, TimeProvider clock) : SaveChangesInterceptor
{
    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is { } context)
        {
            await RecordAsync(context, cancellationToken);
        }

        return result;
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        if (eventData.Context is { } context)
        {
            RecordAsync(context, CancellationToken.None).GetAwaiter().GetResult();
        }

        return result;
    }

    private async Task RecordAsync(DbContext context, CancellationToken ct)
    {
        context.ChangeTracker.DetectChanges();
        var entries = context.ChangeTracker.Entries()
            .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted && IsAudited(e.Entity))
            .ToList();
        if (entries.Count == 0)
        {
            return;
        }

        var save = new SaveContext(entries);
        var lookup = new AuditLookup(context, ct);
        var actor = await actors.CurrentAsync(context, ct);
        var now = clock.GetUtcNow();
        var writer = new AuditWriter(lookup, actor, now);

        foreach (var entry in entries)
        {
            await DescribeAsync(entry, save, writer, actor);
        }

        context.Set<AuditEntry>().AddRange(writer.Entries);
    }

    private static bool IsAudited(object entity) => entity is Organization or OrganizationMember or Invitation or Team or TeamMember
        or Workspace or WorkspaceMember or WorkspaceTeam or Collection or CollectionAccessEntry
        or MockServer or PublishedDoc or CollectionMonitor or ApiKey;

    private static async Task DescribeAsync(EntityEntry entry, SaveContext save, AuditWriter w, AuditActor actor)
    {
        var state = entry.State;
        switch (entry.Entity)
        {
            case Organization o:
                if (state == EntityState.Added)
                {
                    await w.OrganizationAsync(o.Id, AuditActions.OrganizationCreated, "organization", o.Id, o.Name);
                }
                else if (state == EntityState.Modified)
                {
                    if (Changed(entry, nameof(Organization.Name), out var oldName))
                    {
                        await w.OrganizationAsync(o.Id, AuditActions.OrganizationRenamed, "organization", o.Id, o.Name, ("from", oldName as string), ("to", o.Name));
                    }

                    if (Changed(entry, nameof(Organization.RequireTwoFactor), out _))
                    {
                        await w.OrganizationAsync(o.Id, o.RequireTwoFactor ? AuditActions.OrganizationTwoFactorRequired : AuditActions.OrganizationTwoFactorOptional, "organization", o.Id, o.Name);
                    }

                    if (Changed(entry, nameof(Organization.OwnerId), out var oldOwner) && oldOwner is Guid previous)
                    {
                        await w.OrganizationAsync(
                            o.Id, AuditActions.OrganizationOwnershipTransferred, "member", o.OwnerId, (await w.Lookup.UserAsync(o.OwnerId)).Name,
                            ("from", await w.Lookup.UserLabelAsync(previous)), ("to", await w.Lookup.UserLabelAsync(o.OwnerId)));
                    }
                }

                break;

            case OrganizationMember m when !save.AddedOrDeleted<Organization>(m.OrganizationId):
                var member = await w.Lookup.UserAsync(m.UserId);
                if (state == EntityState.Added)
                {
                    var invited = save.Accepted(m.OrganizationId, m.UserId);
                    await w.OrganizationAsync(m.OrganizationId, AuditActions.MemberAdded, "member", m.UserId, member.Name, ("email", member.Email), ("role", m.Role.ToString()), ("via", invited ? "invitation" : null));
                }
                else if (state == EntityState.Modified && Changed(entry, nameof(OrganizationMember.Role), out var oldRole) && !save.OwnerChanged(m.OrganizationId))
                {
                    await w.OrganizationAsync(m.OrganizationId, AuditActions.MemberRoleChanged, "member", m.UserId, member.Name, ("email", member.Email), ("from", oldRole?.ToString()), ("to", m.Role.ToString()));
                }
                else if (state == EntityState.Deleted)
                {
                    var action = actor.UserId == m.UserId ? AuditActions.MemberLeft : AuditActions.MemberRemoved;
                    await w.OrganizationAsync(m.OrganizationId, action, "member", m.UserId, member.Name, ("email", member.Email), ("role", m.Role.ToString()));
                }

                break;

            case Invitation i when !save.AddedOrDeleted<Organization>(i.OrganizationId):
                var workspaceName = i.WorkspaceId is { } wid ? (await w.Lookup.WorkspaceAsync(wid))?.Name : null;
                if (state == EntityState.Added)
                {
                    await w.OrganizationAsync(i.OrganizationId, AuditActions.InvitationSent, "invitation", i.Id, i.Email, ("role", i.Role.ToString()), ("workspace", workspaceName), ("workspace_role", i.WorkspaceRole?.ToString()));
                }
                else if (state == EntityState.Modified && Changed(entry, nameof(Invitation.AcceptedAt), out _))
                {
                    await w.OrganizationAsync(i.OrganizationId, AuditActions.InvitationAccepted, "invitation", i.Id, i.Email, ("role", i.Role.ToString()), ("workspace", workspaceName));
                }
                else if (state == EntityState.Modified && Changed(entry, nameof(Invitation.RevokedAt), out _) && !save.Reinvited(i.OrganizationId, i.Email))
                {
                    await w.OrganizationAsync(i.OrganizationId, AuditActions.InvitationRevoked, "invitation", i.Id, i.Email);
                }

                break;

            case Team t when !save.AddedOrDeleted<Organization>(t.OrganizationId):
                if (state == EntityState.Added)
                {
                    await w.OrganizationAsync(t.OrganizationId, AuditActions.TeamCreated, "team", t.Id, t.Name);
                }
                else if (state == EntityState.Deleted)
                {
                    await w.OrganizationAsync(t.OrganizationId, AuditActions.TeamDeleted, "team", t.Id, t.Name);
                }
                else if (Changed(entry, nameof(Team.Name), out var oldTeamName))
                {
                    await w.OrganizationAsync(t.OrganizationId, AuditActions.TeamRenamed, "team", t.Id, t.Name, ("from", oldTeamName as string), ("to", t.Name));
                }

                break;

            case TeamMember tm when state != EntityState.Modified && !save.AddedOrDeleted<Team>(tm.TeamId):
                if (await w.Lookup.TeamAsync(tm.TeamId) is not { } team || (state == EntityState.Deleted && save.LeftOrganization(team.OrganizationId, tm.UserId)))
                {
                    break;
                }

                var teamMember = await w.Lookup.UserAsync(tm.UserId);
                await w.OrganizationAsync(
                    team.OrganizationId, state == EntityState.Added ? AuditActions.TeamMemberAdded : AuditActions.TeamMemberRemoved, "member", tm.UserId, teamMember.Name,
                    ("email", teamMember.Email), ("team", team.Name));
                break;

            case Workspace ws when !save.AddedOrDeleted<Organization>(ws.OrganizationId):
                if (state == EntityState.Added)
                {
                    await w.WorkspaceAsync(ws.Id, AuditActions.WorkspaceCreated, "workspace", ws.Id, ws.Name, ("type", ws.Type.ToString()));
                }
                else if (state == EntityState.Deleted)
                {
                    await w.WorkspaceAsync(ws.Id, AuditActions.WorkspaceDeleted, "workspace", ws.Id, ws.Name);
                }
                else if (Changed(entry, nameof(Workspace.Name), out var oldWorkspaceName))
                {
                    await w.WorkspaceAsync(ws.Id, AuditActions.WorkspaceRenamed, "workspace", ws.Id, ws.Name, ("from", oldWorkspaceName as string), ("to", ws.Name));
                }

                break;

            case WorkspaceMember wm when !save.AddedOrDeleted<Workspace>(wm.WorkspaceId):
                if (state == EntityState.Deleted && await w.Lookup.WorkspaceAsync(wm.WorkspaceId) is { } owner && save.LeftOrganization(owner.OrganizationId, wm.UserId))
                {
                    break;
                }

                var wsMember = await w.Lookup.UserAsync(wm.UserId);
                if (state == EntityState.Added)
                {
                    await w.WorkspaceAsync(wm.WorkspaceId, AuditActions.WorkspaceMemberAdded, "member", wm.UserId, wsMember.Name, ("email", wsMember.Email), ("role", wm.Role.ToString()));
                }
                else if (state == EntityState.Deleted)
                {
                    await w.WorkspaceAsync(wm.WorkspaceId, AuditActions.WorkspaceMemberRemoved, "member", wm.UserId, wsMember.Name, ("email", wsMember.Email), ("role", wm.Role.ToString()));
                }
                else if (Changed(entry, nameof(WorkspaceMember.Role), out var oldWsRole))
                {
                    await w.WorkspaceAsync(wm.WorkspaceId, AuditActions.WorkspaceMemberRoleChanged, "member", wm.UserId, wsMember.Name, ("email", wsMember.Email), ("from", oldWsRole?.ToString()), ("to", wm.Role.ToString()));
                }

                break;

            case WorkspaceTeam wt when !save.AddedOrDeleted<Workspace>(wt.WorkspaceId) && !save.AddedOrDeleted<Team>(wt.TeamId):
                var teamName = (await w.Lookup.TeamAsync(wt.TeamId))?.Name ?? "—";
                if (state == EntityState.Added)
                {
                    await w.WorkspaceAsync(wt.WorkspaceId, AuditActions.WorkspaceTeamAdded, "team", wt.TeamId, teamName, ("role", wt.Role.ToString()));
                }
                else if (state == EntityState.Deleted)
                {
                    await w.WorkspaceAsync(wt.WorkspaceId, AuditActions.WorkspaceTeamRemoved, "team", wt.TeamId, teamName, ("role", wt.Role.ToString()));
                }
                else if (Changed(entry, nameof(WorkspaceTeam.Role), out var oldTeamRole))
                {
                    await w.WorkspaceAsync(wt.WorkspaceId, AuditActions.WorkspaceTeamRoleChanged, "team", wt.TeamId, teamName, ("from", oldTeamRole?.ToString()), ("to", wt.Role.ToString()));
                }

                break;

            case Collection c:
                await CollectionAsync(entry, c, save, w);
                break;

            // Silinen collection'ın ya da takımın erişim kayıtları üst olayla birlikte gider; ayrıca yazılmaz.
            case CollectionAccessEntry a when !save.AddedOrDeleted<Collection>(a.CollectionId) && (a.TeamId is null || !save.AddedOrDeleted<Team>(a.TeamId.Value)):
                await CollectionAccessAsync(entry, a, save, w);
                break;

            case MockServer mock when !save.AddedOrDeleted<Workspace>(mock.WorkspaceId):
                var visibility = mock.IsPrivate ? "private" : "public";
                if (state == EntityState.Added)
                {
                    await w.WorkspaceAsync(mock.WorkspaceId, AuditActions.MockCreated, "mock", mock.Id, mock.Name, ("visibility", visibility));
                }
                else if (state == EntityState.Deleted)
                {
                    await w.WorkspaceAsync(mock.WorkspaceId, AuditActions.MockDeleted, "mock", mock.Id, mock.Name);
                }
                else
                {
                    if (Changed(entry, nameof(MockServer.IsPrivate), out _))
                    {
                        await w.WorkspaceAsync(mock.WorkspaceId, AuditActions.MockVisibilityChanged, "mock", mock.Id, mock.Name, ("visibility", visibility));
                    }

                    if (Changed(entry, nameof(MockServer.Key), out _))
                    {
                        await w.WorkspaceAsync(mock.WorkspaceId, AuditActions.MockKeyRegenerated, "mock", mock.Id, mock.Name);
                    }
                }

                break;

            case PublishedDoc doc when !save.AddedOrDeleted<Collection>(doc.CollectionId):
                if (await w.Lookup.CollectionAsync(doc.CollectionId) is not { } docCollection)
                {
                    break;
                }

                var docVisibility = ("visibility", (string?)(doc.Visibility == DocVisibility.Public ? "public" : "organization"));
                if (state == EntityState.Added)
                {
                    await w.WorkspaceAsync(docCollection.WorkspaceId, AuditActions.DocsPublished, "collection", doc.CollectionId, docCollection.Name, docVisibility);
                }
                else if (state == EntityState.Deleted)
                {
                    await w.WorkspaceAsync(docCollection.WorkspaceId, AuditActions.DocsUnpublished, "collection", doc.CollectionId, docCollection.Name);
                }
                else
                {
                    if (Changed(entry, nameof(PublishedDoc.Visibility), out _))
                    {
                        await w.WorkspaceAsync(docCollection.WorkspaceId, AuditActions.DocsVisibilityChanged, "collection", doc.CollectionId, docCollection.Name, docVisibility);
                    }

                    if (Changed(entry, nameof(PublishedDoc.Slug), out _))
                    {
                        await w.WorkspaceAsync(docCollection.WorkspaceId, AuditActions.DocsLinkRegenerated, "collection", doc.CollectionId, docCollection.Name);
                    }
                }

                break;

            case CollectionMonitor monitor when state != EntityState.Modified && !save.AddedOrDeleted<Workspace>(monitor.WorkspaceId):
                await w.WorkspaceAsync(
                    monitor.WorkspaceId, state == EntityState.Added ? AuditActions.MonitorCreated : AuditActions.MonitorDeleted, "monitor", monitor.Id, monitor.Name,
                    ("schedule", monitor.Schedule));
                break;

            case ApiKey key:
                // Anahtar sahibinin erişebildiği her organizasyonda geçerli olduğu için hepsine yazılır.
                var keyAction = state == EntityState.Added ? AuditActions.ApiKeyCreated
                    : state == EntityState.Modified && Changed(entry, nameof(ApiKey.RevokedAt), out _) ? AuditActions.ApiKeyRevoked
                    : null;
                if (keyAction is null)
                {
                    break;
                }

                foreach (var organizationId in await w.Lookup.OrganizationsOfAsync(key.UserId))
                {
                    await w.OrganizationAsync(
                        organizationId, keyAction, "api_key", key.Id, key.Name,
                        ("owner", await w.Lookup.UserLabelAsync(key.UserId)), ("prefix", key.Prefix), ("expires_at", key.ExpiresAt?.ToString("O")));
                }

                break;
        }
    }

    private static async Task CollectionAsync(EntityEntry entry, Collection c, SaveContext save, AuditWriter w)
    {
        if (entry.State == EntityState.Deleted && !save.AddedOrDeleted<Workspace>(c.WorkspaceId))
        {
            await w.WorkspaceAsync(c.WorkspaceId, AuditActions.CollectionDeleted, "collection", c.Id, c.Name);
            return;
        }

        if (entry.State != EntityState.Modified)
        {
            return;
        }

        if (Changed(entry, nameof(Collection.WorkspaceId), out var oldWorkspace) && oldWorkspace is Guid from)
        {
            var source = await w.Lookup.WorkspaceAsync(from);
            var target = await w.Lookup.WorkspaceAsync(c.WorkspaceId);
            await w.WorkspaceAsync(c.WorkspaceId, AuditActions.CollectionMovedIn, "collection", c.Id, c.Name, ("from_workspace", source?.Name));
            if (source is { } s && target is { } t && s.OrganizationId != t.OrganizationId)
            {
                // Başka organizasyona taşındıysa kaynak organizasyonun kaydında da görünür.
                await w.WorkspaceAsync(from, AuditActions.CollectionMovedOut, "collection", c.Id, c.Name, ("to_workspace", t.Name));
            }
        }

        if (Changed(entry, nameof(Collection.EditingRestricted), out _))
        {
            await w.WorkspaceAsync(c.WorkspaceId, c.EditingRestricted ? AuditActions.CollectionEditingRestricted : AuditActions.CollectionEditingUnrestricted, "collection", c.Id, c.Name);
        }
    }

    private static async Task CollectionAccessAsync(EntityEntry entry, CollectionAccessEntry a, SaveContext save, AuditWriter w)
    {
        if (await w.Lookup.CollectionAsync(a.CollectionId) is not { } collection)
        {
            return;
        }

        if (entry.State == EntityState.Deleted && a.UserId is { } removedUser
            && await w.Lookup.WorkspaceAsync(collection.WorkspaceId) is { } ws && save.LeftOrganization(ws.OrganizationId, removedUser))
        {
            return;
        }

        var subject = a.UserId is { } userId ? await w.Lookup.UserLabelAsync(userId) : (await w.Lookup.TeamAsync(a.TeamId!.Value))?.Name ?? "—";
        var subjectType = a.UserId is null ? "team" : "user";
        if (entry.State == EntityState.Added)
        {
            await w.WorkspaceAsync(collection.WorkspaceId, AuditActions.CollectionAccessGranted, "collection", a.CollectionId, collection.Name, ("subject", subject), ("subject_type", subjectType), ("role", a.Role.ToString()));
        }
        else if (entry.State == EntityState.Deleted)
        {
            await w.WorkspaceAsync(collection.WorkspaceId, AuditActions.CollectionAccessRemoved, "collection", a.CollectionId, collection.Name, ("subject", subject), ("subject_type", subjectType), ("role", a.Role.ToString()));
        }
        else if (Changed(entry, nameof(CollectionAccessEntry.Role), out var oldRole))
        {
            await w.WorkspaceAsync(collection.WorkspaceId, AuditActions.CollectionAccessChanged, "collection", a.CollectionId, collection.Name, ("subject", subject), ("subject_type", subjectType), ("from", oldRole?.ToString()), ("to", a.Role.ToString()));
        }
    }

    private static bool Changed(EntityEntry entry, string property, out object? original)
    {
        var p = entry.Property(property);
        original = p.OriginalValue;
        return entry.State == EntityState.Modified && p.IsModified && !Equals(p.OriginalValue, p.CurrentValue);
    }

    /// <summary>
    /// Aynı kaydetmedeki diğer değişiklikler (alt kayıtların tekrar yazılmaması için). Bir kez indekslenir; toplu
    /// kaydetmelerde (içe aktarma, workspace silme) her kayıt için listeyi baştan taramamak için.
    /// </summary>
    private sealed class SaveContext
    {
        private readonly HashSet<(Type Type, Guid Id)> _addedOrDeleted = [];
        private readonly HashSet<(Guid OrganizationId, Guid UserId)> _left = [];
        private readonly HashSet<(Guid OrganizationId, Guid UserId)> _accepted = [];
        private readonly HashSet<Guid> _ownerChanged = [];
        private readonly HashSet<(Guid OrganizationId, string Email)> _invited = [];

        public SaveContext(List<EntityEntry> entries)
        {
            foreach (var e in entries)
            {
                if (e.State is EntityState.Added or EntityState.Deleted && e.Entity is Domain.Common.Entity entity)
                {
                    _addedOrDeleted.Add((entity.GetType(), entity.Id));
                }

                switch (e)
                {
                    case { State: EntityState.Deleted, Entity: OrganizationMember m }:
                        _left.Add((m.OrganizationId, m.UserId));
                        break;
                    case { State: EntityState.Modified, Entity: Invitation { AcceptedById: { } acceptedBy } i }:
                        _accepted.Add((i.OrganizationId, acceptedBy));
                        break;
                    case { State: EntityState.Added, Entity: Invitation i }:
                        _invited.Add((i.OrganizationId, i.Email));
                        break;
                    case { State: EntityState.Modified, Entity: Organization o } when e.Property(nameof(Organization.OwnerId)).IsModified:
                        _ownerChanged.Add(o.Id);
                        break;
                }
            }
        }

        public bool AddedOrDeleted<T>(Guid id)
            where T : Domain.Common.Entity => _addedOrDeleted.Contains((typeof(T), id));

        public bool LeftOrganization(Guid organizationId, Guid userId) => _left.Contains((organizationId, userId));

        public bool Accepted(Guid organizationId, Guid userId) => _accepted.Contains((organizationId, userId));

        public bool OwnerChanged(Guid organizationId) => _ownerChanged.Contains(organizationId);

        /// <summary>Yeniden gönderme eski daveti geri alıp yenisini ekler; tek olay ("gönderildi") yeterli.</summary>
        public bool Reinvited(Guid organizationId, string email) => _invited.Contains((organizationId, email));
    }
}
