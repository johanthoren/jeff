# Control plane vision: Jeff beside the terminal

Status: **vision / parallel track**. Not scheduled implementation.
Author of record: Johan (the Chef), completed with the working session of
2026-08-02.
Baseline method: jeff as of the graph slate (`docs/specs/graph-slate-6.0.md`)
and the design rationale (`docs/specs/jeff-design.md`).

This document completes a product vision that sits **beside** the method, not
inside it. It does not weaken iron rules, replace host sessions, or schedule
work against the 6.0 alpha track. Implementation waits for the item 7 dogfood
(a real `cook all` drain in this repo) unless Johan explicitly reopens that
gate.

Audience: Johan and any frontier-class model continuing this track. The file
plus the repository is the complete input.

## 1. Problem

Jeff today is excellent inside one host chat session and one project checkout.
It is weak as an operator surface:

1. **No live multi-project picture.** The Chef tab-dances across Kitty tabs
   (OMP, Claude Code, other projects) to notice interruptions.
2. **No shared attention channel.** Approvals, capture forks, blocked
   handoffs, and freeform steering live inside whichever session happened to
   raise them.
3. **No optional autonomous drain UI.** Graph-slate item 7 adds `cook all`
   primitives and a prose drain loop; nothing yet watches new tasks, claims
   ready work, and surfaces lane stops in one place while the Chef still uses
   ordinary terminals.

The Chef still wants the terminal hosts. The missing product is a **control
surface** that can sit beside them.

## 2. North star

Keep cooking in **OMP and Claude Code** (and Pi/Codex when used). Beside them
runs a local **Jeff Control** stack:

- a multi-project terminal control client (TUI) with live task graphs; a web
  dashboard is a possible later client on the same protocol
- a project inbox that is real Chef↔Jeff chat, including structured decisions
- an optional global attention view so the Chef is not forced into tab-dance
- an optional autonomous drain supervisor
- a small CLI that starts and stops the backend

Disk under each project’s `.jeff/**` remains the only source of truth for the
method. The control plane observes, steers, claims, launches hosts, and may
drive drain. It does not become a second quality plane, state database, or
judgment authority.

## 3. Relationship to the method and to 6.0

### 3.1 Method stays sovereign

Iron rules still bind:

- thin orchestrator that never self-judges
- builder/judge separation and fresh specialists
- durable truth on disk; plain files
- specialists inherit the orchestrator model by default; host-native effort
- `cook validate` and the done-gate remain mechanical

The control plane is a **hybrid surface**:

- projection and inbox work even when no drain is running
- a managed runtime **may** drive `cook all`
- a normal host session can still cook a project with the backend off

### 3.2 Dependency on graph slate item 7

Autonomous drain and honest multi-driver coexistence require item 7’s
primitives:

- `cook ready`
- `cook claim` / `cook release` / `cook claims`
- `.claim` holder records
- `maxParallelTasks`
- worktree-per-concurrent-task rule
- journal-backed resume (item 3)

The backend's read contract is slate item 8, `cook snapshot --json`: a
versioned, additive-only JSON projection. It shipped in `6.0.0-alpha.6`,
pulled forward ahead of items 6 and 7 because its core has no hard dependency
on item 7; the claim fields stay absent until item 7 lands.

Until those exist and dogfood, this vision is spec-only. The dashboard may
later read today’s ledgers in a degraded read-only mode; it must not invent a
parallel claim system.

### 3.3 What this is not

Parked non-goals for this vision:

- replacing OMP/Claude/Pi/Codex as specialist hosts
- multi-user auth, teams, or a hosted SaaS control plane
- beads/Dolt/LangGraph/Temporal as the task substrate
- per-subagent model pickers (reopens a settled method rule)
- mobile/Slack bridges in v1
- making the backend mandatory for jeff to function

## 4. Outcomes locked in discussion

