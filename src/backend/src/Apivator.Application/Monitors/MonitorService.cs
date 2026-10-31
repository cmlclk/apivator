using Apivator.Application.Abstractions;
using Apivator.Application.Common;
using Apivator.Application.Common.Localization;
using Apivator.Application.Workspaces;
using Apivator.Domain.Monitors;
using Apivator.Domain.Runs;
using Apivator.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Apivator.Application.Monitors;

public interface IMonitorService
{
    Task<Result<IReadOnlyList<MonitorDto>>> ListAsync(Guid workspaceId, Guid userId, CancellationToken ct = default);

    Task<Result<MonitorDto>> CreateAsync(Guid workspaceId, CreateMonitorRequest request, Guid userId, CancellationToken ct = default);

    Task<Result<MonitorDto>> UpdateAsync(Guid monitorId, MonitorSettings settings, Guid userId, CancellationToken ct = default);

    Task<Result> DeleteAsync(Guid monitorId, Guid userId, CancellationToken ct = default);

    /// <summary>Son <paramref name="days"/> günün çalıştırmaları, eskiden yeniye (en fazla 1000).</summary>
    Task<Result<IReadOnlyList<MonitorRunPointDto>>> RunsAsync(Guid monitorId, Guid userId, int days = 7, CancellationToken ct = default);

    /// <summary>Monitörü hemen çalıştırır (zamanlama değişmez).</summary>
    Task<Result<MonitorRunPointDto>> RunNowAsync(Guid monitorId, Guid userId, CancellationToken ct = default);
}

