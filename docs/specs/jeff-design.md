# jeff: Design Spec

- Status: design rationale (the why behind the method); superseded by `skills/cook/SKILL.md`, `AGENTS.md`, and `skills/cook/reference/jeff-state-schema.md` where they differ.

## 1. Goal

Reliable long-running autonomous sessions that solve **atomic tasks one at a time** to tackle large projects, for a **single trusted Chef** on frontier models (Opus 4.8+, GPT-5.5+). The system conveys a disciplined *way of working* to a capable LLM and defends against known current-model failure modes:

- momentum bias (wanting to keep going; declaring "done" prematurely)
- skipped verification
- intelligence degradation as context bloats
- one-size model use: cheap tasks burning expensive models, hard tasks under-thought

This is **not** a trust / anti-forgery system (single Chef, nothing public). It is a **separation-and-completeness** system: the right-sized fresh-context specialist performs each stage, a *different* fresh-context specialist judges it, and a mechanical validator guarantees the separation and completeness are real.

## 2. Principles

1. **Thin orchestrator that never judges.** The main session routes work and transcribes specialist verdicts; it never decides "good enough." Every act of judgment happens in a fresh specialist context. Jeff may not override a `needs-work`.
2. **Separation by fresh context.** Each stage is a separate subagent in a fresh window. Two separations are mechanically enforced: `test-author ≠ implementer`, `implementer ≠ reviewer`.
3. **Right-sized brains.** Each stage runs at a chosen `{model, effort}`. Judgment stages (review/audit) never run a cheaper brain than the implement stage did.
4. **Forward-only completion (ratchet on `done`).** A task reaches `done` only with recorded passing review (+ audit when required) and green non-implementer tests. *Any* stage may kick back to *any* earlier stage with a recorded reason; only completion is locked, not revisiting.
5. **Durable truth on disk.** State lives in git-tracked files, re-read each loop, never trusted to Jeff's context. Survives compaction and restarts.
6. **Lean method, borrowed craft.** The craft (capture, TDD, review) is native to frontier models; we supply framing + conventions and hold work to jeff's *bundled first-party standards floor* (which Chef/local/language skills may tighten or specialize, never weaken). No dependency on method-imposing third-party packs: the floor is jeff's own bundled skill.
7. **Capture is interrogation, not transcription.** The `capture` stage asks clarifying questions until it is highly confident the right task is identified and aligned with the Chef: understanding problem X even when the Chef hasn't fully articulated it, and asking questions that drive good architecture. **Dependent questions are asked one at a time**, each informed by the previous answer; never a bundled questionnaire. Missing the right problem cannot be recovered by flawless downstream execution.
8. **Commit once when simple; retain stage commits when complex.** Jeff owns the working tree during a run. In full mode, simple implementation-pipeline changes remain in the worktree until the task clears the full gate, review, required audit, and done validation; terminal-with-removal creates the sole green task commit. Complex tasks commit at stage boundaries on their local branch. The workflow **never halts to ask the Chef to stash or clean**; there is no dirty-tree gate or waiver dance.
9. **Be smart about git; make judgment calls; interrupt rarely.** Routine commit, branch, and squash work is autonomous inside a run (this is the intended override of any default "confirm before commit"). Jeff interrupts the Chef only when genuinely necessary: surprising unrelated changes it cannot attribute, an unresolvable conflict, or anything requiring force-push or history rewrite. `complexity` (`"simple" | "complex"`; absent ⇒ `"complex"`) drives the full-mode commit path: **simple** tasks (do not complect) produce one terminal trunk commit; **complex** tasks (complect: braid concerns, couple previously-separate things, cross subsystem boundaries, or carry non-local side effects such as a deployment) run on a short-lived **local** branch `task/<id>-<slug>` where stage-boundary commits accumulate, then squash-merge to trunk as one clean green commit on `done` and delete the branch (no remote branch, no PR; capture any lasting lesson in project memory, never a surviving branch). Classify by complecting, not difficulty; deployment or other non-local side effects ⇒ complex; default complex when unsure; make the call at plan. Every trunk commit must be green. Backlog/capture commits may land on trunk before implementation, decoupled from any code branch. Lite integration remains profile-driven. Net: trunk history stays one green commit per completed task; complex tasks also have granular, revertable stage history during the task's life.

## 3. Vocabulary

