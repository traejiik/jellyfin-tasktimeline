# Product scope

Task Timeline is a public Jellyfin administration plugin, initially developed and tested on the owner's Jellytest server. Public releases provide convenient catalog installation and updates on the owner's server as well as other users' servers.

The first functional release provides a read-only view of scheduled work. Jellyfin remains responsible for execution and trigger configuration. UI layout, agenda versus task rows, and day versus week views are deferred decisions.

Forecasts must distinguish deterministic projections, estimates, and event-based triggers. Startup events cannot be presented as known future timestamps. Last recorded duration must not be mislabeled as a historical average.

The implemented forecast API covers the next 168 hours. It includes task observations, distinct trigger sources, supported daily/weekly projections and read-only overlap indicators. Interval deadlines remain unknown because Jellyfin does not expose the timer anchor. Same-start indicators need no runtime history; duration overlaps use the last recorded execution duration and retain its outcome, including failed or cancelled results.

Calendar projections are rule calculations, not execution guarantees. Jellyfin's local-clock timer arithmetic makes deadlines around clock changes dependent on timer arming. Affected daily/weekly sources remain visible as unsupported with `clockChangeTimingUnknown`; their dated occurrences are withheld. This conservatively covers an offset change within the forecast or preceding rule period (one day for daily rules, seven days for weekly rules).

The user-facing timeline is not implemented yet. A working API and diagnostic page do not constitute a complete first release.

Later editing may include drafts, conflict detection, snapshots, and restore. None is implemented in the initial scaffold. An initial baseline means the user's captured configuration, not factory defaults.
