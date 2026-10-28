namespace Jellyfin.Plugin.TaskTimeline.Scheduling;

public sealed record CalendarProjection(string Status, string? ReasonCode, IReadOnlyList<DateTime> Starts);

public static class CalendarProjector
{
    public static CalendarProjection Project(TriggerInput trigger, DateTimeOffset start, DateTimeOffset end, TimeZoneInfo zone, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (end <= start || end - start > TimeSpan.FromDays(7))
        {
            throw new ArgumentOutOfRangeException(nameof(end), "Projection range must be positive and at most seven days.");
        }

        switch (trigger.Type)
        {
            case "StartupTrigger":
                return new("eventBased", "startupEvent", []);
            case "IntervalTrigger":
                return trigger.IntervalTicks is > 0
                    ? new("timingUnknown", "intervalAnchorUnavailable", [])
                    : new("unsupported", "invalidIntervalRule", []);
            case "DailyTrigger":
            case "WeeklyTrigger":
                break;
            default:
                return new("unsupported", "unknownTriggerType", []);
        }

        var weekly = trigger.Type == "WeeklyTrigger";
        if (trigger.TimeOfDayTicks is null or < 0 or >= TimeSpan.TicksPerDay
            || (weekly && (trigger.DayOfWeek is null || !Enum.IsDefined(trigger.DayOfWeek.Value))))
        {
            return new("unsupported", "invalidCalendarRule", []);
        }

        // Jellyfin arms a relative timer using local DateTime subtraction. Its
        // actual deadline depends on when it was armed if an offset changes.
        // Include the preceding rule period because an existing timer may have
        // been armed before a recent transition. Do not guess that private state.
        var previousOffset = zone.GetUtcOffset(start.AddDays(weekly ? -7 : -1));
        for (var instant = start.AddDays(weekly ? -7 : -1); instant < end; instant = instant.AddHours(1))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var offset = zone.GetUtcOffset(instant);
            if (offset != previousOffset)
            {
                return new("unsupported", "clockChangeTimingUnknown", []);
            }

            previousOffset = offset;
        }

        if (zone.GetUtcOffset(end) != previousOffset)
        {
            return new("unsupported", "clockChangeTimingUnknown", []);
        }

        var localStart = TimeZoneInfo.ConvertTime(start, zone).DateTime;
        var finalDate = TimeZoneInfo.ConvertTime(end, zone).Date;
        var starts = new List<DateTime>();
        for (var day = localStart.Date; day <= finalDate; day = day.AddDays(1))
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (weekly && day.DayOfWeek != trigger.DayOfWeek)
            {
                continue;
            }

            var local = day.AddTicks(trigger.TimeOfDayTicks.Value);
            // Native daily uses > and weekly uses < when selecting today's date.
            if (weekly && local <= localStart)
            {
                continue;
            }

            if (zone.IsInvalidTime(local) || zone.IsAmbiguousTime(local))
            {
                return new("unsupported", "clockChangeTimingUnknown", []);
            }

            var utc = TimeZoneInfo.ConvertTimeToUtc(local, zone);
            if (utc >= start.UtcDateTime && utc < end.UtcDateTime)
            {
                starts.Add(utc);
            }
        }

        return new("projected", null, starts);
    }
}
