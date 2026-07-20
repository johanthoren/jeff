# jeff: Design Spec

- Status: design rationale (the why behind the method); superseded by `skills/cook/SKILL.md`, `AGENTS.md`, and `skills/cook/reference/jeff-state-schema.md` where they differ.

## 1. Goal

Reliable long-running autonomous sessions that solve **atomic tasks one at a time** to tackle large projects, for a **single trusted Chef** on frontier models. Jeff is a model-native quality control plane: fresh specialist contexts, enforced separation, durable evidence, and deterministic gates make the method inspectable. Current dogfood stamp: GPT-5.6 Sol in July 2026. That stamp records operating experience, not a compatibility floor or routing rule. The system conveys a disciplined *way of working* to a capable LLM and defends against known model failure modes:

- momentum bias (wanting to keep going; declaring "done" prematurely)
- skipped verification
- intelligence degradation as context bloats
- insufficient thinking effort for judgment-heavy stages

This is **not** a trust / anti-forgery system (single Chef, nothing public). It is a **separation-and-completeness** system: the right-sized fresh-context specialist performs each stage, a *different* fresh-context specialist judges it, and a mechanical validator guarantees the separation and completeness are real.

## 2. Principles

1. **Thin orchestrator that never judges.** The main session routes work and transcribes specialist verdicts; it never decides "good enough." Every act of judgment happens in a fresh specialist context. Jeff may not override a `needs-work`.
2. **Separation by fresh context.** Each dispatched stage uses a fresh subagent. Two separations are mechanically enforced: combined test-author ≠ implementer, and implementer ≠ every reviewer.
3. **One model, host-native effort.** Every specialist inherits the orchestrator provider/model unchanged. Pi and Claude Code apply role-frontmatter effort where supported; Codex inherits the orchestrator effort.
4. **Forward-only completion (ratchet on `done`).** A task reaches `done` only with recorded passing review (+ audit when required) and green non-implementer tests. *Any* stage may kick back to *any* earlier stage with a recorded reason; only completion is locked, not revisiting.
5. **Durable truth on disk.** State lives in git-tracked files, re-read each loop, never trusted to Jeff's context. Survives compaction and restarts.
6. **Lean method, borrowed craft.** The craft (capture, TDD, review) is native to frontier models; we supply framing + conventions and use jeff's bundled first-party standards as a portable floor. Applicable user, host, repository, and language instructions may tighten or specialize it, never weaken it. No dependency on method-imposing third-party packs.
7. **Capture is interrogation, not transcription.** The `capture` stage asks clarifying questions until it is highly confident the right task is identified and aligned with the Chef: understanding problem X even when the Chef hasn't fully articulated it, and asking questions that drive good architecture. **Dependent questions are asked one at a time**, each informed by the previous answer; never a bundled questionnaire. Missing the right problem cannot be recovered by flawless downstream execution. **Every Chef-facing ask** (capture, mid-flow escalation, blocked handoff, irreversible git, lifecycle consent) opens with a short cold-context grounder: task id + one-line goal, then the root issue in product/code terms, then the question. Process status alone is not enough when the Chef juggles many parallel sessions.
8. **Gate immutable checkpoints; ship one green task commit.** Jeff never puts red or otherwise unverified task work on trunk. The full gate runs against a clean, immutable checkpoint. Shipped non-state content must match it, with differences limited to terminal bookkeeping accepted by validation. A completed task lands on trunk as one green task commit. The workflow **never halts to ask the Chef to stash or clean**; there is no dirty-tree gate or waiver dance.
9. **Be smart about git; make judgment calls; interrupt rarely.** Repository and host context choose branch, checkpoint, and integration mechanics. Linked worktrees are optional for dirty, occupied, or concurrent checkouts, never mandatory. Routine reversible Git work is autonomous inside a run (this is the intended override of any default "confirm before commit"). Jeff interrupts the Chef only when genuinely necessary: surprising unrelated changes it cannot attribute, an unresolvable conflict, or anything requiring force-push or history rewrite. `complexity` (`"simple" | "complex"`; absent ⇒ `"complex"`) classifies complecting and risk, not Git topology. A complex task braids concerns, couples previously separate things, crosses subsystem boundaries, or carries non-local side effects such as deployment. Classify by complecting, not difficulty; default complex when unsure; make the call at plan. Full mode removes terminal task state. Lite retains done ledgers and follows profile-driven integration.
10. **One bounded task-wide council.** A review or audit cap is only the trigger. Council waits for all required active judgments and source-bound surviving refutes, then votes exactly their blocking union once. The trigger stage remains compatibility evidence, not council scope.

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
| 2 | `plan` | approach, slices, deps, design and author failing tests (targeted red), whether an audit is needed, and an explicit named opportunity limited to behavior-preserving deduplication, deletion, or harmonization, or `null` | xhigh | ≠ implementer |
| 3 | `implement` | make tests green; may **not** author/weaken tests | high | ≠ test-author, ≠ every reviewer |
| 4 | `refactor` | when named by the plan or owed by a surviving review/audit finding: simplify, align to standards, dedup; may reach beyond the diff in service of this change; tests stay green | xhigh | n/a |
| 5 | `review` | independent code review | xhigh | ≠ implementer |
| 6 | `audit` | **conditional** (plan flags a security-relevant surface): adversarial security audit | xhigh | n/a |
| 7 | `done` | terminal state (not an active stage); gated by validator invariants | n/a | n/a |