internal sealed class MonitorService(
    IApplicationDbContext db,
    IWorkspaceAccess access,
    IMonitorExecutor executor,
    IUserDirectory users,
    IOptions<MonitorOptions> options,
    TimeProvider clock) : IMonitorService
{
    private const int MaxPoints = 1000;

    private static Error MonitorNotFound => Error.NotFound("monitor.not_found", L.T("monitor.not_found", "Monitör bulunamadı."));

    public async Task<Result<IReadOnlyList<MonitorDto>>> ListAsync(Guid workspaceId, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Viewer, ct) is { } denied)
        {
            return denied;
        }

        var monitors = await db.Monitors.AsNoTracking().Where(m => m.WorkspaceId == workspaceId).OrderBy(m => m.CreatedAt).ToListAsync(ct);
        return await ToDtosAsync(monitors, ct);
    }

    public async Task<Result<MonitorDto>> CreateAsync(Guid workspaceId, CreateMonitorRequest request, Guid userId, CancellationToken ct = default)
    {
        if (await access.RequireAsync(workspaceId, userId, WorkspaceRole.Editor, ct) is { } denied)
        {
            return denied;
        }

        if (!await db.Collections.AnyAsync(c => c.Id == request.CollectionId && c.WorkspaceId == workspaceId, ct))
        {
            return Error.NotFound("collection.not_found", L.T("monitor.collection_not_found", "Collection bulunamadı."));
        }

        if (await db.Monitors.CountAsync(m => m.WorkspaceId == workspaceId, ct) >= CollectionMonitor.MaxPerWorkspace)
        {
            return Error.Validation("monitor.limit", L.T("monitor.limit", "Bir workspace'te en fazla {max} monitör olabilir.", ("max", CollectionMonitor.MaxPerWorkspace)));
        }

        var now = clock.GetUtcNow();
        var (valid, error) = await ValidateAsync(workspaceId, request.Settings, now, ct);
        if (error is not null)
        {
            return error;
        }

        var s = request.Settings;
        var monitor = CollectionMonitor.Create(
            workspaceId, request.CollectionId, s.EnvironmentId, s.Name, s.Schedule, valid!.TimeZone, valid.Emails,
            s.WebhookUrl, s.WebhookKind, s.NotifyMode, valid.Schedule.Next(now), userId, now);
        if (!s.Enabled)
        {
            monitor.Update(s.Name, s.EnvironmentId, s.Schedule, valid.TimeZone, false, valid.Emails, s.WebhookUrl, s.WebhookKind, s.NotifyMode, null, now);
        }

        db.Monitors.Add(monitor);
        await db.SaveChangesAsync(ct);
        return (await ToDtosAsync([monitor], ct))[0];
    }

    public async Task<Result<MonitorDto>> UpdateAsync(Guid monitorId, MonitorSettings settings, Guid userId, CancellationToken ct = default)
    {
        var (monitor, error) = await LoadAsync(monitorId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        var now = clock.GetUtcNow();
        var (valid, invalid) = await ValidateAsync(monitor!.WorkspaceId, settings, now, ct);
        if (invalid is not null)
        {
            return invalid;
        }

        if (settings.Enabled && !monitor.Enabled && monitor.LastError is not null)
        {
            monitor.TakeOver(userId);
        }

        monitor.Update(
            settings.Name, settings.EnvironmentId, settings.Schedule, valid!.TimeZone, settings.Enabled, valid.Emails,
            settings.WebhookUrl, settings.WebhookKind, settings.NotifyMode, valid.Schedule.Next(now), now);
        await db.SaveChangesAsync(ct);
        return (await ToDtosAsync([monitor], ct))[0];
    }

    public async Task<Result> DeleteAsync(Guid monitorId, Guid userId, CancellationToken ct = default)
    {
        var (monitor, error) = await LoadAsync(monitorId, userId, WorkspaceRole.Editor, ct);
        if (error is not null)
        {
            return error;
        }

        // Raporlar runner geçmişinde kalır; yalnızca monitörle bağı kopar (FK: set null).
        db.Monitors.Remove(monitor!);
        await db.SaveChangesAsync(ct);
        return Result.Success();
    }

    public async Task<Result<IReadOnlyList<MonitorRunPointDto>>> RunsAsync(Guid monitorId, Guid userId, int days = 7, CancellationToken ct = default)
    {
        var (monitor, error) = await LoadAsync(monitorId, userId, WorkspaceRole.Viewer, ct);
        if (error is not null)
        {
            return error;
        }

        var since = clock.GetUtcNow().AddDays(-Math.Clamp(days, 1, 90));
        var runs = await db.Runs.AsNoTracking()
            .Where(r => r.MonitorId == monitor!.Id && r.StartedAt >= since)
            .OrderByDescending(r => r.StartedAt)
            .Take(MaxPoints)
            .Select(r => new MonitorRunPointDto(
                r.Id, r.StartedAt, r.FinishedAt, r.Origin, r.Status,
                r.Status == RunStatus.Completed && r.TestsFailed == 0 && r.RequestErrors == 0,
                r.TotalRequests, r.RequestErrors, r.TestsPassed, r.TestsFailed, r.TotalTimeMs))
            .ToListAsync(ct);
        runs.Reverse();
        return runs;
    }

    public async Task<Result<MonitorRunPointDto>> RunNowAsync(Guid monitorId, Guid userId, CancellationToken ct = default)
    {
        var (_, error) = await LoadAsync(monitorId, userId, WorkspaceRole.Editor, ct);
        return error ?? await executor.ExecuteAsync(monitorId, scheduled: false, ct);
    }

    internal static MonitorRunPointDto ToPoint(CollectionRun r) => new(
        r.Id, r.StartedAt, r.FinishedAt, r.Origin, r.Status, r.Healthy, r.TotalRequests, r.RequestErrors, r.TestsPassed, r.TestsFailed, r.TotalTimeMs);

    private sealed record ValidSettings(MonitorSchedule Schedule, string TimeZone, IReadOnlyList<string> Emails);

    private async Task<(ValidSettings? Valid, Error? Error)> ValidateAsync(Guid workspaceId, MonitorSettings s, DateTimeOffset now, CancellationToken ct)
    {
        static Error Invalid(string message) => Error.Validation("validation", message);

        if (string.IsNullOrWhiteSpace(s.Name) || s.Name.Trim().Length > CollectionMonitor.NameMaxLength)
        {
            return (null, Invalid(L.T("monitor.name_length", "Monitör adı 1–{max} karakter olmalı.", ("max", CollectionMonitor.NameMaxLength))));
        }

        if ((s.Schedule?.Length ?? 0) > CollectionMonitor.ScheduleMaxLength)
        {
            return (null, Invalid(L.T("monitor.schedule_too_long", "Zamanlama çok uzun.")));
        }

        var timeZone = string.IsNullOrWhiteSpace(s.TimeZone) ? "UTC" : s.TimeZone.Trim();
        var (schedule, scheduleError) = MonitorSchedule.Parse(s.Schedule, timeZone, TimeSpan.FromMinutes(options.Value.MinIntervalMinutes), now);
        if (scheduleError is not null)
        {
            return (null, Invalid(scheduleError));
        }

        var emails = (s.NotifyEmails ?? [])
            .Select(e => e.Trim())
            .Where(e => e.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (emails.Count > CollectionMonitor.MaxEmails)
        {
            return (null, Invalid(L.T("monitor.emails_limit", "En fazla {max} e-posta adresi eklenebilir.", ("max", CollectionMonitor.MaxEmails))));
        }

        if (emails.FirstOrDefault(e => e.Length > 254 || !System.Net.Mail.MailAddress.TryCreate(e, out _)) is { } badEmail)
        {
            return (null, Invalid(L.T("monitor.email_invalid", "'{email}' geçerli bir e-posta adresi değil.", ("email", badEmail))));
        }

        if (!string.IsNullOrWhiteSpace(s.WebhookUrl)
            && (s.WebhookUrl.Length > CollectionMonitor.WebhookUrlMaxLength
                || !Uri.TryCreate(s.WebhookUrl.Trim(), UriKind.Absolute, out var hook)
                || hook.Scheme is not ("http" or "https")))
        {
            return (null, Invalid(L.T("monitor.webhook_invalid", "Webhook adresi http:// ya da https:// ile başlayan geçerli bir adres olmalı.")));
        }

        if (s.EnvironmentId is { } envId && !await db.Environments.AnyAsync(e => e.Id == envId && e.WorkspaceId == workspaceId, ct))
        {
            return (null, Invalid(L.T("monitor.environment_not_in_workspace", "Environment bu workspace'te değil.")));
        }

        return (new ValidSettings(schedule!, timeZone, emails), null);
    }

    private async Task<(CollectionMonitor? Monitor, Error? Error)> LoadAsync(Guid monitorId, Guid userId, WorkspaceRole minimum, CancellationToken ct)
    {
        var monitor = await db.Monitors.FirstOrDefaultAsync(m => m.Id == monitorId, ct);
        if (monitor is null)
        {
            return (null, MonitorNotFound);
        }

        var denied = await access.RequireAsync(monitor.WorkspaceId, userId, minimum, ct);
        return denied is null ? (monitor, null) : (null, denied == WorkspaceAccess.NotFound ? MonitorNotFound : denied);
    }

    private async Task<List<MonitorDto>> ToDtosAsync(IReadOnlyList<CollectionMonitor> monitors, CancellationToken ct)
    {
        var collectionIds = monitors.Select(m => m.CollectionId).Distinct().ToList();
        var collections = await db.Collections.AsNoTracking().Where(c => collectionIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var names = await users.DisplayNamesAsync(monitors.Select(m => m.CreatedById).Distinct(), ct);
        return monitors.Select(m => new MonitorDto(
            m.Id, m.WorkspaceId, m.CollectionId, collections.GetValueOrDefault(m.CollectionId, string.Empty), m.EnvironmentId, m.Name,
            m.Schedule, m.TimeZone, m.Enabled, m.NotifyEmails, m.WebhookUrl, m.WebhookKind, m.NotifyMode, m.CreatedById,
            names.GetValueOrDefault(m.CreatedById, string.Empty), m.NextRunAt, m.LastRunAt, m.LastRunId, m.Health,
            m.ConsecutiveFailures, m.LastError, m.CreatedAt)).ToList();
    }
}
