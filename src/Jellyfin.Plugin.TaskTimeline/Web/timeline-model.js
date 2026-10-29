// Pure presentation of API data. No scheduling or overlap inference happens here.
const HOUR = 3600000;
const clamp = value => Math.max(0, Math.min(1, value));

export function buildDayAxis(rangeStart, rangeEnd, requestedZone) {
    const start = Date.parse(rangeStart), end = Date.parse(rangeEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 7 * 24 * HOUR) throw new Error('Invalid forecast range');
    let timeZone = requestedZone, warning = null, formatter;
    try { formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch { timeZone = 'UTC'; warning = `Server timezone ${requestedZone} cannot be displayed by this browser. Times are shown in UTC.`; formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); }
    const key = instant => {
        const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    };
    const boundaries = [];
    let previous = Math.floor((start - 36 * HOUR) / HOUR) * HOUR;
    for (let instant = previous + HOUR; instant <= end + 36 * HOUR; instant += HOUR) {
        if (key(previous) !== key(instant)) {
            let low = previous, high = instant;
            const oldKey = key(low);
            while (high - low > 1) {
                const middle = Math.floor((low + high) / 2);
                if (key(middle) === oldKey) low = middle; else high = middle;
            }
            boundaries.push(high);
        }
        previous = instant;
    }
    const days = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
        if (boundaries[i] < end && boundaries[i + 1] > start) days.push({ key: key(boundaries[i]), start: boundaries[i], end: boundaries[i + 1] });
    }
    if (!days.length) throw new Error('Unable to construct forecast calendar');
    const axisStart = days[0].start, axisEnd = days.at(-1).end;
    const position = instant => clamp((instant - axisStart) / (axisEnd - axisStart));
    return { start: axisStart, end: axisEnd, days, timeZone, warning, rangeStart: start, rangeEnd: end,
        rangeLeft: position(start), rangeRight: position(end), now: position(Date.now()) };
}

export function formatDuration(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return 'Unknown';
    if (ms === 0) return '0 s';
    if (ms < 1000) return '<1 s';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} s` : ''}`;
    return `${Math.floor(seconds / 3600)} h${Math.floor(seconds % 3600 / 60) ? ` ${Math.floor(seconds % 3600 / 60)} min` : ''}`;
}

export function explainSource(source) {
    const labels = { projected: 'Projected', timingUnknown: 'Timing unknown', eventBased: 'Event-based', unsupported: 'Unsupported rule' };
    const reasons = {
        intervalAnchorUnavailable: 'Jellyfin does not expose the interval timer anchor, so its next start is unknown.',
        startupEvent: 'Runs when Jellyfin starts. There is no future timestamp to show.',
        invalidIntervalRule: 'The interval configuration cannot be interpreted safely.',
        unknownTriggerType: 'This trigger type is not supported for prediction.',
        invalidCalendarRule: 'The calendar configuration cannot be interpreted safely.',
        clockChangeTimingUnknown: 'A server clock change makes this timer deadline depend on when Jellyfin armed it. No precise start is shown.'
    };
    return { label: labels[source.projectionStatus] || 'Unavailable', reason: reasons[source.reasonCode] || (source.projectionStatus === 'projected' ? 'Calculated from the configured calendar rule; execution is not guaranteed.' : 'This source cannot currently be placed on the calendar.') };
}

export function taskStateLabel(state) {
    return state === 'Idle' ? 'Not running' : state || 'Unknown';
}

export function forecastActivity(status, hasForecast) {
    if (status === 'loading') return hasForecast ? 'Refreshing…' : 'Loading…';
    if (status === 'forbidden') return 'Administrator access required';
    if (status === 'unauthorized') return 'Sign in required';
    return hasForecast ? null : 'Forecast unavailable';
}

export function timelineNotice(forecastStatus, liveStatus, hasForecast) {
    if (forecastStatus === 'forbidden') return 'Administrator access is required to view Task Timeline.';
    if (forecastStatus === 'unauthorized') return 'Your session has expired. Sign in to Jellyfin again.';
    if (forecastStatus === 'stale') return hasForecast ? 'Forecast refresh failed. Showing the previous forecast.' : 'Could not load the forecast. Use Retry to try again.';
    if (liveStatus === 'disconnected') return 'Live updates disconnected. Observed task state is stale.';
    if (liveStatus === 'stale') return 'Observed task refresh failed. Displayed state is stale.';
    if (liveStatus === 'unavailable') return 'Live progress is unavailable on this client. Forecasts remain usable.';
    return null;
}

