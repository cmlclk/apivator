using Apivator.Application.Abstractions;
using Apivator.Application.Realtime;
using Apivator.Application.Workspaces;
using Apivator.Domain.Workspaces;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Apivator.Api.Realtime;

/// <summary>Değişikliği yapan kişi; istemci kendi sekmesinden gelen olayı tanıyıp yok sayar.</summary>
public sealed record ChangeActor(Guid? UserId, string? DisplayName, string? ClientId);

public sealed record WorkspaceChangedEvent(
    Guid WorkspaceId,
    bool Collections,
    bool Environments,
    bool Runs,
    bool Workspace,
    IReadOnlyList<RequestChange> Requests,
    bool Activity,
    bool Comments,
    bool Mocks,
    bool Monitors,
    bool MergeRequests,
    ChangeActor Actor);

public sealed record OrganizationChangedEvent(Guid OrganizationId, ChangeActor Actor);

internal sealed class SignalRNotifier(
    IHubContext<WorkspaceHub> hub,
    IHttpContextAccessor accessor,
    PresenceTracker presence,
    CollabDocuments documents,
    IServiceScopeFactory scopes) : IRealtimeNotifier
{
    public const string ClientHeader = "X-Apivator-Client";

    public async Task PublishAsync(ChangeBatch batch, CancellationToken cancellationToken = default)
    {
        var http = accessor.HttpContext;
        var clientId = http?.Request.Headers[ClientHeader].ToString();
        var actor = new ChangeActor(
            Guid.TryParse(http?.User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value, out var id) ? id : null,
            http?.User.FindFirst(JwtRegisteredClaimNames.Name)?.Value,
            string.IsNullOrEmpty(clientId) ? null : clientId[..Math.Min(clientId.Length, 64)]);

        foreach (var change in batch.Workspaces)
        {
            await hub.Clients.Group(WorkspaceHub.WorkspaceGroup(change.WorkspaceId)).SendAsync(
                "workspaceChanged",
                new WorkspaceChangedEvent(change.WorkspaceId, change.Collections, change.Environments, change.Runs, change.Workspace, change.Requests, change.Activity, change.Comments, change.Mocks, change.Monitors, change.MergeRequests, actor),
                cancellationToken);
        }

        foreach (var organizationId in batch.Organizations)
        {
            await hub.Clients.Group(WorkspaceHub.OrganizationGroup(organizationId))
                .SendAsync("organizationChanged", new OrganizationChangedEvent(organizationId, actor), cancellationToken);
        }

        // Yeni katılan ya da çıkarılan kişi henüz/artık organizasyon grubunda olmayabilir.
        foreach (var userId in batch.AffectedUsers)
        {
            await hub.Clients.Group(WorkspaceHub.UserGroup(userId)).SendAsync("accessChanged", cancellationToken);
        }

        foreach (var userId in batch.InvitedUsers)
        {
            await hub.Clients.Group(WorkspaceHub.UserGroup(userId)).SendAsync("invitationsChanged", cancellationToken);
        }

        foreach (var userId in batch.NotifiedUsers ?? [])
        {
            await hub.Clients.Group(WorkspaceHub.UserGroup(userId)).SendAsync("notificationsChanged", cancellationToken);
        }

        await EvictLostAccessAsync(batch, cancellationToken);
        await RecheckDocumentAccessAsync(batch, cancellationToken);
    }

    /// <summary>
    /// Üyelik değiştiyse açık bağlantıların erişimi yeniden denetlenir; erişimi kalkan bağlantı workspace grubundan
    /// çıkarılır, böylece sonraki olayları (ve kimin çevrimiçi olduğunu) artık görmez.
    /// </summary>
    private async Task EvictLostAccessAsync(ChangeBatch batch, CancellationToken ct)
    {
        if (batch.Organizations.Count == 0 && batch.AffectedUsers.Count == 0 && !batch.Workspaces.Any(w => w.Workspace))
        {
            return;
        }

        var joined = presence.Joined();
        if (joined.Count == 0)
        {
            return;
        }

        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IApplicationDbContext>();
        var access = scope.ServiceProvider.GetRequiredService<IWorkspaceAccess>();
        var workspaceIds = joined.Select(j => j.WorkspaceId).Distinct().ToList();
        var organizationOf = await db.Workspaces.AsNoTracking()
            .Where(w => workspaceIds.Contains(w.Id))
            .ToDictionaryAsync(w => w.Id, w => w.OrganizationId, ct);
        var flagged = batch.Workspaces.Where(w => w.Workspace).Select(w => w.WorkspaceId).ToHashSet();

        var changedWorkspaces = new HashSet<Guid>();
        foreach (var (connectionId, userId, workspaceId) in joined)
        {
            var relevant = flagged.Contains(workspaceId)
                || batch.AffectedUsers.Contains(userId)
                || !organizationOf.TryGetValue(workspaceId, out var organizationId)
                || batch.Organizations.Contains(organizationId);
            if (!relevant || await access.RoleAsync(workspaceId, userId, ct) is not null)
            {
                continue;
            }

            await presence.LeaveAsync(connectionId);
            await hub.Groups.RemoveFromGroupAsync(connectionId, WorkspaceHub.WorkspaceGroup(workspaceId), ct);
            await hub.Clients.Client(connectionId).SendAsync("accessChanged", ct);
            changedWorkspaces.Add(workspaceId);
        }

        foreach (var workspaceId in changedWorkspaces)
        {
            await hub.Clients.Group(WorkspaceHub.WorkspaceGroup(workspaceId)).SendAsync("presence", await presence.SnapshotAsync(workspaceId), ct);
        }
    }

    /// <summary>
    /// Ortak taslağa katılmış bağlantıların collection yetkisi yeniden denetlenir: erişimi kalkan belgeden çıkarılır,
    /// düzenleyiciliği düşen yalnızca alır.
    /// </summary>
    private async Task RecheckDocumentAccessAsync(ChangeBatch batch, CancellationToken ct)
    {
        var joined = documents.All();
        if (joined.Count == 0 || (batch.Organizations.Count == 0 && batch.AffectedUsers.Count == 0 && !batch.Workspaces.Any(w => w.Workspace || w.Collections)))
        {
            return;
        }

        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<IApplicationDbContext>();
        var access = scope.ServiceProvider.GetRequiredService<IWorkspaceAccess>();
        var ids = joined.Select(j => j.DocumentId).Distinct().ToList();
        var collectionOf = await db.Requests.AsNoTracking()
            .Where(r => ids.Contains(r.Id)).ToDictionaryAsync(r => r.Id, r => r.CollectionId, ct);
        foreach (var (connectionId, userId, documentId, canEdit) in joined)
        {
            var role = collectionOf.TryGetValue(documentId, out var collectionId)
                ? await access.CollectionRoleAsync(collectionId, userId, ct)
                : null;
            if (role is null)
            {
                await documents.LeaveAsync(connectionId, documentId);
                await hub.Groups.RemoveFromGroupAsync(connectionId, WorkspaceHub.DocumentGroup(documentId), ct);
                await hub.Clients.Client(connectionId).SendAsync("docRevoked", documentId, ct);
            }
            else if (canEdit != (role >= WorkspaceRole.Editor))
            {
                documents.SetCanEdit(connectionId, documentId, role >= WorkspaceRole.Editor);
                await hub.Clients.Client(connectionId).SendAsync("docAccessChanged", documentId, role >= WorkspaceRole.Editor, ct);
            }
        }
    }
}
