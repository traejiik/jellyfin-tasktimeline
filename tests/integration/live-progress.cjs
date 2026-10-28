// Run only against a disposable/test server with the diagnostic build installed.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
    const base = process.env.JELLYTEST_URL || 'http://127.0.0.1:8096';
    const username = process.env.JELLYTEST_USERNAME;
    const password = process.env.JELLYTEST_PASSWORD;
    assert.ok(username && password, 'Supply JELLYTEST_USERNAME and JELLYTEST_PASSWORD');
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        const states = [];
        let sockets = 0;
        page.on('websocket', socket => {
            sockets++;
            socket.on('framereceived', ({ payload }) => {
                try {
                    const message = JSON.parse(String(payload));
                    if (message.MessageType !== 'ScheduledTasksInfo') return;
                    for (const task of message.Data || []) {
                        if (task.Key?.startsWith('TaskTimeline.Diagnostics.')) {
                            states.push({ key: task.Key, state: task.State, progress: task.CurrentProgressPercentage ?? null });
                        }
                    }
                } catch { /* Non-task frames are irrelevant to this test. */ }
            });
        });
        await page.goto(`${base}/web/`);
        await page.locator('#txtManualName').fill(username);
        await page.locator('#txtManualPassword').fill(password);
        await page.getByRole('button', { name: 'Sign In', exact: true }).click();
        await page.locator('#txtManualName').waitFor({ state: 'hidden' });
        await page.waitForFunction(() => typeof window.ApiClient?.subscribe === 'function');
        await page.evaluate(() => {
            const api = window.ApiClient;
            const subscribe = api.subscribe.bind(api);
            window.diagnosticSubscriptions = { active: 0, opened: 0, closed: 0 };
            api.subscribe = (types, callback) => {
                const tracked = types.includes('ScheduledTasksInfo');
                if (tracked) {
                    window.diagnosticSubscriptions.active++;
                    window.diagnosticSubscriptions.opened++;
                }
                const stop = subscribe(types, callback);
                return () => {
                    if (tracked) {
                        window.diagnosticSubscriptions.active--;
                        window.diagnosticSubscriptions.closed++;
                    }
                    stop();
                };
            };
        });
        const navigate = hash => page.evaluate(value => { location.hash = value; }, hash);
        const open = async () => {
            await navigate('/configurationpage?name=taskTimelineDiagnostics');
            await page.locator('[data-diagnostics]').waitFor({ state: 'visible', timeout: 10000 });
            await page.waitForFunction(() => ['awaiting-live', 'live'].includes(document.querySelector('[data-diagnostics]')?.dataset.status) && window.ApiClient._sdk.webSocket.socketStatus === 1);
            assert.equal(await page.evaluate(() => window.diagnosticSubscriptions.active), 1);
        };
        await open();
        console.log('PASS: authenticated plugin page subscribes through the native client');
        await page.locator('[data-run-task="TaskTimeline.Diagnostics.Progress"]').click();
        const progressTask = page.locator('[data-task-key="TaskTimeline.Diagnostics.Progress"]');
        await progressTask.locator('progress[value]').waitFor();
        await page.waitForFunction(() => {
            const p = document.querySelector('[data-task-key="TaskTimeline.Diagnostics.Progress"] progress');
            return p && p.value >= 25 && p.value < 100;
        });
        console.log('PASS: running task reports determinate progress without refresh');
        if (process.env.JELLYTEST_SCREENSHOT) await page.screenshot({ path: process.env.JELLYTEST_SCREENSHOT, fullPage: true });
        await page.waitForFunction(() => document.querySelector('[data-task-key="TaskTimeline.Diagnostics.Progress"]')?.dataset.state === 'Idle', null, { timeout: 30000 });
        assert.ok(states.some(s => s.key.endsWith('.Progress') && s.state === 'Running' && s.progress > 0));
        assert.ok(states.some(s => s.key.endsWith('.Progress') && s.state === 'Idle'));
        console.log('PASS: completion reaches the page through native updates');
        await page.locator('[data-run-task="TaskTimeline.Diagnostics.Indeterminate"]').click();
        await page.locator('[data-task-key="TaskTimeline.Diagnostics.Indeterminate"] progress:not([value])').waitFor();
        console.log('PASS: missing percentage remains indeterminate');
        await context.setOffline(true);
        await page.waitForFunction(() => document.querySelector('[data-diagnostics]')?.dataset.status === 'disconnected');
        await context.setOffline(false);
        await page.waitForFunction(() => ['awaiting-live', 'live'].includes(document.querySelector('[data-diagnostics]')?.dataset.status) && window.ApiClient._sdk.webSocket.socketStatus === 1, null, { timeout: 30000 });
        console.log('PASS: disconnect is visible and native connection recovers');
        await page.waitForFunction(() => document.querySelector('[data-task-key="TaskTimeline.Diagnostics.Indeterminate"]')?.dataset.state === 'Idle', null, { timeout: 30000 });
        const snapshotCount = await page.locator('[data-diagnostics]').getAttribute('data-snapshots');
        await page.evaluate(() => window.ApiClient._sdk.webSocket.socket.close());
        await page.waitForFunction(() => document.querySelector('[data-diagnostics]')?.dataset.status === 'disconnected');
        await page.waitForFunction(previous =>
            ['awaiting-live', 'live'].includes(document.querySelector('[data-diagnostics]')?.dataset.status) &&
            Number(document.querySelector('[data-diagnostics]').dataset.snapshots) > Number(previous) &&
            window.ApiClient._sdk.webSocket.socketStatus === 1, snapshotCount);
        console.log('PASS: socket-only disconnect recovers with a fresh snapshot');
        const socketsBeforeNavigation = sockets;
        for (let i = 0; i < 3; i++) {
            await navigate('/dashboard');
            await page.waitForFunction(() => window.diagnosticSubscriptions.active === 0);
            await open();
        }
        assert.equal(sockets, socketsBeforeNavigation, 'Page navigation must reuse the host socket');
        const counts = await page.evaluate(() => window.diagnosticSubscriptions);
        assert.equal(counts.opened - counts.closed, 1);
        console.log('PASS: repeated navigation keeps exactly one page subscription');
        await page.evaluate(() => {
            window.controlTaskUpdates = 0;
            window.stopControlTaskUpdates = window.ApiClient._sdk.subscribe(['ScheduledTasksInfo'], () => {
                window.controlTaskUpdates++;
            });
        });
        await page.locator('[data-run-task="TaskTimeline.Diagnostics.Progress"]').click();
        await progressTask.locator('progress[value]').waitFor();
        await navigate('/dashboard');
        await page.waitForFunction(() => window.diagnosticSubscriptions.active === 0);
        console.log('PASS: leaving the page removes its subscription');
        const controlBefore = await page.evaluate(() => window.controlTaskUpdates);
        await page.waitForFunction(previous => window.controlTaskUpdates > previous, controlBefore);
        assert.equal(await page.evaluate(() => window.ApiClient._sdk.webSocket.socketStatus), 1);
        await page.waitForFunction(async () => {
            const tasks = await window.ApiClient.getScheduledTasks();
            return tasks.find(task => task.Key === 'TaskTimeline.Diagnostics.Progress')?.State === 'Idle';
        });
        await page.evaluate(() => window.stopControlTaskUpdates());
        console.log('PASS: another native task subscriber continues after the page leaves');
        console.log('All live-progress browser checks passed.');
    } finally {
        await browser.close();
    }
})().catch(error => {
    console.error(String(error.message).replace(/([?&](?:api_key|token)=)[^&\s]+/gi, '$1[redacted]'));
    process.exitCode = 1;
});
