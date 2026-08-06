# Context map

## Task and source contract

- `.jeff/tasks/lite-201-1360680937/task.md:1`: task #201 goal, AC1-AC8, non-goals, scope, and required audit.
- `.jeff/tasks/lite-201-1360680937/task.json:43`: cycle-1 review outcomes and surviving routing, shared-root, and gate-order findings.
- `.jeff/tasks/lite-201-1360680937/task.json:552`: surviving routing refutes.
- `.jeff/tasks/lite-201-1360680937/task.json:603`: surviving shared-root refute.
- `.jeff/tasks/lite-201-1360680937/task.json:640`: surviving gate-order refute.
- `docs/specs/graph-slate-6.0.md:501`: item 7 full-mode parallel DAG drain specification.
- `docs/specs/graph-slate-6.0.md:514`: atomic CLI primitives under existing containment and lock discipline.
- `docs/specs/graph-slate-6.0.md:535`: model-owned drain loop.
- `docs/specs/graph-slate-6.0.md:575`: unchanged store-write, judgment, suite-gate, and runtime constraints.

## Shipped instruction paths

- `skills/cook/SKILL.md:65`: closed explicit-request routing table.
- `skills/cook/SKILL.md:79`: generic unrecognized `cook <arg>` task-id fallback.
- `skills/cook/SKILL.md:91`: Entry gives the routing table authority over explicit `cook` invocations.
- `skills/cook/SKILL.md:109`: bounded full-mode `cook all` drain section.
- `skills/cook/SKILL.md:115`: fresh ready/claim read and lane-open step.
- `skills/cook/SKILL.md:118`: current completion-order integration, gate, done, release, and cleanup step.
- `skills/cook/SKILL.md:129`: per-task Loop.
- `skills/cook/SKILL.md:133`: specialist returns are recorded through `cook record`.
- `skills/cook/SKILL.md:229`: Git checkpoint and off-trunk constraints.
- `skills/cook/SKILL.md:240`: one-gate verification protocol and post-checkpoint judgments.
- `skills/cook/reference/full-mode.md:47`: terminal-with-removal sequence after a full-mode task becomes terminal.

## Runtime mechanics

- `src/cli/cook.js:30`: `gitTopLevel` resolves the current worktree top-level.
- `src/cli/cook.js:170`: CLI entry.
- `src/cli/cook.js:174`: root precedence is `COOK_ROOT`, current Git top-level, then cwd.
- `src/core/store-lock.js:17`: `withStoreLock` uses `<root>/.jeff/.record-lock`.
- `src/core/store-lock.js:50`: `locateTask` resolves a task below the supplied root.
- `src/core/drain.js:115`: claim mutation uses the supplied root and store lock.
- `src/core/drain.js:157`: release mutation uses the supplied root and store lock.
- `src/core/record.js:215`: `settleJudgments` transitions code tasks after all required review and audit outcomes exist.
- `src/core/record.js:1103`: `updateTask` runs record transitions under the supplied root's store lock.
- `src/core/record.js:1117`: an in-progress code task entering done requires a present clean green gate.
- `src/core/record.js:1122`: terminal recording reads Git HEAD from the supplied root.
- `src/core/record.js:1126`: terminal recording requires `gate.hash` to equal that HEAD.
- `src/core/record.js:1135`: terminal recording requires a clean tree before writing task state.

## Focused test paths and seams

- `tests/cook-all.bats:75`: scoped `cook all` section extractor.
- `tests/cook-all.bats:92`: closed request-routing table extractor.
- `tests/cook-all.bats:101`: drain completion-step extractor.
- `tests/cook-all.bats:110`: paragraph extractor for one bounded data-flow contract.
- `tests/cook-all.bats:135`: ordered-marker assertion helper.
- `tests/cook-all.bats:269`: explicit `cook all` route and fallback-precedence contract.
- `tests/cook-all.bats:294`: authoritative `COOK_ROOT`, all lane state commands, and shared-lock contract.
- `tests/cook-all.bats:310`: existing lane gate and serialized landing marker contract.
- `tests/cook-all.bats:327`: ordered integrated checkpoint, gate, judgments, trunk, terminal record, and release contract.

## Focused command

- Targeted RED: `bats tests/cook-all.bats`
- Current result: exit 1; 14 tests, 11 passed, 3 failed.
- Failure 9: missing explicit `cook all` routing row.
- Failure 11: missing authoritative `COOK_ROOT` data-flow paragraph.
- Failure 13: missing private integration checkpoint completion sequence.

## Mechanical constraints

- Repository root: `/Users/jthoren/code/jeff`.
- Branch: `item-7-cook-all`.
- Task directory: `.jeff/tasks/lite-201-1360680937`.
- Category: `code`.
- Stage: `plan`, cycle 1.
- Plan-owned writable files: tests, task `notes.md`, and task `context.md`.
- Production code, shipped skill prose, design docs, task metadata, task ledger, package metadata, and lockfiles are outside plan-stage writes.
- No scheduler, new task state, new CLI verb, dependency, schema change, automatic claim breakage, additional suite gate, or CLI lane orchestrator belongs to this repair.
