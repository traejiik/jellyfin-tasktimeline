using Jellyfin.Plugin.TaskTimeline.Api;
using Jellyfin.Plugin.TaskTimeline.Scheduling;
using Xunit;

namespace Jellyfin.Plugin.TaskTimeline.Tests;

public class OverlapDetectorTests
{
    [Fact]
    public void ReportsIntersectionWithoutTouchingOrSameTaskPairs()
    {
        var overlaps = OverlapDetector.Find([Occurrence("a", 0, 10), Occurrence("b", 5, 8), Occurrence("a", 5, 4), Occurrence("c", 13, 1)], default);
        Assert.DoesNotContain(overlaps, p => p.FirstOccurrenceId == "a0" && p.SecondOccurrenceId == "a5");
        var pair = Assert.Single(overlaps, p => p.FirstOccurrenceId == "a0" && p.SecondOccurrenceId == "b5");
        Assert.Equal("possibleDurationOverlap", pair.Kind);
        Assert.Equal(At(5), pair.WindowStart);
        Assert.Equal(At(10), pair.WindowEnd);
        Assert.DoesNotContain(overlaps, p => p.SecondOccurrenceId == "c13");
    }

    [Fact]
    public void EqualStartsNeedNoDurationAndTakePrecedence()
    {
        var pair = Assert.Single(OverlapDetector.Find([Occurrence("a", 0, null), Occurrence("b", 0, 5)], default));
        Assert.Equal("sameStart", pair.Kind);
        Assert.Null(pair.WindowStart);
        Assert.Null(pair.WindowEnd);
    }

    [Fact]
    public void ContainmentUsesInnerWindowAndDoesNotDuplicatePairs()
    {
        var pair = Assert.Single(OverlapDetector.Find([Occurrence("a", 0, 10), Occurrence("b", 2, 3)], default));
        Assert.Equal(At(2), pair.WindowStart);
        Assert.Equal(At(5), pair.WindowEnd);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    public void UnknownOrZeroDurationDoesNotOccupyTime(int? duration)
    {
        Assert.Empty(OverlapDetector.Find([Occurrence("a", 0, duration), Occurrence("b", 2, 10)], default));
    }

    private static DateTime At(int minutes) => new DateTime(2026, 10, 28, 2, 0, 0, DateTimeKind.Utc).AddMinutes(minutes);

    private static ForecastOccurrence Occurrence(string task, int minutes, int? duration) => new(
        task + minutes, task, task, At(minutes), "calendarRule", duration * 60000L, duration is null ? null : At(minutes + duration.Value));
}
