# Architecture

One C# plugin assembly with embedded web assets, no additional runtime service, and no frontend build requirement. The initial shell registers plugin identity only; no dashboard page is chosen or registered yet.

| Location | Responsibility |
| --- | --- |
| `src/Jellyfin.Plugin.TaskTimeline/Plugin.cs` | Plugin identity and lifecycle |
| `Configuration/` | Plugin configuration |
| `Api/` | Administrator-only HTTP endpoints when introduced |
| `Scheduling/` | Occurrence projection and uncertainty |
| `Jellyfin/` | Integration with server task definitions and runtime state |
| `Web/` | Embedded HTML, JavaScript, CSS; UI deferred |
| `tests/Jellyfin.Plugin.TaskTimeline.Tests/` | Future C# behavior tests |
| `tests/packaging/` | Release packaging tests |
| `packaging/` | Tag parsing and release asset generation |
| `docs/decisions/` | Durable architecture decisions |

Keep internal boundaries simple. Add interfaces and additional assemblies only when a concrete need warrants them. Jellyfin supplies the server assemblies; distribute only the plugin DLL and its installation metadata.

Source versions remain at zero. Release builds receive version properties through MSBuild arguments derived from a stable Git tag; tracked files are not rewritten.
