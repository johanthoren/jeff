# Context map

## Source contract

- `.jeff/tasks/lite-201-1360680937/task.md:1`: task #201 goal, AC1-AC8, non-goals, scope, and required audit.
- `docs/specs/graph-slate-6.0.md:501`: item 7 full-mode parallel DAG drain specification.
- `docs/specs/graph-slate-6.0.md:514`: four CLI primitives and store/lock constraint.
- `docs/specs/graph-slate-6.0.md:517`: ready-set definition and ordering.
- `docs/specs/graph-slate-6.0.md:522`: claim directory, holder, and timestamp contract.
- `docs/specs/graph-slate-6.0.md:526`: release and claims contract.
- `docs/specs/graph-slate-6.0.md:529`: `maxParallelTasks` validation and default.
- `docs/specs/graph-slate-6.0.md:535`: model-owned drain prose.
- `docs/specs/graph-slate-6.0.md:581`: RED test contract.

## Production paths and symbols

- `src/cli/cook.js:10`: core imports.
- `src/cli/cook.js:65`: help report.
- `src/cli/cook.js:104`: no-argument verb dispatch map.
- `src/cli/cook.js:163`: CLI root resolution and subcommand dispatch.
- `src/core/store.js:26`: `assertStoreContained`.
- `src/core/store.js:93`: `readTask`.
- `src/core/store.js:143`: `collectTasks` reads depth-two task files and ignores nested operational directories.
- `src/core/store.js:223`: `readConfig`.
- `src/core/store.js:244`: `readMode`.
- `src/core/store-lock.js:17`: `withStoreLock` serializes mutations through `.jeff/.record-lock`.
- `src/core/store-lock.js:50`: `locateTask` resolves one collected id and rejects ambiguity, symlinks, and escapes.
- `src/core/task-schema.js:95`: `configSchemaViolations`; it currently validates full-mode `prunedTaskIds` only.
- `src/core/snapshot.js:82`: private tolerant `readClaim` projection for item 8 snapshot state.
- `src/core/snapshot.js:145`: `buildSnapshot` accepts an injected clock.
- `skills/cook/SKILL.md:109`: bounded full-mode `cook all` drain contract.
- `src/core/drain.js:90`: `deps.every` dependency-satisfaction callback with a checked-JS `number` annotation.
- `src/core/record.js:137`: `judgmentHistoryEntry` builds the archived code judgment row from the live outcomes.
- `src/core/record.js:268`: `archiveAndResetJudgments` appends the history row before resetting live outcomes.
- `src/core/task-schema.js:655`: archived code judgment validation requires audit findings except for the four-field unaudited legacy shape.

## Test paths and seams

- `src/core/drain.test.js:28`: `writeTask` typed fixture helper.
- `src/core/drain.test.js:47`: `writeClaim` typed fixture helper.
- `src/core/drain.test.js:54`: `exists` typed fixture helper.
- `src/core/drain.test.js:64`: ready-set matrix and priority/id ordering.
- `src/core/drain.test.js:95`: concurrent atomic claim.
- `src/core/drain.test.js:117`: existing-holder error.
- `src/core/drain.test.js:133`: blocked and terminal refusal.
- `src/core/drain.test.js:136`: explicit `Array<[number, string]>` fixture table.
- `src/core/drain.test.js:162`: release and unclaimed error.
- `src/core/drain.test.js:181`: deterministic claim ages through an injected clock.
- `src/core/drain.test.js:204`: optional/default capacity.
- `src/core/drain.test.js:212`: positive-integer config validation matrix.
- `src/core/drain.test.js:225`: `collectTasks` claim indifference.
- `tests/cook-all.bats:115`: public ready CLI contract.
- `tests/cook-all.bats:132`: explicit `--by` claim CLI contract.
- `tests/cook-all.bats:147`: omitted `--by` holder contract.
- `tests/cook-all.bats:157`: claims CLI age and no-auto-break contract.
- `tests/cook-all.bats:175`: release CLI contract.
- `tests/cook-all.bats:189`: validation claim indifference.
- `tests/cook-all.bats:199`: full-mode guard for all four drain primitives.
- `tests/cook-all.bats:212`: scoped prose contract begins.
- `tests/verify.bats:289`: linked-worktree verification preserves configured suite status.
- `tests/verify.bats:399`: green, clean, current-HEAD baseline behavior.
- `src/cli/record.test.js:2843`: named task verification binds gate hash, cleanliness, result, command, and evidence to only the selected task.
- `src/cli/record.test.js:4571`: verified gate hash equals the current scoped-fix HEAD and is green/clean.
- `src/cli/record.test.js:6508`: public-recorder regression for a required vacant legacy audit across review-to-plan repair.
- `tests/release-check.bats`: existing release/version checks.
- `tests/plugin-manifest.bats`: existing manifest lockstep checks.

## Focused commands

- Drain runtime contract: `node --test src/core/drain.test.js`
- Legacy audit archive contract: `node --test --test-name-pattern "required vacant legacy audit" src/cli/record.test.js`
- Checked-JS contract: `make typecheck`
- Current drain runtime result: 9 tests passed, 0 failed.
- Current legacy audit archive result: 1 test failed with `[schema] judgmentHistory[0].audit.findings is invalid`.
- Current checked-JS result: `make: ok`.
## Mechanical constraints

- Branch: `item-7-cook-all`.
- Task directory: `.jeff/tasks/lite-201-1360680937`.
- Plan changes are limited to tests, `notes.md`, and `context.md`.
- Production, skill prose, documentation, package metadata, lockfiles, and task ledger are unchanged in the plan commit.
- Full suite, formatter, linter, scanner, and release check are excluded from this plan re-entry; only focused Node tests and `make typecheck` run.
- Item 8 snapshot projection, scheduler processes, services, dependencies, compatibility shims, lane orchestration in the CLI, automatic stale-claim breakage, task-stage dispatch, judgment parallelism, store-lock semantics, and suite-gate count are outside item 7 production scope.
- Version allocation named by the task is `6.0.0-alpha.10`.
