# P1a standalone jeff graph design

Status: approved design for phase P1a. Author of record: Johan.
Audience: any frontier-class model in any harness. This file plus the
repository is the complete input. No conversation history is required.

P1a ships a read-only projector and a standalone full-screen `jeff graph`
TUI. It is the first operator win on the control-plane track. This document
is the cold-context contract for implementers of that phase only.

## Binding sources

Do not relitigate these without Johan. This spec specializes them for P1a.

| Source | What binds here |
|---|---|
| `docs/specs/control-plane-vision.md` §6.2–6.4, §7–8, §14–16 | Backend, standalone TUI order, CLI verbs, registry, graph model, phases |
| `docs/specs/control-plane-handoff.md` §5–6 | Required design contents; debounce, per-project resnapshot, layout cache, no Rust ledger parse |
| `skills/cook/reference/jeff-state-schema.md` Snapshot projection | `cook snapshot --json` document shape and semantics |
| `docs/specs/graph-slate-6.0.md` item 8 | Snapshot as the machine projection surface |

If this file and a binding source disagree on method or ledger truth, the
source wins and this file is defective. If they disagree only on P1a
implementation choices left open there, this file wins for P1a.

## Scope and non-goals

### In scope (P1a)

1. Long-lived local projector backend (`jeffd`) that watches registered
   projects, invokes each project's `cook snapshot --json`, and serves a
   live graph projection over a Unix domain socket.
2. Home project registry (`~/.jeff/projects.json`) sufficient to know which
   roots to watch.
3. Standalone full-screen `jeff graph [project]` TUI: zoomable task DAG,
   selected-node detail, completed-task toggle, claim badges when the
   snapshot carries them.
4. Shared Rust types and layout/viewport code under `control/` so later
   verbs can reuse projection without rewriting it.
5. Mechanical acceptance checks listed below for graph alone.

### Out of scope (explicit non-goals)

- P1b backlog file formats, multi-writer inbox append strategy, and the
  standalone `jeff backlog` TUI (design those in a later pass).
- Combined multi-pane Ratatui shell and three-card layouts. Not first ship.
- Item 6 discovery edges as a required store feature (render
  `discoveredFrom` when the snapshot already projects it).
- Item 7 claim/drain implementation. P1a may run against pre-item-7 stores
  with claims optional and degraded.
- Autodrain supervisor, host launch, web client, browser HTTP API.
- Parsing `.jeff` ledgers directly in Rust.
- Any side claim store or UI-minted claim mechanism.

### Client shape lock

- Ship standalone `jeff graph` first. That is the P1a vehicle.
- Kitty composition of standalone processes is valid from day one and is the
  early way to run multiple surfaces side by side.
- Bare `jeff` is help-only until a later multi-pane composition earns it.
- Bare `jeff` is deferred out of first ship; it does not open a combined
- shell in this phase.
- Design shared widgets so a late Ratatui multi-pane shell can compose them
- later. Do not require that shell for P1a.

## Socket protocol

P1a clients talk only to the local projector. The wire carries graph
projection data derived from `cook snapshot --json`, never raw ledger
bytes.

### Transport

- Preferred transport: Unix domain stream socket.
- Default path: `~/.jeff/jeffd.sock` (directory mode `0700`, socket mode
  `0600`, owner-only). Auth is filesystem permissions; no browser and no
  TCP bind in P1a.
- Override: environment variable `JEFFD_SOCK` when set to an absolute path.
- On start, `jeffd` removes a stale socket inode only when it can prove no
  live listener owns it; otherwise it exits with a clear error.
- Windows later may use a named pipe with the same framing and schemas. P1a
  targets POSIX.

### Framing

One framing for the life of P1a: **newline-delimited JSON (NDJSON)**.

- Each message is one UTF-8 JSON object followed by a single `\n`.
- No length prefix, no bundled multi-object frames.
- Maximum message size: 16 MiB. Larger frames are a protocol error; the
  server closes the connection after writing an error response when a
  request id is known.
- Clients and server MUST flush after each message.
- A connection may carry interleaved responses and events. Clients demux by
  envelope `kind`.

### Envelope

Every frame is one of:

