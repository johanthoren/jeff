# Jeff Control: implementation handoff

Status: **handoff brief**. Author of record: Johan, session of 2026-08-02.
Successor: a different frontier model (Grok 4.5 at time of writing) picks up
implementation from here.

This file plus the repository is the complete input. No conversation history
and no assistant memory are needed or may be assumed. If something appears to
require knowledge outside this repo, treat it as a spec defect: stop and ask
Johan rather than guessing.

## 1. Read these first, in order

1. `AGENTS.md`: iron rules.
2. `docs/specs/control-plane-vision.md`: the product vision. Sections 4
   (locked decisions), 6.3 (TUI layout, graph feasibility survey, interaction
   model), 10 (runtime and coexistence), 15 (invariants), 16 (phases),
   18 (architecture review findings) carry the load.
3. `docs/specs/graph-slate-6.0.md`: the method track. Item 7 (`cook all`
   drain primitives) and item 8 (`cook snapshot`) are the dependencies.
4. `skills/cook/reference/jeff-state-schema.md`: ledger shapes item 8
   projects.
5. `docs/maintaining-jeff.md`, `skills/cook/SKILL.md`: method mechanics.

## 2. What was decided (do not relitigate without Johan)

- **TUI first.** Rust plus ratatui client; the web dashboard is a later
  project and a second client on the same protocol. Reason: a browser client
  invites indefinite polish, and a localhost HTTP API is a forged-grant
  surface (vision 18.1.2). A unix socket makes auth a file-permissions
  question.
- **Rust `jeffd`**, long-lived local daemon, unix socket, JSON requests plus
  event stream.
- **`jeffd` never parses ledgers.** All reads and writes go through each
  project's own installed `cook`. This is the load-bearing constraint: it
  keeps schema knowledge in one place and makes the backend immune to
  per-project jeff version skew.
- **Code home:** Rust workspace in `control/` in this repo. Never added to
  the npm `files` allowlist in `package.json`. The CLI-only boundary is
  enforced by the language wall: Rust cannot import the ESM internals, so
  exec'ing `cook` is the only coupling channel that exists.
- **Client shape:** standalone full-screen TUIs first for short time to
  value. Ship `jeff graph`, then `jeff backlog`, then further verbs as
  earned; bare `jeff` combined view last. Kitty composition of standalone
  processes is valid from day one. Ratatui multi-pane composition is late
  and optional. Design shared widgets and projection for later reuse; do
  not build the combined shell up front. Operator language for the second
  TUI is **backlog** (not an "inbox" product name); disk `.jeff/inbox/` may
  remain attention plumbing later.
- **Graph:** zoomable canvas in the standalone `jeff graph` TUI. Leaning
  layered 2D (`petgraph` model, `layout-rs` Sugiyama coordinates, ratatui
  `Canvas` with `Octant`/`Braille` markers, zoom and pan by rescaling
  `x_bounds`/`y_bounds`), with a pixel upgrade on Kitty via `ratatui-image`
  through the same layout pipeline. True 3D via `bevy_ratatui_camera` is
  confirmed feasible and remains open question 17.1. Survey table with
  maintenance status is in vision 6.3.
- **Input:** mouse and keyboard both first-class. Click selects, wheel zooms,
  tab cycles, a nucleo-class fuzzy finder jumps to any task, project, or open
  card. Every mouse action has a keyboard path and vice versa.
- **Decision cards are projections of ledger state**, not a second durable
  store (vision 18.1.1). This is the single most important correctness
  decision in the backlog / attention design.

## 3. Dependency state, as of this handoff

| Piece | State |
|---|---|
| Item 7 (`cook ready`/`claim`/`release`/`claims`, `.claim`, `maxParallelTasks`, drain loop) | specified in the slate, **not implemented** |
| Item 8 (`cook snapshot --json`) | specified in the slate as `6.0.0-alpha.8`, **not implemented**; core has no hard item 7 dependency and may be pulled forward |
| Journal (item 3) | implemented; append-only `journal.jsonl` per task dir, tailable |
| `cook approve` | shipped; byte-matched boundary, requester is not granter |
| `jeffd`, TUI, registry, backlog surface | **nothing exists**; no daemon, watcher, HTTP surface, or home-level state anywhere in the repo today |

What is startable without item 7: the design spec biased to **P1a standalone
`jeff graph` alone**, item 8, vision phase P1a (projector, registry, graph
TUI, claims degraded), then P1b (`jeff backlog`). Broader backlog card work
and joint attention follow. Blocked on item 7: P3 (claim-aware UI, open in
host) and P4 (autodrain). Never ship a side claim mechanism to work around
this.

## 4. Recommended first move: cook item 8 before designing against it