function offCalendarGroups(offCalendar, noTriggerTasks) {
    const definitions = [
        ['timingUnknown', 'Timing unknown', 'Jellyfin does not expose these interval timers’ anchors, so their next start cannot be determined.'],
        ['eventBased', 'Event-based', 'These sources run on events such as server startup. There is no known future timestamp to show.'],
        ['unsupported', 'Unsupported', 'These rules cannot be projected safely. Select a task for its specific limitation, including clock changes or unsupported trigger types.']
    ];
    const groups = definitions.map(([id, label, description]) => ({ id, label, description, unit: 'sources',
        items: offCalendar.filter(source => (['timingUnknown', 'eventBased'].includes(source.projectionStatus) ? source.projectionStatus : 'unsupported') === id) }));
    groups.push({ id: 'noTriggers', label: 'No triggers', unit: 'tasks', description: 'These tasks have no configured triggers. They are counted separately from undated trigger sources.',
        items: noTriggerTasks.map(task => ({ taskId: task.taskId, task, summary: 'No configured triggers' })) });
    return groups.filter(group => group.items.length > 0);
}

export function buildTimelineModel(forecast, { now = Date.now(), selectedTaskId, groupBy = 'category', observedTasks = new Map() } = {}) {
    const axis = buildDayAxis(forecast.rangeStart, forecast.rangeEnd, forecast.serverTimeZone);
    const tasks = forecast.tasks.map(task => {
        const observed = observedTasks.get(task.taskId);
        const state = observed?.State ?? task.state;
        const rawProgress = observed ? observed.CurrentProgressPercentage : task.progressPercentage;
        const progressPercentage = state === 'Running' && Number.isFinite(rawProgress) && rawProgress >= 0 && rawProgress <= 100 ? rawProgress : null;
        return { ...task, state, progressPercentage, sources: forecast.triggers.filter(s => s.taskId === task.taskId) };
    });
    const taskMap = new Map(tasks.map(t => [t.taskId, t]));
    const occurrences = forecast.occurrences.map(o => ({ ...o, start: Date.parse(o.projectedStart), end: o.estimatedEnd ? Date.parse(o.estimatedEnd) : null,
        task: taskMap.get(o.taskId), overlaps: forecast.overlaps.filter(p => p.firstOccurrenceId === o.occurrenceId || p.secondOccurrenceId === o.occurrenceId) }));
    const occurrenceMap = new Map(occurrences.map(o => [o.occurrenceId, o]));
    const pairs = forecast.overlaps.map(p => ({ ...p, first: occurrenceMap.get(p.firstOccurrenceId), second: occurrenceMap.get(p.secondOccurrenceId) }));
    for (const task of tasks) {
        task.occurrences = occurrences.filter(o => o.taskId === task.taskId).sort((a, b) => a.start - b.start);
        task.overlaps = pairs.filter(p => p.first?.taskId === task.taskId || p.second?.taskId === task.taskId);
    }
    const compare = (a, b) => (a.occurrences[0]?.start ?? Infinity) - (b.occurrences[0]?.start ?? Infinity) || a.name.localeCompare(b.name);
    const groups = groupBy === 'category'
        ? [...new Set(tasks.map(t => t.category))].sort((a, b) => a.localeCompare(b)).map(label => ({ label, tasks: tasks.filter(t => t.category === label).sort(compare), overlapCount: pairs.filter(p => p.first?.task.category === label || p.second?.task.category === label).length }))
        : [{ label: null, tasks: [...tasks].sort(compare), overlapCount: pairs.length }];
    const nextStart = occurrences.filter(o => o.start >= now).sort((a, b) => a.start - b.start)[0] ?? null;
    const offCalendar = forecast.triggers.filter(s => s.projectionStatus !== 'projected').map(s => ({ ...s, task: taskMap.get(s.taskId), ...explainSource(s) }));
    const noTriggerTasks = tasks.filter(t => t.sources.length === 0);
    return { axis, tasks, occurrences, pairs, groups, selectedTaskId: taskMap.has(selectedTaskId) ? selectedTaskId : tasks[0]?.taskId ?? null,
        running: tasks.filter(t => t.state === 'Running'), nextStart, nextStarts: nextStart ? occurrences.filter(o => o.start === nextStart.start) : [],
        offCalendar, offCalendarGroups: offCalendarGroups(offCalendar, noTriggerTasks),
        offCalendarSourceCount: forecast.triggers.filter(s => s.projectionStatus !== 'projected').length,
        noTriggerTasks, overlapPairCount: pairs.length, now };
}
