namespace Jellyfin.Plugin.TaskTimeline.Api;

public sealed record ForecastResponse(
    DateTime GeneratedAt, DateTime RangeStart, DateTime RangeEnd, string ServerTimeZone,
    IReadOnlyList<ForecastTask> Tasks, IReadOnlyList<ForecastTrigger> Triggers,
    IReadOnlyList<ForecastOccurrence> Occurrences, IReadOnlyList<ForecastOverlap> Overlaps);

public sealed record ForecastTask(
    string TaskId, string Name, string Category, string State, double? ProgressPercentage, ForecastExecution? LastExecution);

public sealed record ForecastExecution(DateTime? StartedAt, DateTime? EndedAt, string Outcome, long? DurationMs);

public sealed record ForecastTrigger(string SourceId, string TaskId, string Type, string Summary, string ProjectionStatus, string? ReasonCode);

public sealed record ForecastOccurrence(
    string OccurrenceId, string TaskId, string SourceId, DateTime ProjectedStart,
    string StartBasis, long? LastRecordedDurationMs, DateTime? EstimatedEnd);

public sealed record ForecastOverlap(
    string FirstOccurrenceId, string SecondOccurrenceId, string Kind, DateTime? WindowStart, DateTime? WindowEnd);