| Topic | Decision |
|---|---|
| Product role | Hybrid: disk truth; optional managed drain; host sessions remain first-class |
| Orchestrator home | Host-neutral contracts: OMP, Claude Code, Pi, Codex, or a jeff-owned drain driver |
| OMP | Preferred dogfood host later; not required for projection-only use; terminals and autodrain side by side |
| Graph | Linked views: project task DAG + per-task stage pipeline |
| Inbox | Full two-way Chef↔Jeff chat, with structured decision cards |
| Inbox identity | Project inbox is canonical and standalone; optional global attention/chat overlays all active projects |
| Inbox persistence | `.jeff/inbox/` inside each project |
| Multi-project discovery | Explicit registry file (home-level) |
| Coexistence | Task-level exclusive claim (not project-wide single writer) |
| Model levers | Orchestrator/driver only; specialists inherit model by default; role frontmatter owns effort where supported |
| Drain brain | Hybrid: mechanical ready/claim/launch loop; standby Jeff brain per project while autodrain is on or inbox needs a reply |
| Host launch | Claim task, then launch host in that repo/worktree already bound to the task |
| Scheduling | Spec now; implement after the item 7 drain dogfood |
| First artifact | This vision doc only |
| Client (2026-08-02 follow-up) | TUI-first (Rust, ratatui); web dashboard is a later project, a second client on the same protocol |
| Backend (2026-08-02 follow-up) | Rust `jeffd`; unix-socket API; never parses ledgers, invokes each project's own `cook` for reads and legal writes |
| Client shape (2026-08-02 follow-up) | Standalone full-screen TUIs first for short time to value: `jeff graph`, then `jeff backlog`, then further verbs as earned; bare `jeff` combined view last. Kitty multi-pane composition is valid from day one; Ratatui multi-pane composition is late and optional. Design shared widgets and projection for later reuse; do not build the combined shell up front. |
| Input (2026-08-02 follow-up) | Mouse and keyboard both first-class: click selection, tab cycling, fuzzy-find jump to any task/project/card |
| Code home (2026-08-02 follow-up) | Rust workspace folder `control/` in this repo, outside the npm `files` allowlist; CLI-only boundary enforced by the language wall and the item 8 contract |

## 5. Field survey: steal semantics, not dependencies

Mid-2026 adjacent systems were surveyed for operator-surface patterns. Jeff’s
niche (mechanically enforced quality gates with builder/judge separation)
remains unoccupied. Useful semantics:

| Pattern | Sources | Steal for Jeff Control |
|---|---|---|
| Atomic task claim, not global mutex | Beads / Gas Town; jeff item 7 | One holder per task via `.claim` |
| Worktree isolation per concurrent task | Gas Town, Bernstein, item 7 | Already specified in the slate |
| Unified human inbox for permissions and interrupts | octomux, Codecast | One attention surface for decisions + steer |
| Persistent coordinator persona beside workers | Gas Town Mayor | Project Jeff in the inbox |
| Graph view + interrupt payloads | LangGraph/LangSmith Studio; Temporal HITL | Task DAG, stage graph, decision cards with exact resume actions |
| Session fleet / multi-project switcher | Jean, octomux | Live “who holds what” without replacing the terminal |
| Deterministic ready-set; LLM only inside a claimed unit | Bernstein; item 7 `cook ready` | Mechanical drain loop; Jeff routes within a claim |
| Durable wait for human input | Temporal signals/approvals | Parked lane + inbox card; no busy loop |

Explicit non-adoptions from the same survey (already settled in the graph
slate): beads/Dolt as substrate; LangGraph-style graph runtimes; Temporal as
the execution engine. Steal behavior; keep plain files and jeff’s validator.

## 6. Product surfaces

### 6.1 Terminal host (unchanged class of tool)

OMP, Claude Code, Pi, or Codex running Jeff interactively.

- deep capture and hard calls
- ad-hoc explore work under ambient entry rules
- first-class forever
- may claim tasks and advance them without the dashboard

### 6.2 Control backend (`jeffd` or equivalent)

Long-lived local daemon, written in Rust (launchd agent on macOS),
started/stopped by CLI. Responsibilities:

1. read the home project registry
2. watch registered projects’ `.jeff/**` and project inboxes
3. expose a live projection API (unix socket: JSON requests + event stream)
4. own optional drain supervisors
5. launch or attach host sessions for claimed tasks
6. hold driver model/effort settings for managed runtimes

Two hard constraints:

- **`jeffd` never parses ledgers.** Projection and mutation go through each
  project's own installed `cook` (`cook snapshot --json` per slate item 8,
  `cook ready`, `cook claims`, `cook claim`/`release`/`approve`/
  `journal`). Schema knowledge stays in one place and the backend is immune
  to per-project jeff version skew. FS events only trigger a re-read.
