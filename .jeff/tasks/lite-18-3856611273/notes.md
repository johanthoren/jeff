# Task notes

## Capture

Capture was locked by Johan on 2026-07-05 for the Phase 1 issue slate. The current GitHub issue body matches that locked definition, so no re-interrogation or issue rewrite was needed.

Task #27 merged through PR #59 before this task began. Task #18 starts from remote `main` at `ac6240a22af91f82b78258742bf26da0ef5bf5a7`.

## Plan

Complexity is `complex`. The change joins a strict untrusted-input contract, task-path resolution, stage transitions, separation invariants, atomic filesystem writes, subprocess verification, and Pi plus Claude Code host boundaries. Audit is required by the task's mechanical floor.

### YAGNI decision

Use JSON and Node's standard `JSON.parse`; do not add a YAML or schema dependency. Keep the settled #40 stage return field names and enums, adding only the dispatch-owned `agent_id` field to the strict file. Put the closed return contracts and state transitions in one checked-JS core module. The CLI reads the file and resolves the task, Pi passes its dispatch result to the same core API, and Claude Code reaches it through `cook record`. Neither adapter owns schema or transition rules. Reuse `collectTasks`, `readTask`, and `writeTask`; the existing same-directory exclusive temp plus rename is the atomic commit boundary.

The bridge validates and records supplied judgments. It does not choose a verdict, synthesize findings, dispatch another stage, or run a workflow loop.

### Ordered slices

1. Define one closed JSON contract per current specialist stage, composed from small validators for evidence, findings, AC rows, runs, kickbacks, refutes, and convergence records. Reject invalid JSON as `[record-json]` and missing, mistyped, enum-invalid, or extra fields as `[record-schema] <path>`.
2. Add a pure transition from `(task, stage, specialistReturn)` to a new task. Record the stage identity and applicable result or verdict, findings, evidence, kickback, refute, convergence, and next state. Run the authoritative task-schema and separation predicates on the candidate before any write.
3. Add a single side-effecting record service that finds the task by its stored id, refuses ambiguous or missing matches and symlink escapes, reads once, validates once, then persists once through `writeTask`. Wire `cook record <stage> <id> <file>` to it.
4. Extend `cook verify --task <id>` so the existing full-suite result, HEAD, clean state, command, and timestamp form `tests.gate` and `tests.evidence`, then write through the same task service. A red run records a red gate and leaves `tests.green=false` while preserving the test command's exit status.
5. Feed Pi's dispatch result and Claude Code's returned file through the same core record service. Host code may normalize transport metadata such as `agent_id`; it must not duplicate contract validation or transitions. Update the specialist return render layer to emit the strict JSON shape without changing its settled semantic fields.
6. Keep the compatibility Bash wrapper routing the new host-neutral CLI verbs. Do not port unrelated verbs or add autonomous dispatch.

### Acceptance-criterion test ledger

- AC1, `write`: a consumer can pass a strict plan JSON return to `cook record` and observe the task advance; malformed JSON and an extra top-level field fail with distinct named errors and leave `task.json` byte-identical. Seam: isolated lite store plus spawned checked-JS CLI.
- AC2, `write`: valid plan and review returns persist their identity, verdict/result-owned state, findings, evidence, and next stage in one resulting task document. Kickback, refute, and convergence variants use the same table-driven core transition tests in the implementation slice. Seam: read the single persisted `task.json` after the CLI exits.
- AC3, `write`: an implement return whose `agent_id` equals `tests.authored_by_agent_id`, and a review return whose id equals the implementer, both fail with `[inv1]` or `[inv2]` before write. Seam: compare raw task bytes before and after.
- AC4, `write`: an invalid review finding class is rejected at the exact `findings[0].class` path. Valid review findings and evidence round-trip. The stage-contract table must also cover all severity, class, destination-stage, and required-evidence enums without duplicating one test per literal. Seam: strict validator through the CLI boundary.
- AC5, `revise`: `cook verify --task 18` on a clean isolated Git fixture records `tests.green`, evidence, and the gate's hash, clean flag, command, result, and ISO timestamp directly in the selected task. Seam: deterministic `true` command and a locally committed `.gitignore` that excludes `.jeff/`.
- AC6, `write`: Pi dispatch with a task target and Claude Code's file path both reach the exported core record service; adapter tests assert the resulting task behavior, not private helper calls. A source-level review confirms there is no second schema or transition table.
- AC7, `reuse`: current dispatch and orchestration tests already constrain role sessions and the thin host boundary. No change-detector test is owed for the absence of autonomy; review re-derives that the record core performs validation plus one transition and write only.
- AC8, `write` plus `reuse`: the new CLI tests cover valid returns, malformed input, extra fields, separation, and verify-to-task. `src/core/store.test.js` already deterministically covers atomic rename failure, temp cleanup, and rejection, so duplicate failure machinery is not owed. Add a record-service injection test only if implementation bypasses `writeTask`, which the plan forbids.

### Test files and targeted RED

Changed:

- `src/cli/record.test.js`
- `src/cli/verify-parity.test.js`

Command:

`node --test src/cli/record.test.js src/cli/verify-parity.test.js`

Decisive RED:

```text
record accepts the strict plan return and advances the task atomically
AssertionError: cook: unknown subcommand: record (try `cook help`)

lite verify --task records the green gate and evidence directly in the selected task
AssertionError: cook: verify: unknown option '--task'
```

The remaining existing verify parity cases stay green. The failures are the intended missing public behaviors, not fixture, syntax, or environment failures.
