# jeff: Design Spec

- Status: design rationale (the why behind the method); superseded by `skills/cook/SKILL.md`, `AGENTS.md`, and `skills/cook/reference/jeff-state-schema.md` where they differ.

## 1. Goal

Reliable long-running autonomous sessions that solve **atomic tasks one at a time** to tackle large projects, for a **single trusted Chef** working with friendly frontier agents. Jeff is a model-native quality control plane: fresh specialist contexts, enforced separation, durable evidence, and deterministic gates make the method inspectable. It is a cooperative workflow protocol, not a security sandbox. Current dogfood stamp: GPT-5.6 Sol in July 2026. That stamp records operating experience, not a compatibility floor or routing rule. The system conveys a disciplined *way of working* to a capable LLM and defends against known model failure modes:

- momentum bias (wanting to keep going; declaring "done" prematurely)
- skipped verification
- intelligence degradation as context bloats
- insufficient thinking effort for judgment-heavy stages

This is **not** a trust, anti-forgery, or hostile-child containment system. Host tool isolation is not a cross-host invariant. It is a **separation-and-completeness** system: the right-sized fresh-context specialist performs each stage, a *different* fresh-context specialist judges it, and a mechanical validator guarantees the recorded separation and completeness are real.

## 2. Principles

1. **Thin orchestrator that never judges.** The main session routes work and transcribes specialist verdicts; it never decides "good enough." Every act of judgment happens in a fresh specialist context. Jeff may not override a `needs-work`.
2. **Separation by fresh context.** Code separates test author, implementer, and reviewers. Operations separate executor and verifier. Audit is an additional conditional judgment.
3. **Model is the orchestrator's judgment; effort is host-native.** Specialist model selection follows the dispatch rules in `skills/cook/SKILL.md` (§Dispatch), default inherit. Pi and Claude Code apply role-frontmatter effort where supported; Codex inherits orchestrator effort.
4. **Category-specific completion.** Code reaches done only through its test/review/audit gate. Operation reaches done only through execution evidence, independent postcondition verification, and conditional audit. Kickbacks remain within the locked category.
5. **Durable truth on disk.** State lives in git-tracked files, re-read each loop, never trusted to Jeff's context. Survives compaction and restarts.
6. **Lean method, borrowed craft.** The craft (capture, TDD, review) is native to frontier models; we supply framing + conventions and use jeff's bundled first-party standards as a portable floor. Applicable user, host, repository, and language instructions may tighten or specialize it, never weaken it. No dependency on method-imposing third-party packs.
7. **Capture is interrogation, not transcription.** The `capture` stage asks clarifying questions until it is highly confident the right task is identified and aligned with the Chef: understanding problem X even when the Chef hasn't fully articulated it, and asking questions that drive good architecture. **Dependent questions are asked one at a time**, each informed by the previous answer; never a bundled questionnaire. Missing the right problem cannot be recovered by flawless downstream execution. **Every Chef-facing ask** (capture, mid-flow escalation, blocked handoff, irreversible git, lifecycle consent) opens with a short cold-context grounder: task id + one-line goal, then the root issue in product/code terms, then the question. Process status alone is not enough when the Chef juggles many parallel sessions.
8. **Gate immutable checkpoints; ship one green task commit.** Jeff never puts red or otherwise unverified task work on trunk. The full gate runs against a clean, immutable checkpoint. Shipped non-state content must match it, with differences limited to terminal bookkeeping accepted by validation. A completed task lands on trunk as one green task commit. The workflow **never halts to ask the Chef to stash or clean**; there is no dirty-tree gate or waiver dance.
9. **Be smart about git; make judgment calls; interrupt rarely.** Repository and host context choose branch, checkpoint, and integration mechanics. Linked worktrees are optional for dirty, occupied, or concurrent checkouts, never mandatory. Routine reversible Git work is autonomous inside a run (this is the intended override of any default "confirm before commit"). Jeff interrupts the Chef only when genuinely necessary: surprising unrelated changes it cannot attribute, an unresolvable conflict, or anything requiring force-push or history rewrite. `complexity` (`"simple" | "complex"`; absent ⇒ `"complex"`) classifies complecting and risk, not Git topology. A complex task braids concerns, couples previously separate things, crosses subsystem boundaries, or carries non-local side effects such as deployment. Classify by complecting, not difficulty; default complex when unsure; make the call at plan. Full mode removes terminal task state. Lite retains done ledgers and follows profile-driven integration.
10. **One bounded task-wide council.** A review or audit cap is only the trigger. Council waits for all required active judgments and source-bound surviving refutes, then votes exactly their blocking union once. The trigger stage remains compatibility evidence, not council scope.
11. **Classify by primary outcome.** Capture locks `code` for changed software behavior or `operation` for a bounded state transition with deterministic postconditions. Incidental edits do not change the category, and operation cannot bypass code obligations.