- **Drivers tail inbox files themselves.** `jeffd` writes inbox messages on
  behalf of its own clients and projects the files; it is not a delivery
  channel that can diverge from disk (finding 18.2).

It is **not** the authority on task legality. `cook validate`, ledgers, and
host Jeff sessions remain authoritative.

### 6.3 Control TUI (v1 client)

Rust ratatui client over the backend socket. Where this doc says "dashboard",
read "control client": TUI now, web later.

**Standalone full-screen TUIs first.** Ship focused verbs before any combined
shell. Order:

1. **`jeff graph`**: live task DAG for a project (or the selected registered
   project). Zoomable canvas, claims, drain state when known, selected-node
   detail. This is P1a and the first operator win.
2. **`jeff backlog`**: attention and work queue across watched projects (and
   useful on a single unwatched checkout). Operator language is **backlog**,
   not a separate "inbox" product name. Disk `.jeff/inbox/` may remain
   attention plumbing later; do not brand this TUI as inbox.
3. Further standalone verbs as earned (drain controls, project registry UX).
4. Bare **`jeff`** combined multi-pane shell last, only if composition earns
   its keep after the standalone verbs ship.

Kitty composition (separate OS windows or Kitty tabs/panes running the
standalone verbs side by side) is valid from day one and is the early way to
run graph and backlog together. Design shared widgets and the projection
model so Ratatui multi-pane composition can happen later; defer that
composition. Short time to value wins over building a combined shell up front.

Surfaces the standalone clients cover over time:

- home / multi-project: attention counts, registry (backlog and later home)
- project graph: live DAG, claims, drain state, node detail (`jeff graph`)
- backlog: structured decisions, steer targets, joint attention (`jeff backlog`)
- levers for orchestrator model/effort on managed drivers
- completed-task toggle on the graph

#### Optional late combined sketch

A three-card multi-pane layout remains an **optional late** combined-shell
sketch only. It is not the P1 default and is not required before standalone
`jeff graph` and `jeff backlog` ship. If bare `jeff` composition happens, one
candidate arrangement is:

```text
┌──────────────────────────────┬───────────────┐
│ Chef↔Jeff chat               │               │
│ (full left width)            │  task graph   │
│                              │  (~right      │
├──────────────┬───────────────┤   third)      │
│ backlog      │ selected-node │               │
│ cards        │ detail        │               │
└──────────────┴───────────────┴───────────────┘
```

In that late sketch, chat would span the left side; open backlog cards and
selected-node detail would share the row below; the graph would take roughly
the right third. Splits would be ratio-based. None of this is first-ship
layout. The graph surface itself (standalone or composed later) is a zoomable
canvas (feasibility survey below); a dense tree projection remains as a
fallback for narrow terminals.

#### Graph pane feasibility survey (2026-08-02)

Confirmed: a zoomable, even 3D-rendered, graph view inside a ratatui pane is
feasible, with prior art at every layer. No single crate ships the whole
thing, so the layout-plus-viewport composition is owned code.

| Layer | Prior art | Status |
|---|---|---|
| Graph model | `petgraph` | v0.8.x, standard |
| Layout | `layout-rs` (Sugiyama layered) | maintained, ~573K dl/month; right shape for DAGs. Force-directed alternatives: `forceatlas2` maintained, `fdg` in rewrite limbo |
| Render, baseline | ratatui `Canvas` with `Octant`/`Braille` markers; zoom/pan = rescaling `x_bounds`/`y_bounds` per frame (core demo pattern) | in ratatui core; ~2x4 sub-cell resolution |
| Render, pixel upgrade | `ratatui-image` over the Kitty graphics protocol; production prior art: `serie` draws git DAGs as in-terminal images | QA-clean on Kitty ≥0.28; halfblock fallback elsewhere |
| Render, true 3D | `bevy_ratatui_camera` (Bevy scene into a ratatui widget; proven by `ttysvr`); `ratatui-plt` `Camera3DState` | possible; costs a Bevy-scale dependency, 24-bit color required |
| Node-graph widgets | `tui-nodes` (caller-positioned, cycle panics), `ratatui-flow` fork (pan only, very new) | closest existing widgets; none sufficient alone |

