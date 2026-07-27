# jeff: State Schema (extract)

`src/core/types.js` is the canonical checked-JS task vocabulary and
`src/core/task-schema.js` plus `src/core/invariants.js` are the authoritative
runtime validator. The sole operational entry is `src/cli/cook.js`; it consumes
that checked-JS core directly. Historical Bash parity oracles, when retained as
test-only fixtures, are not installed runtimes or alternate schema authorities.

Jeff is a cooperative workflow protocol for a trusted operator and friendly agents, not a security sandbox. The schema validates ledger order, equality, provenance, evidence, separation, and completion; it does not claim to confine tools supplied by a host.

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
  "category": "code",
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
    "audit_agent_id": null,
    "executor_agent_id": null,
    "verifier_agent_id": null
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
- `category` is `code | operation`. Capture locks it by primary outcome. Omission is historical compatibility and behaves exactly as `code`.
- Code stages are `capture | plan | implement | refactor | review | audit | done`; operation stages are `capture | plan | execute | verify | audit | done`. Historical code ledgers may persist `test` as a compatibility-resume state. Category graphs and kickbacks are closed.
- `priority` ∈ `p0 | p1 | p2 | p3 | p4`.
- `createdAt` / `updatedAt`: calendar-valid ISO-8601 datetimes. The same strict
  timestamp contract applies to `tests.gate.at`, every `kickbacks[*].at`, and every approval `grantedAt`.
- `deps`: array of existing task ids; the graph must be acyclic.
- `complexity`: `"simple" | "complex"` (absent ⇒ `"complex"`). Set or refine it at plan by whether the change complects or carries risk: braids concerns, couples previously separate things, crosses subsystem boundaries, or has non-local side effects. Classify by complecting, not difficulty; deployment or other non-local side effects ⇒ `"complex"`; default `"complex"` when unsure. It does not select Git topology.
- Code `plan.refactorOpportunity` carries a nonempty named behavior-preserving opportunity or `null`; historical code plans may omit it. A completed operation plan requires `runbook`, `preconditions`, `recoveryBoundary`, exact operator-facing `approvalBoundary`, boolean `requiresApproval`, `postconditions`, and deterministic `verificationSeams`, and omits code test/refactor fields. An unresolved operation fork instead persists only `result:"escalation"`, nonempty `slices`, and nonnull `{fork, options}` while remaining at `plan`; the answered plan replaces it.
- `branch` (optional, deprecated): ignored legacy state. New records omit it; validators continue to accept old records containing it without migration.
- Historical records may contain a `brains` field. Validators ignore it and accept those records unchanged; new records omit it. Dispatch evidence may report the child session's actual provider/model/effort.
- `agents.*`: code records implementer/reviewer identities; operation records `executor_agent_id` and `verifier_agent_id`, which must differ. An operation audit binds `agents.audit_agent_id` to `audit.audit_agent_id`, and the auditor must differ from both the executor and verifier. Historical plan/test identities remain accepted and ignored.
- `tests`, `review`, and `review2`: authoritative only for code and omitted from canonical operation ledgers. Compatibility readers validate any present fields and fail closed on malformed shapes.
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
- `audit`: `required` set by `plan`; `verdict` ∈ `pass | needs-work | na`. A required operation audit cannot record `na`; code tasks, including historical category omission, retain their compatible required-`na` path.
- `execution`: operation execute result plus bound executor identity, nonempty action strings and nonempty command/output evidence, nullable `approvalRequired`, and optional operator-recorded `approval`. For `requiresApproval:true`, `approval-required` must equal `plan.approvalBoundary` byte-for-byte, retain the requesting executor identity, and remain at `execute`. The executor return cannot contain a grant. After the operator approves the displayed request, Jeff records it through host-neutral `cook approve <id> <operator>` and re-fires execute with a fresh specialist using ordinary host-native tools.
- `approvals`: optional append-only operation approval history. Each record is `{ mutation, grantedBy, grantedAt }`; `mutation` is the historical field name for the exact operator-facing request. The atomic parent transition copies only the active pending request. It rejects missing, changed, stale, duplicate, or executor-attributed grants. A `requiresApproval:true` plan cannot execute directly, and completed execution requires `execution.approval` to match the plan and one retained history entry exactly.
- `verification`: operation verdict plus bound verifier identity, deterministic `{ postcondition, ok, evidence }` results, findings, and nonempty command/output evidence. A fresh verifier uses the plan's deterministic methods with ordinary host-native read capabilities. An unavailable method produces `needs-work`; executor evidence is never sign-off. Done retains the plan and requires exactly one row per `plan.postconditions` item in identical order and text, with every row true and evidenced, and verifier different from executor. Follow-ups and refute- or exact council-demoted findings remain durable without blocking completion.
- `kickbacks`: `[{ from, to, reason, at }]`. Ordinary operation sources are `execute | verify | audit` and destinations are `capture | plan | execute`. A council-scoped execute kickback to capture or plan terminates as `blocked-to-operator`. Code keeps its existing graph, including historical `verify` source compatibility.
- `status = blocked` ⇒ `blockedReason` non-null.
- `status = abandoned` ⇒ `abandonReason` non-null.
- `status = done` ⇒ the done-gate holds (validator invariant 4).

## `convergence` (optional bounded judgment-loop termination)

Code uses `review`/`audit` counters and sources (`review`, `review2`, `audit`). Operation uses `verify`/`audit`. Both reuse the same cap, source-bound refute, K=3 council vote, retained resolved findings, and one-scoped-cycle terminal mechanism.

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

- `cap`: integer at least 1; default protocol cap is 2.
- Category-specific judgment counters are independent and increment only for source-bound surviving blocking findings. If any active source is already capped, its council marker takes precedence and no other counter or ordinary kickback advances.
- `council.stage` is the single cap trigger: `review | audit` for code or `verify | audit` for operation.
- `council.members`: the K=3 lenses. `lens` ∈ `integrity | security | pragmatist`
  (each used exactly once). `temperature` records the intended decorrelation
  temperature (or `null` where the dispatch can't set one). Member separation
  is scoped to the active judgment cycle; historical identities may serve again.
- `council.findings` is exactly the active blocking union for the category, matched by source plus summary. New returns require the source. Every blocker requires a source-bound surviving refute.
- `blockingVotes` is 0..3 and `survived == (blockingVotes >= 2)`. Demoted findings record a valid follow-up task id; survivors record `null`.
- `council.verdict` is `block` iff any finding survived, otherwise `ship`.
- A block permits one scoped `implement` cycle for code or `execute` cycle for operation. Fresh category-specific judgments must pass. Code additionally requires its fresh clean full-suite gate. An operation approval stop remains resumable, but a scoped execute kickback or failed reassessment ends as `blocked-to-operator`.

### Validator invariants (INV-7..INV-11)

All are pure functions of the recorded state: deterministic, fail-closed,
consistent with the existing invariants. **Absent `convergence` ⇒ all skipped.**

- **INV-7:** category-specific counters are integers in `0..cap`.
- **INV-8:** a convened council has exactly three distinct lenses, separated from the active builder and judges, and a category-valid trigger stage.
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
