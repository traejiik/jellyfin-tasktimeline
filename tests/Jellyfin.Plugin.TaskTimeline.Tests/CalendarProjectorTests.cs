using Jellyfin.Plugin.TaskTimeline.Scheduling;
using Xunit;

namespace Jellyfin.Plugin.TaskTimeline.Tests;

public class CalendarProjectorTests
{
    [Theory]
    [InlineData("DailyTrigger", 7)]
    [InlineData("WeeklyTrigger", 0)]
    public void ExactNowFollowsNativeDailyAndWeeklyEquality(string type, int count)
    {
        var now = DateTimeOffset.Parse("2026-10-28T10:00:00Z");
        var result = CalendarProjector.Project(new(type, TimeSpan.FromHours(10).Ticks, DayOfWeek.Wednesday), now, now.AddDays(7), TimeZoneInfo.Utc, default);
        Assert.Equal("projected", result.Status);
        Assert.Equal(count, result.Starts.Count);
        Assert.DoesNotContain(now.AddDays(7).UtcDateTime, result.Starts);
        if (count > 0) Assert.Equal(now.UtcDateTime, result.Starts[0]);
    }

    [Theory]
    [InlineData("DailyTrigger", "2026-11-10T11:00:00Z", 7)]
    [InlineData("WeeklyTrigger", "2026-11-11T11:00:00Z", 1)]
    public void UsesServerTimezoneAwayFromTransitions(string type, string first, int count)
    {
        var now = DateTimeOffset.Parse("2026-11-10T10:00:00Z");
        var result = CalendarProjector.Project(new(type, TimeSpan.FromHours(12).Ticks, DayOfWeek.Wednesday), now, now.AddDays(7), TimeZoneInfo.FindSystemTimeZoneById("Europe/Budapest"), default);
        Assert.Equal(count, result.Starts.Count);
        Assert.Equal(DateTimeOffset.Parse(first).UtcDateTime, result.Starts[0]);
    }

    [Theory]
    [InlineData("2026-03-28T12:00:00Z", "DailyTrigger")]
    [InlineData("2026-10-24T12:00:00Z", "DailyTrigger")]
    [InlineData("2026-10-28T10:00:00Z", "WeeklyTrigger")]
    public void WithholdsSourcesWhoseTimerArmingMayCrossAnOffsetChange(string instant, string type)
    {
        var now = DateTimeOffset.Parse(instant);
        var result = CalendarProjector.Project(new(type, TimeSpan.FromHours(4).Ticks, DayOfWeek.Sunday), now, now.AddDays(7), TimeZoneInfo.FindSystemTimeZoneById("Europe/Budapest"), default);
        Assert.Equal("unsupported", result.Status);
        Assert.Equal("clockChangeTimingUnknown", result.ReasonCode);
        Assert.Empty(result.Starts);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(-1L)]
    [InlineData(864000000000L)]
    public void RejectsMalformedCalendarTime(long? ticks)
    {
        var now = DateTimeOffset.Parse("2026-11-10T10:00:00Z");
        var result = CalendarProjector.Project(new("DailyTrigger", ticks), now, now.AddDays(7), TimeZoneInfo.Utc, default);
        Assert.Equal("unsupported", result.Status);
        Assert.Equal("invalidCalendarRule", result.ReasonCode);
    }

    [Theory]
    [InlineData(null)]
    [InlineData((DayOfWeek)99)]
    public void WeeklyNeedsAValidWeekday(DayOfWeek? day)
    {
        var now = DateTimeOffset.Parse("2026-11-10T10:00:00Z");
        var result = CalendarProjector.Project(new("WeeklyTrigger", 0, day), now, now.AddDays(7), TimeZoneInfo.Utc, default);
        Assert.Equal("invalidCalendarRule", result.ReasonCode);
        Assert.Empty(result.Starts);
    }

    [Fact]
    public void SupportedWeeklyRuleCanHaveNoOccurrencesInShortRange()
    {
        var now = DateTimeOffset.Parse("2026-11-10T10:00:00Z");
        var result = CalendarProjector.Project(new("WeeklyTrigger", 0, DayOfWeek.Sunday), now, now.AddDays(1), TimeZoneInfo.Utc, default);
        Assert.Equal("projected", result.Status);
        Assert.Empty(result.Starts);
    }

    [Fact]
    public void DoesNotExtendTheRequestedProjectionHorizon()
    {
        var now = DateTimeOffset.Parse("2026-11-10T10:00:00Z");
        Assert.Throws<ArgumentOutOfRangeException>(() => CalendarProjector.Project(new("DailyTrigger", 0), now, now.AddDays(8), TimeZoneInfo.Utc, default));
        Assert.Throws<ArgumentOutOfRangeException>(() => CalendarProjector.Project(new("DailyTrigger", 0), now, now, TimeZoneInfo.Utc, default));
    }
}