Leaning: layered 2D canvas with an owned zoom/pan viewport as baseline, pixel
upgrade on Kitty through the same layout pipeline. True 3D is confirmed
possible; whether it earns the Bevy-scale dependency is open question 17.1.
Because the viewport and layout composition is owned code, the design spec
for `jeff graph` must define the viewport math and layout pipeline exactly.

#### Interaction model

Mouse and keyboard are both first-class:

- **Mouse:** click selects any node, card, or message; wheel zooms the graph
  viewport. Graph clicks hit-test back through the viewport transform, which
  is a second reason that transform is specced exactly. Standard crossterm
  mouse capture.
- **Keyboard:** tab/shift-tab cycle focus and selectable elements; a fuzzy
  finder (nucleo-class matcher) jumps directly to any task, project, or open
  decision card. The fuzzy index is client-side, built over the same
  snapshot data the protocol already carries.

Every action reachable by mouse must have a keyboard path, and vice versa.

Visual bar: calm, dense, legible. Active claimed tasks pulse. Blocked / awaiting
Chef states are unmistakable. This is an operator instrument cluster, not a
marketing page.

### 6.4 CLI

Shape (names may change; verbs matter):

```text
jeffd start | stop | status
jeff graph [project]                 # standalone full-screen graph TUI (P1a)
jeff backlog [project]               # standalone full-screen backlog TUI
jeff                             # optional late combined shell; not first ship
jeff project add <path> | list | rm <id>
jeff drain on | off [project]
jeff claim-status [project]          # thin sugar over cook claims, optional
```

`jeffd start` brings up the backend. `jeff graph` and `jeff backlog` attach
standalone TUI clients (Kitty composition of those processes is fine early).
Bare `jeff` is reserved for a later combined client if Ratatui composition
earns it. Project add/list/rm edits the registry only. Drain toggles are per
project.

### 6.5 Web dashboard (later project)

A second client on the same socket protocol; out of scope for v1. When it
ships, review finding 18.1.2 re-attaches: browser auth (token plus strict
Origin checks) before any mutating endpoint is exposed over HTTP.

## 7. Multi-project registry

Explicit file, home-scoped, for example:

```text
~/.jeff/projects.json
```

Conceptual fields per entry:

- stable `id`
- absolute `path`
- display `name`
- `enabled`
- optional defaults: `autodrain`, preferred host launch (`omp` | `claude` | …),
  orchestrator model/effort for managed drivers

No filesystem crawl as the primary discovery mechanism. A later helper may
propose candidates by scanning known code roots; the registry remains the
source of truth for what the dashboard owns.

A project always stands alone: its `.jeff/` ledgers and `.jeff/inbox/` are
sufficient without the home registry. The registry only teaches the control
backend which roots to watch.

## 8. Graph model

### 8.1 Project canvas (task DAG)

- **Nodes:** tasks
- **Edges:** `deps` and `discoveredFrom` (item 6), visually distinct
- **Node state:** pending, ready, claimed/active (pulse), blocked, awaiting
  Chef, done (hidden unless completed toggle is on)
- **Badges:** priority, stage, claim holder label, category (`code` |
  `operation`)

### 8.2 Task detail (stage pipeline)

Clicking a task node opens a detail surface:

- category-specific stage pipeline as nodes/edges
- current stage emphasis
- active specialist identities and brain evidence when known
- recent journal events (item 3) when present
- findings, kickbacks, approvals summary
- actions:
  - open in host (claim + launch)
  - release claim (Chef-explicit)
  - steer / message Jeff about this task
  - method-legal lifecycle actions only (no forged done)

### 8.3 Projection rules

- Prefer live reads of `task.json`, claims, journal tails, and inbox heads.
- Cache is allowed for UI smoothness; on conflict, disk wins and the UI
  resyncs.
- `cook validate` does not need to understand the dashboard. Operational files
  the method already ignores (`.claim`, locks, inbox) stay outside validated
  ledger contracts unless a later schema item deliberately includes them.

## 9. Inbox

### 9.1 Project inbox (canonical)

Path: `.jeff/inbox/` inside the project.

This is full two-way Chef↔Jeff chat for that project, not a ticket list with a
compose box bolted on.

