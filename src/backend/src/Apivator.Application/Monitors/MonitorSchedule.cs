using Apivator.Application.Common.Localization;
using Cronos;

namespace Apivator.Application.Monitors;

/// <summary>Monitör zamanlaması: 5 alanlı cron ifadesi ve IANA saat dilimi (yaz saati geçişleri dahil).</summary>
public sealed class MonitorSchedule
{
    private readonly CronExpression _expression;
    private readonly TimeZoneInfo _zone;

    private MonitorSchedule(CronExpression expression, TimeZoneInfo zone)
    {
        _expression = expression;
        _zone = zone;
    }

    /// <summary>
    /// İfadeyi ve saat dilimini doğrular. İki çalıştırma arası <paramref name="minInterval"/>'dan kısa olamaz
    /// (sunucuyu ve hedef API'yi korumak için).
    /// </summary>
    public static (MonitorSchedule? Schedule, string? Error) Parse(string? cron, string? timeZone, TimeSpan minInterval, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(cron))
        {
            return (null, L.T("monitor.schedule_empty", "Zamanlama boş olamaz."));
        }

        CronExpression expression;
        try
        {
            expression = CronExpression.Parse(cron.Trim(), CronFormat.Standard);
        }
        catch (CronFormatException)
        {
            return (null, L.T("monitor.cron_invalid", "'{cron}' geçerli bir cron ifadesi değil (dakika saat gün ay haftanın-günü, ör. \"*/15 * * * *\").", ("cron", cron.Trim())));
        }

        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(string.IsNullOrWhiteSpace(timeZone) ? "UTC" : timeZone.Trim());
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return (null, L.T("monitor.timezone_unknown", "'{zone}' bilinen bir saat dilimi değil (ör. Europe/Istanbul).", ("zone", timeZone)));
        }

        var schedule = new MonitorSchedule(expression, zone);
        var occurrences = expression.GetOccurrences(now.UtcDateTime, now.UtcDateTime.AddDays(8), zone, fromInclusive: false).Take(50).ToList();
        if (occurrences.Count == 0 && schedule.Next(now) is null)
        {
            return (null, L.T("monitor.schedule_never", "Bu zamanlama hiçbir zaman çalışmaz."));
        }

        for (var i = 1; i < occurrences.Count; i++)
        {
            if (occurrences[i] - occurrences[i - 1] < minInterval)
            {
                return (null, L.T("monitor.min_interval", "İki çalıştırma arasında en az {minutes:0} dakika olmalı.", ("minutes", minInterval.TotalMinutes)));
            }
        }

        return (schedule, null);
    }

    /// <summary><paramref name="after"/>'dan sonraki ilk çalıştırma zamanı.</summary>
    public DateTimeOffset? Next(DateTimeOffset after) =>
        _expression.GetNextOccurrence(after, _zone) is { } next ? next.ToUniversalTime() : null;
}
