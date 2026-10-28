// The native view loader imports controllers from Blob URLs; load shared resources explicitly.
export default function (view) {
    let shown = false;
    let destroyed = false;
    const bootstrap = new AbortController();
    view.addEventListener('viewshow', () => { shown = true; }, { signal: bootstrap.signal });
    view.addEventListener('viewhide', () => { shown = false; }, { signal: bootstrap.signal });
    view.addEventListener('viewdestroy', () => { destroyed = true; bootstrap.abort(); }, { signal: bootstrap.signal });
    const api = globalThis.ApiClient;
    api.ajax({ url: api.getUrl('web/ConfigurationPage', { name: 'taskTimelineTaskUpdatesJs' }), type: 'GET', dataType: 'text' })
        .then(async source => {
            const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
            try {
                const shared = await import(url);
                if (destroyed) return;
                bootstrap.abort();
                initialize(view, shared);
                if (shown) view.dispatchEvent(new Event('viewshow'));
            } finally { URL.revokeObjectURL(url); }
        }).catch(() => {
            if (!destroyed) view.querySelector('[data-status]').textContent = 'Could not load native task monitoring. Reopen this page to retry.';
        });
}

function initialize(view, { createLiveTaskMonitor, taskProgress }) {
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
