using Apivator.Application.Abstractions;
using Apivator.Application.Account;
using Apivator.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Apivator.Infrastructure.Identity;

internal sealed class UserDirectory(AppDbContext db) : IUserDirectory
{
    public async Task<IReadOnlyDictionary<Guid, string>> DisplayNamesAsync(IEnumerable<Guid> userIds, CancellationToken ct = default)
    {
        var ids = userIds.Distinct().ToList();
        return await db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.DisplayName, ct);
    }

    public async Task<IReadOnlyDictionary<Guid, UserSummary>> UsersAsync(IEnumerable<Guid> userIds, CancellationToken ct = default)
    {
        var ids = userIds.Distinct().ToList();
        return await db.Users.AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => new UserSummary(u.Id, u.DisplayName, u.Email!, u.EmailConfirmed, u.TwoFactorEnabled), ct);
    }

    public async Task<UserSummary?> FindByEmailAsync(string email, CancellationToken ct = default)
    {
        var normalized = email.Trim().ToUpperInvariant();
        return await db.Users.AsNoTracking()
            .Where(u => u.NormalizedEmail == normalized)
            .Select(u => new UserSummary(u.Id, u.DisplayName, u.Email!, u.EmailConfirmed, u.TwoFactorEnabled))
            .FirstOrDefaultAsync(ct);
    }

    public async Task<bool> EmailAllowedAsync(string email, EmailTopic topic, CancellationToken ct = default)
    {
        var normalized = email.Trim().ToUpperInvariant();
        var preferences = await db.Users.AsNoTracking()
            .Where(u => u.NormalizedEmail == normalized)
            .Select(u => u.Preferences)
            .FirstOrDefaultAsync(ct);
        return preferences?.Allows(topic) ?? true;
    }

    public async Task<string?> PreferredLanguageAsync(Guid userId, CancellationToken ct = default)
    {
        var preferences = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.Preferences)
            .FirstOrDefaultAsync(ct);
        return preferences?.Language;
    }

    public async Task<bool> SavesHistoryResponsesAsync(Guid userId, CancellationToken ct = default)
    {
        var preferences = await db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.Preferences)
            .FirstOrDefaultAsync(ct);
        return preferences?.SaveHistoryResponses ?? false;
    }

    public async Task<string?> PreferredLanguageByEmailAsync(string email, CancellationToken ct = default)
    {
        var normalized = email.Trim().ToUpperInvariant();
        var preferences = await db.Users.AsNoTracking()
            .Where(u => u.NormalizedEmail == normalized)
            .Select(u => u.Preferences)
            .FirstOrDefaultAsync(ct);
        return preferences?.Language;
    }

    public async Task SetLanguageIfUnsetAsync(Guid userId, string language, CancellationToken ct = default)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user is null || user.Preferences.Language is not null || !UserPreferences.Languages.Contains(language))
        {
            return;
        }

        // JSON sütunu: değişikliğin algılanması için yeni nesne atanır.
        var p = user.Preferences;
        user.Preferences = new UserPreferences
        {
            Theme = p.Theme,
            DefaultWorkspaceId = p.DefaultWorkspaceId,
            EmailMentions = p.EmailMentions,
            EmailMergeRequests = p.EmailMergeRequests,
            EmailMonitorAlerts = p.EmailMonitorAlerts,
            Language = language,
            SaveHistoryResponses = p.SaveHistoryResponses,
        };
        await db.SaveChangesAsync(ct);
    }
}
