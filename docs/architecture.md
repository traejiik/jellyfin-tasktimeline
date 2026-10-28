# Architecture

One C# plugin assembly with embedded web assets, no additional runtime service, and no frontend build requirement. The plugin exposes a read-only forecast API. The product page presents week/agenda views; the opt-in development diagnostic remains separate.

| Location | Responsibility |
| --- | --- |
| `src/Jellyfin.Plugin.TaskTimeline/Plugin.cs` | Plugin identity and lifecycle |
| `Configuration/` | Plugin configuration |
| `Api/` | Administrator-only forecast endpoint and response contract |
| `Scheduling/` | Occurrence projection and uncertainty |
| `Jellyfin/` | Integration with server task definitions and runtime state |
| `Web/` | Embedded page/styles, view controller, pure presentation model and shared native task monitor |
| `tests/Jellyfin.Plugin.TaskTimeline.Tests/` | Calendar, duration, overlap, adapter and HTTP authorization tests |
| `tests/packaging/` | Release packaging tests |
| `packaging/` | Tag parsing and release asset generation |
| `docs/decisions/` | Durable architecture decisions |

Keep internal boundaries simple. Add interfaces and additional assemblies only when a concrete need warrants them. Jellyfin supplies the server assemblies; distribute only the plugin DLL and its installation metadata.

Source versions remain at zero. Release builds receive version properties through MSBuild arguments derived from a stable Git tag; tracked files are not rewritten.

`TaskSnapshotReader` reads the public Jellyfin task API once per request into copied input records. `ForecastBuilder` assembles the response, `CalendarProjector` calculates supported calendar rules, and `OverlapDetector` finds pairs between different tasks. Calculations take explicit time, timezone and cancellation inputs. The HTTP endpoint uses the server timezone and Jellyfin's `RequiresElevation` policy.

There is no history store, scheduler mutation, private timer access, or forecast cache. Native live task updates remain separate from the forecast response. The normal page and diagnostic share `task-updates.js`; only the diagnostic can manually start its controlled test tasks.

`timeline.html` contains scoped styles and semantic regions. `timeline.js` owns native page lifecycle, authenticated resource loading, rendering and interaction; `timeline-model.js` handles date-axis construction and joins existing API objects. Pure modules have no relative imports: controllers fetch fixed named embedded resources through authenticated native AJAX, import temporary Blob URLs and revoke them. There is no external font or canvas runtime dependency.

Forecast refreshes and native observations have independent freshness states and generation guards. Only task identity persists across responses; response-local occurrence/source IDs do not become saved preferences. The browser does not recalculate scheduling or overlaps.