```json
{"v":1,"kind":"req","id":"c-1","method":"snapshot.get","params":{}}
{"v":1,"kind":"res","id":"c-1","ok":true,"result":{}}
{"v":1,"kind":"res","id":"c-1","ok":false,"error":{"code":"unavailable","message":"…"}}
{"v":1,"kind":"event","name":"snapshot.replaced","payload":{}}
```

| Field | Rule |
|---|---|
| `v` | Protocol major version. P1a sends `1`. Unknown major → close after error. |
| `kind` | `req` \| `res` \| `event` |
| `id` | Required on `req`/`res`. Client-chosen string; server echoes on `res`. |
| `method` | Request verb (see below). |
| `params` / `result` / `error` / `name` / `payload` | As shown. |

### Request methods (P1a)

| Method | Params | Result |
|---|---|---|
| `server.hello` | `{}` or `{ "client": "jeff-graph", "clientVersion": "…" }` | `{ "protocolVersion": 1, "serverVersion": "…", "snapshotSchemaMin": 1, "snapshotSchemaMax": 1 }` |
| `project.list` | `{}` | `{ "projects": [ { "id", "path", "name", "enabled" } ] }` |
| `snapshot.get` | `{ "projectId": "…" }` or `{ "path": "…" }` | Graph projection object (below) |
| `snapshot.subscribe` | same project selector as `get` | `{ "subscriptionId": "…", "snapshot": <graph projection> }` then push events |
| `snapshot.unsubscribe` | `{ "subscriptionId": "…" }` | `{ "ok": true }` |

Unknown methods return `ok: false` with `code: "unknown_method"`.

### Graph projection payload

The socket result is a thin view model built from one snapshot document.
Field names stay close to the snapshot so clients do not invent a second
schema.

```json
{
  "projectId": "demo",
  "path": "/abs/path/to/repo",
  "schemaVersion": 1,
  "generatedAt": "2026-08-03T12:00:00.000Z",
  "mode": "lite",
  "maxParallelTasks": 1,
  "tasks": [
    {
      "id": 1,
      "slug": "example",
      "title": "Example",
      "status": "in_progress",
      "stage": "implement",
      "priority": "p0",
      "deps": [],
      "blockedReason": null,
      "category": "code",
      "discoveredFrom": null,
      "claim": { "by": "omp", "at": "2026-08-03T11:00:00.000Z" },
      "escalation": null
    }
  ],
  "degraded": []
}
```

Rules:

- `tasks` is sorted by `id` exactly as `cook snapshot --json` returns.
- Optional snapshot fields (`claim`, `maxParallelTasks`, `category`,
  `discoveredFrom`, `escalation`) appear when present and are omitted or
  null when absent. Clients MUST tolerate absence.
- `degraded` is an array of machine-readable notes (for example
  `"claims_absent"`, `"snapshot_stale"`). Empty means fully healthy
  projection.
- The backend MUST NOT add fields that require parsing ledgers outside
  `cook snapshot --json`.

### Events

| Name | When | Payload |
|---|---|---|
| `project.updated` | Registry entry added, removed, enabled, or path changed | `{ "projectId", "path", "enabled" }` |
| `snapshot.replaced` | A new successful snapshot replaced the cached projection for a subscribed project | `{ "projectId", "snapshot": <graph projection> }` |
| `snapshot.failed` | Resnapshot failed after a prior good snapshot (keep last good; signal error) | `{ "projectId", "message", "exitCode" }` |
| `subscription.ended` | Server dropped a subscription (project removed, shutdown) | `{ "subscriptionId", "reason" }` |

Events are not responses. They never carry a request `id`.

### Versioning

1. Envelope `v` is the socket protocol major. P1a is `1`. A client that
   cannot speak a server major exits with a clear operator error.
2. Snapshot document `schemaVersion` is gated separately (see cook
   invocation). Socket `server.hello` advertises the inclusive
   `snapshotSchemaMin` / `snapshotSchemaMax` the binary understands.
3. Additive optional fields inside an existing major are allowed. Removing
   or reinterpreting a field requires a major bump.
4. Clients MUST ignore unknown optional fields. Servers MUST NOT require
   new params from older clients inside the same major.

