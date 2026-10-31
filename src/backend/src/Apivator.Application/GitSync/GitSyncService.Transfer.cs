using System.Globalization;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Forks;
using Apivator.Domain.Audit;
using Apivator.Domain.Forks;
using Apivator.Domain.GitSync;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.GitSync;

internal sealed partial class GitSyncService
{
    public async Task<Result<GitPushResult>> PushAsync(Guid collectionId, PushGitRequest request, Guid userId, CancellationToken ct = default)
    {
        var (sync, error) = await LoadForWriteAsync(collectionId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        await using var gate = await gitLock.AcquireAsync(collectionId, ct);
        var side = await ForkSide.LoadAsync(db, "local", collectionId, ct);
        var (fetched, fetchError) = await FetchAsync(sync!, ct);
        if (fetchError is not null)
        {
            return fetchError;
        }

        var local = GitLocalItems.From(side);
        if (GitDiff.Compare(local, fetched!.Items, sync!.BaseSnapshot).Any(c => c.Remote is not null))
        {
            return Error.Conflict("git.behind", L.T("git.behind", "Depoda henüz alınmamış değişiklikler var. Önce \"Repodan al\" ile alın, sonra gönderin."));
        }

        var changed = GitDiff.Ahead(local, sync.BaseSnapshot);
        var warnings = GitSecretScanner.Scan(local.Values.Where(i => sync.BaseSnapshot.GetValueOrDefault(i.Key) != i.Content));
        if (warnings.Count > 0 && !request.AcknowledgeSecrets)
        {
            return Error.Conflict("git.secrets_suspected", L.T("git.secrets_suspected", "Depoya gitmemesi gereken değerler olabilir: {warnings} Kontrol edin; yine de göndermek için onaylayın.", ("warnings", string.Join(" ", warnings.Take(10)))));
        }

        var message = string.IsNullOrWhiteSpace(request.Message)
            ? L.T("git.default_commit_message", "Apivator: {name} güncellendi", ("name", side.Collection.Name))
            : request.Message.Trim()[..Math.Min(request.Message.Trim().Length, CollectionGitSync.CommitMessageMaxLength)];
        var (spec, specError) = TrySpec(sync);
        if (specError is not null)
        {
            return await FailAsync(sync, "git.token_unreadable", specError, ct);
        }

        var author = await AuthorAsync(userId, ct);
        string? commit;
        try
        {
            commit = await remote.PushAsync(spec!, sync.FolderPath, GitLayout.Build(local), fetched.Tree.Head, message, author, ct);
        }
        catch (GitRemoteException ex)
        {
            return await FailAsync(sync, "git.remote_failed", ex.Message, ct, ex.Detail);
        }

        sync.Synced(local.ToDictionary(i => i.Key, i => i.Value.Content), commit ?? fetched.Tree.Head, 0, userId, clock.GetUtcNow());
        if (commit is not null)
        {
            await RecordAsync(side.Collection, AuditActions.GitPushed, sync, ct, ("commit", commit), ("changed", changed.ToString(CultureInfo.InvariantCulture)));
        }

        await db.SaveChangesAsync(ct);
        return new GitPushResult(commit, changed, commit is null, await ToDtoAsync(sync, ct));
    }

    public async Task<Result<GitPullResult>> PullAsync(Guid collectionId, PullGitRequest request, Guid userId, CancellationToken ct = default)
    {
        var (sync, error) = await LoadForWriteAsync(collectionId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        await using var gate = await gitLock.AcquireAsync(collectionId, ct);
        var side = await ForkSide.LoadAsync(db, "local", collectionId, ct);
        var (fetched, fetchError) = await FetchAsync(sync!, ct);
        if (fetchError is not null)
        {
            return fetchError;
        }

        if (request.ExpectedHead is not null && request.ExpectedHead != fetched!.Tree.Head)
        {
            return Error.Conflict("git.remote_moved", L.T("git.remote_moved", "Depo önizlemeden sonra değişti. Farkı yeniden görüntüleyin."));
        }

        var local = GitLocalItems.From(side);
        var incoming = GitDiff.Compare(local, fetched!.Items, sync!.BaseSnapshot).Where(c => c.Remote is not null).ToList();
        var (theirs, mine, unresolved) = Decide(incoming, request.Resolutions);
        if (unresolved > 0)
        {
            return Error.Conflict("git.conflicts", L.T("git.conflicts", "{count} öğe iki tarafta da farklı değiştirilmiş. Her biri için hangisinin kalacağını seçin.", ("count", unresolved)));
        }

        if (await IdsInUseElsewhereAsync(theirs, collectionId, ct) is { } inUse)
        {
            return Error.Validation("git.id_in_use", L.T("git.id_in_use", "'{name}' başka bir collection'ın kimliğini kullanıyor; dosyadaki \"id\" alanını silin.", ("name", inUse)));
        }

        new GitApplier(db, side, fetched.Items, userId, clock.GetUtcNow()).Apply(theirs);
        var skipped = incoming.Count - theirs.Count - mine.Count;
        var keys = theirs.Concat(mine).Select(c => c.Key).Concat(Converged(local, fetched.Items, sync.BaseSnapshot));
        sync.Synced(GitDiff.Rebase(sync.BaseSnapshot, fetched.Items, keys), skipped == 0 ? fetched.Tree.Head : sync.LastCommit, skipped, userId, clock.GetUtcNow());
        await RecordAsync(side.Collection, AuditActions.GitPulled, sync, ct, ("commit", fetched.Tree.Head), ("applied", theirs.Count.ToString(CultureInfo.InvariantCulture)), ("kept_local", mine.Count.ToString(CultureInfo.InvariantCulture)));
        await db.SaveChangesAsync(ct);
        return new GitPullResult(theirs.Count, skipped, await ToDtoAsync(sync, ct));
    }

    /// <summary>
    /// Çözümlere göre uzak değişiklikleri ayırır: uzağınkini alınacaklar, yerelinki korunacaklar (yalnızca çakışmada);
    /// "skip" olanlar ve (çakışma değilse) "mine" seçilenler beklemeye alınır. Çözümsüz çakışma sayısı da döner.
    /// </summary>
    private static (List<GitChange> Theirs, List<GitChange> Mine, int Unresolved) Decide(
        IReadOnlyList<GitChange> incoming,
        IReadOnlyDictionary<string, string>? resolutions)
    {
        var theirs = new List<GitChange>();
        var mine = new List<GitChange>();
        var unresolved = 0;
        foreach (var change in incoming)
        {
            var choice = resolutions?.GetValueOrDefault(change.Key)?.ToLowerInvariant();
            if (change.Conflict && choice is not ("theirs" or "mine" or "skip"))
            {
                unresolved++;
            }
            else if (choice == "theirs" || (choice is null && !change.Conflict))
            {
                theirs.Add(change);
            }
            else if (choice == "mine" && change.Conflict)
            {
                mine.Add(change);
            }
        }

        return (theirs, mine, unresolved);
    }

    /// <summary>İki tarafta da aynı hâle gelmiş öğeler: tabanı bu hâle çekilir (değişiklik sayılmaz).</summary>
    private static IEnumerable<string> Converged(
        IReadOnlyDictionary<string, GitItem> local,
        IReadOnlyDictionary<string, GitItem> remote,
        IReadOnlyDictionary<string, string> baseSnapshot) =>
        local.Keys.Concat(remote.Keys).Concat(baseSnapshot.Keys).Distinct()
            .Where(k => local.GetValueOrDefault(k)?.Content == remote.GetValueOrDefault(k)?.Content
                && baseSnapshot.GetValueOrDefault(k) != remote.GetValueOrDefault(k)?.Content);

    /// <summary>Yeni oluşturulacak öğelerden birinin kimliği başka bir collection'da kullanılıyorsa onun adı.</summary>
    private async Task<string?> IdsInUseElsewhereAsync(IReadOnlyList<GitChange> applied, Guid collectionId, CancellationToken ct)
    {
        var created = applied.Where(c => c.Local is null && c.RemoteItem is { Kind: not ForkItemKind.Collection }).Select(c => c.RemoteItem!).ToList();
        var ids = created.Select(i => i.Id).ToList();
        if (ids.Count == 0)
        {
            return null;
        }

        var taken = await db.Folders.Where(f => ids.Contains(f.Id) && f.CollectionId != collectionId).Select(f => f.Id)
            .Concat(db.Requests.Where(r => ids.Contains(r.Id) && r.CollectionId != collectionId).Select(r => r.Id))
            .ToListAsync(ct);
        return created.FirstOrDefault(i => taken.Contains(i.Id))?.Name;
    }

    private async Task<GitAuthor> AuthorAsync(Guid userId, CancellationToken ct)
    {
        var user = (await users.UsersAsync([userId], ct)).GetValueOrDefault(userId);
        return new GitAuthor(user?.DisplayName ?? "Apivator", user?.Email ?? "noreply@apivator.local");
    }

}
