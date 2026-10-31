// Test servers only. Screenshots using intercepted data are explicitly named synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

function trackSubscriptions() {
    const api = window.ApiClient, subscribe = api.subscribe.bind(api);
    window.timelineSubscriptions = 0;
    api.subscribe = (types, callback) => {
        const tracked = types.includes('ScheduledTasksInfo');
        if (tracked) { window.timelineSubscriptions++; window.timelineReceiver = callback; }
        const stop = subscribe(types, callback);
        return () => { if (tracked) window.timelineSubscriptions--; stop(); };
    };
}

async function checkContrast(page, root) {
    await page.keyboard.press('Tab');
    await root.locator('[data-refresh]').focus();
    const ratios = await root.evaluate(element => {
        const background = getComputedStyle(document.querySelector('.backgroundContainer')).backgroundColor;
        const canvas = document.createElement('canvas').getContext('2d');
        function pixel(color) {
            canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = background; canvas.fillRect(0, 0, 1, 1);
            canvas.fillStyle = color; canvas.fillRect(0, 0, 1, 1);
            return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3);
        }
        function luminance(rgb) {
            return rgb.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
                .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        }
        function ratio(color) {
            const a = luminance(pixel(color)), b = luminance(pixel(background));
            return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        }
        const focused = element.querySelector('[data-refresh]');
        return { text: ratio(getComputedStyle(element.querySelector('.tt-intro p')).color), focus: ratio(getComputedStyle(focused).outlineColor), visible: focused.matches(':focus-visible') };
    });
    assert.ok(ratios.visible);
    assert.ok(ratios.text >= 4.5, `Muted text contrast: ${ratios.text}`);
    assert.ok(ratios.focus >= 3, `Keyboard focus contrast: ${ratios.focus}`);
}