## cook invocation contract

Disk is truth. The only read path from Rust into a project's store is the
project's own installed `cook` binary (or `node /path/to/cook.js` when the
registry records an explicit cook command). Never parse task ledgers,
journals, or `.claim` trees in Rust.

### Command

From the project root (cwd = registered `path`):

```text
cook snapshot --json
```

If the registry stores an absolute cook executable, invoke that instead of
PATH `cook`, still with cwd set to the project root.

No other snapshot flags are required for P1a. Additive extensions such as
`cook snapshot --task <id>` or `--watch` may appear later; P1a must not
depend on them.

### Success

- Exit code `0`.
- Stdout: one JSON document matching Snapshot projection in
  `skills/cook/reference/jeff-state-schema.md`.
- Stderr: empty or diagnostics only; do not parse stderr for data on
  success.
- The command takes no lock and writes nothing under `.jeff/`.
- Invalid-but-parseable stores still project. Legality stays with
  `cook validate`, not the projector.

### Top-level document anchors

Always present:

- `schemaVersion` (integer; starts at `1`)
- `generatedAt` (ISO 8601 UTC)
- `mode` (`lite` \| `full`)
- `tasks` (array sorted by `id`)

Optional top-level:

- `maxParallelTasks`

Each task always has:

- `id`, `slug`, `title`, `status`, `stage`, `priority`, `deps`,
  `blockedReason`

Each task may have:

- `category`
- `discoveredFrom`
- `claim` as `{ by, at }` projected from
  `.jeff/tasks/<dir>/.claim/claim.json` when present and well-formed
- `escalation` as `{ fork, options }` when parked on the plan

### Failure and exit codes

| Situation | Exit | Operator-visible handling |
|---|---|---|
| Success | `0` | Replace cached projection; emit `snapshot.replaced` to subscribers |
| Outside initialized project (no readable `.jeff/config.json`) | non-zero | stderr begins with `cook: snapshot:`; mark project unavailable |
| cook missing / not executable | non-zero (spawn error) | clear error: install or point registry at cook |
| Non-zero for any other reason | non-zero | keep last good snapshot if any; emit `snapshot.failed`; surface message |
| Timeout (default 30s) | treated as failure | kill process group; same as non-zero |

P1a does not require a specific non-zero numeric code beyond "not zero".
Match on exit status and stderr prefix, not on English prose beyond the
`cook: snapshot:` convention.

### Parse failure

If exit is 0 but stdout is not a single JSON object:

1. Do not invent tasks.
2. Treat as broken projection for that burst.
3. Keep the last good snapshot if one exists; otherwise serve
   `unavailable` / degraded empty graph with an explicit error string.
4. Log the parse failure once per burst (coalesced).

Never field-sniff a partial object into a best-effort graph.

### Version skew and older jeff

Consumers gate on `schemaVersion` and never sniff fields for meaning
(slate item 8 / schema doc).

| Case | Behavior |
|---|---|
| `schemaVersion` within `snapshotSchemaMin`…`snapshotSchemaMax` | Accept. Absent optional fields mean legacy semantics. |
| `schemaVersion` older than min (backend newer than project jeff) | Reject projection. Operator error: upgrade project jeff, or run a backend that still supports that schema. Do not parse ledgers to compensate. |
| `schemaVersion` newer than max (project jeff newer than backend) | Reject projection. Operator error: upgrade `jeffd` / control clients. |
| cook binary too old to implement `snapshot` at all (unknown command / usage on stderr) | Fail closed with a clear "older jeff missing snapshot" message. Still never parse ledgers in Rust. |
| Item 7 fields absent | Normal. Claims display degraded (see Claims). |

### Forbidden optimization

Do not "optimize" by reading `task.json`, `journal.jsonl`, or claim files
from Rust. That trades a bounded spawn/parse cost for unbounded correctness
risk across jeff versions (handoff §6).

## Crate layout under control/

P1a code lives in a Rust workspace at `control/` in this repository. It is
never added to the npm `files` allowlist. The language wall is the CLI-only
boundary: Rust cannot import ESM internals, so exec'ing `cook` is the only
coupling channel.

