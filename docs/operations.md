# Development and operations

## Local server

The development server is Jellytest, Docker container `jellytest`, managed through Colima:

```sh
colima start
docker start jellytest
docker port jellytest
docker inspect jellytest --format '{{json .Mounts}}'
```

Inspect the server version and mounts before choosing a deployment path. Never assume a container path or expose API keys in logs. Use Jellytest for runtime checks; production deployment is a separate explicit action.

For a manual shell build:

```sh
dotnet publish src/Jellyfin.Plugin.TaskTimeline/Jellyfin.Plugin.TaskTimeline.csproj --configuration Release --output artifacts/publish
```

Deploy only the plugin DLL into its own folder under Jellytest's actual plugin mount and restart Jellytest. Do not copy host framework assemblies. Confirm the plugin is listed and loads without errors. The normal build includes the Task Timeline dashboard page and forecast API; see [UI behavior](ui.md).

## Forecast API

`GET /TaskTimeline/Forecast` requires an authenticated Jellyfin administrator session using the native `RequiresElevation` policy. The endpoint never starts tasks or modifies triggers. It returns camelCase JSON with explicit nulls, UTC timestamps and integer millisecond durations, independently of the server's default JSON naming settings. Responses are not cached.

The response includes `generatedAt`, `rangeStart`, `rangeEnd`, `serverTimeZone`, `tasks`, `triggers`, `occurrences` and `overlaps`. The range is `[rangeStart, rangeEnd)`, covering the next 168 elapsed hours. Task state is an observation at generation time, not a live stream. Where possible, Windows server timezone IDs are normalized to IANA identifiers for browser date formatting; calculations still use the server timezone.

Trigger statuses are `projected`, `timingUnknown`, `eventBased` and `unsupported`. Each non-projectable source has a `reasonCode`; no fake timestamps are emitted. Interval timing remains unknown. Clock changes within the forecast or preceding rule period conservatively withhold affected daily/weekly sources with `clockChangeTimingUnknown`, because native relative timer deadlines depend on arming time. Unknown or malformed rules remain visible. Source and occurrence IDs are local to one response and must not be treated as persistent identities.

Occurrences retain coincident same-task sources separately. Estimated ends use the last recorded duration, including its visible outcome; they are not guaranteed end times. Overlap pairs concern different tasks only: `sameStart` needs no duration, while `possibleDurationOverlap` needs intersecting positive estimated occupancy windows. Touching endpoints do not overlap.

An unexpected integration failure returns HTTP 503 with a generic actionable message and a server-side error log. Clients should retain previous results with a stale indicator rather than replacing them with an empty success state.

Run `python3 tests/integration/forecast.py` against a test server with `JELLYTEST_URL`, `JELLYTEST_USERNAME` and `JELLYTEST_PASSWORD` supplied through the environment. It verifies real authentication, response consistency and unknown interval handling, creates one temporary non-admin account for the forbidden check, removes it afterward and logs out its sessions. It does not change schedules or start tasks. Never use production credentials for this test.

## Git workflow

The initial setup is committed directly to `development` and pushed to GitHub. Subsequent work uses `feat/<topic>` branches and labeled PRs targeting `development`. Use smart-commit and concise imperative subjects. All work commits must reach `development`; prefer merge commits when retaining the individual work commits matters.

Use at least one PR label: `feature`, `fix`, `documentation`, `maintenance`. CI validates branch naming, labels, packaging, C# formatting, compilation, forecast behavior, HTTP authorization and live-task lifecycle tests. Avoid worktrees; if necessary, clean them up immediately after use without losing unmerged work.

AGENTS.md and CLAUDE.md are intentionally local and ignored. All Superpowers work belongs in ignored `docs/superpowers/`. Durable public documentation belongs elsewhere under `docs/`.

## Releases

Keep source versions at `0.0.0` and assembly/file versions at `0.0.0.0`. To publish a verified stable release, tag a commit in `development` history with `vMAJOR.MINOR.PATCH`, then push that tag. Choose the version deliberately; creating the repository does not publish a plugin release.

The source manifest starts with an empty `versions` list; only release packaging creates a version entry. The target ABI is derived from the pinned Jellyfin.Controller package version in the C# project, independently of release history.

The workflow validates the tag, verifies that it belongs to development history, checks formatting, builds with a derived four-part version (for example, `v0.1.0` becomes `0.1.0.0`), and packages the plugin DLL plus `meta.json`. It publishes the ZIP, SHA-256 checksum, and generated manifest to GitHub Releases using the workflow token. No deploy key, feed branch, or version-bump commit is needed.

The stable installation feed is `https://github.com/traejiik/jellyfin-tasktimeline/releases/latest/download/manifest.json`. It contains only that release. Publish tags in increasing version order; each successful release becomes latest. Prerelease tags are not supported in the initial pipeline. Rolling back means deliberately installing an older release package, rather than expecting older entries in the latest feed.

Before tagging a functional release, validate its intended behavior on Jellytest. CI compilation is not proof of runtime compatibility. No license has been selected yet; choose one before inviting external contributions or publishing the first plugin release.
