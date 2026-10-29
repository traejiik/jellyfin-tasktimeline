using System.Globalization;
using Jellyfin.Plugin.TaskTimeline.Api;

namespace Jellyfin.Plugin.TaskTimeline.Scheduling;

public sealed class ForecastBuilder
{
    public ForecastResponse Build(IReadOnlyList<TaskInput> snapshot, DateTimeOffset now, TimeZoneInfo zone, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var end = now.AddDays(7);
        var tasks = new List<ForecastTask>();
        var triggers = new List<ForecastTrigger>();
        var occurrences = new List<ForecastOccurrence>();
        foreach (var task in snapshot)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var execution = LastExecution(task.LastExecution);
            var progress = task.State == "Running" && task.ProgressPercentage is { } value && double.IsFinite(value) && value is >= 0 and <= 100
                ? (double?)value : null;
            tasks.Add(new(task.TaskId, task.Name, task.Category, task.State, progress, execution));
            for (var i = 0; i < task.Triggers.Count; i++)
            {
                var trigger = task.Triggers[i];
                // Response-local indices avoid assumptions about native trigger IDs.
                var sourceId = $"s{triggers.Count}";
                var projection = CalendarProjector.Project(trigger, now, end, zone, cancellationToken);
                triggers.Add(new(sourceId, task.TaskId, trigger.Type, Summary(trigger), projection.Status, projection.ReasonCode));
                foreach (var start in projection.Starts)
                {
                    var duration = execution?.DurationMs;
                    DateTime? estimatedEnd = duration is { } ms && ms <= (DateTime.MaxValue.Ticks - start.Ticks) / TimeSpan.TicksPerMillisecond
                        ? start.AddTicks(ms * TimeSpan.TicksPerMillisecond) : null;
                    occurrences.Add(new($"o{occurrences.Count}", task.TaskId, sourceId, start, "calendarRule", duration, estimatedEnd));
                }
            }
        }

        var ordered = occurrences.OrderBy(x => x.ProjectedStart).ToArray();
        var zoneId = !zone.HasIanaId && TimeZoneInfo.TryConvertWindowsIdToIanaId(zone.Id, out var ianaId) ? ianaId : zone.Id;
        return new(now.UtcDateTime, now.UtcDateTime, end.UtcDateTime, zoneId, tasks, triggers, ordered, OverlapDetector.Find(ordered, cancellationToken));
    }

    private static ForecastExecution? LastExecution(ExecutionInput? input)
    {
        if (input is null)
        {
            return null;
        }

        DateTime? started = input.StartedAt == DateTime.MinValue ? null : DateTime.SpecifyKind(input.StartedAt, DateTimeKind.Utc);
        DateTime? ended = input.EndedAt == DateTime.MinValue ? null : DateTime.SpecifyKind(input.EndedAt, DateTimeKind.Utc);
        long? duration = started is { } start && ended is { } end && end >= start
            ? (end.Ticks - start.Ticks) / TimeSpan.TicksPerMillisecond : null;
        return new(started, ended, input.Outcome, duration);
    }

    private static string Summary(TriggerInput trigger)
    {
        var time = trigger.TimeOfDayTicks is >= 0 and < TimeSpan.TicksPerDay
            ? TimeSpan.FromTicks(trigger.TimeOfDayTicks.Value).ToString("c", CultureInfo.InvariantCulture) : "invalid time";
        return trigger.Type switch
        {
            "DailyTrigger" => $"Daily at {time} (server time)",
            "WeeklyTrigger" => $"Weekly on {trigger.DayOfWeek} at {time} (server time)",
            "IntervalTrigger" => trigger.IntervalTicks is > 0 ? IntervalSummary(trigger.IntervalTicks.Value) : "Invalid interval",
            "StartupTrigger" => "At server startup",
            _ => $"Unsupported trigger ({trigger.Type})"
        };
    }

    private static string IntervalSummary(long ticks)
    {
        var interval = TimeSpan.FromTicks(ticks);
        var parts = new List<string>();
        foreach (var (count, unit) in new[] { (interval.Days, "day"), (interval.Hours, "hour"), (interval.Minutes, "minute"), (interval.Seconds, "second") })
        {
            if (count > 0)
            {
                parts.Add($"{count.ToString(CultureInfo.InvariantCulture)} {unit}{(count == 1 ? string.Empty : "s")}");
            }
        }

        var milliseconds = (ticks % TimeSpan.TicksPerSecond) / (decimal)TimeSpan.TicksPerMillisecond;
        if (milliseconds > 0)
        {
            parts.Add($"{milliseconds.ToString("0.####", CultureInfo.InvariantCulture)} millisecond{(milliseconds == 1 ? string.Empty : "s")}");
        }

        return "Every " + (parts.Count == 1 && parts[0].StartsWith("1 ", StringComparison.Ordinal) ? parts[0][2..] : string.Join(", ", parts));
    }
}
