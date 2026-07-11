# jeff: Design Spec

- Status: design rationale (the why behind the method); superseded by `skills/cook/SKILL.md`, `AGENTS.md`, and `skills/cook/reference/jeff-state-schema.md` where they differ.

## 1. Goal

Reliable long-running autonomous sessions that solve **atomic tasks one at a time** to tackle large projects, for a **single trusted Chef** on frontier models (Opus 4.8+, GPT-5.5+). The system conveys a disciplined *way of working* to a capable LLM and defends against known current-model failure modes:

- momentum bias (wanting to keep going; declaring "done" prematurely)
- skipped verification
- intelligence degradation as context bloats
- insufficient thinking effort for judgment-heavy stages

This is **not** a trust / anti-forgery system (single Chef, nothing public). It is a **separation-and-completeness** system: the right-sized fresh-context specialist performs each stage, a *different* fresh-context specialist judges it, and a mechanical validator guarantees the separation and completeness are real.

## 2. Principles

1. **Thin orchestrator that never judges.** The main session routes work and transcribes specialist verdicts; it never decides "good enough." Every act of judgment happens in a fresh specialist context. Jeff may not override a `needs-work`.
2. **Separation by fresh context.** Each dispatched stage uses a fresh subagent. Two separations are mechanically enforced: combined test-author ≠ implementer, and implementer ≠ every reviewer.
3. **One model, role-specific effort.** Every specialist inherits the orchestrator provider/model unchanged; role frontmatter prescribes effort only.
4. **Forward-only completion (ratchet on `done`).** A task reaches `done` only with recorded passing review (+ audit when required) and green non-implementer tests. *Any* stage may kick back to *any* earlier stage with a recorded reason; only completion is locked, not revisiting.
5. **Durable truth on disk.** State lives in git-tracked files, re-read each loop, never trusted to Jeff's context. Survives compaction and restarts.
6. **Lean method, borrowed craft.** The craft (capture, TDD, review) is native to frontier models; we supply framing + conventions and hold work to jeff's *bundled first-party standards floor* (which Chef/local/language skills may tighten or specialize, never weaken). No dependency on method-imposing third-party packs: the floor is jeff's own bundled skill.
7. **Capture is interrogation, not transcription.** The `capture` stage asks clarifying questions until it is highly confident the right task is identified and aligned with the Chef: understanding problem X even when the Chef hasn't fully articulated it, and asking questions that drive good architecture. **Dependent questions are asked one at a time**, each informed by the previous answer; never a bundled questionnaire. Missing the right problem cannot be recovered by flawless downstream execution.
8. **Gate immutable checkpoints; ship one green task commit.** Jeff never puts red or otherwise unverified task work on trunk. The full gate runs against a clean, immutable checkpoint. Shipped non-state content must match it, with differences limited to terminal bookkeeping accepted by validation. A completed task lands on trunk as one green task commit. The workflow **never halts to ask the Chef to stash or clean**; there is no dirty-tree gate or waiver dance.
9. **Be smart about git; make judgment calls; interrupt rarely.** Repository and host context choose branch, checkpoint, and integration mechanics. Linked worktrees are optional for dirty, occupied, or concurrent checkouts, never mandatory. Routine reversible Git work is autonomous inside a run (this is the intended override of any default "confirm before commit"). Jeff interrupts the Chef only when genuinely necessary: surprising unrelated changes it cannot attribute, an unresolvable conflict, or anything requiring force-push or history rewrite. `complexity` (`"simple" | "complex"`; absent ⇒ `"complex"`) classifies complecting and risk, not Git topology. A complex task braids concerns, couples previously separate things, crosses subsystem boundaries, or carries non-local side effects such as deployment. Classify by complecting, not difficulty; default complex when unsure; make the call at plan. Full mode removes terminal task state. Lite retains done ledgers and follows profile-driven integration.

## 3. Vocabulary

- **task**: the single unit of work. Flat: no orders, no batches, no parent/child. A task may **block** other tasks; dependency edges form a DAG.
- **stage**: position in a task's pipeline. All active stages are verbs.
- **brain evidence**: the child session's actual `{provider, model, effort}` reported after dispatch.
- Names: `cook` (the pipeline verb), `jeff` (the sous-chef persona and the repo). The kitchen metaphor is a **render layer** (the `flavor` toggle) over a fixed substrate: it carries **no** depth in the method itself; the substance (`file:line` + reason + fix, verdicts, evidence) is identical with the voice off. See `docs/brand.md`.