- **task**: the single unit of work. Flat: no orders, no batches, no parent/child. A task may **block** other tasks; dependency edges form a DAG.
- **stage**: position in a task's pipeline. All active stages are verbs.
- **brain**: a `{model, effort}` pair chosen per stage.
- Names: `cook` (the pipeline verb), `jeff` (the sous-chef persona and the repo). The kitchen metaphor is a **render layer** (the `flavor` toggle) over a fixed substrate: it carries **no** depth in the method itself; the substance (`file:line` + reason + fix, verdicts, evidence) is identical with the voice off. See `docs/brand.md`.

## 4. Pipeline (stages)

Linear by default; kickback to any earlier stage allowed, recorded.

> This table is the original design sketch (history, not a directive). For the current verification protocol and the per-stage brains, `skills/cook/SKILL.md` and `skills/cook/reference/jeff-state-schema.md` are authoritative; the `brain (default)` column below is superseded by the frontmatter-pinned values (see §5).

| # | stage | does | brain (default) | separation |
|---|---|---|---|---|
| 1 | `capture` | interrogate intent (one question at a time), drive good architecture, confirm alignment, produce crisp acceptance criteria + scope/non-goals | **top** | n/a |
| 2 | `plan` | approach, slices, deps, which tests, whether an audit is needed (sensitive surface) | high | n/a |
| 3 | `test` | author failing tests (red) | mid | ≠ implementer |
| 4 | `implement` | make tests green; may **not** author/weaken tests | mid | ≠ test-author, ≠ reviewer |
| 5 | `refactor` | **always when code changed**: simplify, align to standards, dedup; may reach beyond the diff in service of this change; tests stay green | mid | n/a |
| 6 | `review` | independent code review | high | ≠ implementer |
| 7 | `audit` | **conditional** (plan flags a security-relevant surface): adversarial security audit | high | n/a |
| 8 | `done` | terminal state (not an active stage); gated by validator invariants | n/a | n/a |

`capture` is the highest-leverage stage (see Principle 7) and runs at the top brain.

**Stage-boundary commits on complex branches.** For a full-mode complex task, each stage transition is a branch commit (Principle 8): Jeff stages the task's code, artifacts, and `task.json`/`notes.md` updates and commits them with a stage-scoped message (e.g. `task <id> · <stage>: <summary>`), then enters the next stage. This gives the reviewer a discrete per-stage diff and makes kickbacks legible before the terminal squash. For a full-mode simple task, the same changes remain in the worktree and are included in the sole terminal commit, so an intentionally red test never enters trunk history. Lite follows its operating profile. Jeff runs `cook validate` before each commit; CI runs it on push. The loop owns the working tree and does not interrupt the Chef to request cleanup.

## 5. Brains (model × effort)

- Models: `haiku < sonnet < opus < fable` (top slot reserved; Fable currently disabled).
- Effort: `low < med < high < xhigh`.
- Defaults: `capture` = top (`opus·xhigh`; `fable` when live) · `plan`/`review`/`audit` = `opus·high` · `test`/`implement`/`refactor` = `sonnet·med` · mechanical only = `haiku`.
- Provider-aware: on GPT backends the top slot caps at best available (no Fable slot); graceful degradation.
- **Brain tiering is assignment, not enforcement (task 0026; retuned in 0041 + 0043):** each dispatched stage's `{model, effort}` is pinned in `agents/cook-*.md` frontmatter (settled values: plan `opus·xhigh`, test `sonnet·medium` (a low-effort encoder), implement `opus·high`, refactor `sonnet·high`, review/audit `opus·xhigh`: the mechanical stages run Sonnet because their outputs are fully fenced); there is no per-task override and the validator no longer ranks or floors brains. "Judge ≥ builder" holds by construction (review/audit `opus·xhigh` ≥ implement `opus·high`), not a computed invariant. `SKILL.md` / `AGENTS.md` are the authoritative surfaces for these values.
- **Orchestrator brain = top (capture-equivalent).** The main loop session runs at the highest brain: routing, kickback decisions, and verdict transcription must not run degraded. Keep the driving session on the top available model (Opus 4.8 today).

## 6. State & schema

The `.jeff` on-disk store. Per-task directory = **3 files**:

- `task.md`: spec: goal, acceptance criteria, non-goals, scope.
- `task.json`: structured state (below).
- `notes.md`: running notes, kickback findings, decisions.

Plus `memory/` (project memory). The task dirs themselves are the registry; there is no separate index file.

`task.json` fields (trimmed from the original TypeScript schema):

