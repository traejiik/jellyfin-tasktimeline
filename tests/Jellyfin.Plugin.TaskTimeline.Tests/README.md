# Forecast behavior tests

Run `dotnet test Jellyfin.Plugin.TaskTimeline.sln --configuration Release` from the repository root.

Tests cover daily/weekly rules, server timezone conversion, conservative clock-change handling, range boundaries, distinct coincident triggers, progress validity, last-run outcomes and duration, overlap semantics, native task mapping and cancellation. HTTP tests use an in-process ASP.NET Core host with test authentication to exercise the real controller and authorization pipeline.

The test host supplies a test implementation of Jellyfin's administrator policy. Actual Jellyfin authentication and plugin discovery still require runtime integration verification. Host packages are available in the test project at runtime and remain excluded from production plugin distribution.