**Message kinds**

| Kind | Blocking? | Role |
|---|---|---|
| `chat` | no | Freeform Chef or Jeff narration |
| `steer` | no | Non-blocking instruction (“pause drain”, “prefer X”) |
| `decision` | yes | Structured card that parks a lane or method step until answered |
| `system` | no | Backend notes (stale claim aged out of silence, host launch failed, …) |

**Decision cards** carry:

- project id, task id when applicable
- cold-context grounder (same spirit as method Chef-facing asks)
- machine `action` / resume contract (for example exact `cook approve`
  mutation text, fork options, release-claim confirmation)
- UI affordances that call real method/CLI paths

The inbox **must not forge grants**. Approvals still flow through
`cook approve <id> <operator>` provenance rules. The card is a frontend to the
legal path.

### 9.2 Standalone project guarantee

Any single project must work with:

- only its `.jeff/` tree
- an interactive host session and/or local drain
- no global dashboard running

Global views are optional overlays, never required substrate.

### 9.3 Optional global attention and joint chat

To end the tab-dance, the dashboard home may provide:

1. **Global attention bar**  
   Cross-project count of unread blocking decisions and stale claims.
2. **Joint Jeff chat**  
   A single Chef-facing stream where messages from all **active/enabled**
   projects surface, each clearly tagged with project (and task when relevant).

Rules for the joint view:

- it is a **merge of project inboxes**, not a third transcript authority
- sending from the joint view always targets exactly one project inbox
  (explicit project context or reply-to-thread)
- muting or focusing a project is a UI filter; it does not delete project
  history
- a project with autodrain off and no live driver still surfaces blocking
  cards if something wrote them (for example a host session)

### 9.4 Persistence detail

Recommended layout (illustrative):

```text
.jeff/inbox/
  transcript.jsonl      # append-only chat + system + steer
  open/                 # one file per unresolved decision card
  archive/              # resolved cards
```

Operational data: gitignore by default in dogfood; not validated ledger state.
Exact filenames are implementation detail; the invariants are append-only
history, durable open decisions, and project-local storage.

## 10. Runtime model and coexistence

### 10.1 Roles

| Role | Writes task progress? | Notes |
|---|---|---|
| Observer (dashboard/backend projection) | no | FS watch + API |
| Interactive driver (host Jeff session) | yes, for claimed tasks | OMP/Claude/Pi/Codex |
| Drain supervisor | yes, for claimed tasks | optional per project |
| Lane worker / specialist | yes, under a claim | fresh contexts as today |

### 10.2 Coexistence rule (task-level exclusive claim)

Successful multi-agent systems converge on **claim the unit of work**, not
“one brain owns the whole repo.”

1. Any driver that advances a task must hold `cook claim` for it.
2. Interactive sessions and drain may share a project on **different** tasks.
3. A second claim on the same task fails; UI shows the holder label.
4. Claims never auto-break. Stale claims (item 7: aged with no journal
   progress) escalate to the inbox for Chef action.
5. “Open in OMP/Claude” from the dashboard:
   - if the Chef/session already holds the claim → launch/attach in that
     worktree
   - if free → claim, then launch host bound to the task
   - if held by another driver → no silent steal; offer explicit release +
     reclaim only as a Chef action
6. Autodrain is per project (`on`/`off`). When on, the supervisor runs the
   item-7 loop. A Chef-facing stop parks **that lane only**; other lanes
   continue; the stop becomes a decision card.

Project-wide single-writer is rejected for this vision because it fights
“terminal + autodrain side by side.”

### 10.3 Drain supervisor (hybrid brain)

Two cooperating pieces:

**A. Mechanical loop (always, while autodrain on)**

- read `cook ready` / `cook claims`
- respect `maxParallelTasks`
- claim, journal intent, open lane/worktree
- integrate serially on trunk per item 7
- release claim
- never judge quality; never skip gates

**B. Standby Jeff brain (per project, conditional)**

Alive while:

- autodrain is on, or
- the project inbox has unreplied Chef chat / open decisions that need Jeff

Responsibilities:

- run the orchestrator role inside a claimed lane (dispatch specialists via
  host adapter)