(async () => {
    const base = process.env.JELLYTEST_URL || 'http://127.0.0.1:8096';
    const browser = await chromium.launch({ headless: true });
    const output = path.resolve(process.env.JELLYTEST_UI_OUTPUT || 'artifacts/ui');
    await fs.mkdir(output, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    const writes = [];
    page.on('request', request => {
        if (/\/TaskTimeline\//i.test(request.url()) && request.method() !== 'GET') writes.push(request.method());
    });
    try {
        await page.goto(`${base}/web/`);
        await page.locator('#txtManualName').fill(process.env.JELLYTEST_USERNAME);
        await page.locator('#txtManualPassword').fill(process.env.JELLYTEST_PASSWORD);
        await page.getByRole('button', { name: 'Sign In', exact: true }).click();
        await page.locator('#txtManualName').waitFor({ state: 'hidden' });
        await page.waitForFunction(() => typeof window.ApiClient?.subscribe === 'function');
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        if (errors.length) console.log(`Host errors before opening the timeline: ${errors.length}`);
        errors.length = 0;
        await page.evaluate(trackSubscriptions);
        const info = await page.evaluate(async () => (await fetch('/System/Info/Public')).json());
        await page.evaluate(() => { location.hash = '/configurationpage?name=taskTimeline'; });
        await page.waitForFunction(() => document.querySelector('[data-timeline]')?.dataset.forecastStatus === 'ready', { timeout: 20000 });
        const root = page.locator('[data-timeline]');
        await checkContrast(page, root);
        const leaveHash = (await page.getByRole('link', { name: 'General', exact: true }).getAttribute('href')).split('#')[1];
        await page.waitForFunction(() => ['awaiting-live', 'live'].includes(document.querySelector('[data-timeline]').dataset.liveStatus));
        assert.equal(await page.evaluate(() => window.timelineSubscriptions), 1);
        assert.equal(await root.locator('#tt-title').innerText(), 'Upcoming Scheduled Tasks');
        assert.ok(await root.locator('[data-notice]').isHidden());
        assert.doesNotMatch(await root.locator('[data-generated]').innerText(), /Etc\/UTC/);
        assert.equal(await root.getByText('Read-only · next 168 hours', { exact: true }).count(), 0);
        const tabs = root.locator('[data-off-tabs] [role=tab]');
        if (await tabs.count()) {
            const reason = await tabs.first().getAttribute('data-id');
            await tabs.first().click();
            const firstSource = root.locator('[data-off-calendar] .tt-off-item').first();
            if (await firstSource.count()) {
                await firstSource.click();
                const inspector = await root.locator('.tt-inspector').boundingBox();
                assert.ok(inspector.y >= 44 && inspector.y < 1100, 'Inspector must remain visible when an undated source is selected');
            }
            const sectionBounds = await root.locator('[data-off-section]').boundingBox();
            assert.ok(sectionBounds.height <= 701);
            await root.getByRole('button', { name: 'Collapse not on the calendar', exact: true }).click();
            assert.ok(await root.locator('[data-off-contents]').isHidden());
            await root.getByRole('button', { name: 'Expand not on the calendar', exact: true }).click();
            assert.ok(await root.locator('[data-off-contents]').isVisible());
            assert.equal(await root.locator('[role=tab][aria-selected=true]').getAttribute('data-id'), reason);
        }
        const native = await page.evaluate(() => window.ApiClient.getScheduledTasks());
        assert.equal(await root.locator('.tt-task-row').count(), native.length);
        await root.getByRole('button', { name: 'Agenda', exact: true }).click();
        await root.locator('[data-agenda-shell]').waitFor({ state: 'visible' });
        const agenda = root.locator('.tt-agenda-item').first();
        if (await agenda.count()) await agenda.click();
        const selected = await root.locator('[data-detail] h2').innerText();
        await root.getByRole('button', { name: 'Refresh timeline', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-timeline]').dataset.forecastStatus === 'ready');
        assert.equal(await root.locator('[data-detail] h2').innerText(), selected);
        await root.getByRole('button', { name: 'Week', exact: true }).click();
        await root.getByRole('button', { name: 'Start time', exact: true }).click();
        assert.equal(await root.locator('.tt-category').count(), 0);
        await root.getByRole('button', { name: 'Category', exact: true }).click();
        const group = root.locator('.tt-category').first();
        await group.click(); assert.equal(await group.getAttribute('aria-expanded'), 'false'); await group.click();
        const undated = root.locator('.tt-undated-label').first();
        if (await undated.count()) {
            const panel = root.locator('[data-week]');
            const position = () => undated.evaluate(label => {
                const text = label.getBoundingClientRect(), band = label.parentElement.getBoundingClientRect();
                const scroll = document.querySelector('[data-week]').getBoundingClientRect();
                return { left: text.left - scroll.left, center: text.top + text.height / 2 - band.top - band.height / 2,
                    width: band.width, trackWidth: label.parentElement.parentElement.getBoundingClientRect().width };
            });
            await panel.evaluate(el => { el.scrollLeft = 0; });
            const before = await position();
            await panel.evaluate(el => { el.scrollLeft = el.scrollWidth; });
            assert.ok(await panel.evaluate(el => el.scrollLeft > 0));
            const after = await position();
            assert.ok(Math.abs(after.left - before.left) < 1, 'Undated text must stay beside the sticky task column');
            assert.ok(Math.abs(after.center) < 1, 'Undated text must be vertically centered');
            assert.equal(after.width, after.trackWidth);
            await panel.evaluate(el => { el.scrollLeft = 0; });
        }
        for (const width of [820, 430]) {
            await page.setViewportSize({ width, height: 1180 });
            assert.equal(await root.locator('[data-action="open-details"]').count(), 0);
            const primary = await root.locator('.tt-summary-card').first().boundingBox();
            const running = await root.locator('.tt-running-card').boundingBox();
            assert.equal(primary.width, running.width);
            if (width === 820) assert.equal(primary.y, running.y);
            else {
                assert.ok(running.y >= primary.y + primary.height);
                const select = root.getByRole('combobox', { name: 'Group by', exact: true });
                await select.selectOption('time');
                assert.equal(await root.locator('.tt-category').count(), 0);
                await root.getByRole('button', { name: 'Refresh timeline', exact: true }).click();
                await page.waitForFunction(() => document.querySelector('[data-timeline]').dataset.forecastStatus === 'ready');
                assert.equal(await select.inputValue(), 'time');
                await select.selectOption('category');
            }
            const task = root.locator('.tt-task-name').first();
            await task.click();
            await root.locator('[data-detail-drawer][open]').waitFor();
            await root.getByRole('button', { name: 'Close task details', exact: true }).click();
            assert.ok(await task.evaluate(el => document.activeElement === el));
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        }
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `real-${info.Version}-desktop-dark.png`), fullPage: true });
        console.log(`PASS: Jellyfin ${info.Version} normal page, authenticated modules, real tasks, view/group controls and retained selection`);

        if (process.env.JELLYTEST_DIAGNOSTICS === '1') {
            const task = native.find(t => t.Key === 'TaskTimeline.Diagnostics.Progress');
            assert.ok(task, 'Diagnostic task must be installed for the requested live check');
            await page.evaluate(id => window.ApiClient.startScheduledTask(id), task.Id);
            await page.waitForFunction(() => [...document.querySelectorAll('[data-running] progress')].some(p => p.value >= 25 && p.hasAttribute('value')));
            await root.getByRole('button', { name: 'Refresh timeline', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('[data-timeline]').dataset.forecastStatus === 'ready');
            assert.ok(await root.locator('[data-running] progress').count());
            await page.waitForFunction(() => !document.querySelector('[data-running] progress'), { timeout: 25000 });
            const unknown = native.find(t => t.Key === 'TaskTimeline.Diagnostics.Indeterminate');
            await page.evaluate(id => window.ApiClient.startScheduledTask(id), unknown.Id);
            await root.locator('[data-running] progress:not([value])').waitFor();
            await page.waitForFunction(() => !document.querySelector('[data-running] progress'), { timeout: 25000 });
            console.log('PASS: actual task-reported progress and indeterminate execution reach the normal timeline');
        }
        await page.evaluate(hash => { location.hash = hash; }, leaveHash);
        await page.waitForFunction(() => window.timelineSubscriptions === 0);
        await page.evaluate(() => { location.hash = '/configurationpage?name=taskTimeline'; });
        await page.waitForFunction(() => document.querySelector('[data-timeline]')?.dataset.forecastStatus === 'ready' && window.timelineSubscriptions === 1);

        // Keep synthetic scenarios separate from the preceding real-server assertions.
        const { forecastFixture } = await import(pathToFileURL(path.resolve(__dirname, '../web/fixtures/forecast.mjs')).href);
        const fixture = forecastFixture();
        fixture.tasks[0].name = 'Synthetic <img src=x onerror=alert(1)> task with a long name';
        let mode = 'fixture';
        await page.route('**/TaskTimeline/Forecast', route => ['failure', 'forbidden'].includes(mode) ? route.fulfill({ status: mode === 'forbidden' ? 403 : 503, body: '{}' }) : route.fulfill({ json: mode === 'empty' ? { ...fixture, tasks: [], triggers: [], occurrences: [], overlaps: [] } : fixture }));
        await root.getByRole('button', { name: 'Refresh timeline', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-detail]')?.textContent.includes('Synthetic'));
        assert.equal(await root.locator('img').count(), 0);
        assert.equal(await root.locator('[data-overlap-count]').innerText(), '1');
        assert.equal(await root.locator('[data-off-count]').innerText(), '2');
        assert.equal(await root.locator('.tt-overlap').count(), 2);
        await page.waitForFunction(() => ['awaiting-live', 'live'].includes(document.querySelector('[data-timeline]').dataset.liveStatus));
        await root.locator('[data-notice]').evaluate(el => { window.timelineStatusMutations = 0; window.timelineStatusObserver = new MutationObserver(() => window.timelineStatusMutations++); window.timelineStatusObserver.observe(el, { childList: true, subtree: true, characterData: true }); });
        await page.evaluate(() => window.timelineReceiver({ Data: [{ Id: 'a', State: 'Running', CurrentProgressPercentage: 0 }, { Id: 'b', State: 'Running', CurrentProgressPercentage: null }] }));
        await page.waitForFunction(() => document.querySelectorAll('[data-running] progress').length === 2);
        assert.equal(await root.locator('[data-running] progress').count(), 2);
        assert.equal(await root.locator('[data-running] progress[value="0"]').count(), 1);
        assert.equal(await root.locator('[data-running] progress:not([value])').count(), 1);
        const announcements = await page.evaluate(() => window.timelineStatusMutations);
        await page.evaluate(() => window.timelineReceiver({ Data: [{ Id: 'a', State: 'Running', CurrentProgressPercentage: 25 }, { Id: 'b', State: 'Running', CurrentProgressPercentage: null }] }));
        assert.equal(await page.evaluate(() => window.timelineStatusMutations), announcements, 'Progress ticks must not repeatedly mutate the live status region');
        await page.evaluate(() => window.timelineStatusObserver.disconnect());
        await root.locator('.tt-mark').first().focus();
        await page.keyboard.press('Enter');
        assert.match(await root.locator('[data-detail]').innerText(), /Same start/);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `synthetic-${info.Version}-desktop.png`), fullPage: true });
        mode = 'failure';
        await root.getByRole('button', { name: 'Refresh timeline', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-timeline]').dataset.forecastStatus === 'stale');
        assert.equal(await root.locator('[data-overlap-count]').innerText(), '1');
        assert.ok(await root.locator('.tt-mark').count());
        mode = 'fixture';
        await root.getByRole('button', { name: 'Refresh timeline', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-timeline]').dataset.forecastStatus === 'ready');
        await page.setViewportSize({ width: 390, height: 844 });
        await root.getByRole('button', { name: 'Agenda', exact: true }).click();
        assert.ok(await root.locator('[data-agenda-shell]').isVisible());
        await root.locator('.tt-agenda-item').first().click();
        await root.locator('[data-detail-drawer][open]').waitFor();
        assert.ok(await root.locator('.tt-inspector').isHidden());
        await page.keyboard.press('Escape');
        assert.ok(await root.locator('[data-detail-drawer]').isHidden());
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, `synthetic-${info.Version}-mobile.png`), fullPage: true });
        await context.setOffline(true);
        await page.waitForFunction(() => document.querySelector('[data-timeline]').dataset.liveStatus === 'disconnected');
        await context.setOffline(false);
        await page.waitForFunction(() => ['awaiting-live', 'live'].includes(document.querySelector('[data-timeline]').dataset.liveStatus), { timeout: 20000 });
        if (base.includes(':8097')) {
            await page.setViewportSize({ width: 1440, height: 1100 });
            await page.evaluate(async () => {
                const link = [...document.querySelectorAll('link[rel=stylesheet]')].find(l => /themes\/dark\/theme.css/.test(l.href));
                if (!link) throw new Error('Native dark theme link not found');
                await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; link.href = link.href.replace('/dark/', '/light/'); });
            });
            await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
            const colors = await root.evaluate(el => ({ header: getComputedStyle(el.querySelector('.tt-week-header')).backgroundColor, background: getComputedStyle(document.querySelector('.backgroundContainer')).backgroundColor }));
            assert.equal(colors.header, colors.background);
            assert.ok(Number(colors.background.match(/\d+/)[0]) > 200, `Expected a light host background: ${colors.background}`);
            await checkContrast(page, root);
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: path.join(output, `synthetic-${info.Version}-native-light.png`), fullPage: true });
            console.log('PASS: native light-theme stylesheet, matching sticky surfaces, and subscription cleanup across navigation');
        }
        mode = 'empty';
        await root.getByRole('button', { name: 'Refresh timeline', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-timeline]').dataset.forecastStatus === 'ready' && document.querySelector('[data-detail]').textContent.includes('Select a task'));
        assert.equal(await root.locator('.tt-mark').count(), 0);
        assert.equal(await root.locator('[data-next-time]').innerText(), 'No dated starts');
        mode = 'failure';
        await page.reload();
        await page.waitForFunction(() => document.querySelector('[data-timeline]')?.dataset.forecastStatus === 'stale');
        assert.ok(await root.locator('[data-body]').isHidden());
        // Reload clears the earlier instrumentation; no live monitor starts until Retry succeeds.
        await page.evaluate(trackSubscriptions);
        mode = 'fixture'; await root.getByRole('button', { name: 'Retry', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-timeline]').dataset.forecastStatus === 'ready');
        // Change host capabilities only after the preceding page has released its
        // subscription; otherwise this fixture races its in-flight snapshot setup.
        await page.evaluate(hash => { location.hash = hash; }, leaveHash);
        await root.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => window.timelineSubscriptions === 0);
        await page.evaluate(() => { window.savedTimelineStatus = window.ApiClient._sdk.webSocket.onStatusChange; window.ApiClient._sdk.webSocket.onStatusChange = undefined; });
        await page.evaluate(() => { location.hash = '/configurationpage?name=taskTimeline'; });
        await page.waitForFunction(() => document.querySelector('[data-timeline]')?.dataset.liveStatus === 'unavailable' && document.querySelector('[data-timeline]').dataset.forecastStatus === 'ready');
        assert.ok(await root.locator('[data-body]').isVisible());
        mode = 'forbidden'; await root.getByRole('button', { name: 'Refresh timeline', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-timeline]').dataset.forecastStatus === 'forbidden');
        assert.ok(await root.locator('[data-body]').isHidden());
        assert.ok(await root.getByRole('button', { name: 'Refresh timeline', exact: true }).isDisabled());
        await page.evaluate(() => { window.ApiClient._sdk.webSocket.onStatusChange = window.savedTimelineStatus; });
        console.log('PASS: empty forecast, first-load retry, unavailable live capability and forbidden access without cached data');
        assert.deepEqual(writes, []);
        assert.deepEqual(errors, []);
        console.log('PASS: synthetic overlap/unknown-duration/security fixtures, stale retention, keyboard selection, mobile width and reconnect');
    } catch (error) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
        const state = await page.locator('[data-timeline]').getAttribute('data-forecast-status').catch(() => 'not-mounted');
        console.error('UI state:', state, 'page errors:', errors.map(x => x.replace(/(api_key|token)=[^&\s]+/gi, '$1=[redacted]')));
        throw error;
    } finally {
        await page.evaluate(() => window.ApiClient?.logout?.()).catch(() => {});
        await browser.close();
    }
})().catch(error => {
    console.error(String(error.stack || error).replace(/(api_key|token)=[^&\s]+/gi, '$1=[redacted]'));
    process.exitCode = 1;
});
