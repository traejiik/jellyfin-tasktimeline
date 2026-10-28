// Synthetic contract-valid data. Never an export of a user's server.
export function forecastFixture() {
    const at = value => `2026-11-10T${value}:00Z`;
    return {
        generatedAt: at('10:00'), rangeStart: at('10:00'), rangeEnd: '2026-11-17T10:00:00Z', serverTimeZone: 'Etc/UTC',
        tasks: [
            { taskId: 'a', name: 'Task A', category: 'Library', state: 'Idle', progressPercentage: null, lastExecution: { startedAt: at('08:00'), endedAt: at('08:10'), outcome: 'Completed', durationMs: 600000 } },
            { taskId: 'b', name: 'Task B', category: 'Maintenance', state: 'Idle', progressPercentage: null, lastExecution: null },
            { taskId: 'c', name: 'Task C', category: 'Application', state: 'Idle', progressPercentage: null, lastExecution: null }
        ],
        triggers: [
            { sourceId: 's0', taskId: 'a', type: 'DailyTrigger', summary: 'Daily at 12:00', projectionStatus: 'projected', reasonCode: null },
            { sourceId: 's1', taskId: 'a', type: 'IntervalTrigger', summary: 'Every 12 hours', projectionStatus: 'timingUnknown', reasonCode: 'intervalAnchorUnavailable' },
            { sourceId: 's2', taskId: 'a', type: 'StartupTrigger', summary: 'At startup', projectionStatus: 'eventBased', reasonCode: 'startupEvent' },
            { sourceId: 's3', taskId: 'b', type: 'DailyTrigger', summary: 'Daily at 12:00', projectionStatus: 'projected', reasonCode: null }
        ],
        occurrences: [
            { occurrenceId: 'o0', taskId: 'a', sourceId: 's0', projectedStart: at('12:00'), startBasis: 'calendarRule', lastRecordedDurationMs: 600000, estimatedEnd: at('12:10') },
            { occurrenceId: 'o1', taskId: 'b', sourceId: 's3', projectedStart: at('12:00'), startBasis: 'calendarRule', lastRecordedDurationMs: null, estimatedEnd: null }
        ],
        overlaps: [{ firstOccurrenceId: 'o0', secondOccurrenceId: 'o1', kind: 'sameStart', windowStart: null, windowEnd: null }]
    };
}