- narrate drain progress into the project inbox
- turn method escalations into decision cards
- answer Chef chat and apply steer notes at safe points

When autodrain is off and the inbox is idle, no standby brain need run. The
backend can still project disk state.

### 10.4 Host launch contract

Dashboard/CLI action “open task in host”:

1. resolve project path and task worktree rule (main checkout vs linked
   worktree per item 7)
2. ensure claim held by this launch (`by` label names host + session)
3. exec host with cwd and task binding (exact flags are host-specific adapters)
4. record launch in inbox/system projection so the graph shows the holder

Failure to launch leaves the claim only if the claim step succeeded; failed
launches must surface in the UI and must not look like active work.

## 11. Model and effort levers

Dashboard levers configure the **driver / orchestrator** for managed runtimes:

- provider
- model
- effort

Specialists keep the settled method rule, owned by `skills/cook/SKILL.md` (§Dispatch):

- model selection is the orchestrator's judgment, default inherit
- Pi and Claude Code apply role-frontmatter effort where supported
- Codex children inherit orchestrator effort

No per-stage model matrix in this vision. Profile presets (named bundles of
driver model/effort) are an optional UX sugar over the same levers.

## 12. OMP and other hosts

End state the Chef wants:

- watch for new tasks on disk; if unblocked and autodrain is on, claim and
  drain
- surface operator escalations and questions through the project inbox
  (and optional global joint chat)
- still start OMP or Claude Code on a task manually
- interactive and autonomous modes live side by side

Host adapters are a thin launch + specialist-dispatch boundary, same philosophy
as `src/pi/` today:

| Host | Role in control plane |
|---|---|
| OMP | Preferred local dogfood host for launch + dispatch when chosen |
| Claude Code | Peer interactive host and launch target |
| Pi | Peer host; existing `cook_dispatch` bridge remains relevant |
| Codex | Peer host; inherits orchestrator effort as today |

Projection-only dashboard use must work with **no** host binary beyond what
the Chef already uses for interactive work. Autodrain requires at least one
configured host adapter capable of running Jeff lanes.

## 13. Architecture sketch

```text
                    ┌──────────────────────────────┐
                    │  TUI client (terminal)       │
                    │  projects · graph · inbox UI │
                    │  (later: web client)         │
                    └──────────────┬───────────────┘
                                   │ unix socket + events
                    ┌──────────────▼───────────────┐
                    │  jeffd control backend       │
                    │  registry · projector        │
                    │  inbox router                │
                    │  drain supervisors (opt)     │
                    │  host launcher               │
                    └──────┬───────────────┬───────┘
                           │               │
            ~/.jeff/projects.json          │ claim/launch/dispatch
                           │               │
         ┌─────────────────▼──┐   ┌────────▼────────┐
         │ Project A          │   │ Project B       │
         │ .jeff/tasks/**     │   │ .jeff/tasks/**  │
         │ .jeff/inbox/**     │   │ .jeff/inbox/**  │
         │ claims · journal   │   │ claims · journal│
         └─────────┬──────────┘   └────────┬────────┘
                   │                       │
         ┌─────────▼──────────┐   ┌────────▼────────┐
         │ OMP / Claude / …   │   │ drain lane host │
         │ interactive Jeff   │   │ (optional)      │
         └────────────────────┘   └─────────────────┘
```

Truth flows **up** from project disk. Commands flow **down** only through
method-legal paths (claim, record, approve, host launch, steer).

## 14. Minimum shippable architecture (ponytail cut)

When implementation is unblocked, the smallest complete system is:

1. Rust `jeffd`: FS watch, per-project `cook` projection, socket event API
2. `~/.jeff/projects.json` registry
3. TUI: project list, task graph tree, task detail, completed toggle,
   two-pane project view
4. `.jeff/inbox/` transcript + open decision cards + project chat UI
5. optional global attention bar + joint chat as a merge view
6. drain supervisor calling item-7 CLI loop with hybrid standby brain
7. host launch = claim + exec OMP/Claude in the right worktree
8. driver model/effort settings for managed runtimes only

Everything else is deferred sugar.

## 15. Invariants (blocking defects if violated)

1. **Disk is truth.** UI cache never wins over `.jeff` ledgers.
2. **No dual-drive.** Two drivers must not advance the same task without a
   claim conflict.
