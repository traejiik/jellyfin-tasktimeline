namespace Jellyfin.Plugin.TaskTimeline.Scheduling;

public sealed record TaskInput(
    string TaskId, string Name, string Category, string State, double? ProgressPercentage,
    ExecutionInput? LastExecution, IReadOnlyList<TriggerInput> Triggers);

public sealed record ExecutionInput(DateTime StartedAt, DateTime EndedAt, string Outcome);

public sealed record TriggerInput(string Type, long? TimeOfDayTicks = null, DayOfWeek? DayOfWeek = null, long? IntervalTicks = null);
