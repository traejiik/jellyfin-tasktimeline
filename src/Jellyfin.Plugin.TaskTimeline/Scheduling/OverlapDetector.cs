using Jellyfin.Plugin.TaskTimeline.Api;

namespace Jellyfin.Plugin.TaskTimeline.Scheduling;

public static class OverlapDetector
{
    public static IReadOnlyList<ForecastOverlap> Find(IReadOnlyList<ForecastOccurrence> occurrences, CancellationToken cancellationToken)
    {
        var overlaps = new List<ForecastOverlap>();
        for (var i = 0; i < occurrences.Count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var first = occurrences[i];
            for (var j = i + 1; j < occurrences.Count; j++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var second = occurrences[j];
                if (first.TaskId == second.TaskId)
                {
                    continue;
                }

                if (first.ProjectedStart == second.ProjectedStart)
                {
                    overlaps.Add(new(first.OccurrenceId, second.OccurrenceId, "sameStart", null, null));
                    continue;
                }

                if (first.EstimatedEnd is not { } firstEnd || second.EstimatedEnd is not { } secondEnd
                    || firstEnd <= first.ProjectedStart || secondEnd <= second.ProjectedStart)
                {
                    continue;
                }

                var start = first.ProjectedStart > second.ProjectedStart ? first.ProjectedStart : second.ProjectedStart;
                var end = firstEnd < secondEnd ? firstEnd : secondEnd;
                if (start < end)
                {
                    overlaps.Add(new(first.OccurrenceId, second.OccurrenceId, "possibleDurationOverlap", start, end));
                }
            }
        }

        return overlaps;
    }
}
