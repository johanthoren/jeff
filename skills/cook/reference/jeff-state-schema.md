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
- `.jeff/tasks/<dir>/context.md`: optional facts-only repository map whose task scope plan owns; plan creates and refreshes it, while implement and refactor maintain facts encountered during assigned code work.
- `.jeff/tasks/<dir>/journal.jsonl`: optional per-task append-only operational provenance, created on first journal append and pruned with the task directory.
- `.jeff/memory/`: project memory.

Old layout (`.jeff/orders/` + `batches/` + 8 phase files + `proof/ledger.json` + `role-runs/`) is dropped.

## `task.json`

`src/core/types.js` owns the canonical task vocabulary. `src/core/task-schema.js`
owns persisted field names, types, enums, defaults, and the task, config, and
convergence shapes. `src/core/invariants.js` owns enforced relationships and
completion gates.

### Lifecycle and compatibility

- Capture locks `category` by primary outcome. Historical omission remains code. Canonical operation ledgers carry the current operation-state marker; unmarked schema-v1 operation ledgers use the checked legacy branch, while code ledgers never enter it.
- Code and operation follow separate closed stage graphs. Historical code ledgers may resume from the retired `test` stage. A terminal status and terminal stage remain equivalent.
- Pipeline-version data is optional provenance and does not participate in a 6.0 gate. Canonical writers include it. The deprecated branch value and historical brain data remain accepted and ignored; new records omit both.
- Dependencies schedule work. Full mode accepts live predecessors and terminal predecessors retained by prune provenance, while lite mode checks only local dependency cycles. Discovery provenance records origin but never schedules. Historical omission preserves the earlier behavior.
- Complexity describes complecting and non-local risk, not difficulty or Git topology. Historical omission defaults to complex.
- Code plans retain a named behavior-preserving refactor opportunity or `null`. Operation plans retain their runbook, preconditions, recovery and approval boundaries, postconditions, and deterministic verification seams. An unresolved operation fork remains parked at plan until an answered plan replaces it.
- The recorder binds stage identities from host-observed IDs. Code keeps test-author, implementer, reviewer, and auditor separation; operation keeps executor, verifier, and auditor separation. Historical code identity representations remain compatible, but dual-populated representations must agree. Complex code completion requires two passing reviews; simple and identified historical records retain the single-review path.
- Operation approval requests and grants are append-only provenance. A pending request must match the planned boundary exactly. The executor cannot grant its own request, and completed approval-gated execution binds the active request and retained grant before verification.
- Operation verification is independent of execution evidence. Completion preserves the plan and requires one ordered, evidenced, successful result for every planned postcondition from a verifier distinct from the executor. Resolved follow-ups and demoted findings remain durable.
- Judgment history is append-only. Scoped repair archives the whole current judgment cycle once. `cook reverify <id>` is limited to a completed execution with a current `needs-work` verification-only failure and untouched recovery state before any refute, kickback, or council recovery; it appends the superseded judgment to `judgmentHistory`, clears only the live verification slot, preserves execution and approvals, and requires a fresh verifier.
- Kickbacks preserve source, destination, reason, and any typed finding contract. Typed code findings alone authorize scoped implement or refactor repair. Operation kickbacks remain limited to the operation graph, and a council-scoped execute kickback to capture or plan terminates as blocked-to-operator.
- Blocked and abandoned states retain their reasons. Done means the category-specific done-gate holds.

## `journal.jsonl`

`src/core/journal.js` owns journal event names, stages, required and optional
fields, and validation. The optional per-task journal is append-only. Writers
allocate the next sequence after the greatest valid prior sequence while holding
the shared `.record-lock`.

`cook journal <id> intent --stage <s> [--note <text>]` and `cook journal
<id> external [--note <text>]` are the operator-authored surfaces. Successful
`cook record`, `cook approve`, and tracked `cook verify --task <id>` append
their provenance automatically after candidate validation and before task
persistence, all under the shared store lock. If later task persistence fails,
the appended provenance remains because there is no cross-file rollback.
Malformed JSON or invalid events warn and are skipped when reading; their bytes
stay unchanged. Appends fail closed and surface containment, lock, read, or write
errors. The journal is operational provenance, not validated state: `cook
validate` ignores it in 6.0, and historical task directories without one remain
valid.

## `convergence` (optional bounded judgment-loop termination)

