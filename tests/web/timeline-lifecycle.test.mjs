import assert from 'node:assert/strict';
import test from 'node:test';
import { createForecastMonitor } from '../../src/Jellyfin.Plugin.TaskTimeline/Web/timeline.js';

test('forecast rejects old responses and preserves successful data on refresh failure', async () => {
    let resolve;
    let fetch = () => new Promise(done => { resolve = done; });
    const data = [], statuses = [];
    const monitor = createForecastMonitor(() => fetch(), { onForecast: x => data.push(x), onStatus: x => statuses.push(x) });
    const opening = monitor.start();
    monitor.stop(); resolve({ id: 'late' }); await opening;
    assert.equal(data.length, 0);
    fetch = async () => ({ id: 'good' });
    await monitor.start();
    fetch = async () => { throw new Error('offline'); };
    await monitor.refresh();
    assert.deepEqual(data, [{ id: 'good' }]);
    assert.equal(statuses.at(-1), 'stale');
    monitor.stop();
});

test('newer refresh wins and forbidden access disables automatic work', async () => {
    const resolvers = [], data = [], statuses = [];
    const monitor = createForecastMonitor(() => new Promise(done => resolvers.push(done)), { onForecast: x => data.push(x), onStatus: x => statuses.push(x) });
    const first = monitor.start(), second = monitor.refresh();
    resolvers[1]('new'); await second; resolvers[0]('old'); await first;
    assert.deepEqual(data, ['new']); monitor.stop();
    let calls = 0;
    const blocked = createForecastMonitor(async () => { calls++; throw { status: 403 }; }, { onForecast() {}, onStatus: x => statuses.push(x) });
    await blocked.start(); await blocked.refresh();
    assert.equal(calls, 1); assert.equal(statuses.at(-1), 'forbidden'); blocked.stop();
});

test('a previous opening cannot install an extra polling timer after reopening', async () => {
    const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
    const timers = new Set(), pending = [];
    globalThis.setInterval = () => { const timer = {}; timers.add(timer); return timer; };
    globalThis.clearInterval = timer => timers.delete(timer);
    const monitor = createForecastMonitor(() => new Promise(resolve => pending.push(resolve)), { onForecast() {}, onStatus() {} });
    try {
        const first = monitor.start(); monitor.stop(); const second = monitor.start();
        pending[1]({}); await second; pending[0]({}); await first;
        assert.equal(timers.size, 1);
        monitor.stop(); assert.equal(timers.size, 0);
    } finally { globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
});
