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

Deploy only the plugin DLL into its own folder under Jellytest's actual plugin mount and restart Jellytest. Do not copy host framework assemblies. Confirm the plugin is listed and loads without errors. This scaffold does not provide a task timeline yet.

## Git workflow

The initial setup is committed directly to `development` and pushed to GitHub. Subsequent work uses `feat/<topic>` branches and labeled PRs targeting `development`. Use smart-commit and concise imperative subjects. All work commits must reach `development`; prefer merge commits when retaining the individual work commits matters.

Use at least one PR label: `feature`, `fix`, `documentation`, `maintenance`. CI validates branch naming, labels, packaging, C# formatting and compilation. Avoid worktrees; if necessary, clean them up immediately after use without losing unmerged work.

AGENTS.md and CLAUDE.md are intentionally local and ignored. All Superpowers work belongs in ignored `docs/superpowers/`. Durable public documentation belongs elsewhere under `docs/`.

## Releases

Keep source versions at `0.0.0` and assembly/file versions at `0.0.0.0`. To publish a verified stable release, tag a commit in `development` history with `vMAJOR.MINOR.PATCH`, then push that tag. Choose the version deliberately; creating the repository does not publish a plugin release.

The source manifest starts with an empty `versions` list; only release packaging creates a version entry. The target ABI is derived from the pinned Jellyfin.Controller package version in the C# project, independently of release history.

The workflow validates the tag, verifies that it belongs to development history, checks formatting, builds with a derived four-part version (for example, `v0.1.0` becomes `0.1.0.0`), and packages the plugin DLL plus `meta.json`. It publishes the ZIP, SHA-256 checksum, and generated manifest to GitHub Releases using the workflow token. No deploy key, feed branch, or version-bump commit is needed.

The stable installation feed is `https://github.com/traejiik/jellyfin-tasktimeline/releases/latest/download/manifest.json`. It contains only that release. Publish tags in increasing version order; each successful release becomes latest. Prerelease tags are not supported in the initial pipeline. Rolling back means deliberately installing an older release package, rather than expecting older entries in the latest feed.

Before tagging a functional release, validate its intended behavior on Jellytest. CI compilation is not proof of runtime compatibility. No license has been selected yet; choose one before inviting external contributions or publishing the first plugin release.