- `id`, `slug`, `title`
- `status`: `pending | in_progress | blocked | done | abandoned` (+ optional `abandonReason`)
- `stage`: `capture | plan | test | implement | refactor | review | audit | done`
- `priority`: `p0..p4`
- `deps`: `[taskId]` (blockers)
- `brains`: per-stage `{model, effort}` actually used
- `agents`: `{ test_author_agent_id, implementer_agent_id, reviewer_agent_id, audit_agent_id }`
- `tests`: `{ authored_by_agent_id, green: bool, evidence: [commands] }`
- `review`: `{ verdict: pass|needs-work, reviewer_agent_id, evidence: [...] }`
- `audit`: `{ required: bool, verdict: pass|needs-work|na, audit_agent_id, evidence: [...] }`
- `commits`: `[ref]`
- `kickbacks`: `[{ from, to, reason, at }]`

Dropped vs. the old schema: 8-phase enum, `flowState`, `resumeCommand`, `cookSlices`, all gate/attestation/digest fields, `batchId`/batches, `disposition` (folded into `status`).

## 7. Validator (`cook validate`: Bash + `jq`)

Pure Bash + `jq`. No Rust, no Node, no build step, no JSON-Schema engine. The "schema" is the documented field table above plus the validator's assertions. `jq` is the sole prerequisite: `cook init`/`doctor` detects it and offers the OS-appropriate install (brew/apt/dnf/apk); the validator itself only **asserts** `jq` is present and **fails closed** with the install command: it never auto-installs inside a hook or loop.

Invariants enforced:

1. `tests.authored_by_agent_id ≠ implementer_agent_id` (no self-authored tests)
2. `implementer_agent_id ≠ reviewer_agent_id` (no self-review)
3. *(removed in task 0026: the old `review/audit brain ≥ implement brain` floor: "no cheap rubber-stamp" now holds by pinned-frontmatter construction, not a validator check)*
4. no `status = done` unless: `tests.green` AND tests authored by ≠ implementer AND `review.verdict = pass` AND `audit.verdict ∈ {pass, na}`
5. `deps` reference existing tasks; no cycles
6. `task.json` is schema-valid (required fields, enum values)

Jeff runs `cook validate` before every commit (CI runs it on push). On complex branches, structural invariants (5, 6) bind at each stage boundary; on simple tasks, all invariants bind before the sole terminal commit. The separation/completion invariants (1, 2, 4) bind as their fields populate, with the full done-gate (invariant 4) enforced only when `status = done`.

It guarantees *separation and completeness are real*: not that a spec is good or a review thorough. Those remain the specialists' job in fresh context.

**Enforcement is per-project and opt-in.** A project is "on" only after `cook init` (sets `.jeff/config.json` `active: true`); `cook deinit` turns it off. Enforcement is the **orchestrator running `cook validate` before every commit** plus **CI (`make validate` on push)**: deliberately **not** a global Claude Code hook, and no git pre-commit hook in any mode. A plugin hook fires in *every* project the plugin is installed in, intruding on non-jeff repos, which is the opposite of opt-in. Outside an active project the plugin is inert: the `cook` skill stands down and `cook validate` is a no-op, so those repos get vanilla Claude Code + the Chef's `CLAUDE.md`.

## 8. Commands

- `cook`: work the single next ready task (all deps `done`) through its pipeline, then stop.
- `cook <ids…>`: work only those tasks, in dependency order.
- `cook all`: drain every unblocked task. **(v1.1)**
- `cook ls`: list tasks (status, stage, brain, age).
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
- dispatch briefs for the fresh-context specialists `plan`/`test`/`implement`/`refactor`/`review`/`audit` (`plan` is the dispatched test-designer; the rest are thinner doers/judges).

Specialists may **use** official tools (`/code-review`, `/simplify`, `/verify`) and the bundled `security-auditor` skill as accelerators: tools, not method, so they don't taint the pipeline or override the standards floor. No dependency on method-imposing third-party packs (superpowers uninstalled).

## 11. Deferred (v1.1+)

`cook all` (drain); richer backlog analytics; Fable tier activation; migration script; multi-task parallel dispatch.

## Open questions

- ~~A concrete numeric brain-rank table for the `≥` comparison across providers.~~ **Resolved by deletion (task 0026):** brain tiering is now pure assignment pinned in `agents/cook-*.md` frontmatter: no cross-provider rank comparison exists, so no rank table is needed.
- Whether `refactor`'s "beyond the diff" license needs a scope cap.
- ~~Effort knob mechanics.~~ **Resolved (task 0026):** both `model` and `effort` are pinned per-stage in the `agents/cook-*.md` frontmatter (`effort` ∈ `low|med|high|xhigh|max`); no dispatch-time knob or thinking-directive is used.
