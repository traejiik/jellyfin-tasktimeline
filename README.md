<h1 align="center">Task Timeline</h1>
<h2 align="center">A Jellyfin Plugin</h2>

<p align="center"><img src="docs/assets/tasktimeline-banner.svg" width="100%" height="240" alt="Task Timeline Logo"></p>

## About

Visualise scheduled tasks on a timeline inside Jellyfin's administration dashboard.

The plugin provides a read-only week timeline and agenda in Jellyfin’s dashboard, with category grouping, task details, overlap indicators and native live progress. Its administrator-only forecast API projects daily/weekly rules over the next week and keeps uncertain timing visible. Editing and restore are planned features.

## Features

- Week timeline and agenda views, with category grouping or start-time ordering in the week view.
- Seven-day forecasts for daily and weekly triggers, with event-based sources and unknown timing listed separately.
- Read-only overlap indicators, using the last recorded run to estimate task durations.
- Live task state and task-reported progress, with an indeterminate indicator when no percentage is available.
- Task details showing configured triggers, the last recorded result, upcoming starts and overlap partners.
- Responsive layouts with a desktop inspector, a task-details drawer on smaller screens and styling that follows the active dashboard theme.

Forecasts are projections, not execution guarantees. Jellyfin remains responsible for running tasks and configuring their triggers.

## Installation

### Prerequisites

The following are needed for the plugin to run:

- [Jellyfin 12.2](https://github.com/jellyfin/jellyfin/releases/tag/v12.2) or newer.
- A Jellyfin administrator account to open Task Timeline.

### Automatic (recommended)

1. Navigate to Settings > Admin Dashboard > Plugins > Repositories.
2. Add a new repository with the name `TJK Plugins`(or anything you like) and a `Repository URL` of:

   ```link
   https://raw.githubusercontent.com/traejiik/jellyfin-tjk-plugins/main/manifest.json
   ```

3. Save, refresh and navigate to Catalogue.
4. Select **Task Timeline** and install the latest compatible version.
5. Restart Jellyfin, then open **Task Timeline** in the dashboard’s plugin section.

### Manual

[See the official Jellyfin documentation for plugin locations and installation instructions](https://jellyfin.org/docs/general/server/plugins/#manual).

1. Download the plugin ZIP from a [release](https://github.com/traejiik/jellyfin-tasktimeline/releases) compatible with your Jellyfin version.
2. Stop Jellyfin and extract `Jellyfin.Plugin.TaskTimeline.dll`, `meta.json`, `tasktimeline-card.png` and `LICENSE.md` into a dedicated `plugins/task-timeline` folder. When updating, replace the existing plugin files rather than leaving a second copy in another folder.
3. Start Jellyfin again.
4. Open **Task Timeline** in the dashboard’s plugin section. The current plugin is read-only and does not require task settings to be configured.

## Build

You need git, Python 3.10 or newer and the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) to build an installable folder from source. The SDK is not required to install a release ZIP.

1. From the repository root, build an installable plugin folder:

   ```sh
   python3 packaging/release.py local --output artifacts/task-timeline
   ```

   This runs the .NET SDK with a Git-derived build version and writes `Jellyfin.Plugin.TaskTimeline.dll`, `meta.json`, `tasktimeline-card.png` and `LICENSE.md` to `artifacts/task-timeline/`. The metadata points Jellyfin to the bundled card, so the installed plugin has its artwork even without a catalogue download.

2. Stop Jellyfin, copy all four files from `artifacts/task-timeline/` into a dedicated `plugins/task-timeline` folder, then start Jellyfin again. Do not copy assemblies supplied by Jellyfin.

Development builds take their version from the nearest reachable stable release tag plus the number of commits since it. For example, three commits after `v0.1.0` builds as `0.1.0.3`; building the tag itself gives `0.1.0.0`. The DLL and `meta.json` use the same numeric version. The DLL’s informational version and metadata changelog record the commit and whether tracked files have uncommitted changes.

The version values in the project file remain `0.0.0`/`0.0.0.0` placeholders. The build command above injects the actual values into the SDK, like aniDoki’s local build helper. A bare `dotnet publish` without those properties uses the placeholders.

Before the first release tag, builds use `0.0.0.<commit count>`. Without Git metadata, the helper falls back to `0.0.0.0` and marks the informational version as unknown. Use a full Git clone with release tags for identifiable builds; fetch missing tags with `git fetch --tags`, or complete a shallow clone with `git fetch --unshallow --tags`. Include the build version and commit when reporting a bug.

### Checks

In addition to the build requirements, you need Node.js 24 or newer for JavaScript tests. Packaging checks use Python’s standard library only.

```sh
dotnet restore Jellyfin.Plugin.TaskTimeline.sln
dotnet format Jellyfin.Plugin.TaskTimeline.sln --no-restore --verify-no-changes
dotnet build Jellyfin.Plugin.TaskTimeline.sln --configuration Release --no-restore
dotnet test Jellyfin.Plugin.TaskTimeline.sln --configuration Release --no-build
node --test tests/web/*.test.mjs
python3 -m unittest discover -s tests/packaging -v
```

## License

Copyright © 2026 traejiik. Licensed under the [GNU General Public License v3.0](LICENSE.md).

The Nunito font used to create the wordmark has its own [SIL Open Font License notice](docs/assets/OFL-Nunito.txt).
