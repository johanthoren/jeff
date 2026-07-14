# jeff: State Schema (extract)

`src/core/types.js` is the canonical checked-JS task vocabulary and
`src/core/task-schema.js` plus `src/core/invariants.js` are the authoritative
runtime validator. The Node CLI's `validate` route consumes that core through
`src/cli/cook.js`.
The Bash validator remains a transition oracle for intentionally unchanged
behavior; it is not a second source of truth for destination schema changes.

## On-disk layout

- `.jeff/tasks/<NNNN>-<slug>/task.json`: per-task structured state (the canonical source; the dirs are the registry).
- `.jeff/tasks/<NNNN>-<slug>/task.md`: spec (the `capture` output: goal, acceptance criteria, non-goals, scope).
- `.jeff/tasks/<NNNN>-<slug>/notes.md`: running notes, kickback findings, decisions.
- `.jeff/memory/`: project memory.

Old layout (`.jeff/orders/` + `batches/` + 8 phase files + `proof/ledger.json` + `role-runs/`) is dropped.

## `task.json`

```json
{
  "schemaVersion": 1,
  "id": 1,
  "slug": "kebab-case-slug",
  "title": "Human-readable title",
  "status": "pending",
  "stage": "capture",
  "priority": "p2",
  "deps": [],
  "createdAt": "2026-06-13T12:00:00.000Z",
  "updatedAt": "2026-06-13T12:00:00.000Z",
  "complexity": "complex",
  "agents": {
    "implementer_agent_id": null,
    "reviewer_agent_id": null,
    "reviewer2_agent_id": null,
    "audit_agent_id": null
  },
  "tests":  { "authored_by_agent_id": null, "green": false, "evidence": [] },
  "review": { "verdict": null, "reviewer_agent_id": null, "evidence": [] },
  "review2": null,
  "audit":  { "required": false, "verdict": "na", "audit_agent_id": null, "evidence": [] },
  "commits": [],
  "kickbacks": [],
  "blockedReason": null,
  "abandonReason": null
}
```

### Field rules (carried from the old schema where sensible)

- `id`: positive integer, unique. Task dir = `<id zero-padded to 4>-<slug>`.
- `slug`: non-empty, kebab-case.
- `title`: non-empty.
- `status` ∈ `pending | in_progress | blocked | done | abandoned`.
- `stage` ∈ `capture | plan | implement | refactor | review | audit | done`; historical ledgers may persist `test`, which readers accept as the documented compatibility-resume state. Canonical writers never emit `test`.
- `priority` ∈ `p0 | p1 | p2 | p3 | p4`.
- `createdAt` / `updatedAt`: calendar-valid ISO-8601 datetimes. The same strict
  timestamp contract applies to `tests.gate.at` and every `kickbacks[*].at`.
- `deps`: array of existing task ids; the graph must be acyclic.
- `complexity`: `"simple" | "complex"` (absent ⇒ `"complex"`). Set or refine it at plan by whether the change complects or carries risk: braids concerns, couples previously separate things, crosses subsystem boundaries, or has non-local side effects. Classify by complecting, not difficulty; deployment or other non-local side effects ⇒ `"complex"`; default `"complex"` when unsure. It does not select Git topology.
- `branch` (optional, deprecated): ignored legacy state. New records omit it; validators continue to accept old records containing it without migration.
- Historical records may contain a `brains` field. Validators ignore it and accept those records unchanged; new records omit it. Dispatch evidence may report the child session's actual provider/model/effort.
- `agents.*`: harness agent ids recorded by Jeff from implementation, review, and audit dispatches. Complex tasks use both `reviewer_agent_id` and `reviewer2_agent_id`; each reviewer must differ from the implementer. Historical `plan_agent_id` and `test_author_agent_id` fields are accepted and ignored; new ledgers omit them.
- `tests`: `authored_by_agent_id` set to the combined `plan` stage's agent id; `green` is boolean `true`/`false` (set `true` only with cited command `evidence`) **or** the string `"na"` (task 0049). `"na"` is the justified-terminal-no-test done-state: a `None`-disposition acceptance criterion (terminal/declarative, with no consumer-observable behavior to test) records `tests.green == "na"` instead of a manufactured green. On a `done` task the `[inv4]` check accepts `"na"` only when `tests.evidence` is non-empty (the cited justification, reusing the same evidence slot a `true` green uses: no new field) **and** `review.verdict == "pass"` (reviewer-agreed); such a task has no test author (`authored_by_agent_id == null` is allowed). Only the literal `"na"` is accepted; boolean `false` and any other value stay refused. Optional `tests.gate` (the `"gate"` key under `"tests"`) records the full-suite gate result that backs `green`: `{ "hash": "<sha>", "clean": true, "green": true, "command": "<cmd>", "at": "<iso>" }`, written by Jeff from a `cook verify` run. Absent on tasks captured before this field; when present on a `done` task the `[gate]` validator check enforces it (green+clean with a non-empty hash, and `tests.green` backed by `gate.green`).
- Canonical `review` and optional `review2` share the same shape: `verdict` is
  `pass | needs-work | null`, `reviewer_agent_id` is a string or null, and
  `evidence` is an array. The runtime reader additionally accepts `na` only for
  historical primary `review.verdict` values; canonical writers and `review2`
  remain strict. `review2` may be absent or null for historical and single-review
  records. For the primary review, historical records may populate either the
  outcome identity or `agents.reviewer_agent_id`; every populated identity must
  differ from the implementer, and the two identities must match when both are
  populated. `review2` remains canonically bound to
  `agents.reviewer2_agent_id`. A complex done task requires both recorded reviews
  to pass; simple tasks and historical records identified by the retired
  plan/test agent fields retain the single-review path.