Suggested crates (names may shift slightly; responsibilities must not):

```text
control/
  Cargo.toml                 # workspace
  jeffd/                     # backend binary: registry, FS watch, cook spawn, socket
  jeff/                      # CLI front door: `jeff graph`, `jeffd start|stop|status`, help
  jeff-project/              # shared: snapshot types, graph view model, protocol enums
  jeff-graph/                # optional lib: layout + viewport + ratatui graph widgets
```

| Crate | Role in P1a |
|---|---|
| `control/jeffd` | Projector backend. Owns socket server, debounce, per-project snapshot cache, registry load. |
| `control/jeff` | Operator CLI. `jeff graph [project]` attaches the standalone graph TUI. `jeffd start\|stop\|status` manages the daemon. Bare `jeff` with no subcommand prints help only. |
| `control/jeff-project` | Shared serde types for snapshot JSON, protocol envelopes, registry records. No TUI dependency. |
| `control/jeff-graph` | petgraph build, layout-rs call, viewport math, Canvas widget. Used by `jeff graph`; reusable later. |

Notes:

- P1a does not require a combined multi-pane shell crate.
- Shared projection and widgets MUST stay separable so a late composed
  client can depend on `jeff-project` + `jeff-graph` without rewriting.
- CI for Rust is path-filtered and separate from the npm method suite.
  Do not tag crate releases into the npm bare-version namespace.

### CLI surface (P1a)

```text
jeffd start | stop | status
jeff graph [project]       # standalone full-screen graph TUI
jeff                       # help-only in P1a
jeff help
```

`jeff backlog`, drain toggles, and bare multi-pane `jeff` wait for later
phases. Registry edit verbs may land with the backend if needed for dogfood;
they are not graph-rendering scope.

## Projection and cache model

### Truth and cache

1. Disk via `cook snapshot --json` is the only authority for task graph
   data.
2. `jeffd` holds an in-memory cache per project: last good graph projection,
   last error, last successful `generatedAt`.
3. The TUI renders from memory every frame. Socket events update that
   memory. The UI cache never wins over a newer successful snapshot.
4. On conflict or doubt, resnapshot and replace; do not merge field-by-field
   against stale client state.

### FS watch

- Watch each enabled registry path's `.jeff/**` (and only what is needed to
  know the store changed).
- Ignore transient noise (editor swap files) at the watch layer when cheap;
  correctness still comes from the next snapshot, not from perfect filters.

### Debounce and coalesce

- Debounce window: **100–200 ms** (pick one default in code, e.g. 150 ms;
  keep it in range).
- Coalesce: multiple FS events inside the window for the same project
  produce one resnapshot.
- Burst rule: while a snapshot child is running, note "dirty again"; when it
  exits, if dirty, schedule one more run after the debounce window.

### Per-project re-snapshot

- Resnapshot **only the project whose files changed**.
- Never fan out a full registry snapshot because one project touched
  `task.json`.
- `project.list` / registry edits rescan registry state without snapshotting
  every project unless a subscriber needs it.

### Cost model

At jeff scale (hundreds of tasks) one spawn + JSON parse is on the order of
tens to low hundreds of milliseconds and a few hundred KB. That cost is per
project per change-burst, not per frame. Mitigations, in order, only as
measurement demands (handoff §6):

1. Debounce/coalesce 100–200 ms.
2. Per-project resnapshot.
3. Later additive `cook snapshot --task <id>`.
4. Only if still insufficient: long-lived `cook snapshot --watch` NDJSON.

P1a implements (1) and (2) only.

### Subscribe path

1. Client `snapshot.subscribe`.
2. Server returns current cache immediately (or runs a snapshot if cold).
3. Subsequent coalesced rebuilds push `snapshot.replaced` with the full
   projection (P1a: full replace, not JSON patch).
4. Unsubscribe or disconnect drops the subscription.

## Viewport math

The graph pane is an owned zoom/pan viewport over layout world coordinates.
No crate ships the full transform; implement it explicitly.

### Spaces