`capture` is the highest-leverage stage (see Principle 7) and runs in the orchestrator session.

**Gate checkpoint.** `cook verify` runs against a clean, immutable checkpoint and records its identity as the gate hash. A code kickback creates a new checkpoint and gate. Before integration, the shipped non-state content must match the gate; only validated terminal bookkeeping may differ. How the repository materializes and integrates that checkpoint is contextual. Lite follows its operating profile. Jeff runs `cook validate` before each commit; CI runs it on push.

## 5. Model inheritance and effort

Every dispatched specialist inherits the orchestrator's provider/model unchanged on every host. Jeff does not choose that orchestrator model and has no alias map, provider table, ranking, fallback, elevation knob, or per-task model setting. Pi and Claude Code apply the role effort in `agents/cook-<stage>.md` where supported: plan/refactor/review/audit/refute `xhigh`, implement `high`. Native Codex children inherit both model and effort from the orchestrator; Jeff passes neither override. Dispatch reports the child session's actual `{provider, model, effort}` as execution evidence.

## 6. State & schema

The checked-JS definitions are the current source of truth:

- `src/core/types.js` defines the JSDoc data shapes.
- `src/core/task-schema.js` validates task records.
- `src/core/validate-store.js` owns the authoritative store verdict.
- `skills/cook/reference/jeff-state-schema.md` documents the persisted contract.

Full mode stores task state in three plain files per task: `task.md`,
`task.json`, and `notes.md`. Lite mode follows its plan-store profile. Operational
rules and migrations live in `skills/cook/SKILL.md` and the canonical schema
reference; this rationale intentionally does not duplicate their field tables.

## 7. Validator (`cook validate`: checked-JS Node core)

`src/core/validate-store.js`, reached through `src/cli/cook.js validate`, is the
authoritative validation boundary. It imports only Node standard-library modules
and `src/core/*`; there is no build step or runtime package dependency. The
validator mechanically enforces the current schema, separation, completion,
gate, mode, and convergence invariants documented in the canonical schema
reference.

`src/cli/cook.js` is the sole operational CLI. The retired Bash implementation
is retained only in test fixtures when a deterministic historical oracle is
needed; it is neither installed nor included in the npm payload. Checked-JS
under `src/core/` owns runtime behavior and validation.

Jeff runs `cook validate` before every commit, and CI runs it on push. It proves
that separation and completeness records satisfy the contract; fresh specialists
still judge whether the spec and implementation are good.