3. **No forged grants.** Inbox UI cannot mint operation approvals except via
   `cook approve` provenance.
4. **No gate weakening.** Dashboard convenience never skips review, audit,
   verify, or the full-suite gate.
5. **Project standalone.** Removing the home registry and stopping `jeffd`
   leaves interactive jeff fully usable in-repo.
6. **Host optional for observe.** Read-only projection must not require
   autodrain or a live Jeff brain.
7. **Claims are visible and manual to break.** Stale claims escalate; they are
   not silently deleted.
8. **Global chat is a view.** Joint transcript has no separate authoritative
   store that can diverge from project inboxes.
9. **Model inheritance is the default.** Driver levers do not become
   per-specialist model routing.
10. **Implementation waits for item-7 dogfood** unless Johan explicitly
    reopens scheduling.

Gate decision (2026-08-10): The operator explicitly reopened the P1a
implementation gate. The exception replaces only the requirement for
prerequisite dogfood to occur in this repository.

## 16. Implementation phases (after the gate)

Ordered for learning, not for calendar commitment.

Dogfood convergence (2026-08-02): queuing these phases as jeff tasks makes
Jeff Control itself the first real workload for the item-7 `cook all` drain.
The item 7 drain dogfood gate and this track then converge instead of
serializing: the drain dogfood the gate demands is the act of building P1+.

| Phase | Deliverable | Depends on |
|---|---|---|
| P0 | This vision (done) | none |
| P1a | Read-only projector + project registry + standalone `jeff graph` TUI | stable ledgers; claims optional/degraded |
| P1b | Standalone `jeff backlog` TUI (attention / decision projections) | P1a |
| P2 | Richer backlog cards + joint attention; shared widgets ready for later composition | P1b |
| P3 | Claim-aware UI + open-in-host (claim + launch) | item 7 claims |
| P4 | Autodrain supervisor + hybrid standby brain | item 7 drain dogfood + journals |
| P5 | Polish: presets, richer agent detail, host adapter pack; optional late Ratatui multi-pane / bare `jeff` combined shell if earned | P4 |
| P6 | Web client on the socket protocol (auth per 18.1.2) | P2 |

P1a ships the standalone graph before any combined client. A three-card or
other multi-pane shell is not a first-ship phase. P1a may prototype against
pre-item-7 stores as read-only. P3+ must not ship a side claim mechanism.

## 17. Open questions (deliberately unresolved)

These are not blocked on product intent; they are implementation or taste
calls for later. Client shape is already locked: standalone TUIs first
(`jeff graph`, then `jeff backlog`), Kitty composition early, Ratatui
multi-pane / bare `jeff` combined shell optional and late (P1a before any
combined client). A three-card layout is only an optional late sketch, not
an open default.

1. Graph pane rendering tier (survey in 6.3): layered 2D canvas everywhere,
   pixel upgrade on Kitty, or true 3D via Bevy. Zoom exists in all tiers;
   leaning 2D canvas plus Kitty upgrade, 3D only if it earns the dependency.
2. Inbox gitignore defaults and whether any inbox subset is ever committed.
3. How aggressively the standby Jeff brain compresses drain narration.
4. Whether global joint chat allows Chef to address “all projects” in one
   steer, or always requires a single project target (leaning single-target).
5. Session attach vs always-fresh host launch when a holder label already
   points at a live process (leaning: detect+focus if cheap; else fresh).
6. Name of the backend binary and whether `cook` grows subcommands vs a
   separate `jeffd` front door.
7. Whether bare `jeff` multi-pane composition is ever worth building after
   standalone verbs ship, or Kitty composition remains enough (optional,
   late; not a P1a concern).

## 18. Architecture review findings (2026-08-02)

Independent architecture review of this vision against the repository
(graph-slate items 3 and 7, shipped `cook approve`, `src/pi/`, store and
validate code). Fold into implementation planning; the two items in 18.1 are
blocking for their phases.

### 18.1 Blocking

