using Jellyfin.Plugin.TaskTimeline.Scheduling;
using MediaBrowser.Model.Tasks;

namespace Jellyfin.Plugin.TaskTimeline.Jellyfin;

public interface ITaskSnapshotReader
{
    IReadOnlyList<TaskInput> Read(CancellationToken cancellationToken);
}

public sealed class TaskSnapshotReader(ITaskManager taskManager) : ITaskSnapshotReader
{
    public IReadOnlyList<TaskInput> Read(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var workers = taskManager.ScheduledTasks.ToArray();
        var tasks = new List<TaskInput>(workers.Length);
        foreach (var worker in workers)
        {
            cancellationToken.ThrowIfCancellationRequested();
            tasks.Add(Map(ScheduledTaskHelpers.GetTaskInfo(worker)));
        }

        return tasks;
    }

    public static TaskInput Map(TaskInfo task)
    {
        var result = task.LastExecutionResult;
        return new(task.Id, task.Name, task.Category, task.State.ToString(), task.CurrentProgressPercentage,
            result is null ? null : new(result.StartTimeUtc, result.EndTimeUtc, result.Status.ToString()),
            task.Triggers.Select(t => new TriggerInput(t.Type.ToString(), t.TimeOfDayTicks, t.DayOfWeek, t.IntervalTicks)).ToArray());
    }
}