## 3. Vocabulary

- **task**: the single unit of work. Flat: no orders, no batches, no parent/child. A task may **block** other tasks; dependency edges form a DAG.
- **stage**: position in a task's pipeline. All active stages are verbs.
- **brain evidence**: the child session's actual `{provider, model, effort}` reported after dispatch.
- Names: `cook` (the pipeline verb), `jeff` (the sous-chef persona and the repo). The kitchen metaphor is a **render layer** (the `flavor` toggle) over a fixed substrate: it carries **no** depth in the method itself; the substance (`file:line` + reason + fix, verdicts, evidence) is identical with the voice off. See `docs/brand.md`.

## 4. Pipeline (stages)

Capture is shared, then the locked category selects one closed graph:

- Code: `capture → plan → implement → conditional refactor → review + conditional audit → done`.
- Operation: `capture → plan → execute → verify + conditional audit → done`.

Code planning owns tests and targeted RED. Operation planning owns a bounded runbook, preconditions, recovery and exact operator-facing approval boundaries, explicit `requiresApproval`, deterministic postconditions, and verification methods. A genuine unresolved operation fork can persist a minimal escalation at plan without creating execution state. Execute records actions and evidence. When approval is required, the executor returns a request equal to the planned boundary and stops by role contract. After the Chef approves it, Jeff records the active request through `cook approve <id> <operator>` and re-fires execute. The executor cannot return or serve as the provenance of a grant.

`capture` is the highest-leverage stage and runs in the orchestrator session. All later active stages dispatch fresh specialists. Code retains its immutable checkpoint and full-suite gate. Operations intentionally do not manufacture that code gate. Their completion retains the plan and requires nonempty action/evidence records plus exact ordered, all-true, evidenced verification of `plan.postconditions`. Resolved follow-ups, refutes, and exact source-bound council demotions remain durable.

Operation execute and verify use ordinary host-native stage dispatch. Role contracts guide cooperative agents; they do not mechanically confine host tools. A verifier independently applies the plan's deterministic methods and reports `needs-work` when a required method is unavailable. Execution evidence is never substituted for independent observation.

## 5. Model selection and effort

Model selection for each specialist follows the dispatch rules owned by `skills/cook/SKILL.md` (§Dispatch). Pi and Claude Code apply the per-stage effort values owned by `agents/cook-*.md` frontmatter; Codex children inherit orchestrator effort. Dispatch reports actual provider/model/effort as evidence.

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
validator mechanically enforces category graphs, strict returns, builder/judge
separation including operation auditor binding, completion, code gates, operation evidence, and convergence.

`src/cli/cook.js` is the sole operational CLI. The retired Bash implementation
is retained only in test fixtures when a deterministic historical oracle is
needed; it is neither installed nor included in the npm payload. Checked-JS
under `src/core/` owns runtime behavior and validation.

Jeff runs `cook validate` before every commit, and CI runs it on push. It proves
that separation and completeness records satisfy the contract; fresh specialists
still judge whether the spec and implementation are good.

## 8. Commands

