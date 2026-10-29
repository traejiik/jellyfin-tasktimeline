import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTimelineModel, buildDayAxis, formatDuration, explainSource, timelineNotice, taskStateLabel, forecastActivity } from '../../src/Jellyfin.Plugin.TaskTimeline/Web/timeline-model.js';
import { forecastFixture } from './fixtures/forecast.mjs';

test('axis covers partial UTC dates and excludes an exact midnight endpoint', () => {
    const axis = buildDayAxis('2026-11-10T10:00:00Z', '2026-11-17T10:00:00Z', 'Etc/UTC');
    assert.equal(axis.days.length, 8);
    assert.equal(axis.start, Date.parse('2026-11-10T00:00:00Z'));
    assert.equal(axis.end, Date.parse('2026-11-18T00:00:00Z'));
    assert.equal(buildDayAxis('2026-11-10T00:00:00Z', '2026-11-17T00:00:00Z', 'UTC').days.length, 7);
});

test('a 168-hour spring horizon can touch nine server calendar dates', () => {
    const axis = buildDayAxis('2026-03-25T22:30:00Z', '2026-04-01T22:30:00Z', 'Europe/Budapest');
    assert.equal(axis.days.length, 9);
    assert.ok(axis.days.some(d => d.end - d.start === 23 * 3600000));
    assert.equal(axis.days[0].key, '2026-03-25');
});

test('unknown browser timezone IDs use explicit UTC fallback', () => {
    const axis = buildDayAxis('2026-11-10T10:00:00Z', '2026-11-17T10:00:00Z', 'Invalid/Timezone');
    assert.equal(axis.timeZone, 'UTC');
    assert.match(axis.warning, /UTC/);
});

test('joins API pairs and counts mixed-task undated sources rather than tasks', () => {
    const model = buildTimelineModel(forecastFixture(), { now: Date.parse('2026-11-10T10:00:00Z'), selectedTaskId: 'removed', groupBy: 'category' });
    assert.equal(model.offCalendarSourceCount, 2);
    assert.equal(model.overlapPairCount, 1);
    assert.equal(model.selectedTaskId, 'a');
    assert.equal(model.noTriggerTasks[0].taskId, 'c');
    assert.equal(model.groups.find(g => g.label === 'Library').overlapCount, 1);
    assert.equal(model.groups.find(g => g.label === 'Maintenance').overlapCount, 1);
    assert.equal(model.nextStarts.length, 2);
    assert.equal(model.occurrences[1].estimatedEnd, null);
});

test('native observations remain authoritative over an older forecast', () => {
    const model = buildTimelineModel(forecastFixture(), { now: 0, observedTasks: new Map([['a', { Id: 'a', State: 'Running', CurrentProgressPercentage: 0 }]]) });
    assert.equal(model.tasks[0].state, 'Running');
    assert.equal(model.running[0].progressPercentage, 0);
    assert.equal(model.tasks[1].progressPercentage, null);
});

test('duplicates retain identity and empty or elapsed forecasts do not invent a next start', () => {
    const fixture = forecastFixture();
    fixture.occurrences.push({ ...fixture.occurrences[0], occurrenceId: 'duplicate', sourceId: 'duplicateSource' });
    fixture.triggers.push({ ...fixture.triggers[0], sourceId: 'duplicateSource' });
    const model = buildTimelineModel(fixture, { now: Date.parse('2026-11-11T00:00:00Z') });
    assert.equal(model.occurrences.length, 3);
    assert.equal(new Set(model.occurrences.map(x => x.occurrenceId)).size, 3);
    assert.equal(model.nextStart, null);
    fixture.tasks = []; fixture.triggers = []; fixture.occurrences = []; fixture.overlaps = [];
    assert.equal(buildTimelineModel(fixture).selectedTaskId, null);
});

test('duration and source copy retain zero, unknown and future reason states', () => {
    assert.equal(formatDuration(0), '0 s');
    assert.equal(formatDuration(null), 'Unknown');
    assert.equal(formatDuration(50), '<1 s');
    assert.match(explainSource({ projectionStatus: 'unsupported', reasonCode: 'clockChangeTimingUnknown' }).reason, /clock change/);
    assert.equal(explainSource({ projectionStatus: 'eventBased', reasonCode: 'startupEvent' }).label, 'Event-based');
    assert.ok(explainSource({ projectionStatus: 'unsupported', reasonCode: 'futureCode' }).reason);
});

test('zero-length and unknown bars never cause the browser to invent overlap pairs', () => {
    const fixture = forecastFixture(); fixture.overlaps = [];
    fixture.occurrences[0].estimatedEnd = fixture.occurrences[0].projectedStart;
    fixture.occurrences[0].lastRecordedDurationMs = 0;
    const model = buildTimelineModel(fixture);
    assert.equal(model.overlapPairCount, 0);
    assert.equal(model.occurrences[0].end, model.occurrences[0].start);
    assert.equal(model.occurrences[1].end, null);
});

test('off-calendar groups retain sources and keep no-trigger tasks separate', () => {
    const fixture = forecastFixture();
    fixture.triggers.push({ ...fixture.triggers[1], sourceId: 'second-interval' });
    fixture.triggers.push({ sourceId: 'unsupported', taskId: 'b', type: 'FutureTrigger', summary: 'Custom rule', projectionStatus: 'unsupported', reasonCode: 'unknownTriggerType' });
    const model = buildTimelineModel(fixture);
    assert.deepEqual(model.offCalendarGroups.map(g => g.id), ['timingUnknown', 'eventBased', 'unsupported', 'noTriggers']);
    assert.equal(model.offCalendarGroups[0].items.length, 2);
    assert.equal(model.offCalendarGroups[0].unit, 'sources');
    assert.equal(model.offCalendarGroups[3].unit, 'tasks');
    assert.equal(model.offCalendarGroups[3].items.length, 1);
    assert.equal(model.offCalendarSourceCount, 4);
    assert.notEqual(model.offCalendarGroups[0].items[0].sourceId, model.offCalendarGroups[0].items[1].sourceId);
});

test('routine health is quiet but failed or disconnected data remains explicit', () => {
    assert.equal(timelineNotice('ready', 'awaiting-live', true), null);
    assert.equal(timelineNotice('ready', 'live', true), null);
    assert.equal(timelineNotice('loading', 'connecting', true), null);
    assert.match(timelineNotice('stale', 'live', true), /previous forecast/i);
    assert.match(timelineNotice('ready', 'disconnected', true), /stale/i);
    assert.match(timelineNotice('ready', 'unavailable', true), /unavailable/i);
    assert.match(timelineNotice('forbidden', 'live', true), /administrator/i);
    assert.equal(forecastActivity('loading', true), 'Refreshing…');
    assert.equal(forecastActivity('loading', false), 'Loading…');
    assert.equal(forecastActivity('ready', true), null);
});

test('Idle describes execution, not disabled scheduling', () => {
    assert.equal(taskStateLabel('Idle'), 'Not running');
    assert.equal(taskStateLabel('Running'), 'Running');
    assert.equal(taskStateLabel('Cancelling'), 'Cancelling');
});