## 4. Pipeline (stages)

Linear by default; kickback to any earlier stage allowed, recorded.

> This table is the original design sketch (history, not a directive). For the current verification protocol and per-stage effort, `skills/cook/SKILL.md` is authoritative.

| # | stage | does | effort | separation |
|---|---|---|---|---|
| 1 | `capture` | interrogate intent (one question at a time), drive good architecture, confirm alignment, produce crisp acceptance criteria + scope/non-goals | orchestrator setting | n/a |
| 2 | `plan` | approach, slices, deps, design and author failing tests (targeted red), whether an audit is needed | xhigh | ≠ implementer |
| 3 | `implement` | make tests green; may **not** author/weaken tests | high | ≠ test-author, ≠ every reviewer |
| 4 | `refactor` | **always when code changed**: simplify, align to standards, dedup; may reach beyond the diff in service of this change; tests stay green | xhigh | n/a |
| 5 | `review` | independent code review | xhigh | ≠ implementer |
| 6 | `audit` | **conditional** (plan flags a security-relevant surface): adversarial security audit | xhigh | n/a |
| 7 | `done` | terminal state (not an active stage); gated by validator invariants | n/a | n/a |

`capture` is the highest-leverage stage (see Principle 7) and runs in the orchestrator session.

**Gate checkpoint.** `cook verify` runs against a clean, immutable checkpoint and records its identity as the gate hash. A code kickback creates a new checkpoint and gate. Before integration, the shipped non-state content must match the gate; only validated terminal bookkeeping may differ. How the repository materializes and integrates that checkpoint is contextual. Lite follows its operating profile. Jeff runs `cook validate` before each commit; CI runs it on push.

## 5. Model inheritance and effort

Every dispatched specialist inherits the orchestrator's provider/model unchanged on every host. Jeff does not choose that orchestrator model and has no alias map, provider table, ranking, fallback, elevation knob, or per-task model setting. `agents/cook-<stage>.md` frontmatter supplies only role effort: plan/refactor/review/audit/refute `xhigh`, implement `high`. Dispatch reports the child session's actual `{provider, model, effort}` as execution evidence.

## 6. State & schema

The `.jeff` on-disk store. Per-task directory = **3 files**:

- `task.md`: spec: goal, acceptance criteria, non-goals, scope.
- `task.json`: structured state (below).
- `notes.md`: running notes, kickback findings, decisions.

Plus `memory/` (project memory). The task dirs themselves are the registry; there is no separate index file.

`task.json` fields (trimmed from the original TypeScript schema):

- `id`, `slug`, `title`
- `status`: `pending | in_progress | blocked | done | abandoned` (+ optional `abandonReason`)
- `stage`: `capture | plan | implement | refactor | review | audit | done` (readers also accept historical persisted `test` for compatibility resume)
- `priority`: `p0..p4`
- `deps`: `[taskId]` (blockers)
- `agents`: `{ implementer_agent_id, reviewer_agent_id, reviewer2_agent_id, audit_agent_id }` (historical plan/test identity fields accepted and ignored)
- `tests`: `{ authored_by_agent_id, green: bool, evidence: [commands] }`
- `review`: `{ verdict: pass|needs-work, reviewer_agent_id, evidence: [...] }`
- `audit`: `{ required: bool, verdict: pass|needs-work|na, audit_agent_id, evidence: [...] }`
- `commits`: `[ref]`
- `kickbacks`: `[{ from, to, reason, at }]`

Dropped vs. the old schema: 8-phase enum, `flowState`, `resumeCommand`, `cookSlices`, all gate/attestation/digest fields, `batchId`/batches, `disposition` (folded into `status`), and plan-time `brains`. Historical records with `brains` remain accepted.

## 7. Validator (`cook validate`: Bash + `jq`)

Pure Bash + `jq`. No Rust, no Node, no build step, no JSON-Schema engine. The "schema" is the documented field table above plus the validator's assertions. `jq` is the sole prerequisite: `cook init`/`doctor` detects it and offers the OS-appropriate install (brew/apt/dnf/apk); the validator itself only **asserts** `jq` is present and **fails closed** with the install command: it never auto-installs inside a hook or loop.