- `audit`: `required` set by `plan`; `verdict` ∈ `pass | needs-work | na`.
- `kickbacks`: `[{ from, to, reason, at }]`. Current sources are canonical stage
  names plus `verify`; current destinations are canonical stage names. The
  runtime reader also accepts the retired `test` destination in historical
  records without making `test` a canonical task stage.
- `status = blocked` ⇒ `blockedReason` non-null.
- `status = abandoned` ⇒ `abandonReason` non-null.
- `status = done` ⇒ the done-gate holds (validator invariant 4).

## `convergence` (optional: review/audit loop termination)

Records how the review/audit loop converged for this task: the per-stage
blocking-kickback counters, and (if a cap was hit) the one task-wide council's
membership, per-finding votes, verdict, and outcome. See task 0002 and
`AGENTS.md` for the mechanism (severity gate from cycle 1, per-stage cap, K=3
council with per-finding ≥2 majority, scoped-fix-or-escalate termination).

**Optional, with strict back-compat.** A `task.json` *without* `convergence`
validates exactly as before (treated as defaulted/zeroed); invariants INV-7..11
are skipped entirely. No migration: only 0002+ carry the block; 0001 (done) is
never touched.

```jsonc
"convergence": {
  "cap": 2,                                  // int ≥ 1: per-stage blocking-kickback cap
  "stages": {
    "review": { "blockingKickbacks": 0 },    // int 0..cap
    "audit":  { "blockingKickbacks": 0 }     // int 0..cap (independent counter)
  },
  "council": {
    "convened": false,                       // bool: true once the complete task-wide council returns
    "stage": null,                           // null | "review" | "audit" (cap trigger/recovery compatibility)
    "members": [],                           // when convened: EXACTLY 3
    //   member = { "agent_id": str, "lens": "integrity"|"security"|"pragmatist", "temperature": number|null }
    "findings": [],                          // when convened: exact active source+summary blocker union
    //   finding = { "id": str, "summary": str, "source": "review"|"review2"|"audit",
    //               "blockingVotes": int 0..3,
    //               "survived": bool, "followupTaskId": int|null }
    "verdict": null,                         // null | "ship" | "block"
    "outcome": null                          // null | "shipped" | "scoped-fix-shipped" | "blocked-to-operator"
  }
}
```

### Field rules

- `cap`: integer ≥ 1. Per-stage blocking-kickback cap (default 2 in the protocol).
- `stages.review` / `stages.audit`: independent `{ blockingKickbacks }` counters.
  Only **blocking**-severity kickbacks increment a counter; follow-ups never do.
- `council.convened`: `true` once a stage reaches the cap, every required active
  judgment and source-bound surviving refute is present, and the one task-wide
  council returns; else `false`.
- `council.stage`: which stage triggered the council: `review` or `audit` (when
  convened). It remains for recovery and historical compatibility, not scope.