## 8. Commands

The checked-JS entry point implements the complete operational surface:
`validate`, `verify`, `record`, `baseline check`, `ls`, `status`, `show`,
`init`, `lite`, `on`, `plan section|check|append`, `indiff`, `deinit`,
`flavor`, `profile`, `doctor`, and help routing. Its header and dispatch in
`src/cli/cook.js` are the source of truth for the verb set.

## 9. Ambient entry

**Activation gate:** the skill engages only in an *active* jeff project (`.jeff/config.json` with `active: true`, set by `cook init`); elsewhere it stands down to the normal host agent under the applicable user, host, and repository instructions. Within an active project, that agent handles ordinary work-intent in the current context under those instructions, not as task creation or specialist dispatch. Addressing Jeff or the Chef and using engineering verbs do not change that route. The Chef can preserve a finding without creating work, record future work as pending, or separately ask to start tracked execution.

Explicit natural-language activation requests use the activation map. The closed request-routing table applies only to typed `cook` invocations and explicit named task/external-ref requests. Its unknown-id catch-all never consumes unstructured conversation.

In lite mode, recording first creates or updates the external item and then uses the existing `cook on <ref>` path to register an idempotent local ledger at pending/capture. This pending adoption does not interrogate the Chef, write a capture breakdown, enter `in_progress`, or dispatch a specialist. A later explicit start begins capture and makes Jeff the thin orchestrator; all tracked-work restrictions then apply. Lite follow-ups are pending-adopted before their ids are recorded, preserving INV-10 without starting execution.

Full mode keeps durable findings under `.jeff/memory/`. Outside full mode, Jeff prefers a suitable existing Git-tracked memory, decisions, learnings, or handoff file and preserves its purpose and format; local `.jeff/memory/` is the fallback. `AGENTS.md`, READMEs, and ordinary product documentation are not memory stores.

After a short assess, when a durable write would touch method/harness, shipped payload or version cuts, cross-cutting behavior, needed ACs/independent review, or work that should survive another session, Jeff **pauses before the first durable write** and forks once (grounded): ad-hoc minimal ship, record pending, or record + start capture. Hold writes until the Chef picks; do not continue ad hoc by default. Version cuts never ride silently on ad-hoc. Pure Q&A, read-only scout, and trivial single-file local tweaks stay Explore with no interrupt. Once the Chef starts tracked work, the existing capture, separation, verification, review, audit, convergence, and done-gate contracts apply unchanged. `skills/cook/SKILL.md` is authoritative for the operational boundary.

## 10. Standards & skill-leaning policy

Specialists are held to jeff's **bundled first-party** `code-standards`/`testing`/`security-auditor` skills as a portable quality floor; applicable user, host, repository, and language instructions may tighten or specialize it, never weaken it. This does **not** depend on a third-party `code-standards` skill. jeff owns the method, state, conventions, and file locations. We write only:

- the `cook` orchestration/loop skill (+ embedded schema doc + validator script),
- the Jeff-run `capture` stage prose (the sole Chef-in-the-loop, method-defining stage),
- dispatch briefs for the fresh-context specialists `plan`/`implement`/`refactor`/`review`/`audit` (`plan` designs and authors tests; the rest are doers/judges).

Specialists may **use** official tools (`/code-review`, `/simplify`, `/verify`) and the bundled `security-auditor` skill as accelerators: tools, not method, so they don't taint the pipeline or override the standards floor. No dependency on method-imposing third-party packs (superpowers uninstalled).

## 11. Deferred (v1.1+)

`cook all` (drain); richer backlog analytics; migration script; multi-task parallel dispatch.

## Open questions

- Whether `refactor`'s "beyond the diff" license needs a scope cap.
- ~~Effort knob mechanics.~~ **Resolved:** specialists inherit the orchestrator model; Pi and Claude Code apply role-frontmatter effort where supported, while Codex inherits orchestrator effort.
