# Control plane vision: Jeff beside the terminal

Status: **vision / parallel track**. Not scheduled implementation.
Author of record: Johan (the Chef), completed with the working session of
2026-08-02.
Baseline method: jeff as of the graph slate (`docs/specs/graph-slate-6.0.md`)
and the design rationale (`docs/specs/jeff-design.md`).

This document completes a product vision that sits **beside** the method, not
inside it. It does not weaken iron rules, replace host sessions, or schedule
work against the 6.0 alpha track. Implementation is gated on
`6.0.0-alpha.7` dogfood (real `cook all` drain) unless Johan reopens that gate.

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

- a multi-project dashboard with live task graphs
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
- one model inheritance for specialists; host-native effort
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
| Model levers | Orchestrator/driver only; specialists inherit model; role frontmatter owns effort where supported |
| Drain brain | Hybrid: mechanical ready/claim/launch loop; standby Jeff brain per project while autodrain is on or inbox needs a reply |
| Host launch | Claim task, then launch host in that repo/worktree already bound to the task |
| Scheduling | Spec now; implement after `6.0.0-alpha.7` dogfood |
| First artifact | This vision doc only |

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

Local process started/stopped by CLI. Responsibilities:

1. read the home project registry
2. watch registered projects’ `.jeff/**` and project inboxes
3. expose a live projection API (HTTP + event stream)
4. own optional drain supervisors
5. deliver inbox messages to the correct driver / standby brain
6. launch or attach host sessions for claimed tasks
7. hold driver model/effort settings for managed runtimes

It is **not** the authority on task legality. `cook validate`, ledgers, and
host Jeff sessions remain authoritative.

### 6.3 Web dashboard

Browser UI against the backend:

- home: all registered projects, attention counts
- project: live graph, claims, drain state, inbox
- task detail drawer from graph nodes
- levers for orchestrator model/effort on managed drivers
- completed-task toggle on the graph

Visual bar: calm, dense, legible. Active claimed tasks pulse. Blocked / awaiting
Chef states are unmistakable. This is an operator instrument cluster, not a
marketing page.

### 6.4 CLI

Shape (names may change; verbs matter):

```text
jeffd start | stop | status | open
jeff project add <path> | list | rm <id>
jeff drain on | off [project]
jeff claim-status [project]          # thin sugar over cook claims, optional
```

`jeffd start` brings up the backend; `open` launches the dashboard. Project
add/list/rm edits the registry only. Drain toggles are per project.

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

Specialists keep the settled method rule:

- inherit the orchestrator provider/model unchanged
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
                    │  Dashboard (browser)         │
                    │  projects · graph · inbox UI │
                    └──────────────┬───────────────┘
                                   │ HTTP + events
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

1. `jeffd` with FS projector + event API
2. `~/.jeff/projects.json` registry
3. web UI: project list, task DAG, task detail, completed toggle
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
9. **One model inheritance remains.** Driver levers do not become per-specialist
   model routing.
10. **Implementation waits for item-7 dogfood** unless Johan explicitly
    reopens scheduling.

## 16. Implementation phases (after the gate)

Ordered for learning, not for calendar commitment:

| Phase | Deliverable | Depends on |
|---|---|---|
| P0 | This vision (done) | none |
| P1 | Read-only projector + project registry + task DAG UI | stable ledgers; claims optional/degraded |
| P2 | Project inbox + decision cards + joint attention view | P1 |
| P3 | Claim-aware UI + open-in-host (claim + launch) | item 7 claims |
| P4 | Autodrain supervisor + hybrid standby brain | item 7 drain dogfood + journals |
| P5 | Polish: presets, richer agent detail, host adapter pack | P4 |

P1 may prototype against pre-item-7 stores as read-only. P3+ must not ship a
side claim mechanism.

## 17. Open questions (deliberately unresolved)

These are not blocked on product intent; they are implementation or taste
calls for later:

1. Exact dashboard stack (local static UI vs small SSR; graph library choice).
2. Whether `jeffd` lives in this repo, a sibling package, or a workspace
   folder without shipping inside the npm method payload initially.
3. Inbox gitignore defaults and whether any inbox subset is ever committed.
4. How aggressively the standby Jeff brain compresses drain narration.
5. Whether global joint chat allows Chef to address “all projects” in one
   steer, or always requires a single project target (leaning single-target).
6. Session attach vs always-fresh host launch when a holder label already
   points at a live process (leaning: detect+focus if cheap; else fresh).
7. Name of the backend binary and whether `cook` grows subcommands vs a
   separate `jeffd` front door.

## 18. Doc control

- Supersedes nothing in `skills/cook/SKILL.md` or the state schema.
- Parallel to `docs/specs/graph-slate-6.0.md`; consumes item 7 as a dependency,
  does not modify the slate.
- If this vision and the method prose disagree on quality gates or separation,
  the method wins until Johan revises this file.
- Kitchen voice is optional in UI copy; artifacts and specs stay substrate-first
  (see `docs/brand.md`).
