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
- **Layout:** three cards. Chat spans the full left width; inbox cards and
  selected-node detail share the row below; the task graph takes roughly the
  right third, ratio-based and adapting to terminal width.
- **Graph:** zoomable canvas. Leaning layered 2D (`petgraph` model,
  `layout-rs` Sugiyama coordinates, ratatui `Canvas` with `Octant`/`Braille`
  markers, zoom and pan by rescaling `x_bounds`/`y_bounds`), with a pixel
  upgrade on Kitty via `ratatui-image` through the same layout pipeline. True
  3D via `bevy_ratatui_camera` is confirmed feasible and remains open
  question 17.1. Survey table with maintenance status is in vision 6.3.
- **Input:** mouse and keyboard both first-class. Click selects, wheel zooms,
  tab cycles, a nucleo-class fuzzy finder jumps to any task, project, or open
  card. Every mouse action has a keyboard path and vice versa.
- **Decision cards are projections of ledger state**, not a second durable
  store (vision 18.1.1). This is the single most important correctness
  decision in the inbox design.

## 3. Dependency state, as of this handoff

| Piece | State |
|---|---|
| Item 7 (`cook ready`/`claim`/`release`/`claims`, `.claim`, `maxParallelTasks`, drain loop) | specified in the slate, **not implemented** |
| Item 8 (`cook snapshot --json`) | specified in the slate as `6.0.0-alpha.8`, **not implemented**; core has no hard item 7 dependency and may be pulled forward |
| Journal (item 3) | implemented; append-only `journal.jsonl` per task dir, tailable |
| `cook approve` | shipped; byte-matched boundary, requester is not granter |
| `jeffd`, TUI, registry, inbox | **nothing exists**; no daemon, watcher, HTTP surface, or home-level state anywhere in the repo today |

What is startable without item 7: the design spec, item 8, vision phase P1
(projector, registry, graph TUI, claims degraded), and most of P2 (inbox,
cards). Blocked on item 7: P3 (claim-aware UI, open in host) and P4
(autodrain). Never ship a side claim mechanism to work around this.

## 4. Immediate next deliverable

**A self-contained design spec for the control plane**, written to the
standard `docs/specs/graph-slate-6.0.md` sets: cold-context, contract-first,
mechanically checkable. It must define at minimum:

1. Socket protocol: transport, framing, request and response schemas, event
   frames, versioning rule.
2. The `cook` invocation contract: exact commands, expected exit codes,
   parse failure and version skew handling, and what happens when a project's
   jeff is older than the snapshot schema the backend expects.
3. Crate layout under `control/`.
4. Projection and cache model, including the debounce and coalesce rules in
   section 5 below.
5. Viewport math for the graph pane: world coordinates, zoom levels, pan
   bounds, and the hit-test transform that maps a mouse cell back to a node.
   This is owned code; no crate provides it.
6. Layout pipeline: `petgraph` model to `layout-rs` coordinates to canvas
   space, and when layout is recomputed versus cached.
7. Inbox file formats and the multi-writer append strategy (reuse the
   existing mkdir-lock primitive family, or per-message files).
8. Mechanical acceptance checks per phase.

## 5. Performance guidance (asked and answered 2026-08-02)

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

## 6. Working agreement for the successor

- Method rules bind this work: builder and judge separation, RED-proven
  tests before implementation, independent review, no self-assessment. The
  Rust workspace does not exempt anything.
- Authored-text rules bind too: no em dashes, no AI or assistant
  attribution, imperative commit first lines of at most 50 characters,
  artifacts refer to "Johan" or "the operator" and never use kitchen persona
  speech.
- Johan approves every merge. Never merge or push a protected base.
- Rust CI is a separate path-filtered workflow. Do not tag crate releases
  initially: the repo's bare-version tag namespace belongs to the npm method
  releases.
- Queue the phases as jeff tasks in this repo's `.jeff/`. That is deliberate:
  building Jeff Control becomes the first real workload for the item 7
  `cook all` drain, so the alpha.7 dogfood gate and this track converge
  instead of serializing (vision section 16).

## 7. Open questions carried forward

Vision section 17 holds the live list. The two that most affect early
implementation: the graph rendering tier (17.1) and the backend binary naming
and front door (17.6).