- `council.members`: the K=3 lenses. `lens` ∈ `integrity | security | pragmatist`
  (each used exactly once). `temperature` records the intended decorrelation
  temperature (or `null` where the dispatch can't set one). Member separation
  is scoped to the active judgment cycle; historical identities may serve again.
- `council.findings`: exactly the active blocking union across `review`,
  `review2`, and `audit`, matched by originating `source` plus finding summary.
  New initial council returns require `source`; persisted historical findings
  and their recovery replay may omit it. Omission, invention, duplication, a missing source-bound surviving
  refute, or a wrong source rejects before persistence. Scoped recovery archives
  and clears every judgment slot.
  `blockingVotes` ∈ 0..3 (one per lens). `survived` is a pure function of the
  votes (see INV-9). `followupTaskId` references a spawned backlog task for
  demoted findings; `null` for survivors.
- `council.verdict`: `block` iff any finding survived, else `ship` (INV-9).
- `council.outcome`: `shipped` (verdict ship), `scoped-fix-shipped` (verdict
  block, the one scoped fix passed verification → reached done), or
  `blocked-to-operator` (scoped fix failed → handed off, `status=blocked`).
  After a scoped fix, all reviews and the audit run fresh. Their identities must
  differ from the scoped implementer, but may reuse identities from prior cycles.

### Validator invariants (INV-7..INV-11)

All are pure functions of the recorded state: deterministic, fail-closed,
consistent with the existing invariants. **Absent `convergence` ⇒ all skipped.**

- **INV-7 (shape/range):** `cap` is an integer ≥ 1; each
  `stages.{review,audit}.blockingKickbacks` is an integer in `0..cap`.
- **INV-8 (council distinctness):** when `convened`, `members` has exactly 3
  entries; their `agent_id`s are mutually distinct and none equals
  the active `agents.reviewer_agent_id` or `agents.implementer_agent_id`; the three `lens`
  values are exactly `integrity`, `security`, `pragmatist`; `council.stage` ∈
  `{review, audit}`.
- **INV-9 (per-finding determinism):** for each finding,
  `survived == (blockingVotes ≥ 2)`; and `verdict == ("block" if any finding
  survived else "ship")`. The ship/block decision is reproducible from the
  recorded tallies.
- **INV-10 (follow-up tracking):** every demoted finding (`survived == false`)
  records a `followupTaskId` that exists in the task set; every surviving finding
  has `followupTaskId == null`.
- **INV-11 (block resolution / done-gate):**
  `verdict == "block" && outcome == "blocked-to-operator"` ⇒ `status == "blocked"`;
  and `status == "done"` with a convened council whose `verdict == "block"` is
  permitted **only** when `outcome == "scoped-fix-shipped"` (a council-block may
  reach done only via the one verified scoped fix).


## Task registry

There is no separate registry file: the `.jeff/tasks/<NNNN>-<slug>/` dirs **are** the registry. `cook ls` / `cook status` enumerate them; "next ready task" and "next id" are *computed* from the on-disk `task.json`s (`status` + `deps`), never stored. (The retired `index.json` registry (a duplicate of the dirs that drifted) was dropped in task 0065.)

## `config.json` (`mode`: full vs lite)

`.jeff/config.json` carries the per-project mode:

```json
{ "schemaVersion": 1, "system": "jeff", "mode": "lite", "active": true }
```

- `mode` ∈ `full | lite`. **Absent ⇒ `full`** (back-compat: every pre-lite store reads as full and validates byte-identically to today). `cook init` leaves `mode` unset (full); `cook lite` writes `mode:"lite"`.
- `testCommand` (string, full mode; optional): the project's full-suite gate command, run by `cook verify` as the verdict (exit 0 = green). Absent/empty ⇒ `cook verify` fails closed (it never falls back to a hardcoded default). In lite mode the command is read instead from the operating profile's `Test command:` prose line (single-source; not duplicated into config).
- **Full mode** (the default): the committed task dirs, validated by the full invariant set below. Jeff runs `cook validate` before each stage-boundary commit; CI runs `make validate` on push. No git pre-commit hook is installed in any mode.
- **Lite mode** (for a shared repo): the `.jeff/` store is git-excluded locally (`.git/info/exclude`, never committed) and **no** pre-commit hook is installed. The team owns the tracker and merge; jeff contributes only its quality machinery. Activated by `cook lite` (or its explicit natural-language twin; see `skills/cook/SKILL.md`).

### Lite validator subset

`cook validate` branches on `config.mode`:

- **full / absent.** Empty `tasks/` (no task dirs) ⇒ "nothing to validate", exit 0; otherwise runs the **full** invariant set over the on-disk task dirs: the schema/done-gate quality invariants (INV-1, INV-2, INV-4), the convergence block (INV-7..11), **and** the registry invariants: numeric-`id` requirement, `deps` reference existing tasks + no cycles (INV-5), duplicate-id, and `[prune]`.
- **lite: quality subset only.** Runs INV-1 (test author ≠ implementer), INV-2 (implementer differs from every reviewer), INV-4 (done-gate), and the INV-7..11 convergence block over each run-ledger `task.json`. **Drops** the registry invariants: a string `id` (an external tracker ref, e.g. `"JIRA-42"`) is accepted, INV-5 (dep DAG), duplicate-id, and `[prune]` are **skipped** (a lite run-ledger legitimately retains a local `done` record).

Before either mode's semantic checks, the core validates the persisted shape and
reports field-named `[schema]` failures. The compatibility reader accepts and
ignores historical `brains`, `branch`, `agents.plan_agent_id`, and
`agents.test_author_agent_id`; it also accepts omitted `review2`,
`agents.reviewer2_agent_id`, `convergence`, and `tests.gate`. Canonical writers
do not expose the historical fields, and canonical stages do not include the
legacy resume-only `test` value. Historical convergence records may also omit a
council member's `temperature` or a finding's `followupTaskId`; canonical
writers include both.

**`[prune]` (registry invariant, task 0063; full mode only):** a `done`/`abandoned` task dir must not rest in the committed store. Terminal tasks are pruned at completion (the dir is removed, satisfied deps stripped, the removal committed to trunk); the archive is git history/tags and memory, not a resting `0NNN/` dir. Because a present `done` record (validated by `[gate]`/INV-4) and an absent terminal dir cannot both hold in one committed tree, completion follows a fixed gate -> remove -> validate -> commit order (see `skills/cook/SKILL.md` → Validation), so a legitimately-completing task is never blocked. Lite drops it (the team tracker owns the lifecycle and the lite store is never committed, so there is no git-history archive to fall back on).

**Separation invariants (the load-bearing property: the implementer must not have shaped the tests it has to pass):**
- **INV-1**: `tests.authored_by_agent_id ≠ agents.implementer_agent_id` (the combined test designer/author is not the implementer).
- **INV-2**: `agents.implementer_agent_id` differs from both `agents.reviewer_agent_id` and optional `agents.reviewer2_agent_id` (no reviewer wrote the code). Every populated primary-review identity participates in separation; the outcome and agents representations must match only when both are populated. A populated `review2` outcome identity is bound to `agents.reviewer2_agent_id`. Historical plan/test identity fields do not participate.
- **INV-4**: a done task satisfies the test disposition, has a passing primary
  review, has a recorded passing second review when complexity is `complex`,
  preserves the single-review path when complexity is `simple` or the historical
  record carries retired plan/test agent fields, and has an audit verdict of
  `pass` or `na`.

**Done-gate full-suite binding (`[gate]`, task 0044):** when a `done` task records `tests.gate`, the validator asserts `gate.green == true` AND `gate.clean == true` AND `gate.hash` is a non-empty string, and that `tests.green == true` is backed by `gate.green == true`: so `tests.green` can only stand on a recorded green+clean full-suite run (written by `cook verify`), never on a targeted-subset run. It is a pure function of `task.json` (no per-task git probe); gate freshness (the gated hash matching the tree at done) is enforced at write time by Jeff via `cook verify` / `cook baseline check`. **Null-tolerant:** `tests.gate` absent ⇒ skipped, so the historical `done` tasks (which carry no gate) keep validating. Runs in both full and lite mode (a done-gate quality invariant, not a registry one).

The lite **run-ledger** is the `task.json` shape above minus the registry-only obligations: `id` may be a string.

- `externalRef` (string, lite only): the plan location a ledger was **adopted** from by `cook on <ref>`: a markdown plan ref (`docs/plans/foo.md`, `PLAN.md`, or `PLAN.md#anchor`), and in later adapters a tracker ref. On adoption `id` is set to this same ref. It is the **idempotency key**: re-running `cook on <ref>` resumes the ledger whose `externalRef` matches rather than creating a second one. Absent on registry (full-mode) tasks.

## Dropped from the old schema

`phase` / `phaseIndex` / 8-file `artifacts` map, `flowState`, `resume` (`command`/`artifact`/`requiredInputs`), `kind`, `batchId` + entire `BatchState`, `disposition` (folded into `status`), `abandonRefs` / `abandonNote` / `abandonedAt` (keep only `abandonReason`), the gate/proof ledger, all attestation/digest fields, `cookSlices`.
