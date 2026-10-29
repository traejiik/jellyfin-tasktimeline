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
        view: matchMedia('(max-width: 720px)').matches ? 'agenda' : 'week', collapsed: new Set(), observedTasks: new Map(),
        offReason: 'timingUnknown', offCollapsed: false, offScroll: new Map() };
    let modules, modulePromise, forecastMonitor, liveMonitor, connectionCleanup, themeObserver, session, shown = false, destroyed = false, lifetime = 0, clockTimer;
    let forecastStatus = 'loading', liveStatus = 'stopped';
    const events = new AbortController();
    const compact = matchMedia('(max-width: 1100px)');
    const drawer = q('[data-detail-drawer]');
    let drawerOpenerKey;

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
        const hasForecast = Boolean(state.forecast);
        const activity = modules ? modules.model.forecastActivity(forecastStatus, hasForecast)
            : forecastStatus === 'loading' ? (hasForecast ? 'Refreshing…' : 'Loading…') : 'Forecast unavailable';
        setText('[data-generated]', activity || `Updated ${date(state.forecast.generatedAt)}${forecastStatus === 'stale' ? ' · stale' : ''}`);
        q('[data-generated]').title = state.forecast ? `Times follow the server timezone: ${state.forecast.serverTimeZone}` : '';
        const notice = modules ? modules.model.timelineNotice(forecastStatus, liveStatus, hasForecast)
            : forecastStatus === 'stale' ? 'Could not load the forecast. Use Retry to try again.' : null;
        setText('[data-notice]', notice || '');
        q('[data-notice]').hidden = !notice;
        root.dataset.forecastStatus = forecastStatus; root.dataset.liveStatus = liveStatus;
        q('[data-refresh]').textContent = !state.forecast && forecastStatus === 'stale' ? 'Retry' : 'Refresh forecast';
        q('[data-refresh]').disabled = forecastStatus === 'loading' || ['forbidden', 'unauthorized'].includes(forecastStatus);
    }
    function executionLabel(value) { return modules.model.taskStateLabel(value); }
    function updateStateElement(element, task) {
        const label = executionLabel(task.state);
        if (element.textContent !== label) element.textContent = label;
        element.title = task.state === 'Idle' ? 'Jellyfin reports Idle: this task is not currently running. This does not mean its schedule is disabled.' : `Current execution state: ${label}`;
        element.setAttribute('aria-label', `Current execution state: ${label}`);
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
            if (task) updateStateElement(element, task);
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
                const observed = node('span', 'tt-observed'); observed.dataset.observedTask = task.taskId; updateStateElement(observed, task); name.append(observed);
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
                    const band = node('div', 'tt-undated-band'); band.append(label); track.append(band);
                }
                row.append(name, track); host.append(row);
            }
        }
    }
    function renderAgenda() {
        const host = q('[data-agenda-content]'); host.replaceChildren();
        for (const day of state.model.axis.days) {
            const section = node('section', 'tt-agenda-day');
            const heading = node('h3', '', date(day.start, { weekday: 'long', month: undefined, day: undefined, hour: undefined, minute: undefined }) + ' ');
            heading.append(node('span', 'tt-agenda-date', date(day.start, { hour: undefined, minute: undefined })));
            section.append(heading);
            const entries = node('div', 'tt-agenda-entries');
            const occurrences = state.model.occurrences.filter(o => o.start >= day.start && o.start < day.end).sort((a, b) => a.start - b.start);
            if (!occurrences.length) entries.append(node('p', 'tt-muted', 'No dated starts in this part of the range.'));
            for (const occurrence of occurrences) {
                const item = button('', 'select', occurrence.taskId, 'tt-agenda-item');
                item.setAttribute('aria-pressed', String(occurrence.taskId === state.selectedTaskId));
                const words = node('span', 'tt-agenda-words');
                words.append(node('strong', '', occurrence.task.name), node('span', 'tt-mono tt-muted', occurrence.estimatedEnd ? `estimated end ${date(occurrence.estimatedEnd)} · last ${duration(occurrence.lastRecordedDurationMs)}` : 'Duration unknown; projected start only'));
                const labels = node('span', 'tt-tags'); labels.append(tag(occurrence.task.category));
                if (occurrence.overlaps.length) labels.append(tag('Overlap', 'tt-warn'));
                item.append(node('time', 'tt-mono', date(occurrence.start, { month: undefined, day: undefined })), words, labels); entries.append(item);
            }
            section.append(entries); host.append(section);
        }
    }
    function saveOffScroll() {
        const host = q('[data-off-calendar]');
        if (!state.offCollapsed && host.dataset.reason) state.offScroll.set(host.dataset.reason, host.scrollTop);
    }
    function applyOffCollapse() {
        q('[data-off-contents]').hidden = state.offCollapsed;
        const control = q('[data-action="off-toggle"]');
        control.setAttribute('aria-expanded', String(!state.offCollapsed));
        const label = `${state.offCollapsed ? 'Expand' : 'Collapse'} not on the calendar`;
        control.setAttribute('aria-label', label); control.title = label;
        if (!state.offCollapsed) q('[data-off-calendar]').scrollTop = state.offScroll.get(state.offReason) || 0;
    }
    function renderOffCalendar() {
        saveOffScroll();
        const model = state.model, groups = model.offCalendarGroups;
        if (!groups.some(group => group.id === state.offReason)) state.offReason = groups[0]?.id ?? null;
        const selected = groups.find(group => group.id === state.offReason);
        const tabs = q('[data-off-tabs]'), host = q('[data-off-calendar]');
        tabs.replaceChildren(); host.replaceChildren(); host.dataset.reason = state.offReason || '';
        for (const group of groups) {
            const tab = button('', 'off-reason', group.id, 'tt-off-tab');
            tab.id = `tt-off-tab-${group.id}`; tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(group.id === state.offReason));
            tab.setAttribute('aria-controls', 'tt-off-list'); tab.tabIndex = group.id === state.offReason ? 0 : -1;
            tab.append(node('span', '', group.label), node('span', 'tt-mono tt-tab-count', group.items.length)); tabs.append(tab);
        }
        tabs.hidden = groups.length === 0;
        setText('[data-off-explanation]', selected?.description || 'No undated sources or tasks without configured triggers in this forecast.');
        if (selected) {
            host.setAttribute('aria-labelledby', `tt-off-tab-${selected.id}`);
            for (const [index, source] of selected.items.entries()) {
                const item = button('', 'select', source.taskId, 'tt-off-item');
                item.dataset.focusKey = `off:${selected.id}:${source.taskId}:${source.summary}:${index}`;
                item.setAttribute('aria-pressed', String(source.taskId === state.selectedTaskId));
                const words = node('span', '');
                words.append(node('strong', '', source.task.name), node('span', 'tt-muted', source.summary));
                item.append(words, tag(source.task.category)); host.append(item);
            }
        } else {
            host.removeAttribute('aria-labelledby'); host.setAttribute('aria-label', 'No undated sources');
        }
        applyOffCollapse();
    }
    function renderDetail() {
        renderTaskDetail(q('[data-detail]'));
        renderTaskDetail(q('[data-detail-drawer-content]'));
    }
    function renderTaskDetail(host) {
        host.replaceChildren();
        const task = state.model.tasks.find(t => t.taskId === state.selectedTaskId);
        if (!task) { host.append(node('h2', '', 'Task details'), node('p', 'tt-muted', 'Select a task when scheduled task data is available.')); return; }
        const badges = node('div', 'tt-tags'); badges.append(tag(task.category));
        const status = tag(''); status.dataset.observedTask = task.taskId; updateStateElement(status, task); badges.append(status);
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
                const technical = node('details', 'tt-technical'), content = node('div', 'tt-technical-content');
                for (const [label, value] of [['Projection status', source.projectionStatus], ['Reason code', source.reasonCode]]) {
                    const field = node('div', ''); field.append(node('span', '', label), node('code', '', value)); content.append(field);
                }
                technical.append(node('summary', '', 'Technical details'), content); entry.append(technical);
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
        message(); syncTheme();
        q('[data-zone-warning]').hidden = !model.axis.warning; setText('[data-zone-warning]', model.axis.warning || '');
        setText('[data-overlap-count]', model.overlapPairCount);
        setText('[data-overlap-note]', `${model.pairs.filter(p => p.kind === 'sameStart').length} same-start · ${model.pairs.filter(p => p.kind !== 'sameStart').length} duration pairs`);
        setText('[data-off-count]', model.offCalendarSourceCount);
        renderWeek(); renderAgenda(); renderOffCalendar(); renderDetail(); renderRunning(); tick();
        q('[data-week-shell]').hidden = state.view !== 'week'; q('[data-agenda-shell]').hidden = state.view !== 'agenda'; q('[data-group-controls]').hidden = state.view !== 'week';
        root.querySelectorAll('[data-action="view"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === state.view)));
        root.querySelectorAll('[data-action="group"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === state.groupBy)));
        q('[data-group-select]').value = state.groupBy;
        for (const [element, top, left] of scrolls) { element.scrollTop = top; element.scrollLeft = left; }
        if (active) [...(drawer.open ? drawer : root).querySelectorAll('[data-focus-key]')].find(b => b.dataset.focusKey === active && b.getClientRects().length)?.focus({ preventScroll: true });
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
        const candidates = [document.querySelector('.backgroundContainer'), document.body, document.documentElement].filter(Boolean);
        const paint = candidates.map(element => getComputedStyle(element));
        const native = paint.find(style => style.backgroundImage !== 'none' || !['rgba(0, 0, 0, 0)', 'transparent'].includes(style.backgroundColor)) || paint[0];
        const solid = paint.find(style => !['rgba(0, 0, 0, 0)', 'transparent'].includes(style.backgroundColor));
        const values = {
            '--tt-header-bg': solid?.backgroundColor || native.getPropertyValue('--jf-palette-background-default').trim() || 'transparent',
            '--tt-header-image': native.backgroundImage,
            '--tt-header-size': native.backgroundSize,
            '--tt-header-position': native.backgroundPosition,
            '--tt-header-repeat': native.backgroundRepeat
        };
        for (const [property, value] of Object.entries(values)) if (root.style.getPropertyValue(property) !== value) root.style.setProperty(property, value);
    }
    async function start() {
        stop();
        if (!shown || document.hidden || destroyed) return;
        state.observedTasks.clear();
        const ticket = lifetime; session = new AbortController();
        syncTheme();
        themeObserver = new MutationObserver(syncTheme);
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
        themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
        const background = document.querySelector('.backgroundContainer');
        if (background) themeObserver.observe(background, { attributes: true, attributeFilter: ['class', 'style'] });
        themeObserver.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'media', 'disabled'] });
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
                        if (drawer.open) drawer.close(); q('[data-detail]').replaceChildren(); q('[data-detail-drawer-content]').replaceChildren();
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
    function updateSelection() {
        for (const control of root.querySelectorAll('[data-action="select"]')) {
            const selected = control.dataset.id === state.selectedTaskId;
            control.setAttribute('aria-pressed', String(selected));
            if (control.classList.contains('tt-task-name')) control.closest('.tt-task-row').classList.toggle('tt-selected', selected);
        }
    }
    function openDetails(opener) {
        if (!compact.matches || drawer.open) return;
        drawerOpenerKey = opener.dataset.focusKey;
        drawer.showModal();
    }
    drawer.addEventListener('close', () => {
        const opener = [...root.querySelectorAll('[data-focus-key]')].find(control => control.dataset.focusKey === drawerOpenerKey && !drawer.contains(control) && control.getClientRects().length);
        (opener || q('[data-action="view"][data-id="week"]'))?.focus({ preventScroll: true });
    }, { signal: events.signal });
    compact.addEventListener('change', event => { if (!event.matches && drawer.open) drawer.close(); }, { signal: events.signal });
    root.addEventListener('click', event => {
        const control = event.target.closest('button[data-action]');
        if (!control || !root.contains(control)) return;
        const action = control.dataset.action, id = control.dataset.id;
        if (action === 'close-details') { drawer.close(); return; }
        if (action === 'refresh') {
            if (!forecastMonitor || forecastStatus === 'stale' && !state.forecast) void start(); else void forecastMonitor.refresh();
            return;
        }
        if (!state.model) return;
        if (action === 'off-toggle') { saveOffScroll(); state.offCollapsed = !state.offCollapsed; applyOffCollapse(); return; }
        if (action === 'off-reason') { state.offReason = id; renderOffCalendar(); q(`[data-off-tabs] [data-id="${id}"]`)?.focus({ preventScroll: true }); return; }
        if (action === 'select') {
            state.selectedTaskId = id; renderDetail(); updateSelection(); openDetails(control); return;
        }
        if (action === 'view') state.view = id;
        else if (action === 'group') state.groupBy = id;
        else if (action === 'collapse') { if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id); }
        render();
    }, { signal: events.signal });
    q('[data-group-select]').addEventListener('change', event => {
        if (!state.model || !['category', 'time'].includes(event.target.value)) return;
        state.groupBy = event.target.value; render();
    }, { signal: events.signal });
    q('[data-off-tabs]').addEventListener('keydown', event => {
        if (!event.target.closest('[role="tab"]') || !state.model) return;
        const groups = state.model.offCalendarGroups;
        let index = groups.findIndex(group => group.id === state.offReason);
        if (event.key === 'ArrowRight') index = (index + 1) % groups.length;
        else if (event.key === 'ArrowLeft') index = (index - 1 + groups.length) % groups.length;
        else if (event.key === 'Home') index = 0;
        else if (event.key === 'End') index = groups.length - 1;
        else return;
        event.preventDefault(); state.offReason = groups[index].id; renderOffCalendar();
        [...q('[data-off-tabs]').querySelectorAll('[role="tab"]')].find(tab => tab.dataset.id === state.offReason)?.focus();
    }, { signal: events.signal });
    view.addEventListener('viewshow', () => { shown = true; void start(); }, { signal: events.signal });
    view.addEventListener('viewhide', () => { shown = false; if (drawer.open) drawer.close(); stop(); }, { signal: events.signal });
    view.addEventListener('viewdestroy', () => { destroyed = true; shown = false; if (drawer.open) drawer.close(); stop(); events.abort(); }, { signal: events.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (shown) void start(); }, { signal: events.signal });
}
