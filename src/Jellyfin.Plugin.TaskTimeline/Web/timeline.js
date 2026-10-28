// Native plugin controller: imports named embedded resources through authenticated requests.
export function createForecastMonitor(loadForecast, { onForecast, onStatus }) {
    let active = false, generation = 0, request = 0, timer;
    async function refresh() {
        if (!active) return;
        const lifetime = generation, current = ++request;
        onStatus('loading');
        try {
            const response = await loadForecast();
            if (!active || lifetime !== generation || current !== request) return;
            onForecast(response);
            onStatus('ready');
        } catch (error) {
            if (!active || lifetime !== generation || current !== request) return;
            const status = error?.status ?? error?.response?.status;
            if (status === 401 || status === 403) {
                active = false; clearInterval(timer);
                onStatus(status === 403 ? 'forbidden' : 'unauthorized');
            } else onStatus('stale');
        }
    }
    return {
        async start() {
            if (active) return;
            active = true; const opening = ++generation;
            await refresh();
            if (active && opening === generation) timer = setInterval(() => { void refresh(); }, 30000);
        },
        stop() { active = false; generation++; request++; clearInterval(timer); },
        refresh
    };
}

async function loadModule(api, name) {
    const source = await api.ajax({ url: api.getUrl('web/ConfigurationPage', { name }), type: 'GET', dataType: 'text' });
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try { return await import(url); } finally { URL.revokeObjectURL(url); }
}

