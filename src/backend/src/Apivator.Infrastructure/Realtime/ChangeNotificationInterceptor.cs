using Apivator.Application.Realtime;
using Apivator.Domain.Activity;
using Apivator.Domain.Collections;
using Apivator.Domain.Comments;
using Apivator.Domain.Environments;
using Apivator.Domain.Forks;
using Apivator.Domain.Mocks;
using Apivator.Domain.Monitors;
using Apivator.Domain.Organizations;
using Apivator.Domain.Runs;
using Apivator.Domain.Workspaces;
using Apivator.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;

namespace Apivator.Infrastructure.Realtime;

/// <summary>
/// Her başarılı kaydetmeden sonra neyin değiştiğini bağlı istemcilere bildirir. Servisler olay yayınlamayı
/// unutamasın diye değişiklik izleyicisinden (ChangeTracker) çıkarılır; yalnızca kimlikler ve sürümler taşınır,
/// içerik her zaman yetki kontrollü API'den okunur.
/// </summary>
internal sealed class ChangeNotificationInterceptor(IRealtimeNotifier notifier, ILogger<ChangeNotificationInterceptor> logger)
    : SaveChangesInterceptor
{
    private PendingBatch? _pending;

    public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is { } context)
        {
            _pending = await CollectAsync(context, cancellationToken);
        }

        return result;
    }

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        if (eventData.Context is { } context)
        {
            _pending = CollectAsync(context, CancellationToken.None).GetAwaiter().GetResult();
        }

        return result;
    }

    public override async ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        await PublishAsync(cancellationToken);
        return result;
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        PublishAsync(CancellationToken.None).GetAwaiter().GetResult();
        return result;
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData) => _pending = null;

    public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        _pending = null;
        return Task.CompletedTask;
    }

    private async Task PublishAsync(CancellationToken cancellationToken)
    {
        var batch = _pending?.Build();
        _pending = null;
        if (batch is null || batch.IsEmpty)
        {
            return;
        }

        try
        {
            await notifier.PublishAsync(batch, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Bildirim başarısız olsa da veri kaydedildi; istemciler bir sonraki yenilemede görür.
            logger.LogWarning(ex, "Gerçek zamanlı bildirim gönderilemedi.");
        }
    }

    private static async Task<PendingBatch?> CollectAsync(DbContext context, CancellationToken ct)
    {
        var entries = context.ChangeTracker.Entries()
            .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
            .ToList();
        if (entries.Count == 0)
        {
            return null;
        }

        var batch = new PendingBatch();
        var collectionIds = new HashSet<Guid>();
        var exampleRequestIds = new HashSet<Guid>();
        var membershipWorkspaceIds = new HashSet<Guid>();
        var teamIds = new HashSet<Guid>();
        var invitedEmails = new HashSet<string>(StringComparer.Ordinal);

        foreach (var entry in entries)
        {
            switch (entry.Entity)
            {
                case Collection c:
                    foreach (var id in Values(entry, nameof(Collection.WorkspaceId), c.WorkspaceId))
                    {
                        batch.Workspace(id).Collections = true;
                    }

                    if (entry.State != EntityState.Added)
                    {
                        // Taşınan ya da silinen collection'ın istekleri açık sekmelerde olabilir.
                        collectionIds.Add(c.Id);
                    }

                    break;
                case Folder f:
                    collectionIds.Add(f.CollectionId);
                    break;
                case CollectionAccessEntry a:
                    // Collection rolü değişince ağaçtaki "düzenleyebilir" bilgisi tazelenmeli.
                    collectionIds.Add(a.CollectionId);
                    break;
                case ApiRequest r:
                    foreach (var id in Values(entry, nameof(ApiRequest.CollectionId), r.CollectionId))
                    {
                        collectionIds.Add(id);
                    }

                    batch.Requests.Add((r, entry.State == EntityState.Deleted));
                    break;
                case ResponseExample e:
                    exampleRequestIds.Add(e.RequestId);
                    break;
                case WorkspaceEnvironment env:
                    batch.Workspace(env.WorkspaceId).Environments = true;
                    break;
                case CollectionRun run:
                    foreach (var id in Values(entry, nameof(CollectionRun.WorkspaceId), run.WorkspaceId))
                    {
                        batch.Workspace(id).Runs = true;
                    }

                    break;
                case Workspace w:
                    batch.Workspace(w.Id).Workspace = true;
                    batch.Organizations.Add(w.OrganizationId);
                    break;
                case WorkspaceMember m:
                    membershipWorkspaceIds.Add(m.WorkspaceId);
                    batch.Workspace(m.WorkspaceId).Workspace = true;
                    batch.AffectedUsers.Add(m.UserId);
                    break;
                case WorkspaceTeam t:
                    membershipWorkspaceIds.Add(t.WorkspaceId);
                    batch.Workspace(t.WorkspaceId).Workspace = true;
                    teamIds.Add(t.TeamId);
                    break;
                case Organization o:
                    batch.Organizations.Add(o.Id);
                    break;
                case OrganizationMember m:
                    batch.Organizations.Add(m.OrganizationId);
                    batch.AffectedUsers.Add(m.UserId);
                    break;
                case Team t:
                    batch.Organizations.Add(t.OrganizationId);
                    break;
                case TeamMember m:
                    teamIds.Add(m.TeamId);
                    batch.AffectedUsers.Add(m.UserId);
                    break;
                case ChangeLogEntry log when entry.State == EntityState.Added && !log.Quiet:
                    batch.Workspace(log.WorkspaceId).Activity = true;
                    break;
                case MockServer mock:
                    foreach (var id in Values(entry, nameof(MockServer.WorkspaceId), mock.WorkspaceId))
                    {
                        batch.Workspace(id).Mocks = true;
                    }

                    break;
                case CollectionMonitor monitor:
                    foreach (var id in Values(entry, nameof(CollectionMonitor.WorkspaceId), monitor.WorkspaceId))
                    {
                        batch.Workspace(id).Monitors = true;
                    }

                    break;
                case MergeRequest mergeRequest:
                    batch.Workspace(mergeRequest.WorkspaceId).MergeRequests = true;
                    break;
                case CollectionFork fork:
                    // Fork rozetleri collection listesinde; iki tarafın workspace'i de tazelenir.
                    collectionIds.Add(fork.ForkCollectionId);
                    collectionIds.Add(fork.SourceCollectionId);
                    break;
                case Comment comment:
                    batch.Workspace(comment.WorkspaceId).Comments = true;
                    break;
                case Notification n when entry.State == EntityState.Added:
                    batch.NotifiedUsers.Add(n.UserId);
                    break;
                case Invitation i:
                    batch.Organizations.Add(i.OrganizationId);
                    invitedEmails.Add(i.Email.ToUpperInvariant());
                    break;
            }
        }

        // Kaydetmeden önce sorgulanır: silinen kayıtların bağlı olduğu satırlar henüz yerinde.
        if (exampleRequestIds.Count > 0)
        {
            collectionIds.UnionWith(await context.Set<ApiRequest>().AsNoTracking()
                .Where(r => exampleRequestIds.Contains(r.Id)).Select(r => r.CollectionId).ToListAsync(ct));
        }

        if (collectionIds.Count > 0)
        {
            var known = context.ChangeTracker.Entries<Collection>()
                .Where(e => collectionIds.Contains(e.Entity.Id))
                .ToDictionary(e => e.Entity.Id, e => e.Entity.WorkspaceId);
            var missing = collectionIds.Where(id => !known.ContainsKey(id)).ToList();
            foreach (var row in await context.Set<Collection>().AsNoTracking()
                         .Where(c => missing.Contains(c.Id)).Select(c => new { c.Id, c.WorkspaceId }).ToListAsync(ct))
            {
                known[row.Id] = row.WorkspaceId;
            }

            foreach (var workspaceId in known.Values)
            {
                batch.Workspace(workspaceId).Collections = true;
            }

            batch.CollectionWorkspaces = known;
        }

        if (membershipWorkspaceIds.Count > 0)
        {
            batch.Organizations.UnionWith(await context.Set<Workspace>().AsNoTracking()
                .Where(w => membershipWorkspaceIds.Contains(w.Id)).Select(w => w.OrganizationId).ToListAsync(ct));
        }

        if (teamIds.Count > 0)
        {
            batch.Organizations.UnionWith(await context.Set<Team>().AsNoTracking()
                .Where(t => teamIds.Contains(t.Id)).Select(t => t.OrganizationId).ToListAsync(ct));
        }

        if (invitedEmails.Count > 0)
        {
            batch.InvitedUsers.UnionWith(await context.Set<ApplicationUser>().AsNoTracking()
                .Where(u => u.NormalizedEmail != null && invitedEmails.Contains(u.NormalizedEmail)).Select(u => u.Id).ToListAsync(ct));
        }

        return batch;
    }

    /// <summary>Alanın şimdiki ve (taşındıysa) önceki değeri.</summary>
    private static IEnumerable<Guid> Values(EntityEntry entry, string property, Guid current)
    {
        yield return current;
        if (entry.State == EntityState.Modified && entry.Property(property).OriginalValue is Guid original && original != current)
        {
            yield return original;
        }
    }

    private sealed class Flags
    {
        public bool Collections { get; set; }

        public bool Environments { get; set; }

        public bool Runs { get; set; }

        public bool Workspace { get; set; }

        public bool Activity { get; set; }

        public bool Comments { get; set; }

        public bool Mocks { get; set; }

        public bool Monitors { get; set; }

        public bool MergeRequests { get; set; }
    }

    private sealed class PendingBatch
    {
        private readonly Dictionary<Guid, Flags> _workspaces = [];

        public List<(ApiRequest Request, bool Deleted)> Requests { get; } = [];

        public Dictionary<Guid, Guid> CollectionWorkspaces { get; set; } = [];

        public HashSet<Guid> Organizations { get; } = [];

        public HashSet<Guid> AffectedUsers { get; } = [];

        public HashSet<Guid> InvitedUsers { get; } = [];

        public HashSet<Guid> NotifiedUsers { get; } = [];

        public Flags Workspace(Guid id)
        {
            if (!_workspaces.TryGetValue(id, out var flags))
            {
                _workspaces[id] = flags = new Flags();
            }

            return flags;
        }

        /// <summary>Kaydetmeden sonra çağrılır: isteklerin sürüm numaraları artık kesin.</summary>
        public ChangeBatch Build()
        {
            var requests = Requests
                .Select(r => (WorkspaceId: CollectionWorkspaces.GetValueOrDefault(r.Request.CollectionId),
                    Change: new RequestChange(r.Request.Id, r.Request.CollectionId, r.Request.Version, r.Deleted)))
                .Where(r => r.WorkspaceId != Guid.Empty)
                .ToLookup(r => r.WorkspaceId, r => r.Change);

            var changes = _workspaces
                .Select(w => new WorkspaceChange(w.Key, w.Value.Collections, w.Value.Environments, w.Value.Runs, w.Value.Workspace, [.. requests[w.Key]], w.Value.Activity, w.Value.Comments, w.Value.Mocks, w.Value.Monitors, w.Value.MergeRequests))
                .ToList();
            return new ChangeBatch(changes, Organizations, AffectedUsers, InvitedUsers, NotifiedUsers);
        }
    }
}