1. **Decision cards are projections, not a second store.** The ledger already
   persists every blocking condition: escalations in `task.json.plan`
   (`result: "escalation"` with fork/options), `blocked` plus `blockedReason`,
   operation approvals in `execution.approval` plus append-only `approvals[]`.
   A durable card in `open/` with no reconciliation rule goes stale the moment
   the Chef answers in a host session instead. Rule: the projector opens a
   card keyed to task plus ledger condition and archives it when the ledger
   resolves, regardless of which surface resolved it. Only chat, steer, and
   system messages are native inbox content. This extends invariant 8 one
   layer down (project inbox vs task ledger). Reshapes P2.
2. **Backend auth is a v1 requirement, not polish.** A localhost HTTP API
   that can run `cook approve`, release claims, and exec host processes is
   reachable from any open web page via CSRF or DNS rebinding, making
   invariant 3 violable by construction and the launch endpoint arbitrary
   process execution. Unix socket, or per-start bearer token plus strict
   Origin checks, from P1 onward. Direction update, same day: the v1 client
   is a TUI over a unix socket (6.3), which removes the browser attack
   surface; this requirement re-attaches when the web client ships (6.5).

### 18.2 Fold into the relevant sections

- Interactive inbox use (chat, answering cards) with no live host session
  requires the standby brain, hence at least one configured host adapter.
  Only observation is runtime-free; state the dependency in 6.2/10.3. A brain
  acting on a card answer claims the task first.
- Failed host launch (10.4): the launcher is the legal claim holder and
  releases its own claim on failed exec; do not leave it to the 24 h
  staleness report.
- Item 7 feedback (does not modify the slate): `cook release` as specified
  has no holder check, so "no silent steal" (10.2 rule 5) is UI convention
  only. Suggest release warns or requires a flag when the releaser label
  differs from the holder label.
- The inbox transcript is multi-writer (backend, brain, host sessions).
  Single-writer through `jeffd` would break the standalone guarantee (9.2);
  use the existing mkdir-lock primitive family for appends, or per-message
  files.
- Drop backend responsibility 5 in 6.2 ("deliver inbox messages to the
  correct driver"): drivers tail the inbox files themselves; `jeffd` only
  projects. A delivery channel can diverge from disk.
- Packaging: the npm `files` allowlist ships `src/**/*.js`, so `jeffd` under
  `src/` would ship inside the method payload. Resolved: the Rust workspace
  lives in `control/`, which is never in the allowlist, so nothing ships.
- OMP wording in section 12: today OMP is a Pi-SDK isolation mode inside
  `role-session.js`, not a fourth adapter. Inventory reads: Claude Code
  (Agent tool), Pi (`cook_dispatch`), Codex (native dispatch), OMP as a
  Pi-family launch target.
- Method-side prerequisite for the backend contract: `cook snapshot --json`,
  slate item 8, shipped in `6.0.0-alpha.6`, so `jeffd` never learns the task
  schema.

### 18.3 Verified as specified

- Item 7 primitives match 3.2, including the conditional worktree rule
  (worktrees only when two or more tasks are claimed simultaneously), which
  10.4 already reflects.
- `.claim` is slate-excluded from `cook validate`; the journal is documented
  as unvalidated and is tailable by a projector.
- `cook approve` is shipped; byte-matched boundary and requester-not-granter
  semantics fit the decision-card design.
- No existing daemon, watcher, HTTP surface, or home-level state anywhere;
  `~/.jeff/projects.json` would be jeff's first (store.js currently rejects
  any path escaping the repo root).
- `.jeff/inbox/` collides with nothing; `src/pi/` matches the "thin launch
  plus specialist-dispatch boundary" description.

## 19. Doc control

- Supersedes nothing in `skills/cook/SKILL.md` or the state schema.
- Parallel to `docs/specs/graph-slate-6.0.md`; consumes item 7 as a dependency,
  does not modify the slate.
- If this vision and the method prose disagree on quality gates or separation,
  the method wins until Johan revises this file.
- Kitchen voice is optional in UI copy; artifacts and specs stay substrate-first
  (see `docs/brand.md`).
- Implementation handoff: the design spec for Jeff Control will be authored
  on this track, but implementation is planned for a different frontier
  model (Grok 4.5 at time of writing). Design artifacts must therefore be
  fully self-contained: exact socket protocol schemas, crate layout, the
  `cook` invocation contract, and mechanical acceptance checks. No reliance
  on conversational context, Claude-specific agent tooling, or this
  repository's host plugins beyond the documented CLI surface.
