# Graph slate: the jeff 6.0 design spec

Status: approved design, ready to implement. Author of record: Johan (the Chef).
Baseline: jeff 5.0.0, commit `dfa9a31`, 2026-07-31.

This spec is self-contained. It was produced from a full survey of the mid-2026
graph-engineering field (LangGraph, Microsoft Agent Framework, Mastra, Pydantic
AI, Temporal/Restate/DBOS, Gas Town + beads, GSD, OpenHands, and the fleet
orchestrators). Conclusion of that survey: nothing replaces jeff; its niche
(mechanically enforced quality gates with builder/judge separation) is unoccupied
in the entire field. What the field does better is throughput. This slate
imports the throughput mechanisms without weakening a single gate.

The two operator gripes this slate exists to fix:

1. **jeff is slow**: fresh specialists re-explore the repo every stage, one
   task drains at a time, kickbacks re-buy the whole judgment layer.
2. **Too much ceremony around exhausted cycles**: small mechanical findings buy
   full council ceremony, and every follow-up finding costs a full tracked task.

## How to implement this spec

**Audience: any frontier-class model in any harness.** This file plus the
repository is the complete input: no conversation history, no assistant
memory, no model-specific or vendor-specific context is needed or may be
assumed. If something appears to require knowledge outside this repo, treat
that as a spec defect: stop and ask Johan rather than guessing.

Toolchain prerequisites: a POSIX system with git, Node.js ≥ 22.19, and `bats`
(the test suite is bats + `node:test`; see the `Makefile`).

- Implement the eight items **in order**. Each item is one jeff task, cooked
  through jeff's own pipeline in this repo (`.jeff/` here runs lite mode;
  `node src/cli/cook.js` is the CLI). Dogfood: cook item N on the pipeline as
  merged through item N-1.
- Jeff dispatch has host adapters for Claude Code, Pi, and Codex. In any other
  harness, the pipeline's discipline still applies and is followed manually,
  one fresh context (or failing that, one clearly separated pass) per stage:
  author the failing tests first and record the RED evidence; implement in a
  separate context from the test author; obtain an independent review pass
  that did not write the code; audit where an item requires it; keep the
  evidence in the task dir exactly as the state schema records it.
- Per item: capture from this spec's acceptance criteria, plan authors the
  failing tests first (RED proven), a separate implementer makes them green,
  independent review, audit where flagged. One branch and one PR per item to
  `main`. **Johan approves every merge; never merge or push `main` yourself.**
- Alpha versions are allocated by **release order, not by slate item**: every
  merged change that reaches the alpha track takes the next unused
  `6.0.0-alpha.N` in lockstep metadata, whatever it contains. §Release owns
  that rule in full, records what each alpha actually carried, and states the
  gate on plain `6.0.0`. After Johan approves and merges each item, a separate
  operation task with exact operator approval creates that alpha's immutable
  bare tag, publishes it to npm `next`, and then refreshes the dogfood installs
  on Pi, OMP, Claude Code, and Codex. npm `latest` remains stable `5.0.0`.
- Before touching anything, read: `AGENTS.md` (iron rules),
  `docs/maintaining-jeff.md`, `docs/specs/jeff-design.md`,
  `skills/cook/reference/jeff-state-schema.md`, `skills/cook/SKILL.md`.
- Verification floor for every PR: `make test`, `make typecheck`,
  `make validate` all green.
- If the code has drifted from what this spec describes, preserve the spec's
  intent and the iron rules, adapt the mechanics, and record the deviation in
  the PR description.

### Binding constraints (violating any of these is a blocking defect)

1. **Host-neutral.** Everything must work identically under Claude Code, Pi,
   and Codex dispatch. No feature may depend on a Claude-Code-only tool.
2. **State on disk, plain files.** No server, no daemon, no database. New state
   is files under `.jeff/`, human-readable.
3. **Prose owns sequence, checked JS owns legality.** Any behavior that must
   hold lands in `src/core/` with tests and validator coverage; `SKILL.md` and
   `agents/*.md` route it. A rule that exists only in prose is advisory.
4. **Back-compat without migration.** Every schema addition is optional; an
   absent field means exact legacy semantics. Historical ledgers must validate
   byte-identically. Follow the `convergence` precedent (absent block ⇒
   INV-7..11 skipped).
5. **Anchors are untouchable.** RED-proven test contracts, the non-implementer
   test author, builder/judge separation (INV-1/INV-2), the single full-suite
   gate binding (`tests.gate`), fresh-context judgment, and the done-gate
   (INV-4) may not be weakened by any item. Where an item trades review
   freshness for speed, the trade is explicit, mechanical, and validator-checked.
