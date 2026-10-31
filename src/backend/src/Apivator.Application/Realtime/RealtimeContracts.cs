namespace Apivator.Application.Realtime;

/// <summary>Kaydedilen bir isteğin yeni sürümü; açık sekmeler buna göre güncellenir ya da çakışma gösterir.</summary>
public sealed record RequestChange(Guid Id, Guid CollectionId, int Version, bool Deleted);

/// <summary>Bir workspace'te neyin değiştiği. İstemci yalnızca ilgili listeleri yeniden çeker; içerik taşınmaz.</summary>
public sealed record WorkspaceChange(
    Guid WorkspaceId,
    bool Collections,
    bool Environments,
    bool Runs,
    bool Workspace,
    IReadOnlyList<RequestChange> Requests,
    bool Activity = false,
    bool Comments = false,
    bool Mocks = false,
    bool Monitors = false,
    bool MergeRequests = false);

/// <summary>Tek bir kaydetmenin (SaveChanges) sonucu olarak bildirilecekler.</summary>
public sealed record ChangeBatch(
    IReadOnlyList<WorkspaceChange> Workspaces,
    IReadOnlyCollection<Guid> Organizations,
    IReadOnlyCollection<Guid> AffectedUsers,
    IReadOnlyCollection<Guid> InvitedUsers,
    IReadOnlyCollection<Guid>? NotifiedUsers = null)
{
    public bool IsEmpty =>
        Workspaces.Count == 0 && Organizations.Count == 0 && AffectedUsers.Count == 0 && InvitedUsers.Count == 0 && (NotifiedUsers?.Count ?? 0) == 0;
}

/// <summary>Değişiklikleri bağlı istemcilere iletir (API'de SignalR; başka yerde hiçbir şey yapmaz).</summary>
public interface IRealtimeNotifier
{
    Task PublishAsync(ChangeBatch batch, CancellationToken cancellationToken = default);
}

public sealed class NullRealtimeNotifier : IRealtimeNotifier
{
    public Task PublishAsync(ChangeBatch batch, CancellationToken cancellationToken = default) => Task.CompletedTask;
}