Code and operation judgments reuse the same cap, source-bound refute, K=3 council vote, retained resolved findings, and one-scoped-cycle terminal mechanism.

**Optional, with strict back-compat.** A `task.json` without convergence state
validates exactly as before: its counters are treated as zero and INV-7 through
INV-11 are skipped. No migration is required; historical completed tasks remain
untouched.

`src/core/types.js` and `src/core/task-schema.js` own the convergence fields,
types, enums, defaults, and persisted shape. `src/core/invariants.js` owns the
relationships below.

### Lifecycle semantics

- Category-specific judgment counters are independent. A council can convene only when its triggering source reaches the exact cap.
- A canonical council records three distinct, host-observed members and three non-identical independent inquiry packets before deterministic synthesis. At least one inquiry carries the exact defects-versus-reconstruction question. Every inquiry votes every active source-bound finding exactly once; persisted tallies, survival, verdict, and synthesis blockers are derived from those votes.
- A blocking canonical code council may add one optional recovery episode to the same task. The recovery route is one of confined repair, test-contract repair, refactor, causal-subgraph reconstruction, full replan, or operator escalation, and must equal the synthesis selection. Baseline gate, fresh test-author identity, and fresh builder identity remain inspectable in the existing convergence record.
- The route reuses the linear stage machine. Test-contract repair moves from fresh plan/test authorship directly to the gate-facing review state; reconstruction and replan continue to implement; direct refactor records the refactorer as builder. A clean full-suite gate precedes fresh, identity-separated judgments, and a surviving blocker exhausts the episode to the operator.
- Findings, inquiries, synthesis, prior checkpoints, judgment history, and recovery evidence remain on the original task. Historical councils may omit inquiry, synthesis, and recovery and retain their prior scoped-fix meaning. Existing operation recovery semantics are unchanged.
- A source may spend one evidence-scaled bonus cycle only after a confined typed repair strictly reduces its findings.

### Validator invariants (INV-7..INV-11)

All are pure functions of the recorded state: deterministic, fail-closed,
consistent with the existing invariants. **Absent `convergence` ⇒ all skipped.**

- **INV-7:** category-specific counters are integers in `0..cap`. Each source's
  kickbacks that carry a typed `findings` contract are bounded at `cap`, or at
  `cap + 1` when that source records `bonusGranted: true`; untyped judgment
  kickbacks (a council block, a false-verification kick) stay outside the bound.
  A recorded `bonusGranted: true` additionally requires its enabling evidence:
  that source's last typed kickback is confined to `implement | refactor` and
  carries strictly fewer findings than its predecessor.
- **INV-8:** a convened council has exactly three distinct lenses, a category-valid exact-cap trigger stage, and required builder/judge separation. When canonical research is present, all three inquiry packets are complete and non-identical, and the required reconstruction question occurs exactly as specified. Operation councils also retain cycle and baseline-executor provenance and exclude archived judges/refuters.
- **INV-9 (per-finding determinism):** for each finding,
  `survived == (blockingVotes ≥ 2)`; and `verdict == ("block" if any finding
  survived else "ship")`. Canonical blocking councils additionally derive each
  tally from the independent votes and require synthesis to list exactly the
  surviving finding ids and select one of its materially different strategies.
- **INV-10 (follow-up tracking):** every demoted finding (`survived == false`)
  records a `followupTaskId` that exists in the task set, or the literal
  `"ledger"`, which the validator accepts without reading any file; every
  surviving finding has `followupTaskId == null`.
- **INV-11 (block resolution / done-gate):** a present code recovery is episode 1, matches the synthesis route, preserves recovery-role identity separation, and cannot attach code routes to operations. `verdict == "block" && outcome == "blocked-to-operator"` implies `status == "blocked"`. A done task with a convened blocking council requires `outcome == "scoped-fix-shipped"`. Marked operation state additionally proves one adjacent post-council execution and fresh reassessment from its retained cycle provenance.


## Code targeted repair and INV-12

At the `implement` or `refactor` record following ordinary code judgment kickbacks, repair is scoped only when every applicable kickback in the active round has nonempty typed findings, every finding targets `implement | refactor`, every recorded file set across an owed implement/refactor chain is a nonempty subset of the finding file union, and no council is pending or convened. Live failing identities relative to the latest archived row distinguish active from consumed provenance; equal whole-second timestamps only group same-round sources. Category omission retains its historical code meaning. Every other path uses the existing full judgment reset.

