using System.Collections.Concurrent;
using Apivator.Application.Abstractions;
using Apivator.Application.Audit;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Forks;
using Apivator.Application.Workspaces;
using Apivator.Domain.Audit;
using Apivator.Domain.Collections;
using Apivator.Domain.GitSync;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Application.GitSync;

/// <summary>
/// Collection'ı Git deposuna dosya olarak gönderir ve depodan alır. Karşılaştırma son eşitlemedeki ortak hâle
/// (taban) göre üç yönlüdür; gönderme, uzakta henüz alınmamış değişiklik varsa reddedilir (önce "al").
/// </summary>
internal sealed partial class GitSyncService(
    IApplicationDbContext db,
    IWorkspaceAccess access,
    IGitRemote remote,
    IGitRemoteGuard guard,
    IGitSecretProtector protector,
    IAuditLog audit,
    IUserDirectory users,
    IGitLock gitLock,
    TimeProvider clock) : IGitSyncService, IGitChecker
{
    private static Error NotConnected => Error.NotFound("git.not_connected", L.T("git.not_connected", "Bu collection bir Git deposuna bağlı değil."));
    private static Error CollectionNotFound => Error.NotFound("collection.not_found", L.T("collection.not_found", "Collection bulunamadı."));
    private bool _showDetail;

    private sealed record Fetched(GitRemoteTree Tree, Dictionary<string, GitItem> Items);

    public async Task<Result<GitSyncDto>> GetAsync(Guid collectionId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireCollectionAsync(collectionId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var sync = await db.GitSyncs.AsNoTracking().FirstOrDefaultAsync(s => s.CollectionId == collectionId, ct);
        return sync is null ? NotConnected : await ToDtoAsync(sync, ct);
    }

    public async Task<Result<GitSyncDto>> ConnectAsync(Guid collectionId, ConnectGitRequest request, Guid userId, CancellationToken ct = default)
    {
        var (collection, error) = await AdminAsync(collectionId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        var (url, urlError) = GitSyncSettings.CanonicalUrl(request.RemoteUrl);
        var invalid = urlError ?? GitSyncSettings.ValidateBranch(request.Branch);
        var (folder, folderError) = GitSyncSettings.NormalizeFolder(request.FolderPath);
        invalid ??= folderError;
        if (invalid is null && ((request.Username?.Length ?? 0) > CollectionGitSync.UsernameMaxLength || (request.Token?.Length ?? 0) > GitSyncSettings.TokenMaxLength))
        {
            invalid = Error.Validation("git.credentials_invalid", L.T("git.credentials_invalid", "Kullanıcı adı ya da belirteç çok uzun."));
        }

        if (invalid is not null)
        {
            return invalid;
        }

        if (await guard.ValidateAsync(url, ct) is { } blocked)
        {
            return Error.Validation("git.url_blocked", blocked);
        }

        var now = clock.GetUtcNow();
        var username = string.IsNullOrWhiteSpace(request.Username) ? null : request.Username.Trim();
        var token = string.IsNullOrEmpty(request.Token) ? null : protector.Protect(request.Token.Trim());
        string? oldHost = null;
        var sync = await db.GitSyncs.FirstOrDefaultAsync(s => s.CollectionId == collectionId, ct);
        if (sync is null)
        {
            sync = CollectionGitSync.Create(collectionId, url, request.Branch.Trim(), folder, username, token, userId, now);
            db.GitSyncs.Add(sync);
        }
        else
        {
            oldHost = GitSyncSettings.HostOf(sync.RemoteUrl);
            sync.Reconfigure(url, request.Branch.Trim(), folder, username, token, GitSyncSettings.HostOf(url) != oldHost);
        }

        if (request.ClearToken && token is null)
        {
            sync.ClearToken();
        }

        await RecordAsync(collection!, AuditActions.GitConnected, sync, ct, ("token", sync.ProtectedToken is null ? "yok" : "var"), ("old_host", oldHost), ("new_host", oldHost is null || oldHost == GitSyncSettings.HostOf(url) ? null : GitSyncSettings.HostOf(url)));
        await db.SaveChangesAsync(ct);
        return await ToDtoAsync(sync, ct);
    }

    public async Task<Result> DisconnectAsync(Guid collectionId, Guid userId, CancellationToken ct = default)
    {
        var (collection, error) = await AdminAsync(collectionId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        var sync = await db.GitSyncs.FirstOrDefaultAsync(s => s.CollectionId == collectionId, ct);
        if (sync is null)
        {
            return NotConnected;
        }

        await RecordAsync(collection!, AuditActions.GitDisconnected, sync, ct);
        db.GitSyncs.Remove(sync);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<GitSyncDto>> SetScheduleAsync(Guid collectionId, SetGitScheduleRequest request, Guid userId, CancellationToken ct = default)
    {
        var (sync, error) = await LoadForWriteAsync(collectionId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        if (request.IntervalHours is { } hours && !CollectionGitSync.CheckIntervals.Contains(hours))
        {
            return Error.Validation("git.interval_invalid", L.T("git.interval_invalid", "Kontrol aralığı 1, 6 ya da 24 saat olabilir."));
        }

        sync!.Schedule(request.IntervalHours, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return await ToDtoAsync(sync, ct);
    }

    public async Task<Result<GitPullPreviewDto>> PreviewPullAsync(Guid collectionId, Guid userId, CancellationToken ct = default)
    {
        var (sync, error) = await LoadForWriteAsync(collectionId, userId, ct);
        if (error is not null)
        {
            return error;
        }

        var side = await ForkSide.LoadAsync(db, "local", collectionId, ct);
        var (fetched, fetchError) = await FetchAsync(sync!, ct);
        if (fetchError is not null)
        {
            return fetchError;
        }

        var changes = GitDiff.Compare(GitLocalItems.From(side), fetched!.Items, sync!.BaseSnapshot).Where(c => c.Remote is not null).ToList();
        sync.Checked(fetched.Tree.Head, changes.Count, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return new GitPullPreviewDto(fetched.Tree.Head, [.. changes.Select(c => c.ToDto())]);
    }

    public async Task CheckAsync(Guid syncId, CancellationToken ct = default)
    {
        var sync = await db.GitSyncs.FirstOrDefaultAsync(s => s.Id == syncId, ct);
        if (sync is null)
        {
            return;
        }

        var side = await ForkSide.LoadAsync(db, "local", sync.CollectionId, ct);
        var (fetched, error) = await FetchAsync(sync, ct);
        if (error is null)
        {
            var behind = GitDiff.Compare(GitLocalItems.From(side), fetched!.Items, sync.BaseSnapshot).Count(c => c.Remote is not null);
            sync.Checked(fetched.Tree.Head, behind, clock.GetUtcNow());
            await db.SaveChangesAsync(ct);
        }
    }

    private async Task<(Collection? Collection, Error? Error)> AdminAsync(Guid collectionId, Guid userId, CancellationToken ct)
    {
        var collection = await db.Collections.AsNoTracking().FirstOrDefaultAsync(c => c.Id == collectionId, ct);
        if (collection is null || await access.RequireAsync(collection.WorkspaceId, userId, WorkspaceRole.Viewer, ct) is not null)
        {
            return (null, CollectionNotFound);
        }

        return await access.RequireAsync(collection.WorkspaceId, userId, WorkspaceRole.Admin, ct) is { } denied ? (null, denied) : (collection, null);
    }

    private async Task<(CollectionGitSync? Sync, Error? Error)> LoadForWriteAsync(Guid collectionId, Guid userId, CancellationToken ct)
    {
        if (await access.RequireCollectionAsync(collectionId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return (null, denied);
        }

        var workspaceId = await db.Collections.AsNoTracking().Where(c => c.Id == collectionId).Select(c => c.WorkspaceId).FirstAsync(ct);
        _showDetail = await access.RequireAsync(workspaceId, userId, WorkspaceRole.Admin, ct) is null;

        var sync = await db.GitSyncs.FirstOrDefaultAsync(s => s.CollectionId == collectionId, ct);
        return sync is null ? (null, NotConnected) : (sync, null);
    }

    /// <summary>Uzak dalı okur ve öğelere çevirir; hata olursa bağlantıya yazar (kaydeder) ve Türkçe hata döner.</summary>
    private async Task<(Fetched? Fetched, Error? Error)> FetchAsync(CollectionGitSync sync, CancellationToken ct)
    {
        var (spec, specError) = TrySpec(sync);
        if (specError is not null)
        {
            return (null, await FailAsync(sync, "git.token_unreadable", specError, ct));
        }

        if (await guard.ValidateAsync(sync.RemoteUrl, ct) is { } blocked)
        {
            return (null, await FailAsync(sync, "git.url_blocked", blocked, ct));
        }

        GitRemoteTree tree;
        try
        {
            tree = await remote.ReadAsync(spec!, sync.FolderPath, ct);
        }
        catch (GitRemoteException ex)
        {
            return (null, await FailAsync(sync, "git.remote_failed", ex.Message, ct, ex.Detail));
        }

        var (items, parseError) = GitLayout.Parse(tree.Files);
        return parseError is not null
            ? (null, await FailAsync(sync, "git.files_invalid", parseError, ct))
            : (new Fetched(tree, items), null);
    }

    /// <summary>Hatayı bağlantıya yazar. Ham ayrıntı (<paramref name="detail"/>) yalnızca yöneticiye dönen hataya eklenir, saklanmaz.</summary>
    private async Task<Error> FailAsync(CollectionGitSync sync, string code, string message, CancellationToken ct, string? detail = null)
    {
        sync.Failed(message, clock.GetUtcNow(), L.T("gitsync.auto_check_disabled", "Otomatik kontrol üst üste hata nedeniyle kapatıldı."));
        await db.SaveChangesAsync(ct);
        return Error.Validation(code, _showDetail && !string.IsNullOrEmpty(detail) ? L.T("git.error_detail", "{message} Ayrıntı: {detail}", ("message", message), ("detail", detail)) : message);
    }

    /// <summary>Erişim bilgisi; kayıtlı belirteç çözülemiyorsa (anahtar kaybolmuş) sessizce anonim denenmez, hata döner.</summary>
    private (GitRemoteSpec? Spec, string? Error) TrySpec(CollectionGitSync sync)
    {
        string? token = null;
        if (sync.ProtectedToken is not null && (token = protector.Unprotect(sync.ProtectedToken)) is null)
        {
            return (null, L.T("git.token_unreadable", "Kayıtlı erişim belirteci çözülemiyor. Workspace yöneticisi belirteci yeniden girmeli."));
        }

        return (new GitRemoteSpec(sync.RemoteUrl, sync.Branch, sync.Username, token), null);
    }

    private async Task<GitSyncDto> ToDtoAsync(CollectionGitSync sync, CancellationToken ct)
    {
        var side = await ForkSide.LoadAsync(db, "local", sync.CollectionId, ct);
        var ahead = GitDiff.Ahead(GitLocalItems.From(side), sync.BaseSnapshot);
        var names = sync.LastSyncedById is { } id ? await users.DisplayNamesAsync([id], ct) : null;
        return new GitSyncDto(
            sync.Id, sync.CollectionId, sync.RemoteUrl, sync.Branch, sync.FolderPath, sync.Username, sync.ProtectedToken is not null,
            sync.LastCommit, sync.LastSyncedAt, sync.LastSyncedById is { } by ? names?.GetValueOrDefault(by) : null,
            sync.RemoteHead, ahead, sync.Behind, sync.LastCheckedAt, sync.LastError, sync.CheckIntervalHours, sync.ConnectedAt);
    }

    private async Task RecordAsync(Collection collection, string action, CollectionGitSync sync, CancellationToken ct, params (string Key, string? Value)[] extra)
    {
        var workspace = await db.Workspaces.AsNoTracking().FirstAsync(w => w.Id == collection.WorkspaceId, ct);
        var data = new Dictionary<string, string?>
        {
            ["remote"] = sync.RemoteUrl,
            ["branch"] = sync.Branch,
            ["path"] = sync.FolderPath,
        };
        foreach (var (key, value) in extra)
        {
            data[key] = value;
        }

        await audit.RecordAsync(workspace.OrganizationId, action, "collection", collection.Id, collection.Name, data, ct: ct, workspaceId: workspace.Id, workspaceName: workspace.Name);
    }
}
