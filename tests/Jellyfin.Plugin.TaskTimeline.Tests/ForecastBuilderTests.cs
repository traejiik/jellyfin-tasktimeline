using Jellyfin.Plugin.TaskTimeline.Scheduling;
using Xunit;

namespace Jellyfin.Plugin.TaskTimeline.Tests;

public class ForecastBuilderTests
{
    [Fact]
    public void ReturnsBrowserCompatibleIanaIdForWindowsServerTimezone()
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Pacific Standard Time");
        var result = new ForecastBuilder().Build([], Now, zone, default);
        Assert.Equal("America/Los_Angeles", result.ServerTimeZone);
    }

    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-28T10:00:00Z");

    [Theory]
    [InlineData(864000000000L, "Every day")]
    [InlineData(432000000000L, "Every 12 hours")]
    [InlineData(216000000000L, "Every 6 hours")]
    [InlineData(6048000000000L, "Every 7 days")]
    [InlineData(936000000000L, "Every 1 day, 2 hours")]
    [InlineData(600000000L, "Every minute")]
    [InlineData(5000L, "Every 0.5 milliseconds")]
    public void DescribesIntervalRulesInReadableWords(long ticks, string expected)
    {
        var response = new ForecastBuilder().Build([Task("a", new TriggerInput("IntervalTrigger", IntervalTicks: ticks))], Now, TimeZoneInfo.Utc, default);
        Assert.Equal(expected, response.Triggers.Single().Summary);
        Assert.Equal("timingUnknown", response.Triggers.Single().ProjectionStatus);
        Assert.Empty(response.Occurrences);
    }

    [Fact]
    public void PreservesUnknownSourcesAndTasksWithoutTriggers()
    {
        var task = Task("a", new("IntervalTrigger", null, null, TimeSpan.TicksPerHour), new("StartupTrigger"), new("FutureTrigger"));
        var result = new ForecastBuilder().Build([task, Task("b")], Now, TimeZoneInfo.Utc, default);
        Assert.Equal(2, result.Tasks.Count);
        Assert.Equal(new[] { "timingUnknown", "eventBased", "unsupported" }, result.Triggers.Select(x => x.ProjectionStatus));
        Assert.Empty(result.Occurrences);
        Assert.Equal(Now.UtcDateTime, result.RangeStart);
        Assert.Equal(Now.AddHours(168).UtcDateTime, result.RangeEnd);
    }

    [Theory]
    [InlineData("Running", 0d, 0d)]
    [InlineData("Running", 100d, 100d)]
    [InlineData("Running", -1, null)]
    [InlineData("Running", 101, null)]
    [InlineData("Idle", 75, null)]
    public void UsesOnlyValidRunningProgress(string state, double progress, double? expected)
    {
        var result = new ForecastBuilder().Build([Task("a") with { State = state, ProgressPercentage = progress }], Now, TimeZoneInfo.Utc, default);
        Assert.Equal(expected, result.Tasks.Single().ProgressPercentage);
    }

    [Fact]
    public void MissingOrNonFiniteProgressIsIndeterminate()
    {
        foreach (var progress in new double?[] { null, double.NaN, double.PositiveInfinity })
        {
            var result = new ForecastBuilder().Build([Task("a") with { State = "Running", ProgressPercentage = progress }], Now, TimeZoneInfo.Utc, default);
            Assert.Null(result.Tasks.Single().ProgressPercentage);
        }
    }

    [Theory]
    [InlineData("Completed", 60000)]
    [InlineData("Failed", 60000)]
    [InlineData("Cancelled", 60000)]
    [InlineData("Completed", 0)]
    [InlineData("Completed", -1)]
    public void KeepsLastOutcomeAndValidDuration(string outcome, long milliseconds)
    {
        var task = Task("a", new TriggerInput("DailyTrigger", TimeSpan.FromHours(12).Ticks)) with
        {
            LastExecution = new(Now.AddHours(-1).UtcDateTime, Now.AddHours(-1).AddMilliseconds(milliseconds).UtcDateTime, outcome)
        };
        var result = new ForecastBuilder().Build([task], Now, TimeZoneInfo.Utc, default);
        Assert.Equal(outcome, result.Tasks.Single().LastExecution!.Outcome);
        Assert.Equal(milliseconds < 0 ? null : (long?)milliseconds, result.Tasks.Single().LastExecution!.DurationMs);
        Assert.All(result.Occurrences, x => Assert.Equal(milliseconds < 0 ? null : (long?)milliseconds, x.LastRecordedDurationMs));
    }

    [Fact]
    public void DuplicateSourcesRemainSeparateWithResolvableReferences()
    {
        var rule = new TriggerInput("DailyTrigger", TimeSpan.FromHours(12).Ticks);
        var result = new ForecastBuilder().Build([Task("a", rule, rule)], Now, TimeZoneInfo.Utc, default);
        Assert.Equal(2, result.Triggers.Select(x => x.SourceId).Distinct().Count());
        Assert.Equal(14, result.Occurrences.Count);
        Assert.Equal(14, result.Occurrences.Select(x => x.OccurrenceId).Distinct().Count());
        Assert.All(result.Occurrences, x => Assert.Contains(result.Triggers, s => s.SourceId == x.SourceId));
        Assert.Empty(result.Overlaps);
    }

    [Fact]
    public void CancellationDoesNotReturnPartialSuccess()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        Assert.Throws<OperationCanceledException>(() => new ForecastBuilder().Build([], Now, TimeZoneInfo.Utc, cancellation.Token));
    }

    [Fact]
    public void MissingResultTimestampsDoNotSupplyADuration()
    {
        var task = Task("a", new TriggerInput("DailyTrigger", TimeSpan.FromHours(12).Ticks)) with
        {
            LastExecution = new(DateTime.MinValue, Now.UtcDateTime, "Failed")
        };
        var result = new ForecastBuilder().Build([task], Now, TimeZoneInfo.Utc, default);
        Assert.Null(result.Tasks.Single().LastExecution!.StartedAt);
        Assert.Null(result.Tasks.Single().LastExecution!.DurationMs);
        Assert.All(result.Occurrences, x => Assert.Null(x.EstimatedEnd));
    }

    [Fact]
    public void LastOccurrenceCanHaveEstimatedEndBeyondTheForecast()
    {
        var task = Task("a", new TriggerInput("DailyTrigger", TimeSpan.FromHours(9).Ticks)) with
        {
            LastExecution = new(Now.AddHours(-3).UtcDateTime, Now.UtcDateTime, "Completed")
        };
        var result = new ForecastBuilder().Build([task], Now, TimeZoneInfo.Utc, default);
        Assert.True(result.Occurrences.Last().EstimatedEnd > result.RangeEnd);
        Assert.True(result.Occurrences.Last().ProjectedStart < result.RangeEnd);
    }

    internal static TaskInput Task(string id, params TriggerInput[] triggers) => new(id, id, "Test", "Idle", null, null, triggers);
}
