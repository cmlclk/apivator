using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;
using Apivator.Application.Audit;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Audit;
using Apivator.Domain.Organizations;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Apivator.Infrastructure.Audit;

/// <summary>Varlık değişikliği olmayan olayları denetim kaydına ekler (çağıranın SaveChanges'i ile yazılır).</summary>
internal sealed class AuditLog(AppDbContext db, AuditActorSource actors, TimeProvider clock) : IAuditLog
{
    [System.Diagnostics.CodeAnalysis.SuppressMessage("Design", "CA1068")]
    public async Task RecordAsync(
        Guid organizationId,
        string action,
        string targetType,
        Guid? targetId,
        string targetName,
        IReadOnlyDictionary<string, string?>? data = null,
        AuditActor? actor = null,
        CancellationToken ct = default,
        Guid? workspaceId = null,
        string? workspaceName = null)
    {
        if (!await new AuditLookup(db, ct).IsAuditedAsync(organizationId))
        {
            return;
        }

        actor ??= await actors.CurrentAsync(db, ct);
        db.AuditEntries.Add(AuditEntry.Create(organizationId, action, actor, targetType, targetId, targetName, clock.GetUtcNow(), workspaceId, workspaceName, data));
    }
}

internal sealed class AuditService(
    AppDbContext db,
    IOrganizationAccess organizations,
    IAuditLog log,
    IOptions<AuditOptions> options,
    TimeProvider clock) : IAuditService
{
    private const int DefaultLimit = 50;
    private const int MaxLimit = 200;
    private const int ExportBatch = 1000;

    public async Task<Result<AuditPageDto>> ListAsync(Guid organizationId, AuditQuery query, Guid userId, CancellationToken ct = default)
    {
        if (await RequireAsync(organizationId, userId, ct) is { } denied)
        {
            return denied;
        }

        if (ValidateQuery(query) is { } invalid)
        {
            return invalid;
        }

        var filtered = Filter(organizationId, query);
        if (query.Cursor is { } cursor)
        {
            if (!TryReadCursor(cursor, out var at, out var id))
            {
                return Error.Validation("audit.cursor", L.T("audit.cursor", "Sayfa bilgisi geçersiz."));
            }

            filtered = filtered.Where(e => EF.Functions.LessThan(ValueTuple.Create(e.CreatedAt, e.Id), ValueTuple.Create(at, id)));
        }

        var limit = Math.Clamp(query.Limit ?? DefaultLimit, 1, MaxLimit);
        var rows = await filtered
            .OrderByDescending(e => e.CreatedAt).ThenByDescending(e => e.Id)
            .Take(limit + 1)
            .ToListAsync(ct);
        var next = rows.Count > limit ? WriteCursor(rows[limit - 1]) : null;
        return new AuditPageDto(rows.Take(limit).Select(ToDto).ToList(), next, options.Value.RetentionDays);
    }

    public async Task<Result<IAsyncEnumerable<AuditEntryDto>>> ExportAsync(
        Guid organizationId,
        AuditQuery query,
        AuditExportFormat format,
        Guid userId,
        CancellationToken ct = default)
    {
        if (await RequireAsync(organizationId, userId, ct) is { } denied)
        {
            return denied;
        }

        if (ValidateQuery(query) is { } invalid)
        {
            return invalid;
        }

        // Sınırı aşan dışa aktarma yarıda kesilmez (eksik dosya tam sanılmasın); aralığın daraltılması istenir.
        var max = Math.Max(1, options.Value.MaxExportRows);
        if (await Filter(organizationId, query).Take(max + 1).CountAsync(ct) > max)
        {
            return Error.Validation(
                "audit.export_too_large",
                L.T("audit.export_too_large", "Filtreye uyan kayıt sayısı {max:N0} sınırını aşıyor. Tarih aralığını daraltıp parça parça dışa aktarın.", ("max", max)));
        }

        var organizationName = await db.Organizations.Where(o => o.Id == organizationId).Select(o => o.Name).FirstAsync(ct);

        // Kimin, hangi filtreyle dışa aktardığı da kayda geçer (dışa aktarılan dosyada da görünür).
        await log.RecordAsync(organizationId, AuditActions.AuditExported, "organization", organizationId, organizationName, new Dictionary<string, string?>
        {
            ["format"] = format.ToString().ToLowerInvariant(),
            ["from"] = query.From?.ToString("O", CultureInfo.InvariantCulture),
            ["to"] = query.To?.ToString("O", CultureInfo.InvariantCulture),
            ["action"] = query.Action,
            ["search"] = query.Search,
        }, ct: ct);
        await db.SaveChangesAsync(ct);

        return Result<IAsyncEnumerable<AuditEntryDto>>.Success(StreamAsync(organizationId, query, CancellationToken.None));
    }

    /// <summary>En eskiden yeniye, sayfa sayfa (bellekte tüm kayıtlar tutulmaz).</summary>
    private async IAsyncEnumerable<AuditEntryDto> StreamAsync(Guid organizationId, AuditQuery query, [EnumeratorCancellation] CancellationToken ct)
    {
        var max = Math.Max(1, options.Value.MaxExportRows);
        var written = 0;
        (DateTimeOffset At, Guid Id)? after = null;
        while (written < max)
        {
            var batch = Filter(organizationId, query);
            if (after is { } a)
            {
                batch = batch.Where(e => EF.Functions.GreaterThan(ValueTuple.Create(e.CreatedAt, e.Id), ValueTuple.Create(a.At, a.Id)));
            }

            var rows = await batch.OrderBy(e => e.CreatedAt).ThenBy(e => e.Id).Take(Math.Min(ExportBatch, max - written)).ToListAsync(ct);
            foreach (var row in rows)
            {
                yield return ToDto(row);
            }

            written += rows.Count;
            if (rows.Count < ExportBatch)
            {
                yield break;
            }

            after = (rows[^1].CreatedAt, rows[^1].Id);
            db.ChangeTracker.Clear();
        }
    }

    private async Task<Error?> RequireAsync(Guid organizationId, Guid userId, CancellationToken ct)
    {
        var found = await organizations.RequireAsync(organizationId, userId, OrganizationRole.Admin, ct);
        if (!found.IsSuccess)
        {
            return found.Error;
        }

        return found.Value.IsPersonal
            ? Error.Validation("organization.personal", L.T("audit.organization_personal", "Kişisel organizasyonun denetim kaydı tutulmaz."))
            : null;
    }

    private static Error? ValidateQuery(AuditQuery query) =>
        query.From is { } from && query.To is { } to && from > to ? Error.Validation("audit.range", L.T("audit.range", "Başlangıç tarihi bitişten sonra olamaz."))
        : query.Search is { Length: > 200 } ? Error.Validation("audit.search", L.T("audit.search", "Arama metni en fazla 200 karakter olabilir."))
        : null;

    private IQueryable<AuditEntry> Filter(Guid organizationId, AuditQuery query)
    {
        var q = db.AuditEntries.AsNoTracking().Where(e => e.OrganizationId == organizationId);

        // Saklama süresi dolanlar günlük temizlikten (AuditRetention) önce de görünmez.
        if (options.Value.RetentionDays > 0)
        {
            var cutoff = clock.GetUtcNow().AddDays(-options.Value.RetentionDays);
            q = q.Where(e => e.CreatedAt >= cutoff);
        }

        if (query.From is { } from)
        {
            q = q.Where(e => e.CreatedAt >= from);
        }

        if (query.To is { } to)
        {
            q = q.Where(e => e.CreatedAt <= to);
        }

        if (!string.IsNullOrWhiteSpace(query.Action))
        {
            var action = query.Action.Trim();
            q = action.Contains('.', StringComparison.Ordinal)
                ? q.Where(e => e.Action == action)
                : q.Where(e => e.Action.StartsWith(action + "."));
        }

        if (query.ActorId is { } actorId)
        {
            q = q.Where(e => e.ActorId == actorId);
        }

        if (query.WorkspaceId is { } workspaceId)
        {
            q = q.Where(e => e.WorkspaceId == workspaceId);
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            var pattern = "%" + EscapeLike(query.Search.Trim()) + "%";
            q = q.Where(e => EF.Functions.ILike(e.ActorName, pattern, "\\")
                || EF.Functions.ILike(e.ActorEmail ?? string.Empty, pattern, "\\")
                || EF.Functions.ILike(e.TargetName, pattern, "\\"));
        }

        return q;
    }


    private static AuditEntryDto ToDto(AuditEntry e) => new(
        e.Id, e.CreatedAt, e.Action, e.ActorId, e.ActorName, e.ActorEmail, e.ApiKeyId is not null, e.IpAddress, e.Device,
        e.TargetType, e.TargetId, e.TargetName, e.WorkspaceId, e.WorkspaceName, e.Data);

    private static string EscapeLike(string value) =>
        value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("%", "\\%", StringComparison.Ordinal).Replace("_", "\\_", StringComparison.Ordinal);

    private static string WriteCursor(AuditEntry e) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes($"{e.CreatedAt.UtcTicks.ToString(CultureInfo.InvariantCulture)}:{e.Id:N}"));

    private static bool TryReadCursor(string cursor, out DateTimeOffset at, out Guid id)
    {
        at = default;
        id = default;
        try
        {
            var parts = Encoding.UTF8.GetString(Convert.FromBase64String(cursor)).Split(':');
            if (parts.Length != 2 || !long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks) || !Guid.TryParseExact(parts[1], "N", out id))
            {
                return false;
            }

            at = new DateTimeOffset(ticks, TimeSpan.Zero);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
        catch (ArgumentOutOfRangeException)
        {
            return false;
        }
    }
}
