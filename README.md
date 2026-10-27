# Task Timeline

Visualise scheduled tasks on a timeline inside Jellyfin's administration dashboard.

Initial repository setup only: the plugin shell and release pipeline exist; task projection and the UI are not implemented yet. The first functional release will be read-only. Editing and restore are later work.

## Requirements

- Jellyfin 12.2 (target ABI `12.2.0.0`). Runtime compatibility must be verified on Jellytest before release.
- .NET 10 SDK for development.
- Python 3.10 or newer for packaging checks (standard library only).

## Build and check

```sh
dotnet restore Jellyfin.Plugin.TaskTimeline.sln
dotnet format Jellyfin.Plugin.TaskTimeline.sln --no-restore --verify-no-changes
dotnet build Jellyfin.Plugin.TaskTimeline.sln --configuration Release --no-restore
python3 -m unittest discover -s tests/packaging -v
```

## Install and update

Once the first public release exists, add this repository URL in Jellyfin's plugin repository settings:

```text
https://github.com/traejiik/jellyfin-tasktimeline/releases/latest/download/manifest.json
```

Install **Task Timeline** from the catalog and restart Jellyfin as required. Later stable releases update the same feed URL. Until a first release exists, this URL will return 404.

The root `manifest.json` is a template, not a live installation feed. A release replaces the placeholder version, adds its timestamp, download URL and checksum, and omits the pending image URL. The generated feed contains the latest release only; older packages remain on GitHub Releases.

See [architecture](docs/architecture.md), [operations and releases](docs/operations.md), and [product scope](docs/product.md).