export default function (view) {
    const root = view.querySelector('[data-timeline]');
    const api = globalThis.ApiClient;
    const q = selector => root.querySelector(selector);
    const state = { forecast: null, model: null, selectedTaskId: null, groupBy: 'category',
        view: matchMedia('(max-width: 720px)').matches ? 'agenda' : 'week', collapsed: new Set(), observedTasks: new Map() };
    let modules, modulePromise, forecastMonitor, liveMonitor, connectionCleanup, themeObserver, session, shown = false, destroyed = false, lifetime = 0, clockTimer;
    let forecastStatus = 'loading', liveStatus = 'stopped';
    const events = new AbortController();

    function node(tag, cls, text) {
        const item = document.createElement(tag);
        if (cls) item.className = cls;
        if (text !== undefined) item.textContent = text;
        return item;
    }
    function button(text, action, id, cls = 'tt-select') {
        const item = node('button', cls, text);
        item.type = 'button'; item.dataset.action = action;
        if (id !== undefined) item.dataset.id = id;
        item.dataset.focusKey = `${action}:${id ?? text}`;
        return item;
    }
    function tag(text, kind = '') { return node('span', `tt-tag ${kind}`, text); }
    function date(instant, options = {}) {
        if (instant === null || instant === undefined) return 'Unknown';
        return new Intl.DateTimeFormat(undefined, { timeZone: state.model?.axis.timeZone || 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...options }).format(new Date(instant));
    }
    function duration(value) { return modules.model.formatDuration(value); }
    function setText(selector, text) {
        const element = q(selector);
        if (element && element.textContent !== String(text)) element.textContent = text;
    }
    function message() {
        const labels = {
            loading: state.forecast ? 'Refreshing forecast…' : 'Loading forecast…',
            ready: 'Forecast loaded', stale: state.forecast ? 'Forecast refresh failed. Showing the previous forecast.' : 'Could not load the forecast. Use Retry to try again.',
            forbidden: 'Administrator access is required to view Task Timeline.', unauthorized: 'Your session has expired. Sign in to Jellyfin again.'
        };
        const liveLabels = { connecting: 'Refreshing observed task state', 'awaiting-live': 'Live task feed connected; waiting for changes', live: 'Live task updates connected',
            disconnected: 'Live updates disconnected. Observed task state is stale.', stale: 'Observed task refresh failed. Displayed state is stale.', unavailable: 'Live progress is unavailable on this client. Forecasts remain usable.', stopped: 'Live monitoring paused' };
        setText('[data-forecast-status]', labels[forecastStatus]);
        setText('[data-live-status]', liveLabels[liveStatus]);
        root.dataset.forecastStatus = forecastStatus; root.dataset.liveStatus = liveStatus;
        q('[data-refresh]').textContent = !state.forecast && forecastStatus === 'stale' ? 'Retry' : 'Refresh forecast';
        q('[data-refresh]').disabled = forecastStatus === 'loading' || ['forbidden', 'unauthorized'].includes(forecastStatus);
    }
    function rebuild() {
        const model = modules.model.buildTimelineModel(state.forecast, state);
        state.model = model; state.selectedTaskId = model.selectedTaskId;
        return model;
    }
    function renderRunning() {
        const list = q('[data-running]');
        const running = state.model?.running || [];
        const keep = new Set(running.map(t => t.taskId));
        for (const child of [...list.children]) if (!keep.has(child.dataset.taskId)) child.remove();
        for (const task of running) {
            let row = [...list.children].find(child => child.dataset.taskId === task.taskId);
            if (!row) {
                row = node('div', 'tt-running-task'); row.dataset.taskId = task.taskId;
                row.append(button(task.name, 'select', task.taskId));
                const progress = node('progress'); progress.max = 100; progress.setAttribute('aria-label', `${task.name} progress`);
                row.append(progress, node('span', 'tt-mono')); list.append(row);
            }
            const progress = row.querySelector('progress');
            if (task.progressPercentage === null) progress.removeAttribute('value'); else progress.value = task.progressPercentage;
            row.querySelector('span').textContent = task.progressPercentage === null ? 'Running · progress not reported' : `${Math.round(task.progressPercentage)}%`;
        }
        q('[data-running-empty]').hidden = running.length > 0;
    }
    function renderObserved() {
        if (!state.forecast) return;
        rebuild(); renderRunning();
        for (const element of root.querySelectorAll('[data-observed-task]')) {
            const task = state.model.tasks.find(t => t.taskId === element.dataset.observedTask);
            if (task) element.textContent = task.state;
        }
    }
    function tick() {
        if (!state.model) return;
        const now = Date.now();
        const upcoming = state.model.occurrences.filter(o => o.start >= now).sort((a, b) => a.start - b.start);
        const first = upcoming[0];
        setText('[data-next-time]', first ? date(first.start) : 'No dated starts');
        setText('[data-next-wait]', first ? `in ${duration(Math.max(0, first.start - now))}` : 'in this forecast range');
        setText('[data-next-names]', first ? [...new Set(upcoming.filter(o => o.start === first.start).map(o => o.task.name))].join(' · ') : 'Undated triggers remain listed below.');
        const percent = Math.max(0, Math.min(100, (now - state.model.axis.start) / (state.model.axis.end - state.model.axis.start) * 100));
        root.querySelectorAll('.tt-now').forEach(line => { line.style.left = `${percent}%`; });
    }
    function trackBase() {
        const axis = state.model.axis;
        const track = node('div', 'tt-track');
        track.style.gridTemplateColumns = axis.days.map(d => `${d.end - d.start}fr`).join(' ');
        axis.days.forEach(() => track.append(node('span', 'tt-cell')));
        const before = node('span', 'tt-range-shade'); before.style.width = `${axis.rangeLeft * 100}%`;
        const after = node('span', 'tt-range-shade tt-range-after'); after.style.width = `${(1 - axis.rangeRight) * 100}%`;
        const now = node('span', 'tt-now');
        for (const item of [before, after, now]) item.setAttribute('aria-hidden', 'true');
        track.append(before, after, now); return track;
    }
    function renderWeek() {
        const host = q('[data-week-content]'), model = state.model, axis = model.axis;
        host.replaceChildren();
        const header = node('div', 'tt-week-header');
        header.append(node('div', 'tt-task-heading', 'Task'));
        const dates = node('div', 'tt-day-headings');
        dates.style.gridTemplateColumns = axis.days.map(d => `${d.end - d.start}fr`).join(' ');
        for (const day of axis.days) {
            const item = node('div', 'tt-day');
            item.append(node('span', '', date(day.start, { weekday: 'short', month: undefined, day: undefined, hour: undefined, minute: undefined })),
                node('span', 'tt-mono', date(day.start, { hour: undefined, minute: undefined })));
            dates.append(item);
        }
        header.append(dates); host.append(header);
        if (!model.tasks.length) host.append(node('p', 'tt-empty', 'No scheduled tasks are available on this server.'));
        for (const group of model.groups) {
            if (group.label !== null) {
                const collapsed = state.collapsed.has(group.label);
                const heading = button('', 'collapse', group.label, 'tt-category');
                heading.setAttribute('aria-expanded', String(!collapsed));
                heading.append(node('span', '', collapsed ? '›' : '⌄'), node('strong', '', group.label || 'Uncategorized'), node('span', 'tt-mono', `${group.tasks.length} tasks`));
                if (group.overlapCount) heading.append(tag(`${group.overlapCount} overlap pairs`, 'tt-warn'));
                host.append(heading);
                if (collapsed) continue;
            }
            for (const task of group.tasks) {
                const row = node('div', `tt-task-row${task.taskId === state.selectedTaskId ? ' tt-selected' : ''}`);
                const name = button('', 'select', task.taskId, 'tt-task-name');
                name.setAttribute('aria-pressed', String(task.taskId === state.selectedTaskId));
                name.append(node('strong', '', task.name), node('span', 'tt-mono', `${task.sources.length} sources · last ${duration(task.lastExecution?.durationMs)}`));
                const observed = node('span', 'tt-observed', task.state); observed.dataset.observedTask = task.taskId; name.append(observed);
                const track = trackBase(), laneEnds = [];
                const trackWidth = Math.max(716, q('[data-week]').clientWidth - 264);
                for (const occurrence of task.occurrences) {
                    const left = (occurrence.start - axis.start) / (axis.end - axis.start);
                    const end = Math.min(occurrence.end ?? occurrence.start, axis.rangeEnd);
                    const width = Math.max(0, (end - occurrence.start) / (axis.end - axis.start));
                    let lane = laneEnds.findIndex(last => last <= left);
                    if (lane < 0) lane = laneEnds.length;
                    laneEnds[lane] = left + Math.max(width, 28 / trackWidth);
                    const marker = button('', 'select', task.taskId, `tt-mark${occurrence.overlaps.length ? ' tt-overlap' : ''}${width * trackWidth < 6 ? ' tt-pin' : ''}`);
                    marker.dataset.occurrenceId = occurrence.occurrenceId;
                    marker.style.left = `${left * 100}%`; marker.style.width = `max(24px, ${width * 100}%)`; marker.style.top = `${12 + lane * 28}px`;
                    const explanation = `${task.name} · ${date(occurrence.start)} · ${occurrence.lastRecordedDurationMs === null ? 'duration unknown' : `last run ${duration(occurrence.lastRecordedDurationMs)}`}${occurrence.overlaps.length ? ' · overlap indicator; select task for partners' : ''}`;
                    marker.setAttribute('aria-label', explanation); marker.title = explanation;
                    const glyph = node('span', 'tt-mark-glyph', occurrence.overlaps.length ? '!' : ''); marker.append(glyph); track.append(marker);
                }
                track.style.minHeight = `${Math.max(64, laneEnds.length * 28 + 24)}px`;
                if (!task.occurrences.length) {
                    const label = node('span', 'tt-undated-label', task.sources.length === 0 ? 'No configured triggers' : task.sources.some(s => s.projectionStatus === 'projected') ? 'No dated starts in this range' : 'Start time unknown');
                    label.style.left = `calc(${axis.rangeLeft * 100}% + 12px)`;
                    track.append(label);
                }
                row.append(name, track); host.append(row);
            }
        }
    }
    function renderAgenda() {
        const host = q('[data-agenda-content]'); host.replaceChildren();
        for (const day of state.model.axis.days) {
            const section = node('section', 'tt-agenda-day');
            section.append(node('h3', '', date(day.start, { weekday: 'long', hour: undefined, minute: undefined })));
            const occurrences = state.model.occurrences.filter(o => o.start >= day.start && o.start < day.end).sort((a, b) => a.start - b.start);
            if (!occurrences.length) section.append(node('p', 'tt-muted', 'No dated starts in this part of the range.'));
            for (const occurrence of occurrences) {
                const item = button('', 'select', occurrence.taskId, 'tt-agenda-item');
                item.setAttribute('aria-pressed', String(occurrence.taskId === state.selectedTaskId));
                const words = node('span', 'tt-agenda-words');
                words.append(node('strong', '', occurrence.task.name), node('span', 'tt-mono tt-muted', occurrence.estimatedEnd ? `estimated end ${date(occurrence.estimatedEnd)} · last ${duration(occurrence.lastRecordedDurationMs)}` : 'Duration unknown; projected start only'));
                const labels = node('span', 'tt-tags'); labels.append(tag(occurrence.task.category));
                if (occurrence.overlaps.length) labels.append(tag('Overlap', 'tt-warn'));
                item.append(node('time', 'tt-mono', date(occurrence.start, { month: undefined, day: undefined })), words, labels); section.append(item);
            }
            host.append(section);
        }
    }
    function renderOffCalendar() {
        const host = q('[data-off-calendar]'); host.replaceChildren();
        for (const source of state.model.offCalendar) {
            const item = button('', 'select', source.taskId, 'tt-off-item');
            const words = node('span', ''); words.append(node('strong', '', source.task.name), node('span', 'tt-muted', source.summary), node('span', 'tt-reason', source.reason));
            item.append(words, tag(source.label, source.projectionStatus === 'eventBased' ? 'tt-event' : '')); host.append(item);
        }
        for (const task of state.model.noTriggerTasks) {
            const item = button('', 'select', task.taskId, 'tt-off-item');
            item.append(node('strong', '', task.name), tag('No configured triggers')); host.append(item);
        }
        if (!host.children.length) host.append(node('p', 'tt-muted', 'All configured sources can be projected in this range.'));
    }
    function renderDetail() {
        const host = q('[data-detail]'); host.replaceChildren();
        const task = state.model.tasks.find(t => t.taskId === state.selectedTaskId);
        if (!task) { host.append(node('h2', '', 'Task details'), node('p', 'tt-muted', 'Select a task when scheduled task data is available.')); return; }
        const badges = node('div', 'tt-tags'); badges.append(tag(task.category));
        const status = tag(task.state); status.dataset.observedTask = task.taskId; badges.append(status);
        host.append(badges, node('h2', '', task.name));
        const last = node('section', 'tt-detail-section'); last.append(node('h3', 'tt-eyebrow', 'Last recorded run'));
        const result = task.lastExecution;
        if (!result) last.append(node('p', 'tt-muted', 'No recorded execution result.'));
        else {
            const list = node('dl');
            for (const [label, value] of [['Started', date(result.startedAt)], ['Duration', duration(result.durationMs)], ['Outcome', result.outcome]]) list.append(node('dt', '', label), node('dd', '', value));
            last.append(list);
        }
        last.append(node('p', 'tt-muted tt-small', 'One recorded run, not an average. Estimated ends use this length.'));
        host.append(last);
        const sources = node('section', 'tt-detail-section'); sources.append(node('h3', 'tt-eyebrow', 'Triggers'));
        if (!task.sources.length) sources.append(node('p', 'tt-muted', 'No configured triggers.'));
        for (const source of task.sources) {
            const copy = modules.model.explainSource(source), entry = node('div', 'tt-detail-entry');
            entry.append(node('strong', '', source.summary), tag(copy.label), node('p', 'tt-muted tt-small', copy.reason));
            if (source.reasonCode) {
                const technical = node('details', 'tt-technical'); technical.append(node('summary', '', 'Technical details'), node('code', '', `${source.projectionStatus} · ${source.reasonCode}`)); entry.append(technical);
            }
            sources.append(entry);
        }
        host.append(sources);
        const upcoming = node('section', 'tt-detail-section'); upcoming.append(node('h3', 'tt-eyebrow', 'Upcoming starts'));
        for (const occurrence of task.occurrences) {
            const entry = node('p', 'tt-detail-entry tt-small', `${date(occurrence.start)}${occurrence.estimatedEnd ? ` → ${date(occurrence.estimatedEnd)} estimated${occurrence.end > state.model.axis.rangeEnd ? ' (continues beyond this range)' : ''}` : ' · duration unknown'}`);
            upcoming.append(entry);
        }
        if (!task.occurrences.length) upcoming.append(node('p', 'tt-muted', 'No dated starts in this range. See the trigger explanations.'));
        if (task.occurrences.some((o, index, all) => all.some((p, other) => other !== index && p.start === o.start))) upcoming.append(node('p', 'tt-muted tt-small', 'Coincident sources remain separate. Jellyfin may queue a repeat; one execution is not guaranteed.'));
        host.append(upcoming);
        const overlaps = node('section', 'tt-detail-section'); overlaps.append(node('h3', 'tt-eyebrow', 'Overlaps'));
        if (!task.overlaps.length) overlaps.append(node('p', 'tt-muted', 'No overlap indicators in this range.'));
        for (const pair of task.overlaps) {
            const partner = pair.first.taskId === task.taskId ? pair.second.task : pair.first.task;
            const entry = node('div', 'tt-detail-entry');
            entry.append(button(`${partner.name}${partner.category !== task.category ? ` · ${partner.category}` : ''}`, 'select', partner.taskId),
                tag(pair.kind === 'sameStart' ? 'Same start' : 'Possible duration overlap', 'tt-warn'),
                node('p', 'tt-mono tt-small', pair.kind === 'sameStart' ? date(pair.first.start) : `${date(pair.windowStart)} → ${date(pair.windowEnd)}`));
            overlaps.append(entry);
        }
        host.append(overlaps);
    }
    function render() {
        const active = root.contains(document.activeElement) ? document.activeElement?.dataset.focusKey : null;
        const scrolls = ['[data-week]', '[data-agenda]'].map(s => [q(s), q(s).scrollTop, q(s).scrollLeft]);
        const model = rebuild();
        q('[data-body]').hidden = false; q('[data-summary]').hidden = false;
        setText('[data-generated]', `Generated ${date(state.forecast.generatedAt)} · ${state.forecast.serverTimeZone}`);
        q('[data-zone-warning]').hidden = !model.axis.warning; setText('[data-zone-warning]', model.axis.warning || '');
        setText('[data-overlap-count]', model.overlapPairCount);
        setText('[data-overlap-note]', `${model.pairs.filter(p => p.kind === 'sameStart').length} same-start · ${model.pairs.filter(p => p.kind !== 'sameStart').length} duration pairs`);
        setText('[data-off-count]', model.offCalendarSourceCount);
        renderWeek(); renderAgenda(); renderOffCalendar(); renderDetail(); renderRunning(); tick();
        q('[data-week-shell]').hidden = state.view !== 'week'; q('[data-agenda-shell]').hidden = state.view !== 'agenda'; q('[data-group-controls]').hidden = state.view !== 'week';
        root.querySelectorAll('[data-action="view"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === state.view)));
        root.querySelectorAll('[data-action="group"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === state.groupBy)));
        for (const [element, top, left] of scrolls) { element.scrollTop = top; element.scrollLeft = left; }
        if (active) [...root.querySelectorAll('[data-focus-key]')].find(b => b.dataset.focusKey === active)?.focus({ preventScroll: true });
    }
    async function ensureModules() {
        if (modules) return modules;
        modulePromise ??= Promise.all([loadModule(api, 'taskTimelineModelJs'), loadModule(api, 'taskTimelineTaskUpdatesJs')])
            .then(([model, transport]) => ({ model, transport })).catch(error => { modulePromise = undefined; throw error; });
        modules = await modulePromise;
        return modules;
    }
    async function connectLive(ticket) {
        if (!shown || document.hidden || ticket !== lifetime || liveMonitor) return;
        const socket = api._sdk?.webSocket;
        if (typeof socket?.onStatusChange !== 'function' || typeof api.subscribe !== 'function') { liveStatus = 'unavailable'; message(); return; }
        liveMonitor = modules.transport.createLiveTaskMonitor(api, {
            onStatus(status) { liveStatus = status; message(); },
            onTasks(tasks, source) {
                if (source === 'snapshot') state.observedTasks.clear();
                for (const task of tasks) state.observedTasks.set(task.Id, task);
                renderObserved();
            }
        });
        const monitor = liveMonitor;
        await monitor.start();
        if (!shown || ticket !== lifetime || monitor !== liveMonitor) return;
        connectionCleanup = socket.onStatusChange(status => {
            if (status === 1) { void monitor.reconnect(); void forecastMonitor.refresh(); }
            else monitor.connectionLost();
        });
        if (socket.socketStatus !== 1) monitor.connectionLost();
        window.addEventListener('offline', () => monitor.connectionLost(), { signal: session.signal });
        window.addEventListener('online', () => { void monitor.reconnect(); void forecastMonitor.refresh(); }, { signal: session.signal });
    }
    function stop() {
        lifetime++; session?.abort(); clearInterval(clockTimer); forecastMonitor?.stop();
        themeObserver?.disconnect();
        connectionCleanup?.(); connectionCleanup = undefined; liveMonitor?.stop(); liveMonitor = undefined;
    }
    function syncTheme() {
        const background = getComputedStyle(document.querySelector('.backgroundContainer') || document.body).backgroundColor;
        if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') root.style.setProperty('--tt-header-bg', background);
    }
    async function start() {
        stop();
        if (!shown || document.hidden || destroyed) return;
        state.observedTasks.clear();
        const ticket = lifetime; session = new AbortController();
        syncTheme();
        themeObserver = new MutationObserver(syncTheme);
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
        document.head.addEventListener('load', syncTheme, { capture: true, signal: session.signal });
        forecastStatus = 'loading'; message();
        try {
            await ensureModules();
            if (ticket !== lifetime || !shown || destroyed) return;
            forecastMonitor = createForecastMonitor(() => api.ajax({ url: api.getUrl('TaskTimeline/Forecast'), type: 'GET', dataType: 'json' }), {
                onForecast(response) {
                    modules.model.buildTimelineModel(response, state); // validate before replacing a successful forecast
                    state.forecast = response; render(); void connectLive(ticket);
                },
                onStatus(status) {
                    forecastStatus = status;
                    if (status === 'forbidden' || status === 'unauthorized') {
                        connectionCleanup?.(); liveMonitor?.stop(); liveMonitor = undefined; session?.abort(); clearInterval(clockTimer);
                        state.forecast = null; state.model = null; state.observedTasks.clear();
                        q('[data-body]').hidden = true; q('[data-summary]').hidden = true;
                        setText('[data-generated]', 'Forecast unavailable');
                    }
                    message();
                }
            });
            await forecastMonitor.start();
            if (ticket !== lifetime || ['forbidden', 'unauthorized'].includes(forecastStatus)) return;
            clockTimer = setInterval(tick, 1000);
        } catch { if (ticket === lifetime) { forecastStatus = 'stale'; message(); } }
    }
    root.addEventListener('click', event => {
        const control = event.target.closest('button[data-action]');
        if (!control || !root.contains(control)) return;
        const action = control.dataset.action, id = control.dataset.id;
        if (action === 'refresh') {
            if (!forecastMonitor || forecastStatus === 'stale' && !state.forecast) void start(); else void forecastMonitor.refresh();
            return;
        }
        if (!state.model) return;
        if (action === 'select') state.selectedTaskId = id;
        else if (action === 'view') state.view = id;
        else if (action === 'group') state.groupBy = id;
        else if (action === 'collapse') { if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id); }
        render();
        if (action === 'select' && matchMedia('(max-width: 720px)').matches) q('[data-detail]').scrollIntoView({ block: 'start' });
    }, { signal: events.signal });
    view.addEventListener('viewshow', () => { shown = true; void start(); }, { signal: events.signal });
    view.addEventListener('viewhide', () => { shown = false; stop(); }, { signal: events.signal });
    view.addEventListener('viewdestroy', () => { destroyed = true; shown = false; stop(); events.abort(); }, { signal: events.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (shown) void start(); }, { signal: events.signal });
}