| Space | Unit | Meaning |
|---|---|---|
| World | layout-rs coordinates (f64) | Node centers and edge routes from the layout pipeline |
| View | world after pan/zoom | `view = (world - pan) * zoom` in a convenient intermediate, or equivalent |
| Screen cell | terminal cells (i32) | ratatui `Canvas` cells; mouse reports in cell coordinates |

### State

```text
pan_x, pan_y   : f64   # world point pinned near the top-left of the canvas
zoom           : f64   # scale factor; 1.0 = identity
canvas_w, h    : u16   # current inner width/height in cells
world_bounds   : Rect  # axis-aligned bounds of all node anchors (+ padding)
```

### Zoom

- Wheel up multiplies `zoom` by a constant (e.g. `1.1`); wheel down divides.
- Clamp zoom to a closed range, e.g. `[0.25, 8.0]`.
- Zoom about the cursor: adjust `pan` so the world point under the mouse
  cell stays under that cell after the scale change.

### Pan

- Drag or keyboard arrows translate `pan_x` / `pan_y` in world units
  scaled by `1/zoom` so motion feels stable across zoom levels.
- Pan bounds: after each pan/zoom, clamp so the world bounding box still
  intersects the canvas with a margin (e.g. keep at least 20% of the canvas
  over `world_bounds`). Never allow the graph to be thrown infinitely off
  screen.

### World ↔ cell

With canvas origin at bottom-left in Canvas space (ratatui default) or
top-left if the implementation flips Y consistently:

```text
cell_x = floor( (world_x - pan_x) * zoom )
cell_y = floor( (world_y - pan_y) * zoom )   # apply the same Y flip used when drawing

world_x = pan_x + (cell_x + 0.5) / zoom
world_y = pan_y + (cell_y + 0.5) / zoom
```

Drawing sets Canvas `x_bounds` / `y_bounds` from `pan` and `zoom` each
frame rather than rewriting stored layout coordinates.

### Hit-test (mouse cell → node)

1. Read mouse cell `(mx, my)` relative to the graph canvas widget.
2. Convert to world `(wx, wy)` with the inverse transform above.
3. For each node, test whether `(wx, wy)` lies inside the node's world-space
   hit rectangle (layout anchor ± half node width/height in world units).
4. If several overlap, pick the smallest area, then highest `id` as
   tie-break.
5. If none contain the point, optionally snap to nearest node within a
   world-space radius `r = 1.5 * min_node_half_diagonal`; else miss.

Keyboard selection does not use hit-test: tab cycle and fuzzy jump set the
selected task id directly. Every mouse selection path has a keyboard path.

## Layout pipeline

Pipeline order:

```text
snapshot.tasks  →  petgraph DiGraph  →  layout-rs (Sugiyama)  →  world positions  →  ratatui Canvas
```

### petgraph

- One node per snapshot task (`id` is the stable key).
- One directed edge per `deps` entry: dependency → dependent (or the reverse
  consistently; pick dependency → dependent so layers flow prerequisites
  first).
- When `discoveredFrom` is present, add a visually distinct edge kind; it
  must not break acyclic layout. If a cycle appears, drop discovery edges
  from the layout graph and keep them for drawing as annotations, or fall
  back to a stable grid. Dep cycles are a store defect; still show nodes.
- Node weights carry display fields needed for badges (status, stage,
  claim, priority, category). Those weights may update without rebuilding
  topology.

### layout-rs

- Run Sugiyama layered layout on the topology graph.
- Outputs world coordinates per node (and edge route points when used).
- Configuration stays boring: default rank direction top-to-bottom or
  left-to-right; document the choice in code. P1a picks one and sticks.

### Canvas

- Map world positions through the viewport to ratatui `Canvas` with
  `Octant` or `Braille` markers.
- Draw edges first, nodes second, selection highlight last.
- Pixel upgrade on Kitty (`ratatui-image`) is optional and must consume the
  same world positions. True 3D is out of P1a.

### Recompute vs cache

Cache the layout result keyed by topology fingerprint.

**Topology fingerprint** includes:

- sorted task ids
- sorted dep edge set `(from, to)`
- sorted discovery edge set when those edges participate in layout

**Recompute layout when:**

- topology fingerprint changes
- first layout for a project
- explicit operator "re-layout" action (optional)

