using System.Collections.Concurrent;
using Apivator.Application.GitSync;

namespace Apivator.Infrastructure.GitSync;

/// <summary>
/// Tek süreçli kurulumlar (SQLite / yerel mod) için collection başına süreç içi kilit; advisory lock yerine.
/// </summary>
internal sealed class InProcessGitLock : IGitLock
{
    private static readonly ConcurrentDictionary<Guid, SemaphoreSlim> Locks = new();

    public async Task<IAsyncDisposable> AcquireAsync(Guid collectionId, CancellationToken ct = default)
    {
        var semaphore = Locks.GetOrAdd(collectionId, _ => new SemaphoreSlim(1, 1));
        await semaphore.WaitAsync(ct);
        return new Handle(semaphore);
    }

    private sealed class Handle(SemaphoreSlim semaphore) : IAsyncDisposable
    {
        private int _released;

        public ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref _released, 1) == 0)
            {
                semaphore.Release();
            }

            return ValueTask.CompletedTask;
        }
    }
}
