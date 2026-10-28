// Self-contained because Jellyfin imports plugin controllers through its view loader.
export function taskProgress(task) {
    const value = task.CurrentProgressPercentage;
    return task.State === 'Running' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function createLiveTaskMonitor(api, { onTasks, onStatus }) {
    let active = false;
    let connected = true;
    let ready = false;
    let generation = 0;
    let request = 0;
    let buffered;
    let unsubscribe;

    function receive(message) {
        if (!active || !connected || !Array.isArray(message.Data)) return;
        if (!ready) {
            buffered = message.Data;
            return;
        }
        onTasks(message.Data, 'live');
        onStatus('live');
    }

    async function refresh() {
        if (!active || !connected) return;
        const lifetime = generation;
        const currentRequest = ++request;
        ready = false;
        buffered = undefined;
        onStatus('connecting');
        try {
            const tasks = await api.getScheduledTasks();
            if (!active || !connected || lifetime !== generation || currentRequest !== request) return;
            if (!Array.isArray(tasks)) throw new Error('Invalid task response');
            onTasks(tasks, 'snapshot');
            ready = true;
            onStatus('awaiting-live');
            if (buffered) {
                const tasks = buffered;
                buffered = undefined;
                receive({ Data: tasks });
            }
        } catch {
            if (active && lifetime === generation && currentRequest === request) onStatus('stale');
        }
    }

    return {
        async start() {
            if (active) return;
            active = true;
            connected = true;
            generation++;
            try {
                const lifetime = generation;
                unsubscribe = api.subscribe(['ScheduledTasksInfo'], message => {
                    if (lifetime === generation) receive(message);
                });
                await refresh();
            } catch {
                onStatus('unavailable');
            }
        },
        stop() {
            if (!active) return;
            active = false;
            ready = false;
            generation++;
            request++;
            buffered = undefined;
            unsubscribe?.();
            unsubscribe = undefined;
            onStatus('stopped');
        },
        connectionLost() {
            if (!active) return;
            connected = false;
            ready = false;
            request++;
            buffered = undefined;
            onStatus('disconnected');
        },
        reconnect() {
            if (!active) return Promise.resolve();
            connected = true;
            return refresh();
        },
        refresh
    };
}

export default function (view) {
    const api = globalThis.ApiClient;
    const root = view.querySelector('[data-diagnostics]');
    const status = root.querySelector('[data-status]');
    const list = root.querySelector('[data-tasks]');
    const messages = root.querySelector('[data-messages]');
    const refreshed = root.querySelector('[data-refreshed]');
    let lifetime;
    let connectionCleanup;
    let timer;
    let shown = false;
    let latestTasks = [];
    let messageCount = 0;
    let snapshotCount = 0;
    const labels = {
        connecting: 'Refreshing current task state…',
        'awaiting-live': 'Snapshot loaded; waiting for task changes',
        live: 'Live task updates connected',
        disconnected: 'Live updates disconnected — displayed data is stale',
        stale: 'Refresh failed — displayed data is stale',
        stopped: 'Monitoring paused',
        unavailable: 'Native task subscriptions are unavailable'
    };
    const monitor = createLiveTaskMonitor(api, {
        onStatus(value) {
            root.dataset.status = value;
            status.textContent = labels[value];
        },
        onTasks(tasks, source) {
            latestTasks = tasks;
            if (source === 'live') messages.textContent = String(++messageCount);
            else root.dataset.snapshots = String(++snapshotCount);
            root.dataset.source = source;
            refreshed.textContent = new Date().toLocaleTimeString();
            list.replaceChildren();
            for (const task of tasks.filter(task => task.Key?.startsWith('TaskTimeline.Diagnostics.'))) {
                const item = document.createElement('li');
                item.dataset.taskKey = task.Key;
                item.dataset.state = task.State;
                const name = document.createElement('strong');
                name.textContent = task.Name;
                const detail = document.createElement('span');
                const percentage = taskProgress(task);
                detail.textContent = ` — ${task.State}${percentage === null ? '' : ` · ${Math.round(percentage)}%`}`;
                item.append(name, detail);
                if (task.State === 'Running') {
                    const progress = document.createElement('progress');
                    progress.max = 100;
                    progress.setAttribute('aria-label', task.Name);
                    if (percentage !== null) progress.value = percentage;
                    item.append(document.createElement('br'), progress);
                }
                list.append(item);
            }
            root.querySelectorAll('[data-run-task]').forEach(button => {
                const task = tasks.find(task => task.Key === button.dataset.runTask);
                button.disabled = !task || task.State !== 'Idle';
            });
        }
    });

    function stop() {
        shown = false;
        lifetime?.abort();
        clearInterval(timer);
        connectionCleanup?.();
        connectionCleanup = undefined;
        monitor.stop();
    }

    async function start() {
        stop();
        if (document.hidden) return;
        shown = true;
        lifetime = new AbortController();
        const signal = lifetime.signal;
        await monitor.start();
        if (signal.aborted) return;
        // Jellyfin's compatibility client exposes its SDK here. Guard this bridge:
        // an unavailable connection-status API must not silently appear live.
        const socket = api._sdk?.webSocket;
        if (typeof socket?.onStatusChange !== 'function') {
            monitor.stop();
            root.dataset.status = 'unavailable';
            status.textContent = 'Native connection-status bridge is unavailable on this client';
            return;
        }
        connectionCleanup = socket.onStatusChange(state => {
            if (state === 1) void monitor.reconnect();
            else monitor.connectionLost();
        });
        window.addEventListener('offline', () => monitor.connectionLost(), { signal });
        window.addEventListener('online', () => { void monitor.reconnect(); }, { signal });
        timer = setInterval(() => { void monitor.refresh(); }, 30000);
    }

    root.querySelector('[data-refresh]').addEventListener('click', () => { void monitor.refresh(); });
    root.querySelectorAll('[data-run-task]').forEach(button => {
        button.addEventListener('click', async () => {
            const task = latestTasks.find(task => task.Key === button.dataset.runTask);
            if (!task || !task.Key.startsWith('TaskTimeline.Diagnostics.') || task.State !== 'Idle') return;
            button.disabled = true;
            try {
                await api.startScheduledTask(task.Id);
            } catch {
                status.textContent = 'Could not start the diagnostic task';
            }
        });
    });
    view.addEventListener('viewshow', () => { void start(); });
    view.addEventListener('viewhide', stop);
    view.addEventListener('viewdestroy', () => {
        stop();
        document.removeEventListener('visibilitychange', onVisibilityChange);
    });
    function onVisibilityChange() {
        if (document.hidden) {
            if (shown) {
                stop();
                shown = true;
            }
        } else if (shown) void start();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
}
