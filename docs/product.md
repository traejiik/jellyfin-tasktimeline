# Product scope

Task Timeline is a public Jellyfin administration plugin, initially developed and tested on the owner's Jellytest server. Public releases provide convenient catalog installation and updates on the owner's server as well as other users' servers.

The first functional release provides a read-only view of scheduled work. Jellyfin remains responsible for execution and trigger configuration. UI layout, agenda versus task rows, and day versus week views are deferred decisions.

Forecasts must distinguish deterministic projections, estimates, and event-based triggers. Startup events cannot be presented as known future timestamps. Last recorded duration must not be mislabeled as a historical average.

Later editing may include drafts, conflict detection, snapshots, and restore. None is implemented in the initial scaffold. An initial baseline means the user's captured configuration, not factory defaults.