The checked-JS entry point implements the public CLI surface:
`validate`, `verify`, `record`, `approve <id> <operator>`, `rebuild <id>`,
`reverify <id>`, `journal <id> <intent|external>`, `baseline check [<hash>]`,
`ready`, `claim <id> [--by <label>]`, `release <id>`, `claims`, `ls`, `status`,
`show <id>`, `snapshot --json`, `init`, `lite`, `plan <sub>`,
`indiff <base-ref> <pre-ref>`, `deinit`, `flavor`, `profile`, `profile init`,
`doctor`, and `help`. A private
adoption dispatch remains available only for internal pending-ledger wiring; it
is neither an operator command nor a pipeline starter. `cook approve <id>
<operator>` atomically copies the active pending operation request into
append-only grant history.

## 9. Ambient entry

**Activation gate:** the skill engages only in an *active* jeff project (`.jeff/config.json` with `active: true`, set by `cook init`); elsewhere it stands down to the normal host agent under the applicable user, host, and repository instructions. Within an active project, that agent handles ordinary work-intent in the current context under those instructions, not as task creation or specialist dispatch. Addressing Jeff or the Chef and using engineering verbs do not change that route. The Chef can preserve a finding without creating work, record future work as pending, or separately ask to start tracked execution.

Explicit natural-language activation requests use the activation map. The closed request-routing table applies only to typed `cook` invocations and explicit named task/external-ref requests. Its unknown-id catch-all never consumes unstructured conversation. Explicit `cook <id>` and `cook on <ref>` requests share one host-owned start/resume route: a matching local ledger takes precedence and resumes at its recorded current stage.

In active lite mode, only when no local ledger matches may that route resolve the configured external task. It validates the target before mutation, uses private idempotent adoption wiring when a ledger is needed, and continues directly into capture. If neither target exists, it fails before a partial ledger or external mutation. Separately, recording future lite work or a review/audit follow-up creates or updates the external item and invokes the private pending-adoption mechanism to register an idempotent ledger at pending/capture without starting execution, preserving INV-10.

An explicit Remember request is the consent to write durable memory. Full mode keeps durable findings under `.jeff/memory/`. Outside full mode, Jeff prefers a suitable existing Git-tracked memory, decisions, learnings, or handoff file and preserves its purpose and format; local `.jeff/memory/` is the fallback. Without an explicit Remember (or other persistence) request, ordinary Explore work does not write durable memory. `AGENTS.md`, READMEs, and ordinary product documentation are not memory stores.

After a short assess, Jeff classifies the work on consequence and expected lifetime: disposable work takes the ad-hoc route with no interrupt, and a risk floor always overrides a lighter classification and restores the ordinary pause; `skills/cook/SKILL.md` is authoritative for its membership and operational boundary. Otherwise, when a durable write would touch method/harness, shipped payload or version cuts, cross-cutting behavior, needed ACs/independent review, or work that should survive another session, Jeff **pauses before the first durable write** and forks once (grounded): ad-hoc minimal ship, record pending, or record + start capture. Hold writes until the Chef picks; do not continue ad hoc by default. Version cuts never ride silently on ad-hoc. Once the Chef starts tracked work, the existing capture, separation, verification, review, audit, convergence, and done-gate contracts apply unchanged.

## 10. Standards & skill-leaning policy

Specialists are held to jeff's **bundled first-party** `code-standards`/`testing`/`security-auditor` skills as a portable quality floor; applicable user, host, repository, and language instructions may tighten or specialize it, never weaken it. This does **not** depend on a third-party `code-standards` skill. jeff owns the method, state, conventions, and file locations. We write only:

- the `cook` orchestration/loop skill, its separate reference files, and the checked-JS owners under `src/core/` and `src/cli/`,
- Jeff-run capture, including primary-outcome category classification and lock.
- Fresh specialist briefs for code plan/implement/refactor/review, operation plan/execute/verify, and shared audit/refute/convergence.

Specialists may **use** official tools (`/code-review`, `/simplify`, `/verify`) and the bundled `security-auditor` skill as accelerators: tools, not method, so they don't taint the pipeline or override the standards floor. No dependency on method-imposing third-party packs (superpowers uninstalled).

## 11. Deferred (v1.1+)

Richer backlog analytics; migration script.

## Open questions

- Whether `refactor`'s "beyond the diff" license needs a scope cap.
