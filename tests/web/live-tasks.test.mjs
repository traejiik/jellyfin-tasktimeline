import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveTaskMonitor, taskProgress } from '../../src/Jellyfin.Plugin.TaskTimeline/Web/Diagnostics/diagnostics.js';

function harness() {
    let receive;
    let subscriptions = 0;
    let unsubscriptions = 0;
    let fetch = async () => [{ Id: 'snapshot' }];
    const events = [];
    const api = {
        subscribe(types, callback) {
            assert.deepEqual(types, ['ScheduledTasksInfo']);
            subscriptions++;
            receive = callback;
            return () => { unsubscriptions++; };
        },
        getScheduledTasks: () => fetch()
    };
    const monitor = createLiveTaskMonitor(api, {
        onTasks: (tasks, source) => events.push({ tasks, source }),
        onStatus: status => events.push({ status })
    });
    return { monitor, events, send: data => receive({ Data: data }), setFetch: fn => { fetch = fn; },
        receiver: () => receive, counts: () => ({ subscriptions, unsubscriptions }) };
}

test('opening twice uses one native subscription and hiding releases it once', async () => {
    const h = harness();
    await h.monitor.start();
    await h.monitor.start();
    h.send([{ Id: 'live' }]);
    assert.deepEqual(h.events.at(-2), { tasks: [{ Id: 'live' }], source: 'live' });
    h.monitor.stop();
    h.monitor.stop();
    assert.deepEqual(h.counts(), { subscriptions: 1, unsubscriptions: 1 });
    const count = h.events.length;
    h.send([{ Id: 'late' }]);
    assert.equal(h.events.length, count);
});

test('snapshot cannot overwrite a newer live message', async () => {
    const h = harness();
    let resolve;
    h.setFetch(() => new Promise(done => { resolve = done; }));
    const opening = h.monitor.start();
    h.send([{ Id: 'newer' }]);
    resolve([{ Id: 'older' }]);
    await opening;
    assert.deepEqual(h.events.filter(e => e.tasks).map(e => e.tasks[0].Id), ['older', 'newer']);
    assert.equal(h.events.at(-1).status, 'live');
});

test('hiding rejects an outstanding snapshot even after reopening', async () => {
    const h = harness();
    let resolve;
    h.setFetch(() => new Promise(done => { resolve = done; }));
    const first = h.monitor.start();
    h.monitor.stop();
    h.setFetch(async () => [{ Id: 'current' }]);
    await h.monitor.start();
    resolve([{ Id: 'obsolete' }]);
    await first;
    assert.deepEqual(h.events.filter(e => e.tasks).map(e => e.tasks[0].Id), ['current']);
});

test('reconnecting fetches a snapshot before accepting buffered live updates', async () => {
    const h = harness();
    await h.monitor.start();
    h.monitor.connectionLost();
    assert.equal(h.events.at(-1).status, 'disconnected');
    h.send([{ Id: 'disconnected' }]);
    let resolve;
    h.setFetch(() => new Promise(done => { resolve = done; }));
    const reconnecting = h.monitor.reconnect();
    h.send([{ Id: 'fresh-live' }]);
    assert.equal(h.events.at(-1).status, 'connecting');
    resolve([{ Id: 'fresh-snapshot' }]);
    await reconnecting;
    assert.deepEqual(h.events.filter(e => e.tasks).map(e => e.tasks[0].Id), ['snapshot', 'fresh-snapshot', 'fresh-live']);
    assert.deepEqual(h.counts(), { subscriptions: 1, unsubscriptions: 0 });
});

test('failed refresh retains data and marks it stale', async () => {
    const h = harness();
    await h.monitor.start();
    h.setFetch(async () => { throw new Error('offline'); });
    await h.monitor.refresh();
    assert.equal(h.events.at(-1).status, 'stale');
    assert.equal(h.events.filter(e => e.tasks).length, 1);
});

test('only actual finite running progress is determinate, including zero', () => {
    assert.equal(taskProgress({ State: 'Running', CurrentProgressPercentage: 0 }), 0);
    assert.equal(taskProgress({ State: 'Running', CurrentProgressPercentage: 50 }), 50);
    for (const value of [null, undefined, NaN, Infinity, -1, 101, '50']) {
        assert.equal(taskProgress({ State: 'Running', CurrentProgressPercentage: value }), null);
    }
    assert.equal(taskProgress({ State: 'Idle', CurrentProgressPercentage: 100 }), null);
});


test('a callback from a previous page lifetime cannot update a reopened page', async () => {
    const h = harness();
    await h.monitor.start();
    const oldReceive = h.receiver();
    h.monitor.stop();
    await h.monitor.start();
    const count = h.events.length;
    oldReceive({ Data: [{ Id: 'old-socket-message' }] });
    assert.equal(h.events.length, count);
});