A scoped repair appends the whole current code judgment entry to `judgmentHistory` once. A raising `review` source clears `review`, `review2`, and both reviewer identities. A raising `audit` source clears only `audit` and its identity. When both raise in one round, all judgment slots clear. Independently passing siblings retain the exact identity and deep-equal outcome from the latest archived row. A later owed stage outside the same typed file contract triggers the full reset. Convergence counters do not change. Every implement or refactor repair clears `tests.gate` and sets `tests.green` to false.

- **INV-12 (targeted repair retention):** code only. Select the actual latest judgment kickback before reading `findings`; an absent or empty latest contract cannot borrow authorization from an older typed round, but does not invalidate a genuine full reset with fresh identities. A live identity found in an older row but not the latest row is stale; equal output under an identity absent from history is fresh. Retention requires aligned `implement | refactor` contracts for every same-round raising source, the exact latest archived row, a successful confined repair at every recorded stage in the repair path, and a passing live sibling whose identity owners and full outcome equal that latest row. Missing history remains historical-compatible. Any stale, non-passing, source-, identity-, outcome-, or file-mismatched retention proof violates `[inv12]`.

## Task registry

The `.jeff/tasks/<NNNN>-<slug>/` dirs are the live registry. `cook ls` / `cook status` enumerate them, and "next ready task" is computed from on-disk `task.json`s (`status` plus live `deps`). Optional full-mode config provenance `prunedTaskIds` records only terminal task ids whose directories were removed; it never duplicates live task state. (The retired `index.json` registry, a duplicate of the dirs that drifted, was dropped in task 0065.)

## `config.json` (`mode`: full vs lite)

`src/core/types.js` and `src/core/task-schema.js` own the config fields, types,
defaults, and persisted shape. A missing config retains historical full-mode
behavior. `cook init` preserves that default; `cook lite` selects lite mode.

Full mode reads its full-suite gate command from config and fails closed when it
is unavailable. Lite mode reads the command from the operating profile instead
of duplicating it into config. Full mode may retain terminal predecessor
provenance after pruning; absence preserves the legacy live-predecessor rule,
and lite mode ignores that provenance.

- **Full mode** (the default): the committed task dirs, validated by the full invariant set below. Jeff runs `cook validate` before each stage-boundary commit; CI runs `make validate` on push. No git pre-commit hook is installed in any mode.
- **Lite mode** (for a shared repo): the `.jeff/` store is git-excluded locally (`.git/info/exclude`, never committed) and **no** pre-commit hook is installed. The team owns the tracker and merge; jeff contributes only its quality machinery. Activated by `cook lite` (or its explicit natural-language twin; see `skills/cook/SKILL.md`).

### Lite validator subset

`cook validate` branches on `config.mode`:

- **full / absent.** Empty `tasks/` (no task dirs) ⇒ "nothing to validate", exit 0; otherwise runs the **full** invariant set over the on-disk task dirs: the schema/done-gate quality invariants (INV-1, INV-2, INV-4), the convergence block (INV-7..11), **and** the registry invariants: numeric-`id` requirement, dependency and discovery provenance + live-task cycles (INV-5), duplicate-id, and `[prune]`. When `prunedTaskIds` is absent, dependency and discovery provenance fall back to the legacy live-task rule.
- **lite: quality subset plus local cycle safety.** Runs INV-1 (test author ≠ implementer), INV-2 (category-specific persisted identity binding and builder/judge separation), INV-4 (done-gate), and the INV-7..11 convergence block over each run-ledger `task.json`. The existing INV-5 Kahn pass rejects cycles using only dependency edges whose endpoints both exist in the local ledger set; unresolvable ids, including external tracker refs, are ignored. Lite drops full-mode dependency and discovery provenance, duplicate-id, and `[prune]` checks (a lite run-ledger legitimately retains a local `done` record), and accepts string task ids. Config provenance is ignored.

Before either mode's semantic checks, the core validates the persisted shape and
reports field-named `[schema]` failures. Full validation and task updates treat a
truly missing config as the legacy full-mode default, but reject a present
unreadable, uncontained, malformed, or non-object config before writing task
state. In full mode, present `prunedTaskIds` must contain only unique positive
integers and no live ids. Lite mode does not interpret the field. The
compatibility reader accepts and ignores historical `brains`, `branch`,
`agents.plan_agent_id`, and `agents.test_author_agent_id`; it also accepts
omitted `review2`, `agents.reviewer2_agent_id`, `convergence`, and `tests.gate`.
Canonical writers do not expose the historical fields, and canonical stages do
not include the legacy resume-only `test` value. Historical convergence records
may also omit a council member's `temperature` or a finding's `followupTaskId`;
canonical writers include both.

