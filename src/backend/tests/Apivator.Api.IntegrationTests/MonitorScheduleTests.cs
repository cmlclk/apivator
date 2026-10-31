using Apivator.Application.Monitors;

namespace Apivator.Api.IntegrationTests;

public class MonitorScheduleTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 21, 5, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan FiveMinutes = TimeSpan.FromMinutes(5);

    [Fact]
    public void DailySchedule_UsesTheTimeZone()
    {
        var (schedule, error) = MonitorSchedule.Parse("0 9 * * *", "Europe/Istanbul", FiveMinutes, Now);

        Assert.Null(error);
        // 09:00 İstanbul = 06:00 UTC
        Assert.Equal(new DateTimeOffset(2026, 10, 21, 6, 0, 0, TimeSpan.Zero), schedule!.Next(Now));
    }

    [Fact]
    public void EveryFifteenMinutes_IsAllowed()
    {
        var (schedule, error) = MonitorSchedule.Parse("*/15 * * * *", "UTC", FiveMinutes, Now);

        Assert.Null(error);
        Assert.Equal(Now.AddMinutes(15), schedule!.Next(Now));
    }

    [Theory]
    [InlineData("* * * * *", "UTC", "en az 5 dakika")]
    [InlineData("*/2 9 * * 1-5", "UTC", "en az 5 dakika")]
    [InlineData("her gün", "UTC", "geçerli bir cron")]
    [InlineData("0 9 * * *", "Mars/Olympus", "saat dilimi")]
    [InlineData("", "UTC", "boş olamaz")]
    public void InvalidSchedules_AreRejected(string cron, string zone, string message)
    {
        var (schedule, error) = MonitorSchedule.Parse(cron, zone, FiveMinutes, Now);

        Assert.Null(schedule);
        Assert.Contains(message, error, StringComparison.Ordinal);
    }
}
