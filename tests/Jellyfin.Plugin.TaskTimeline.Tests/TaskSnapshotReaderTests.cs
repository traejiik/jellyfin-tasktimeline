using Jellyfin.Plugin.TaskTimeline.Jellyfin;
using MediaBrowser.Model.Tasks;
using Xunit;

namespace Jellyfin.Plugin.TaskTimeline.Tests;

public class TaskSnapshotReaderTests
{
    [Fact]
    public void CopiesNativeDefinitionsWithoutCollapsingDuplicateTriggers()
    {
        var rule = new TaskTriggerInfo { Type = TaskTriggerInfoType.DailyTrigger, TimeOfDayTicks = TimeSpan.TicksPerHour };
        var native = new TaskInfo { Id = "a", Name = "A", Category = "Test", State = TaskState.Idle, Triggers = [rule, rule] };
        var input = TaskSnapshotReader.Map(native);
        rule.TimeOfDayTicks = 0;
        Assert.Equal("a", input.TaskId);
        Assert.Equal(2, input.Triggers.Count);
        Assert.All(input.Triggers, x => Assert.Equal(TimeSpan.TicksPerHour, x.TimeOfDayTicks));
        Assert.Null(input.LastExecution);
    }

    [Fact]
    public void RetainsNativeResultOutcomeAndUnknownTriggerType()
    {
        var native = new TaskInfo
        {
            Id = "a",
            Name = "A",
            Category = "Test",
            State = TaskState.Running,
            CurrentProgressPercentage = 0,
            Triggers = [new TaskTriggerInfo { Type = (TaskTriggerInfoType)999 }],
            LastExecutionResult = new TaskResult { Status = TaskCompletionStatus.Failed, StartTimeUtc = DateTime.UtcNow.AddMinutes(-1), EndTimeUtc = DateTime.UtcNow }
        };
        var input = TaskSnapshotReader.Map(native);
        Assert.Equal("999", input.Triggers.Single().Type);
        Assert.Equal("Failed", input.LastExecution!.Outcome);
        Assert.Equal(0, input.ProgressPercentage);
    }
}