**`[prune]` (registry invariant, task 0063; full mode only):** a `done`/`abandoned` task dir must not rest in the committed store. After the record earns its terminal status and immediately before removing its exact directory, append its id once to config `prunedTaskIds`. Successor `deps` stay unchanged. INV-5 then treats pruned ids as satisfied predecessors while continuing to reject missing ids and cycles among live tasks. The terminal task archive remains git history/tags, not a resting `0NNN/` dir. Completion follows a fixed gate -> terminal record -> append provenance -> remove terminal dir -> validate -> commit order (see `skills/cook/SKILL.md` -> Validation). Lite drops this invariant and ignores config provenance.

**Separation invariants (the load-bearing property: the implementer must not have shaped the tests it has to pass):**
- **INV-1**: `tests.authored_by_agent_id ≠ agents.implementer_agent_id` (the combined test designer/author is not the implementer).
- **INV-2**: for code tasks, including historical category omission, `agents.implementer_agent_id` differs from both reviewer identities and every populated audit identity. Every populated primary-review identity participates in separation; its outcome and agents representations must match only when both are populated. A populated `review2` outcome identity is bound to `agents.reviewer2_agent_id`. Historical code audit records may populate either audit identity alone; when both are populated they match. A code audit with `pass` or `needs-work` requires at least one populated auditor identity; null/null is valid only for `na`. For operation tasks, executor and verifier differ; a populated auditor is bound in both audit identity fields and differs from both. Historical plan/test identity fields do not participate.
- **INV-4**: a done task satisfies the test disposition, has a passing primary
  review, has a recorded passing second review when complexity is `complex`,
  preserves the single-review path when complexity is `simple` or the historical
  record carries retired plan/test agent fields, and has an audit verdict of
  `pass` or `na`.

**Done-gate full-suite binding (`[gate]`, task 0044):** when a `done` task records `tests.gate`, the validator asserts `gate.green == true` AND `gate.clean == true` AND `gate.hash` is a non-empty string, and that `tests.green == true` is backed by `gate.green == true`: so `tests.green` can only stand on a recorded green+clean full-suite run (written by `cook verify`), never on a targeted-subset run. It is a pure function of `task.json` (no per-task git probe); gate freshness (the gated hash matching the tree at done) is enforced at write time by Jeff via `cook verify` / `cook baseline check`. **Null-tolerant:** `tests.gate` absent ⇒ skipped, so the historical `done` tasks (which carry no gate) keep validating. Runs in both full and lite mode (a done-gate quality invariant, not a registry one).

The lite run-ledger uses the checked task shape without full-mode registry
obligations. `src/core/types.js` and `src/core/task-schema.js` own its fields and
types. Lite adoption binds the external plan location as the ledger's
idempotency key, so named-task routing resumes the matching local ledger instead
of creating another one.

## Dropped from the old schema

`phase` / `phaseIndex` / 8-file `artifacts` map, `flowState`, `resume` (`command`/`artifact`/`requiredInputs`), `kind`, `batchId` + entire `BatchState`, `disposition` (folded into `status`), `abandonRefs` / `abandonNote` / `abandonedAt` (keep only `abandonReason`), the gate/proof ledger, all attestation/digest fields, `cookSlices`.

## Snapshot projection

`cook snapshot --json` prints one versioned JSON document that projects the
active store for external read-only observers (for example a control-plane
backend). It never takes a lock, never writes under `.jeff/`, and does not
judge legality: an invalid-but-parseable store still projects so observers can
see broken state. Legality remains `cook validate`.

The projection is **additive-only**. Absent fields mean exact legacy semantics.
Consumers gate on `schemaVersion` and never sniff fields for meaning.

`src/core/snapshot.js` owns the projection's document fields, types, task
whitelist, optional side-file projections, and task ordering. Optional data is
omitted when its underlying state is absent or unreadable.

Outside an initialized project (no readable `.jeff/config.json`), the command
exits non-zero with a clear `cook: snapshot: …` error.

