# Dashboard timeline

Sign in as a Jellyfin administrator and choose **Task Timeline** in the dashboard plugin section. The normal plugin build includes this page:

```text
/web/#/configurationpage?name=taskTimeline
```

The page is read-only. It never starts tasks, changes triggers or creates a separate WebSocket.

## Views and details

Week shows task rows grouped by category or ordered by first projected start. Category sections collapse. Agenda shows dated starts by day. Both use the server scheduling timezone, not the browser timezone. A 168-hour forecast can touch seven to nine local dates; partial days are shaded outside the requested range. The week panel scrolls horizontally when necessary, retaining task names and day headings. Narrow screens initially use Agenda; either view remains selectable. Week/Agenda is the first toolbar control at every size; phones use a native grouping dropdown alongside the view controls. Agenda groups dates beside their entries on wider screens and above their entries on phones, with no heavy date-header stripes. Desktop and tablet use an aligned primary pair for next start and running work, with two quieter metrics below. Phones stack the two primary panels above the same metric pair. Undated messages fill the timeline portion of each row. Their text stays vertically centered and left-aligned, sticky just after the task column during horizontal scrolling. Details open through task selection at every size; there is no separate Task details toolbar button.

Select a task row, start marker, agenda entry or undated source to inspect its last recorded result, triggers, upcoming starts and overlap partners. On desktop, details remain in a sticky inspector alongside both the timeline and the off-calendar section, with their own scrolling. On screens up to 1100px wide, selection opens a modal drawer instead; the accessible X button or Escape returns focus to the selected entry without moving the list. Selection, view and category collapse state survive forecast refreshes while the page remains mounted. Source and occurrence IDs are local to one response and are not retained as persistent identities.

The labeled timeline key groups four glyph samples with their explanations: projected starts, overlap indicators, short/unknown durations and out-of-range hatching. Blue marks indicate projected starts. Longer bars use the last recorded execution duration; very short or unknown durations use a minimum-width start marker whose width is not a duration measurement. Exact duration and available estimated end are in details. Zero duration is valid. Overlap marks include an exclamation indicator as well as color and remain keyboard/touch accessible. Coincident same-task triggers stay distinct and may queue a repeat.

Overlap counts are API occurrence pairs, including repeated dates. Category counts include pairs touching that category, so a cross-category pair can appear in both categories. Details preserve dates and partner categories. Duration overlaps are possible overlaps based on one recorded run, not guaranteed contention or average runtimes.

Off-calendar counts refer to undated trigger sources, not tasks. Mixed timed/untimed tasks retain all sources. Reason tabs separate timing unknown, event-based, unsupported and tasks without triggers; empty groups are omitted. Counts appear in compact badges within each reason tab; duplicate header and footer totals are omitted. A borderless circular chevron collapses or expands the whole section, and its scrolling content is capped at 700px or a smaller viewport-relative height. The selected reason, collapse state and each reason's list position survive refreshes. Startup sources are event-based; intervals without a timer anchor remain unknown. Interval summaries use readable units, such as “Every day” and “Every 12 hours.” Malformed rules, unknown trigger types and clock-change uncertainty have readable explanations. Tasks without configured triggers are counted separately and do not inflate the source count. Technical reason codes are available under a contained disclosure rather than used as the primary explanation; expanded content labels the projection status and reason code separately.

## Refresh and live state

Forecasts load on opening and refresh every 30 seconds while visible, manually, on return and reconnect. Header metadata shows “Refreshing…” during updates, then the last generation time; the server timezone is available in its tooltip. Routine success and connection messages stay hidden. Exceptions such as a disconnected feed remain visible. Failed refreshes retain previous data with the original generation timestamp and a stale message. First-load errors offer Retry. Missing or expired administrator access hides cached forecast data and stops automatic work.

The native task feed supplies observed state and actual reported percentages, including zero. Missing percentages show indeterminate progress; multiple running tasks remain visible. No progress or completion ETA is inferred from prior durations. Jellyfin's Idle state is labeled “Not running”; it describes current execution, not whether scheduling is enabled. Idle streams may be silent. Forecast freshness and live-connection status are independent; unavailable live support does not prevent use of a valid forecast.

Hidden pages pause timers and subscriptions. Late responses from previous page lifetimes cannot overwrite current data. Reconnect obtains a fresh observed-task snapshot before buffered live messages are applied. New native observations take precedence over older forecast responses. Live progress patches running/state elements without rebuilding the entire page.

The host's guarded `ApiClient._sdk.webSocket.onStatusChange` bridge remains a compatibility boundary; see [diagnostic limitations](diagnostics.md). A browser that cannot format an unusual server timezone explicitly displays UTC with a warning, rather than silently using its own timezone.

## Theme and accessibility

The page inherits Jellyfin's fonts, text colors and theme palette. Sticky surfaces follow the actual host background color and image, including dashboard styling applied by KefinTweaks and stylesheet/palette changes while mounted. There is no plugin-specific theme preference, external font request or canvas runtime. Reduced-motion settings disable entry animation. Reason tabs support arrow keys, Home and End. Buttons, focus indicators, status messages and selectable task details work without relying on hover alone. Progress ticks are not announced through a live region.

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

The subsequent off-calendar refinements were checked in the actual browser on Jellytest 12.4.0 with its existing KefinTweaks background and on a disposable Jellyfin 12.2.0 with the normal package. Checks covered reason selection, readable interval summaries and keeping the inspector visible while selecting undated sources. Jellytest also covered collapse/expand, keyboard reason navigation, selection/list-position retention after refresh, and a 390×844 drawer with Escape returning focus and no page-width overflow. The disposable server and volumes were removed afterward. All 51 C# tests, 21 Node tests and three packaging tests passed, with normal and diagnostic formatting/build checks. The updated Playwright integration runner was syntax-checked; its full synthetic acceptance suite was not rerun for this refinement.

On 29 October 2026, the annotated presentation polish was checked in a real Chromium browser on Jellytest 12.4.0 using its native dark dashboard styling. Checks covered the desktop summary hierarchy and agenda, the labeled legend and count badges, chevron states, an 820px tablet layout and drawer disclosure, and a 430px phone toolbar with no page-width overflow. The X button returned focus to its opener. All 51 C# tests, 21 Node tests, three packaging tests, both formatting modes and normal/diagnostic publishes passed. The integration runner selectors were updated and syntax-checked; the full synthetic suite and a new 12.2 browser run were not repeated for these presentation-only changes.

The final responsive follow-up removed the standalone details button, changed phone grouping to a native dropdown, carried the desktop summary hierarchy through tablet and phone sizes, and vertically centered undated track labels. Checked at 820px and 430px on Jellytest 12.4.0: tablet panels align, the dropdown changes grouping and retains it on refresh, no page-width overflow occurs, and selecting a task still opens the drawer with focus returning on close.

The follow-up correction gives phone grouping the same translucent theme surface as the view controls, retaining native select interaction and a theme-colored chevron. Undated messages use a full-track band with vertically centered, left-aligned text. On Jellytest 12.4.0, scrolling the week panel from 0 to 194px kept the message at the same 265px offset from the panel edge, immediately after the sticky task column. Phone grouping still changes the view and adds no page-width overflow.
