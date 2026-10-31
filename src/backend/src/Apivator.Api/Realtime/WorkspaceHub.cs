using Apivator.Application.Abstractions;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Workspaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Apivator.Api.Realtime;

/// <summary>
/// İstemcinin canlı kanalı. Bağlanınca kişisel grubuna ve organizasyon gruplarına katılır; açtığı workspace'in
/// grubuna yalnızca erişimi varsa girer. Sunucudan gelenler: workspaceChanged, organizationChanged,
/// accessChanged, invitationsChanged, presence.
/// </summary>
[Authorize]
internal sealed class WorkspaceHub(IApplicationDbContext db, IWorkspaceAccess access, IUserDirectory users, PresenceTracker presence, CollabDocuments documents) : Hub
{
    public const string Path = "/hubs/workspace";

    public static string UserGroup(Guid id) => $"user:{id}";

    public static string OrganizationGroup(Guid id) => $"org:{id}";

    public static string WorkspaceGroup(Guid id) => $"ws:{id}";

    public static string DocumentGroup(Guid id) => $"doc:{id:N}";

    private Guid UserId => Guid.Parse(Context.User!.FindFirst(JwtRegisteredClaimNames.Sub)!.Value);

    private const string LanguageKey = "lang";

    public override async Task OnConnectedAsync()
    {
        await StoreLanguageAsync();
        presence.Connect(Context.ConnectionId, UserId, Context.User?.FindFirst(JwtRegisteredClaimNames.Name)?.Value ?? "?");
        await Groups.AddToGroupAsync(Context.ConnectionId, UserGroup(UserId));
        await RefreshGroups();
        await base.OnConnectedAsync();
    }

    /// <summary>Hub çağrıları istek ara katmanının dilini taşımaz; bağlantı anında belirlenip bağlantıya yazılır.</summary>
    private async Task StoreLanguageAsync()
    {
        var http = Context.GetHttpContext();
        var language = Lang.Match(http?.Request.Query["lang"].ToString())
            ?? Lang.FromAcceptLanguage(http?.Request.Headers.AcceptLanguage.ToString())
            ?? await users.PreferredLanguageAsync(UserId, Context.ConnectionAborted);
        Context.Items[LanguageKey] = Lang.Match(language) ?? Lang.Default;
    }

    /// <summary>İletiyi bağlantının dilinde üretir (<paramref name="message"/> içinde <c>L.T</c> çağrılır).</summary>
    private HubException Fail(Func<string> message)
    {
        using (Lang.Use(Context.Items.TryGetValue(LanguageKey, out var language) ? language as string : null))
        {
            return new HubException(message());
        }
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (await presence.DisconnectAsync(Context.ConnectionId) is { } workspaceId)
        {
            // Bağlantı kapandığı için ConnectionAborted iptal edilmiş olur; yayın yine de gitmeli.
            await BroadcastPresenceAsync(workspaceId, CancellationToken.None);
        }

        await documents.LeaveAllAsync(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>Organizasyon üyelikleri değişince (davet kabulü vb.) istemci yeniden çağırır.</summary>
    public async Task RefreshGroups()
    {
        var userId = UserId;
        foreach (var organizationId in await db.OrganizationMembers.AsNoTracking()
                     .Where(m => m.UserId == userId).Select(m => m.OrganizationId).ToListAsync(Context.ConnectionAborted))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, OrganizationGroup(organizationId));
        }
    }