**Do not recompute layout when:**

- pan or zoom changes
- selection changes
- status, stage, priority, claim, or other display-only field changes
- `generatedAt` advances without topology change
- window resize (only viewport/canvas bounds change; optional label
  reflow is not a full Sugiyama recompute)

On display-only updates, mutate node weights and redraw. On topology
change, recompute, then attempt to preserve pan/zoom if the previous
selected node still exists; otherwise reset viewport to fit
`world_bounds`.

## Claims

Item 7 owns claim primitives on disk. P1a is read-only and must run before
or without item 7.

### Optional / degraded display

- When a task's snapshot object includes `claim: { by, at }`, show the
  holder badge and active styling (pulse when status is active).
- When `claim` is absent, missing, or the whole store is pre-item-7, show
  no holder. This is degraded, not an error.
- When `.claim/claim.json` was unreadable or malformed, snapshot omits
  `claim`; the UI matches that omission and does not invent a holder.
- Top-level `maxParallelTasks` is optional; ignore when absent.

### Forbid side claim systems

- MUST NOT create a parallel claim file, lock, or UI-only claim table.
- MUST NOT write claim state from `jeffd` or `jeff graph` in P1a.
- MUST NOT treat a missing claim as "claimable" by forging local state.
- Claim-aware actions (claim, release, open-in-host) wait for P3 after
  item 7. P1a is observe-only for claims.
- Visible claims come only from the snapshot projection of
  `.claim/claim.json` (via `cook snapshot --json`).

## Mechanical acceptance checks

Operators and CI can tick these for P1a graph alone. Runtime tasks implement
them; this design task only defines them.

1. `control/` workspace builds the `jeffd` and `jeff` binaries without being
   in the npm package `files` list.
2. `jeffd start` listens on `~/.jeff/jeffd.sock` (or `JEFFD_SOCK`);
   `jeffd status` reports live; `jeffd stop` removes the listener cleanly.
3. `jeff graph [project]` launches a standalone full-screen graph TUI for a
   registered or path-selected project.
4. Graph data is produced only through `cook snapshot --json` (cwd = project
   root). No Rust code parses task ledgers or claim files.
5. FS changes under `.jeff/` debounce/coalesce in a 100–200 ms window and
   resnapshot only the project whose files changed.
6. Zoom and pan update the viewport every frame without Sugiyama recompute;
   topology id/dep changes recompute layout; status-only updates do not.
7. Mouse click hit-tests cell → world → node; keyboard can select the same
   nodes (tab cycle and/or fuzzy jump).
8. Missing claims degrade cleanly (no holder badge); no side claim system
   exists in code or on disk from this phase.
9. Socket protocol speaks NDJSON envelopes with `req`/`res`/`event`,
   `snapshot.get` / `snapshot.subscribe`, and `snapshot.replaced` /
   `project.updated` events.
10. `schemaVersion` gate rejects unsupported snapshot majors with a clear
    operator error; older jeff missing `snapshot` fails closed without
    ledger parse.
11. Bare `jeff` is help-only; it does not open a combined multi-pane shell.
12. Kitty composition of separate `jeff graph` processes is documented as
    supported; P1a does not require a Ratatui multi-pane shell.

Non-goals reminder: backlog file formats and multi-writer append strategy
are deferred to P1b and MUST NOT appear as required checks above.

## Implementation order (guidance)

1. Freeze and dogfood `cook snapshot --json` against real stores (item 8).
2. Scaffold `control/` workspace with `jeff-project` types matching the
   snapshot document.
3. `jeffd`: registry load, spawn snapshot, debounce, socket, in-memory cache.
4. `jeff graph`: connect, subscribe, render Canvas from layout pipeline.
5. Viewport + hit-test + keyboard parity.
6. Claims degraded badges when present.
7. Tick mechanical acceptance; only then consider P1b design.

## Doc control

- Path: `docs/specs/jeff-graph-p1a.md`
- Phase: P1a only (standalone `jeff graph`)
- Does not supersede vision, handoff, slate, or state schema
- Prose contract: `tests/jeff-graph-p1a-spec.bats`