6. **Authored-text rules** (docs, commits, PR bodies, issues, notes): no em
   dashes (use colons, semicolons, periods, or the `·` separator); no AI or
   assistant attribution anywhere; commit first lines are imperative and at
   most 50 characters; task commits keep the `task <id> · done: ...` shape;
   kitchen persona speech never appears in artifacts (refer to "Johan" or "the
   operator"; "the Chef" is acceptable only as jeff's defined role term).

## The slate

| # | Item | Phase | Depends on | Gripe attacked |
|---|------|-------|------------|----------------|
| 1 | Parallel refute fan-out | speed | none | latency per judgment round |
| 2 | Context packets | speed | none | per-stage re-exploration |
| 3 | Journal with write-ahead intents | foundation | none | false cycle exhaustion; resume safety |
| 4 | Targeted repair with typed kickback contracts | ceremony | 3 | kickback cost |
| 5 | Evidence-scaled escalation | ceremony | 4 | council + follow-up ceremony |
| 6 | Capture decomposition + discovered-from + lite cycle check | width | none (before 7) | width to drain |
| 7 | `cook all`: parallel DAG drain | width | 3, 6 | one task at a time |
| 8 | `cook snapshot`: machine projection | surface | none (ordered after 7; claim fields need 7) | external consumers parsing ledgers |

Item 3 is deliberately before 4 and 5: while the kickback machinery is being
rebuilt and dogfooded, the journal guarantees an interrupted dispatch is
detectable instead of ambiguous.

---

## Item 1: parallel refute fan-out

**Motivation.** Every blocking finding gets one fresh source-bound refute pass
before it counts (`skills/cook/SKILL.md` §Kickbacks). Refutes are mutually
independent by construction (one finding each, read-only, fresh context), yet
nothing tells the orchestrator to dispatch them concurrently. This is a pure
fake edge.

**Behavior.** When a judgment round leaves more than one blocking finding,
Jeff dispatches **all** refute specialists concurrently: one fresh specialist
per finding, each briefed on exactly its one finding and blind to the others.
Returns are recorded in any order.

**Mechanics.**
- `skills/cook/SKILL.md` §Dispatch: add a short "Parallel refutes" paragraph
  next to the existing "Parallel judgments" one, stating the rule above and
  that recording order is irrelevant.
- No CLI, schema, or agent-file change. `agents/cook-refute.md` is already
  per-finding. The recorder already supports this: `recordRefute`
  (`src/core/record.js`) computes kickbacks only after the last active blocker
  carries a refute, and `assertCurrentJudgment` rejects duplicate identities.

**Test contract.** A `node:test` case in `src/core/` proving N refutes for N
blockers record in arbitrary order with identical final state (kickbacks,
counters) regardless of order; extend the existing convergence tests if they
already cover part of this. A prose check (bats, `payload-hygiene` style) that
SKILL.md contains the parallel-refutes rule.

**Acceptance criteria.**
- SKILL.md instructs concurrent refute dispatch.
- Order-independence of refute recording is proven by test.

Audit: not required (prose + test-only).

---

## Item 2: context packets

**Motivation.** Every specialist starts cold and re-derives the same repo map:
where the relevant files are, what the key symbols do, how to run the targeted
tests. That discovery cost recurs five to eight times per task. The fix from
the graph-engineering literature is a scoped, facts-only context packet. The
separation rule (`SKILL.md` §The loop, step 2: "never a conclusion") survives
because the packet is restricted to facts.

**Behavior.** The `plan` specialist creates the initial optional `context.md` in the task dir, owns its task scope, and refreshes it whenever plan re-enters. It
contains **facts only**:

- relevant files, one line each: `path` plus a one-line role;
- key symbols/functions with `file:line`;
- the exact targeted-test command(s) and any build/run commands;
- discovered mechanical constraints stated as facts (for example "file X is
  generated from Y; edit Y").

**Forbidden content** (each is a review finding if it appears): hypotheses,
root-cause claims, suggested fixes, verdicts, opinions, "the bug is", "the
approach should be". Plan's conclusions live in `notes.md` and the plan
return, never in the packet.

Downstream briefs (implement, refactor, review, audit, refute, council) name
the packet path when the file exists, always with this fixed caveat: **"a map,
not an authority: use it to skip discovery; verify only entries you rely on;
correct stale facts if writable, otherwise report them."** Consumers never
independently reconstruct the packet. Implement and refactor maintain only
facts they directly verify, invalidate, create, or move during assigned code
work; they do not expand task scope or add conclusions. Review, audit, refute,
and council remain read-only and report stale facts through existing return
evidence. Absence of the packet is legal everywhere (advisory artifact, never
a gate).

**Mechanics.**
- `agents/cook-plan.md`: create the initial optional packet, own its task
  scope, refresh it whenever plan re-enters, and retain the facts-only contract
  and forbidden list. The strict JSON return is **unchanged**.
- `skills/cook/SKILL.md` §Dispatch: own the canonical lifecycle, consumer
  duties, exact caveat, optional absence, and no-reconstruction rule.
- `agents/cook-implement.md` and `cook-refactor.md`: explicitly maintain facts
  encountered during assigned code work without expanding task scope or adding
  conclusions.
- `agents/cook-review.md`, `cook-audit.md`, and `cook-refute.md`: explicitly
  keep the packet read-only and report stale facts through existing return
  evidence. Council receives the same duty through its generated brief.
- `skills/cook/reference/jeff-state-schema.md` §On-disk layout: document the
  file and its ownership.
- No `task.json` change. No validator change.

**Test contract.** Bats prose checks: plan packet creation, task-scope
ownership, and re-entry refresh; canonical dispatch caveat and consumer duties;
bounded inputs in each file-backed consumer; and the on-disk layout entry.

**Acceptance criteria.**
- Plan authors the packet; all six consumer briefs may carry it; the facts-only
  boundary, plan task-scope ownership, and implement/refactor factual-maintenance duties are stated in the payload prose.

Audit: not required (prose-only).

---

## Item 3: journal with write-ahead intents

**Motivation** (from the durable-execution survey). jeff's state is durable,
but *intent* is not: when a session dies between dispatching a specialist and
recording its return, nothing distinguishes "never ran" from "ran and was
lost", and an external side effect (a `gh pr create`) can be repeated on
resume. A per-task append-only journal with write-ahead intent records makes
every resume a deterministic replay and stops interrupted dispatches from
creating ambiguity or phantom cycle consumption.

**Behavior.** Each task dir gains `journal.jsonl`: append-only, one JSON
object per line, monotonically increasing `seq` from 0.

Event vocabulary (closed set for 6.0):

```jsonc
{"seq":0,"at":"<ISO>","event":"intent","stage":"<stage|refute|council|external>","note":"<optional text>"}
{"seq":1,"at":"<ISO>","event":"record","stage":"<stage>","agent":"<observedAgentId>"}
{"seq":2,"at":"<ISO>","event":"gate","hash":"<sha>","green":true,"clean":true}
{"seq":3,"at":"<ISO>","event":"external","note":"<what completed>"}
```

- The orchestrator appends an `intent` **before** every specialist dispatch and
  before every external side effect (PR creation, issue comment, release
  action), via the CLI.
- `cook record` and `cook approve` append a `record` event automatically on
  success; `cook verify --task` appends a `gate` event automatically.
- **Resume semantics** (prose, `SKILL.md` §The loop and
  `reference/full-mode.md`): at loop start for a task, read the journal tail.
  An `intent` with no later matching `record` for the same stage means the
  dispatch may have died: dispatch a fresh specialist and never count the
  orphan against anything. An `external` intent with no completion event means:
  query the external system first (for example `gh pr list`) and only re-act
  if the effect is genuinely absent.
- The journal is operational provenance, **not validated state**: `cook
  validate` ignores it in 6.0. Reads are fail-open (skip and warn on a
  malformed line); writes are fail-closed (surface errors).
- The journal lives and dies with the task dir (pruned with it in full mode).

**Version stamp** (same item, three lines of mechanism): `task.json` gains
optional `pipelineVersion` (nonempty string; the jeff `package.json` version at
ledger creation). Canonical ledger writers set it; `reference/full-mode.md`
instructs hand-authored capture scaffolding to include it. Provenance only in
6.0: no gate reads it.

**Mechanics.**
- New CLI verb: `cook journal <id> <event> [--stage <s>] [--note <text>]` for
  `intent` and `external` appends. Auto-appends from record/approve/verify live
  inside the existing code paths (`src/cli/cook.js`, `src/core/record.js` or a
  new `src/core/journal.js`).
- Appends take the existing store lock (`withStoreLock`) so `seq` is atomic.
- `task-schema.js`: accept optional `pipelineVersion` (absent ⇒ legacy;
  present ⇒ nonempty string).
- Docs: `jeff-state-schema.md` (§On-disk layout + field rules), `SKILL.md`
  (§The loop step 2: journal intent before dispatch; §Git: check the journal
  before repeating an external side effect), `reference/full-mode.md` (resume
  procedure).

**Test contract.** `node:test`: seq monotonicity under the lock; auto-append
on record/approve/verify; malformed-line read behavior; `pipelineVersion`
schema accept/reject. Bats: the CLI verb; a resume scenario fixture with a
dangling intent.

**Acceptance criteria.**
- Every dispatch and external side effect is preceded by a recorded intent;
  record/gate events auto-append; resume semantics documented; historical
  ledgers without journals validate unchanged.

Audit: **required** (new CLI surface + filesystem writes).

---

## Item 4: targeted repair with typed kickback contracts

Scope: **code tasks only.** Operation tasks keep today's semantics unchanged
(their cycle/approval provenance machinery is stricter and the frequency is
lower; extending this to operations is a parked follow-up).

**Motivation.** Today any post-kickback fix resets **all** judgments
(`resetJudgmentsAfterFix` → `archiveAndResetJudgments` in
`src/core/record.js`): one surviving review blocker re-buys review, review2,
audit, and the suite gate. The graph-engineering literature calls the
alternative "targeted repair": give every mistake an address, repair the node,
keep verified siblings. The mechanical version of that trade, with the suite
gate kept as the anchor:

**Behavior.**

*Typed kickback contract.* Ordinary judgment kickbacks appended by
`recordRefute` gain an optional `findings` array: the surviving blockers that
produced the kickback, `{source, file, line, what, kickTo}` each. This is the
machine-readable contract of what the fix must resolve. The scoped-fix
implement brief quotes it verbatim; the re-judgment brief carries it as "the
kicked findings this cycle must resolve". (Council-block kickbacks are
excluded: the council recovery path keeps its existing machinery untouched.)

*Scoped repair rule* (deterministic, computed in `transitionTask` at the
implement or refactor record that follows a judgment kickback). Let K be the
latest judgment-source kickback (`from` ∈ {review, audit}; review2 collapses
into review, as the convergence counters already do). The repair is **scoped**
iff all of:

- (a) `K.findings` is present and nonempty;
- (b) every `K.findings[i].kickTo` ∈ {`implement`, `refactor`};
- (c) the recording implement return's `files` is a nonempty subset of
  `{K.findings[*].file}`;
- (d) the task is category code;
- (e) no council is pending or convened for the active cycle.

When scoped: archive the full current judgment entry to `judgmentHistory`
(existing whole-cycle shape), then reset **only the raising source**:

- K.from == `review`: null `review`, `review2`, `agents.reviewer_agent_id`,
  `agents.reviewer2_agent_id`; **retain** `audit` and `agents.audit_agent_id`
  as they stand.
- K.from == `audit`: reset audit only; retain review and review2.
- Kickbacks from both sources in the same round: reset both (identical to
  today).

When not scoped (any condition fails, including historical kickbacks without
`findings`): today's full reset, byte-identical behavior.

`invalidateVerification` stays **unconditional** on implement and refactor:
the full-suite gate always re-runs on the new checkpoint. That is the anchor
that makes the retention trade safe: a retained judgment is stale by exactly
the delta, the delta is confined to files the findings named, and the suite
gate catches mechanical regressions deterministically.

The existing occupied-slot guards (`recordReview`/`recordAudit` throw when the
slot is occupied) now do double duty: they mechanically prevent re-dispatching
a retained source. `settleJudgments` needs no change in outcome logic: with
audit retained and reviews nulled it lands on `review`; when the fresh review
records, completion proceeds as today.

*Re-judgment scope.* The fresh judge for the raising source judges the **full
diff** as always (fresh eyes are not narrowed); the saving is not re-running
the other source, not shrinking the judge.

**Validator.** New pure invariant **INV-12** (code tasks; skipped entirely
when `judgmentHistory` is absent or no kickback carries `findings`, so every
historical ledger is untouched): a live judgment outcome whose identity also
appears in the latest `judgmentHistory` entry (a retained judgment) is valid
only when:

- the latest judgment kickback carries `findings` satisfying (a) and (b);
- the recorded post-kickback `implement.files` ⊆ union of those findings'
  `file` values;
- the retained live outcome deep-equals its archived counterpart and its
  verdict is `pass`.

Otherwise it is a violation (fail-closed: an unproven retention forces the
full-reset practice). `task-schema.js` additionally validates the optional
`kickbacks[*].findings` shape (source ∈ code judgment sources, nonempty
file/what, integer line ≥ 1, kickTo ∈ code destinations).

**Docs.** `SKILL.md` §Kickbacks (scoped repair rule, the contract-carrying
briefs, the explicit trade and its anchor); `jeff-state-schema.md` (kickback
findings field, retention semantics, INV-12).

**Test contract** (authored first, RED): transition tests for the scoped
branch (audit retained when review raised and files confined), the full-reset
branch (files exceed the contract; destination capture/plan; operation
category; council pending), occupied-slot retention enforcement, counter
semantics unchanged, gate invalidation unconditional; INV-12 accept/violate
matrix; schema accept/reject for `kickbacks[*].findings`.

**Acceptance criteria.**
- A review-raised, file-confined fix re-dispatches review only, with audit
  retained, and the task completes with a valid INV-12 proof.
- Every non-confined path behaves byte-identically to 5.0.0.
- Full-suite gate re-runs on every fix cycle without exception.

Audit: **required** (touches convergence and completion machinery).

---

## Item 5: evidence-scaled escalation

**Motivation.** The cap-2 → council → one-scoped-cycle → blocked escalator is
a fixed topology: a one-line mechanical finding on cycle 3 buys the same
ceremony as a design flaw. And every follow-up finding costs a full tracked
task, which is the single loudest ceremony complaint. The work-graph principle:
let recorded evidence, not a bare counter, choose the path; keep every bound.

**Behavior, part A: one convergent bonus cycle.** In `recordRefute`, at the
point where a source's counter has reached the cap (the `capped` branch),
check bonus eligibility before arming the council:

Eligible iff all of:

- `convergence.stages[<s>].bonusGranted` is not already true;
- every surviving blocker in this round for that source has `kickTo` ∈
  {`implement`, `refactor`};
- this round's surviving-blocker count for that source is **strictly smaller**
  than the previous round's, where the previous round's count is
  `findings.length` of the last recorded kickback from that source (requires
  item 4's typed kickbacks; a historical kickback without `findings` is never
  eligible).

When eligible: set `bonusGranted: true`, append the ordinary kickback (the
counter stays at cap), and do not arm the council. The next surviving round
from that source convenes the council unconditionally. Total bound per source:
cap + 1 cycles, exactly once, only while converging on confined findings.
Divergent or unconfined cap hits convene the council exactly as today. Council
size, K=3 voting, recovery, and terminal semantics are unchanged.

**Behavior, part B: the follow-up ledger.** New repo file `.jeff/FOLLOWUPS.md`
(shares `.jeff/` git treatment per mode). Line format:

```
- [ ] task <id> · <file>:<line> · <what> (<source>, <YYYY-MM-DD>)
```

- Ordinary follow-up findings: `SKILL.md` changes from "becomes a tracked
  backlog task" to "append one line to `.jeff/FOLLOWUPS.md`". A follow-up
  graduates to a real task only when the operator asks or picks it up; the
  graduated task records `discoveredFrom` (item 6).
- Council-demoted findings: `followupTaskId` may now be an existing task id
  (as today) **or the literal string `"ledger"`**, meaning the demotion was
  appended to FOLLOWUPS.md. INV-10 accepts `"ledger"` without cross-reading
  the file (the validator stays a pure function of the task store; the append
  is prose-owned by the orchestrator).

**Validator.**
- Schema: `convergence.stages[<s>].bonusGranted` optional boolean (absent ⇒
  false); `followupTaskId`: null | id | `"ledger"`.
- INV-7 extension (fail-closed, still skipped when `convergence` is absent):
  the count of kickbacks with `from == s` may exceed `cap` by at most one, and
  only when `bonusGranted` is true; `bonusGranted: true` additionally requires
  the enabling evidence recorded: the last source-s kickback's `findings` all
  have confined `kickTo` and are strictly fewer than the prior source-s
  kickback's `findings`.
- INV-10 amendment as above.

**Docs.** `SKILL.md` §Kickbacks and §Council (bonus rule, ledger rule);
`jeff-state-schema.md` (both field rules, INV amendments); `cook-review.md` /
`cook-audit.md` follow-up description lines updated to name the ledger.

**Test contract** (RED first): recordRefute bonus branch matrix (eligible;
already spent; non-shrinking; unconfined; historical kickback without
findings); INV-7 extension matrix; INV-10 `"ledger"` accept plus existing id
path regression; schema checks; prose checks for the SKILL.md changes.

**Acceptance criteria.**
- A shrinking, confined blocker set at cap buys exactly one extra scoped cycle
  with no council; a second cap hit convenes council regardless.
- Follow-ups cost one ledger line, not one task; council demotions may point
  at the ledger; all bounds remain validator-derived.

Audit: **required** (changes the convergence bound).

---

## Item 6: capture decomposition, discovered-from, lite cycle check

**Motivation.** Item 7 can only drain width that exists. Width is created at
capture (splitting wide orders into small dep-linked tasks) and by provenance
(mid-task discoveries becoming linked tasks cheaply, which also serves item
5's graduation path). The lite validator currently skips dependency-cycle
checking entirely, which item 7 needs at least locally sane.

**Behavior.**
- *Capture guidance* (`SKILL.md` capture stage row plus a short paragraph):
  apply the fake-edge test at capture. When an order contains two or more
  independently shippable outcomes, capture them as separate tasks; add a
  `deps` edge only where one task genuinely consumes another's output. Prefer
  several simple tasks over one complex task when acceptance criteria cluster
  into independent seams. Guidance, never a gate.
- *Plan split escalation* (`agents/cook-plan.md`): when planning reveals the
  task decomposes into independently shippable slices, return the existing
  escalation shape with a fork naming the proposed split. No new return shape.
- *`discoveredFrom`* (`task.json`, optional): a single task id recording which
  task's work surfaced this one (follow-up graduation, mid-task discovery,
  capture split provenance). Provenance only: scheduling stays exclusively in
  `deps`. Full mode: the id must name a live task or a `prunedTaskIds` entry.
  Lite: shape-checked only (string or number).
- *Lite cycle check* (`src/core/invariants.js`): lite mode now runs the Kahn
  cycle pass restricted to edges whose **both endpoints exist in the local
  ledger set**; unresolvable dep ids (external tracker refs) are ignored, so
  no false positives. Full-mode behavior is unchanged.

**Test contract.** Schema accept/reject for `discoveredFrom` (both modes, both
id types, provenance rule in full); lite Kahn over local edges including the
ignore-unresolvable case; prose checks for the SKILL.md and cook-plan.md
additions.

**Acceptance criteria.**
- `discoveredFrom` validates per mode; lite cycle detection catches a local
  cycle and tolerates external refs; capture/plan prose carries the
  decomposition guidance.

Audit: not required (schema-additive + prose; no new I/O).

---

## Item 7: `cook all`, the parallel DAG drain

Scope: **full mode only** in 6.0. In lite, `cook all` reports that it is
full-mode-only (lite repos are team-owned; parallel landing there is the
team's call, parked).

**Motivation.** The task-level DAG (`deps`, INV-5) exists but is drained one
task at a time; `cook all` has been a reserved verb since v1.1. Every fleet
system surveyed converged on the same validated shape: ready-set computation,
atomic claims, one isolated worktree per concurrent task. This item turns task
count from summed latency into slowest-path latency without touching a single
quality gate.

**CLI primitives** (all in `src/cli/cook.js` + `src/core/`, under the existing
store-containment and lock discipline):

- `cook ready`: print the ready set as JSON lines
  `{id, slug, title, priority, deps}`. Ready = status ∈ {pending,
  in_progress}, not claimed, and every dep satisfied. A dep is satisfied when
  it is in `prunedTaskIds`, or names a live task with terminal status. A dep on
  a live non-terminal or blocked task is unsatisfied. Order: priority, then id.
- `cook claim <id> [--by <label>]`: atomically `mkdir`
  `.jeff/tasks/<dir>/.claim` (the same primitive as `.record-lock`; EEXIST ⇒
  error naming the holder), then write `.claim/claim.json`
  `{"by":"<label>","at":"<ISO>"}`. Refuses terminal or blocked tasks.
- `cook release <id>`: remove the claim (error if unclaimed; surfacing bugs
  beats silent idempotence).
- `cook claims`: list active claims with age.
- `.jeff/config.json` optional `maxParallelTasks` (integer ≥ 1, default 1),
  validated in `configSchemaViolations`. Default 1 keeps 5.0.0 behavior.

The `.claim` dir is operational, like `.record-lock`: `cook validate` ignores
it, and `collectTasks` must be confirmed unaffected by its presence.

**The drain loop** (prose-owned, `SKILL.md`; replaces the reserved
`cook all` line):

1. Read the ready set and claims fresh from disk (`cook ready`,
   `cook claims`). Never trust context.
2. While unclaimed ready tasks exist and active claims < `maxParallelTasks`:
   claim the next task, journal a drain intent (item 3), and open its lane.
   **Worktree rule: whenever two or more tasks are claimed simultaneously,
   every claimed task gets its own linked git worktree on its own task
   branch.** A single claimed task may use the main checkout, as today.
3. Run each lane through The Loop (§The loop) independently. Dispatch stages
   of different lanes concurrently where the host supports parallel subagent
   dispatch; otherwise interleave. Any serialization is legal: the store lock
   serializes `.jeff` writes and lanes share no checkout.
4. **Integration is serialized at the main checkout, in completion order.**
   When a lane's judgments pass: merge or rebase its task branch onto trunk in
   the main checkout; then run `cook verify --task <id>` at the main root
   against the integrated tree (this preserves the existing gate semantics
   unchanged: `gate.hash` is root HEAD, done requires HEAD match and a clean
   tree, and it deterministically catches cross-task interference at the only
   place it can exist); then record done, release the claim, remove the
   worktree.
5. A merge conflict when landing lane B after lane A is a discovered hidden
   edge: route it as an ordinary scoped kickback to implement for B, with the
   conflict as the finding, in B's worktree. Soft prevention guidance: two
   ready tasks that obviously touch the same area run in sequence, not in
   parallel.
6. A capture lock, approval stop, escalation, or blocked-to-operator stops
   only its own lane; the drain continues the rest and reports every stopped
   lane with the Chef-facing grounder at the end.
7. Loop to 1 (completions may unblock new ready tasks). Stop when no ready
   unclaimed tasks remain and every claim is resolved. Report a drain summary:
   per task, terminal state, cycles, kickbacks.
8. Stale claims: never break a claim automatically. Report any claim older
   than 24h with no subsequent journal record, and ask the operator.

**Resume.** `cook all` after an interruption reconstructs lanes from claims
plus journals (item 3) and resumes each claimed task at its recorded stage;
dangling intents follow item 3's resume semantics.

**What deliberately does not change.** Store writes stay serialized by
`.record-lock`. Judgment parallelism inside a task is unchanged. The suite
gate count is unchanged (one per task, now at integration). No scheduler
process exists: the orchestrating model is the runtime; the CLI provides only
`ready`/`claim`/`release`/`claims` primitives.

**Test contract** (RED first). Bats + `node:test`: ready-set matrix (pruned
dep, done dep, blocked dep, missing dep, claimed task excluded, priority
order); claim atomicity (concurrent mkdir, EEXIST, holder named), refusal on
terminal/blocked; release error on unclaimed; claims listing; config
`maxParallelTasks` accept/reject; `collectTasks` indifference to `.claim`;
prose checks that SKILL.md documents the drain loop and the reserved line is
gone.

**Acceptance criteria.**
- Two independent ready tasks drain concurrently in separate worktrees and
  land sequentially, each with its own green integration gate, with
  `maxParallelTasks: 2`; with the default 1 the behavior is 5.0.0's.
- Claims are atomic, visible, and never auto-broken.

Audit: **required** (git operations, filesystem, concurrency).

---

## Item 8: `cook snapshot`, the machine projection

**Motivation.** External read-only consumers need the project's task state
without parsing ledgers themselves. The first consumer is the Jeff Control
plane (`docs/specs/control-plane-vision.md`), whose backend is bound by a
hard constraint: it never learns the task schema. Today the only machine
surfaces are `cook validate` (legality, not content) and raw `task.json`
files, so any outside tool would re-implement schema knowledge and silently
break on schema evolution. One versioned projection command keeps schema
knowledge in this repo, in one place.

**Behavior.** `cook snapshot --json` prints one JSON document for the active
store and exits. Read-only: the store is byte-identical before and after. It
projects; it does not judge. An invalid store still snapshots (observers must
be able to see broken states); legality remains `cook validate`'s job.

Document shape:

- top level: `schemaVersion` (integer, starts at 1), `generatedAt`
  (ISO 8601 UTC), `mode`, and `tasks` (sorted by id)
- per task: `id`, `slug`, `title`, `status`, `stage`, `category`,
  `priority`, `deps`, `discoveredFrom`, `blockedReason`, and `escalation`
  (present only when the plan parked one: `{fork, options}` summary)
- item 7 surfaces, present only when the underlying state exists: per-task
  `claim` (`{by, at}`) and top-level `maxParallelTasks`

Absent field means exact legacy semantics, per the binding back-compat rule.
The contract evolves additively only; consumers gate on `schemaVersion` and
never sniff fields.

**Sequencing.** Slate order places this after item 7, but nothing in the core
projection depends on item 7. Johan may pull it forward to unblock control
plane P1; in that case the item 7 fields simply stay absent until item 7
lands.

**Mechanics.**
- New `snapshot` subcommand in `src/cli/cook.js`; projection logic in
  `src/core/` reusing the existing store readers (`collectTasks`). No new
  state on disk, no lock taken.
- Contract documented in `skills/cook/reference/jeff-state-schema.md` under a
  new "Snapshot projection" section, including the additive-only rule.
- `skills/cook/SKILL.md` gets one line: snapshot exists for external
  observers and is not part of the method loop.

**Test contract** (RED first).
- Golden test: fixture store in, exact documented JSON out, `tasks` sorted
  by id.
- Optionality: `claim` and `maxParallelTasks` appear when present in the
  store and are absent otherwise; a legacy store without item 7 state
  produces no item 7 fields.
- Read-only proof: store bytes identical before and after the command.
- Bats: exits 0 with parseable JSON in an initialized project; clear error
  and non-zero exit outside one; an invalid store still emits a snapshot.

**Acceptance criteria.**
- `cook snapshot --json` emits the documented, versioned schema, proven by
  golden test.
- Item 7 fields are strictly optional and absent on legacy stores.
- The command never mutates the store.
- The contract is documented in the state schema reference as additive-only.

Audit: not required (read-only projection; no trust boundary crossed).

---

## Non-goals (parked, do not implement)

- Operation-category targeted repair (item 4 is code-only).
- `cook all` in lite mode.
- Early-abort tripwire guardrails alongside implement.
- Compaction of done tasks into a living spec (OpenSpec pattern).
- Property-based testing as an additional gate (Kiro pattern).
- Trajectory-asserting eval fixtures for jeff's own regression testing.
- Any adoption of beads/Dolt as a state substrate; any graph runtime
  (LangGraph or similar); any durable-execution engine. The survey verdicts
  are settled: steal semantics, never dependencies.

## Release: 6.0.0

Alpha versions are allocated by **release order, not by slate item**. A merged
change that reaches the alpha track carries whichever `6.0.0-alpha.N` lockstep
metadata holds when it lands: the next unused number if the previous one has
already been tagged, otherwise the number already allocated and not yet tagged,
which absorbs it under the accumulation rule below. Either way the number
follows release order and takes whatever the merge contains, including a defect
fix that is not a slate item. Items 1 through 5 happened to align with
`6.0.0-alpha.1` through `6.0.0-alpha.5`; from `6.0.0-alpha.6` onward they do
not, and no item-to-alpha correspondence is claimed for any unreleased item.

What each alpha actually carried:

| Version | Contents |
| --- | --- |
| `6.0.0-alpha.1` | item 1 |
| `6.0.0-alpha.2` | item 2 |
| `6.0.0-alpha.3` | item 3 |
| `6.0.0-alpha.4` | item 4 |
| `6.0.0-alpha.5` | item 5 |
| `6.0.0-alpha.6` | item 8, pulled forward ahead of items 6 and 7 to unblock the control plane, per the sequencing note at §Item 8 |
| `6.0.0-alpha.7` | a combined release of every merge into `main` since the `6.0.0-alpha.6` tag, recorded below |

The merges into `main` recorded for `6.0.0-alpha.7` so far, in merge order:

- PR #177: the standalone TUI client shape locked.
- PR #180: the minimal `jeff` Rust CLI front door and the `control/`
  workspace, the work of issue #179.
- PR #181: command capability for the operation judgment stations, the work
  of issue #173, a defect fix and not a slate item.
- PR #183: the alpha version skew recorded in this section, closing issue
  #182.
- PR #185: the P1a `jeff graph` design spec.
- Issue #190: this correction to the record row, plus a repository-wide test
  floor banning `pull_request_target` under `.github/workflows/`. Named by
  issue rather than by PR because the merge does not exist while the text is
  being authored.

The list is a record kept by hand, so it is complete only up to its last
edit. Any merge landing after that and before the tag is cut joins
`6.0.0-alpha.7` too, under the accumulation rule below. Once the tag exists,
`git log --first-parent --merges 6.0.0-alpha.6..6.0.0-alpha.7` is the
authority for what the release actually took.

PR #187, carrying the six-location alpha.7 lockstep, the path-filtered Rust
CI workflow and the `--locked` lockfile guard for issues #186 and #188,
merged into PR #180's branch rather than into `main`, and reached `main`
inside #180. That nesting is why `git log --merges 6.0.0-alpha.6..HEAD`
counts a merge commit that `main` itself never took. Use `--first-parent` to
count merges into `main`; without it the two figures will not agree.

The sequence skips for two reasons, neither of them a mistake. Item 8 was
pulled forward under the sequencing note at §Item 8. Issue #173 then changed
shipped payload, and `scripts/release-check` requires any payload change to
carry a version strictly above the last tag, so `6.0.0-alpha.7` was the only
number available to it.

One number then covers a whole run of merges because allocation and tagging
are separate events. A version allocated in lockstep metadata but not yet tagged
absorbs every further merge until its tag is cut; only a merge landing after
a tag takes the next unused number. That is how `6.0.0-alpha.7` grew from one
defect fix into a combined release. This section records allocations and
never tag state: `git tag --list` is the authority for which alphas have
actually been tagged.

Issue #176, item 6, and item 7 remain. Each takes whichever number is current
when it merges: a fresh one if the previous number has been tagged by then,
otherwise the untagged number already allocated, shared with everything else
that merges before that tag.

- After Johan approves and merges each item, a separate operation task with
  exact operator approval creates that alpha's immutable bare tag (no `v`
  prefix), publishes it through the existing release process to npm `next`,
  and then refreshes the dogfood installs on Pi, OMP, Claude Code, and Codex.
  Never move or reuse an alpha tag or version. npm `latest` remains stable
  `5.0.0` throughout the alpha track.
- After all eight items have merged and item 7's `cook all` has dogfooded at
  least one real drain in this repo, a separately approved release task cuts
  plain **6.0.0**: consolidated notes
  covering all eight items (the semantic changes in items 4 and 5 are the
  majority-defining behavior changes), `package.json` bump, bare tag `6.0.0`
  (no `v` prefix), and publish per the existing release process
  (`make release-check`; the version cut itself is Johan's call to approve).
