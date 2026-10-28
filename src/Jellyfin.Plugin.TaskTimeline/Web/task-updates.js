// Shared native task transport. This module has no relative imports.
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
