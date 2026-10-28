# Live-progress diagnostic

This development-only probe verifies native scheduled-task updates inside an embedded plugin page. It does not implement the Task Timeline forecast or establish its final UI layout.

## Build and open

```sh
dotnet publish src/Jellyfin.Plugin.TaskTimeline/Jellyfin.Plugin.TaskTimeline.csproj \
  --configuration Release --output artifacts/diagnostics \
  -p:TaskTimelineDiagnostics=true
```

Inspect the test server's plugin directory, copy only `Jellyfin.Plugin.TaskTimeline.dll` into its own folder, and restart that test server. Do not install this build on a production server.

Sign in as an administrator and open **Task Timeline diagnostics** in the dashboard plugin section, or navigate to:

```text
http://localhost:8096/web/#/configurationpage?name=taskTimelineDiagnostics
```

The page offers two explicitly manual test tasks. Both have an empty default trigger list, access no media, and support cancellation:

- Reported progress: reports 0, 25, 50, 75 and 100 percent, waiting three seconds at each step.
- No percentage: waits twelve seconds without reporting a percentage, producing an indeterminate progress indicator.

The normal build omits the tasks, page registration, and diagnostic web resources entirely. It requires no diagnostic configuration setting and leaves source version placeholders unchanged.

## Subscription behavior

The page calls the host's authenticated `ApiClient.subscribe(['ScheduledTasksInfo'], callback)` bridge. It does not create a separate WebSocket or store credentials. The SDK manages shared subscriptions, server start/stop messages, and reconnection.

For connection status, the compatibility adapter uses the host's guarded `ApiClient._sdk.webSocket.onStatusChange` bridge. The `onStatusChange` method is a public SDK API; exposing `_sdk` on the legacy client is a dashboard implementation detail. Both supported test versions must therefore be checked. If the bridge is unavailable, the diagnostic displays an explicit capability failure rather than silently claiming live status.

A task snapshot is fetched on opening, every thirty seconds while visible, on manual refresh, and after reconnection. Live messages arriving during a snapshot fetch are buffered until the snapshot is applied, so an older response cannot overwrite newer progress. Page-lifetime guards reject late responses and callbacks after navigating away. Hidden pages pause subscriptions and polling; leaving a page removes its own listeners without closing other consumers' subscriptions.

Task updates are change-driven. The SDK requests a one-second periodic listener interval, but an idle server can remain silent. An idle subscription is not a continuous heartbeat. A loaded snapshot can therefore show "waiting for task changes" until a native message arrives.

Only a finite task-reported percentage in the range 0–100 for a running task produces a determinate bar. Missing or invalid percentages stay indeterminate. Durations are never converted into artificial progress or ETAs.

## Automated verification

Unit checks use Node 24's built-in test runner:

```sh
node --test tests/web/*.test.mjs
python3 -m unittest discover -s tests/packaging -v
```

The real-browser acceptance runner requires Playwright and Chromium in the executing environment. Supply credentials through environment variables; do not commit them or a browser storage/session file:

```sh
# Set JELLYTEST_USERNAME and JELLYTEST_PASSWORD in your shell.
JELLYTEST_URL=http://127.0.0.1:8096 node tests/integration/live-progress.cjs
```

If Playwright is installed outside the repository, set `NODE_PATH` to that installation's node_modules directory. Set `PLAYWRIGHT_BROWSERS_PATH` if Chromium uses a non-default cache. `JELLYTEST_SCREENSHOT` optionally saves an image of reported progress. Use this runner only against a test server with the diagnostic build installed: it starts only tasks with the two diagnostic keys.

The browser checks cover authenticated page access, reported progress, completion, missing percentages, offline/online recovery, a socket-only disconnect followed by a fresh snapshot, repeated page navigation, and continued updates for a second native subscriber after this page leaves.

CI runs the lifecycle tests and builds/formats both the ordinary and diagnostic variants. Real-browser tests against a running Jellyfin instance are integration checks, not part of ordinary CI.

## Implementation references

- [Plugin-page host](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/components/ServerContentPage.tsx)
- [Legacy client subscription bridge](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/lib/jellyfin-apiclient/ServerConnections.js)
- [Native dashboard live-task hook](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/apps/dashboard/features/tasks/hooks/useLiveTasks.ts)
- [Server task-update listener](https://github.com/jellyfin/jellyfin/blob/v12.2/Jellyfin.Api/WebSocketListeners/ScheduledTasksWebSocketListener.cs)

## Verified results — 28 October 2026

| Environment | Result |
| --- | --- |
| Existing Jellytest, Jellyfin 12.4.0 | Full browser suite passed |
| Isolated Jellyfin 12.2.0, no media or other plugins | Full browser suite passed; temporary container and its anonymous volumes removed afterward |
| JS lifecycle tests | Seven passed, including late callbacks from a previous page lifetime |
| Packaging tests | Three passed |
| Standard and diagnostic compilation | Both passed; standard DLL checked to exclude diagnostic task types and web resource names |

On both servers, the browser observed real reported progress, task completion, an indeterminate running state, offline/online recovery, socket-only reconnection with a new snapshot, three navigation cycles with exactly one page subscription and no new socket connections, and continued native updates to another task subscriber after this page left. The controlled tasks finished before the test ended. No existing task triggers were intentionally edited and no non-diagnostic task was manually started; restarting Jellytest ran its normal startup jobs.

The diagnostic build remains installed on Jellytest for manual inspection. These checks establish the live-update integration on the two tested versions, not completion of the forecast feature or a guarantee about future Jellyfin client internals.