    /// <summary>Workspace'in olaylarına abone olur ve orada çevrimiçi olanları döner.</summary>
    public async Task<PresenceSnapshot> JoinWorkspace(Guid workspaceId)
    {
        if (await access.RoleAsync(workspaceId, UserId, Context.ConnectionAborted) is null)
        {
            throw Fail(() => L.T("realtime.workspace_forbidden", "Bu workspace'e erişiminiz yok."));
        }

        var previous = await presence.JoinAsync(Context.ConnectionId, workspaceId);
        if (previous is { } old)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, WorkspaceGroup(old));
            await BroadcastPresenceAsync(old, Context.ConnectionAborted);
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, WorkspaceGroup(workspaceId));
        await BroadcastPresenceAsync(workspaceId, Context.ConnectionAborted);
        return await presence.SnapshotAsync(workspaceId);
    }

    /// <summary>Açık (etkin) sekmedeki kayıtlı istek; yoksa null.</summary>
    public async Task ViewRequest(Guid? requestId)
    {
        if (await presence.ViewAsync(Context.ConnectionId, requestId) is { } workspaceId)
        {
            await BroadcastPresenceAsync(workspaceId, Context.ConnectionAborted);
        }
    }

    /// <summary>
    /// İsteğin ortak taslağına (Yjs belgesi) katılır. Görüntüleyici alır ama yazamaz; düzenleyici yazar. Dönen
    /// <c>First</c> true ise belgeyi bu istemci kaydedilmiş sürümden tohumlar, değilse güncellemeleri uygular.
    /// </summary>
    public async Task<DocumentJoin> JoinDocument(Guid requestId)
    {
        var role = await RoleOnRequestAsync(requestId);
        if (role is null)
        {
            throw Fail(() => L.T("realtime.request_not_found", "İstek bulunamadı ya da erişiminiz yok."));
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, DocumentGroup(requestId));
        return await documents.JoinAsync(Context.ConnectionId, UserId, requestId, role >= WorkspaceRole.Editor);
    }

    private async Task<WorkspaceRole?> RoleOnRequestAsync(Guid requestId)
    {
        var collectionId = await db.Requests.AsNoTracking()
            .Where(r => r.Id == requestId).Select(r => (Guid?)r.CollectionId).FirstOrDefaultAsync(Context.ConnectionAborted);
        return collectionId is { } id ? await access.CollectionRoleAsync(id, UserId, Context.ConnectionAborted) : null;
    }

    /// <summary>
    /// Yazmadan önce: hız sınırı ve (başka sunucuda iptal edilmiş olabilen) yetkinin süreli yeniden denetimi.
    /// </summary>
    private async Task RequireWriteAsync(Guid requestId, bool needEdit = true, bool rateLimited = true, bool awareness = false)
    {
        var canEdit = documents.CanEdit(Context.ConnectionId, requestId);
        if (canEdit is null || (needEdit && canEdit is false))
        {
            throw Fail(() => canEdit is null
                ? L.T("realtime.document_not_joined", "Bu belgeye katılmadınız.")
                : L.T("realtime.request_no_edit", "Bu isteği düzenleme yetkiniz yok."));
        }

        if (rateLimited && !(awareness ? documents.AllowAwareness(Context.ConnectionId) : documents.AllowWrite(Context.ConnectionId)))
        {
            throw Fail(() => L.T("realtime.rate_limited", "Çok sık güncelleme gönderiyorsunuz; biraz bekleyin."));
        }

        if (documents.NeedsRecheck(Context.ConnectionId, requestId))
        {
            var role = await RoleOnRequestAsync(requestId);
            if (role is null)
            {
                await LeaveDocument(requestId);
                throw Fail(() => L.T("realtime.request_access_lost", "Bu isteğe erişiminiz kalmadı."));
            }

            documents.SetCanEdit(Context.ConnectionId, requestId, role >= WorkspaceRole.Editor);
            if (needEdit && role < WorkspaceRole.Editor)
            {
                throw Fail(() => L.T("realtime.request_no_edit", "Bu isteği düzenleme yetkiniz yok."));
            }
        }
    }

    /// <summary>Base64 Yjs güncellemesi: günlüğe eklenir ve belgedeki diğerlerine iletilir.</summary>
    public async Task SendUpdate(Guid requestId, string update)
    {
        await RequireWriteAsync(requestId);
        var bytes = Decode(update, CollabDocuments.MaxUpdateBytes);
        var length = await documents.AppendAsync(requestId, bytes);
        if (length < 0 || length > CollabDocuments.MaxLogEntries)
        {
            throw Fail(() => L.T("realtime.draft_too_large", "Ortak taslak çok büyüdü; sayfayı yenileyin."));
        }

        await Clients.OthersInGroup(DocumentGroup(requestId)).SendAsync("docUpdate", requestId, update, Context.ConnectionAborted);
    }

    /// <summary>İmleç ve seçim bilgisi (Yjs awareness); saklanmaz, yalnızca iletilir.</summary>
    public async Task SendAwareness(Guid requestId, string payload)
    {
        await RequireWriteAsync(requestId, needEdit: false, awareness: true);
        Decode(payload, CollabDocuments.MaxAwarenessBytes);
        // Kim olduğu istemcinin yazdığı durumdan değil, sunucunun bildiği kimlikten gelir (taklit edilemez).
        var name = Context.User?.FindFirst(JwtRegisteredClaimNames.Name)?.Value ?? "?";
        await Clients.OthersInGroup(DocumentGroup(requestId))
            .SendAsync("docAwareness", requestId, payload, UserId, name, Context.ConnectionAborted);
    }

    /// <summary>Günlüğün ilk <c>count</c> kaydını istemcinin birleştirdiği tek güncellemeyle değiştirir.</summary>
    public async Task<bool> CompactDocument(Guid requestId, int count, long generation, string merged)
    {
        // Sıkıştırma tek çıkış yolu olduğundan (belge sınırdayken) hız bütçesine sayılmaz; yetki yine denetlenir.
        await RequireWriteAsync(requestId, rateLimited: false);

        return await documents.CompactAsync(requestId, count, generation, Decode(merged, CollabDocuments.MaxUpdateBytes));
    }

    public async Task LeaveDocument(Guid requestId)
    {
        await documents.LeaveAsync(Context.ConnectionId, requestId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, DocumentGroup(requestId));
    }

    private byte[] Decode(string value, int maxBytes)
    {
        var buffer = new byte[Math.Min(maxBytes, (value.Length / 4 * 3) + 3)];
        if (value.Length > (maxBytes / 3 * 4) + 8 || !Convert.TryFromBase64String(value, buffer, out var written))
        {
            throw Fail(() => L.T("realtime.invalid_update", "Geçersiz ya da çok büyük güncelleme."));
        }

        return buffer[..written];
    }

    private async Task BroadcastPresenceAsync(Guid workspaceId, CancellationToken ct) =>
        await Clients.Group(WorkspaceGroup(workspaceId)).SendAsync("presence", await presence.SnapshotAsync(workspaceId), ct);
}