Item 8 (`cook snapshot --json`) is the true unblocker for phase P1a
(standalone `jeff graph`), and it is small, self-contained, and read-only.
Cook it in this repo first, through the normal jeff pipeline, before or
alongside drafting the design spec. Two reasons:

1. The Rust work then builds against a **real** contract with real output,
   not a specified one. Every protocol decision downstream inherits the
   snapshot document shape; discovering it is wrong after the backend exists
   is expensive.
2. It is a clean, low-risk warm-up task on the method itself: a normal cook
   cycle in JavaScript, exercising the pipeline before the two-language work
   starts.

Item 8's core has no hard dependency on item 7, so pulling it forward ahead
of the drain work is legal per the slate's sequencing note. The item 7 fields
(`claim`, `maxParallelTasks`) simply stay absent until item 7 lands.

Do not begin the Rust workspace before the snapshot document shape is
settled, either by cooking item 8 or by Johan explicitly freezing the shape
in the design spec.

## 5. Immediate next deliverable

**A self-contained design spec for P1a standalone `jeff graph`**, written to
the standard `docs/specs/graph-slate-6.0.md` sets: cold-context,
contract-first, mechanically checkable. Bias this first design-spec
deliverable to the graph TUI alone; do not scope the full three-card or
combined shell up front (that composition is optional and late). It must
define at minimum:

1. Socket protocol: transport, framing, request and response schemas, event
   frames, versioning rule (enough for graph projection).
2. The `cook` invocation contract: exact commands, expected exit codes,
   parse failure and version skew handling, and what happens when a project's
   jeff is older than the snapshot schema the backend expects.
3. Crate layout under `control/` for backend plus the `jeff graph` client.
4. Projection and cache model, including the debounce and coalesce rules in
   section 6 below.
5. Viewport math for the standalone graph TUI: world coordinates, zoom
   levels, pan bounds, and the hit-test transform that maps a mouse cell
   back to a node. This is owned code; no crate provides it.
6. Layout pipeline: `petgraph` model to `layout-rs` coordinates to canvas
   space, and when layout is recomputed versus cached.
7. Mechanical acceptance checks for P1a (graph alone). Backlog file formats
   and multi-writer append strategy wait for the P1b design pass.

## 6. Performance guidance (asked and answered 2026-08-02)

Concern raised: does the CLI boundary bottleneck on large graphs?

Assessment: no, and the fix is not to break the boundary. The cost is one
process spawn plus a JSON parse, paid per project per change-burst, not per
frame. The TUI renders from an in-memory model. At jeff scale (hundreds of
tasks) that is a few hundred KB of JSON and roughly 50 to 100 ms of Node
startup.

Mitigations, apply in this order and only as measurement demands:

1. Debounce and coalesce FS events (100 to 200 ms window).
2. Re-snapshot only the project whose files changed.
3. Add `cook snapshot --task <id>` for the common case of a single
   `task.json` changing. This is an additive item 8 extension.
4. Only if the above proves insufficient: a long-lived
   `cook snapshot --watch` streaming NDJSON, so Node startup is paid once per
   project rather than per burst.

Expect layout recompute, not the CLI, to be the first real bottleneck. Cache
the layout and recompute only when graph topology changes, not on pan, zoom,
selection, or status-only updates.

Do not "optimize" by parsing ledgers directly in Rust. That trades a bounded
latency problem for an unbounded correctness problem across jeff versions.

## 7. Working agreement for the successor

- Method rules bind this work: builder and judge separation, RED-proven
  tests before implementation, independent review, no self-assessment. The
  Rust workspace does not exempt anything.
- Authored-text rules bind too: no em dashes, no AI or assistant
  attribution, imperative commit first lines of at most 50 characters,
  artifacts refer to "Johan" or "the operator" and never use kitchen persona
  speech.
- Johan approves every merge. Never merge or push a protected base.
- Rust CI is a separate path-filtered workflow. Never mark its `control` job a
  required status check in branch protection: a `paths:`-filtered
  `pull_request` workflow does not run at all on a pull request touching no
  matching path, so it reports no status rather than a passing one, and every
  Node-only pull request would then wait forever on a check that never
  arrives.
- Do not tag crate releases initially: the repo's bare-version tag namespace
  belongs to the npm method releases.
- Queue the phases as jeff tasks in this repo's `.jeff/`. That is deliberate:
  building Jeff Control becomes the first real workload for the item 7
  `cook all` drain, so the alpha.7 dogfood gate and this track converge
  instead of serializing (vision section 16).

## 8. Open questions carried forward

Vision section 17 holds the live list. The two that most affect early
implementation: the graph rendering tier (17.1) and the backend binary naming
and front door (17.6).