Invariants enforced:

1. `tests.authored_by_agent_id ≠ implementer_agent_id` (no self-authored tests)
2. `implementer_agent_id ≠ reviewer_agent_id` (no self-review)
3. *(retired)*
4. no `status = done` unless: `tests.green` AND tests authored by ≠ implementer AND `review.verdict = pass` AND `audit.verdict ∈ {pass, na}`
5. `deps` reference existing tasks; no cycles
6. `task.json` is schema-valid (required fields, enum values)

Jeff runs `cook validate` before every commit (CI runs it on push). Structural invariants (5, 6) bind whenever task state is committed. The separation/completion invariants (1, 2, 4) bind as their fields populate, with the full done-gate (invariant 4) enforced only when `status = done`. Before the one green task commit reaches trunk, shipped non-state content must match the clean, immutable gate checkpoint; only validated terminal bookkeeping may differ.

It guarantees *separation and completeness are real*: not that a spec is good or a review thorough. Those remain the specialists' job in fresh context.

**Enforcement is per-project and opt-in.** A project is "on" only after `cook init` (sets `.jeff/config.json` `active: true`); `cook deinit` turns it off. Enforcement is the **orchestrator running `cook validate` before every commit** plus **CI (`make validate` on push)**: deliberately **not** a global Claude Code hook, and no git pre-commit hook in any mode. A plugin hook fires in *every* project the plugin is installed in, intruding on non-jeff repos, which is the opposite of opt-in. Outside an active project the plugin is inert: the `cook` skill stands down and `cook validate` is a no-op, so those repos get vanilla Claude Code + the Chef's `CLAUDE.md`.

## 8. Commands

- `cook`: work the single next ready task (all deps `done`) through its pipeline, then stop.
- `cook <ids…>`: work only those tasks, in dependency order.
- `cook all`: drain every unblocked task. **(v1.1)**
- `cook ls`: list tasks (status, stage, age).
- `cook status`: current task + in-flight stage + **backlog health** (size, age), with a nudge when the ready-backlog grows past a threshold.
- `cook show <id>`: full task detail.
- `cook validate`: run the validator.
- `cook init`: **activate jeff in this project** (opt-in): scaffold `.jeff/` if absent + set `active: true`. No git hook is installed.
- `cook deinit`: **deactivate**: set `active: false` (preserves `.jeff/` task history; never deletes data).
- `cook doctor`: environment check (`jq`), active state.

## 9. Ambient entry

**Activation gate:** the skill engages only in an *active* jeff project (`.jeff/config.json` with `active: true`, set by `cook init`); elsewhere it stands down to vanilla Claude Code + the Chef's `CLAUDE.md`. Within an active project, the `cook` skill triggers on work-intent in ordinary conversation: the Chef need not type a command. Before **formulating/locking a task** (the `capture` stage), it **asks for confirmation**, so it never silently commits to a pipeline. Explicit commands remain available.

## 10. Standards & skill-leaning policy

Specialists are held to jeff's **bundled first-party** `code-standards`/`testing`/`security-auditor` floor as the quality bar (`~/.claude/CLAUDE.md` global standards plus any project standards doc may tighten or specialize it, never weaken it), **not** a third-party `code-standards` skill. jeff owns the method, state, conventions, and file locations. We write only:

- the `cook` orchestration/loop skill (+ embedded schema doc + validator script),
- the Jeff-run `capture` stage prose (the sole Chef-in-the-loop, method-defining stage),
- dispatch briefs for the fresh-context specialists `plan`/`implement`/`refactor`/`review`/`audit` (`plan` designs and authors tests; the rest are doers/judges).

Specialists may **use** official tools (`/code-review`, `/simplify`, `/verify`) and the bundled `security-auditor` skill as accelerators: tools, not method, so they don't taint the pipeline or override the standards floor. No dependency on method-imposing third-party packs (superpowers uninstalled).

## 11. Deferred (v1.1+)

`cook all` (drain); richer backlog analytics; migration script; multi-task parallel dispatch.

## Open questions

- Whether `refactor`'s "beyond the diff" license needs a scope cap.
- ~~Effort knob mechanics.~~ **Resolved:** role frontmatter supplies effort; the specialist inherits the orchestrator model unchanged.
