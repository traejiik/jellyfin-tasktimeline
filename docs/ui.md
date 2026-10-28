# Dashboard timeline

Sign in as a Jellyfin administrator and choose **Task Timeline** in the dashboard plugin section. The normal plugin build includes this page:

```text
/web/#/configurationpage?name=taskTimeline
```

The page is read-only. It never starts tasks, changes triggers or creates a separate WebSocket.

## Views and details

Week shows task rows grouped by category or ordered by first projected start. Category sections collapse. Agenda shows dated starts by day. Both use the server scheduling timezone, not the browser timezone. A 168-hour forecast can touch seven to nine local dates; partial days are shaded outside the requested range. The week panel scrolls horizontally when necessary, retaining task names and day headings. Narrow screens initially use Agenda; either view remains selectable.

Select a task row, start marker, agenda entry or undated source to inspect its last recorded result, triggers, upcoming starts and overlap partners. Selection, view and category collapse state survive forecast refreshes while the page remains mounted. Source and occurrence IDs are local to one response and are not retained as persistent identities.

Blue marks indicate projected starts. Longer bars use the last recorded execution duration; very short or unknown durations use a minimum-width start marker whose width is not a duration measurement. Exact duration and available estimated end are in details. Zero duration is valid. Overlap marks include an exclamation indicator as well as color and remain keyboard/touch accessible. Coincident same-task triggers stay distinct and may queue a repeat.

Overlap counts are API occurrence pairs, including repeated dates. Category counts include pairs touching that category, so a cross-category pair can appear in both categories. Details preserve dates and partner categories. Duration overlaps are possible overlaps based on one recorded run, not guaranteed contention or average runtimes.

Off-calendar counts refer to undated trigger sources, not tasks. Mixed timed/untimed tasks retain all sources. Startup sources are event-based; intervals without a timer anchor remain unknown. Malformed rules, unknown trigger types and clock-change uncertainty have readable explanations. Tasks without configured triggers are listed separately and do not inflate the source count. Technical reason codes are available under a disclosure rather than used as the primary explanation.

## Refresh and live state

Forecasts load on opening and refresh every 30 seconds while visible, manually, on return and reconnect. Failed refreshes retain previous data with the original generation timestamp and a stale message. First-load errors offer Retry. Missing or expired administrator access hides cached forecast data and stops automatic work.

The native task feed supplies observed state and actual reported percentages, including zero. Missing percentages show indeterminate progress; multiple running tasks remain visible. No progress or completion ETA is inferred from prior durations. Idle streams may be silent. Forecast freshness and live-connection status are independent; unavailable live support does not prevent use of a valid forecast.

Hidden pages pause timers and subscriptions. Late responses from previous page lifetimes cannot overwrite current data. Reconnect obtains a fresh observed-task snapshot before buffered live messages are applied. New native observations take precedence over older forecast responses. Live progress patches running/state elements without rebuilding the entire page.

The host's guarded `ApiClient._sdk.webSocket.onStatusChange` bridge remains a compatibility boundary; see [diagnostic limitations](diagnostics.md). A browser that cannot format an unusual server timezone explicitly displays UTC with a warning, rather than silently using its own timezone.

## Theme and accessibility

The page inherits Jellyfin's fonts, text colors and theme palette. Sticky surfaces follow the host background, including palette changes while mounted. There is no plugin-specific theme preference, external font request or canvas runtime. Reduced-motion settings disable entry animation. Buttons, focus indicators, status messages and selectable task details work without relying on hover alone. Progress ticks are not announced through a live region.

## Verification

Run `node --test tests/web/*.test.mjs` for pure presentation, transport and lifecycle tests. Run `dotnet test Jellyfin.Plugin.TaskTimeline.sln --configuration Release` for forecast/API behavior and normal resource registration.

The browser runner is `tests/integration/timeline.cjs`, using Playwright and Chromium. Supply `JELLYTEST_URL`, `JELLYTEST_USERNAME` and `JELLYTEST_PASSWORD` through the environment. `JELLYTEST_UI_OUTPUT` selects an ignored screenshot directory, defaulting to `artifacts/ui`. It first checks real server data and then uses explicitly synthetic intercepted fixtures for edge cases. Synthetic screenshots are named accordingly.

Set `JELLYTEST_DIAGNOSTICS=1` only on a test server with the diagnostic build installed to verify actual reported and indeterminate progress using its two known manual test tasks. The product UI itself has no start controls. The separate `tests/integration/live-progress.cjs` checks the diagnostic and shared-subscription behavior.

Browser integration is a test-server check, not part of ordinary CI. Normal CI covers all Node behavior tests, C# tests, build/format checks, packaging checks and resource inclusion/exclusion. Supported versions and visual themes must be stated from actual runs; a successful build alone is not runtime verification.

Verified on 28 October 2026:

| Check | Evidence |
| --- | --- |
| Normal package, Jellyfin 12.2.0 | Page registration, authenticated module loading, real task definitions and browser acceptance passed |
| Jellytest 12.4.0 | Full product-page browser acceptance passed alongside the existing plugins |
| Native progress, 12.2.0 and 12.4.0 | Actual reported and indeterminate execution reached the normal page using only controlled diagnostic tasks |
| Shared diagnostic | Existing progress, reconnect, navigation and second-subscriber browser checks passed after extraction |
| Native dark/light palettes | Desktop/mobile screenshots inspected; muted explanatory text measured at least 4.5:1, keyboard focus at least 3:1 |
| Pure/unit checks | 44 C# tests, 18 Node tests and three packaging tests passed; normal/diagnostic build/format checks and resource assertions passed |

Selection, grouping, stale retention, empty/first-load/access errors, reconnect, subscription cleanup, keyboard interaction and live-region behavior were exercised. Overlap and multiple-running edge cases used explicitly synthetic fixtures because current runtime schedules did not provide those examples. These checks establish the tested versions and palettes, not every third-party theme or client. The disposable minimum-version container and its volumes were removed afterward; no production data was mounted into it.
