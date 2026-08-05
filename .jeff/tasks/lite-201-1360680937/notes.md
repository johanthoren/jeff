# Plan

## Decision

- Complexity: `complex`.
- Audit: required. Claims cross filesystem containment, locking, concurrent mutation, task resolution, and model-owned Git worktree instructions.
- Refactor opportunity: `null`. No behavior-preserving deduplication, deletion, or harmonization is owed. `src/core/snapshot.js` tolerantly projects malformed or absent claim side files, while the drain primitives must fail closed around ownership. Item 8 snapshot refactoring is outside this task.

## Smallest production shape

Add one focused `src/core/drain.js` because readiness and claim lifecycle change together and independently of the already large CLI dispatcher. Keep it verdict-shaped like the reporter modules. Reuse `collectTasks`, `readConfig`, `readMode`, `assertStoreContained`, `locateTask`, and `withStoreLock`. Use Node filesystem primitives for `.claim` creation/removal. Add no dependency, scheduler, service, lane abstraction, compatibility shim, or snapshot work.

The focused core surface exercised by the tests is:

- `readyReport(root)`: full-mode JSON-lines ready projection.
- `claimReport(root, id, { by, now })`: status-checked, contained, locked atomic claim.
- `releaseReport(root, id)`: contained, locked release with an unclaimed error.
- `claimsReport(root, { now })`: JSON-lines active claims with `ageSeconds`.
- `maxParallelTasks(config)`: present positive integer or default `1`.

`claimReport` and `releaseReport` should reuse `withStoreLock` so a concurrent loser observes a completed winner record before naming its holder. The claim directory remains the ownership primitive. Reads stay fresh from disk. The CLI only parses and dispatches `ready`, `claim`, `release`, and `claims`; `cook all` remains model-owned prose, not a CLI scheduler.

## Ordered slices

1. Extend `configSchemaViolations` for optional positive-integer `maxParallelTasks` and implement the absent-field default of `1` in the focused drain core.
2. Implement full-mode `readyReport` and `claimsReport` from `collectTasks` plus contained claim reads, including terminal/pruned dependency satisfaction, claimed-task exclusion, priority/id ordering, JSON-lines projection, and injected-clock age calculation.
3. Implement full-mode `claimReport` and `releaseReport` with `locateTask`, store containment, `withStoreLock`, native atomic `.claim` directory creation, exact claim JSON, terminal/blocked refusal, holder errors, and unclaimed release errors.
4. Wire help and strict argument dispatch in `src/cli/cook.js`, including optional `--by`, a nonempty fallback holder, and fail-fast full-mode-only guards for every drain primitive.
5. Replace the reserved `cook all` line in `skills/cook/SKILL.md` with one scoped full-mode section containing the complete fresh-disk, capacity, worktree, lane, serialized integration, hidden-edge, stop, summary, stale-claim, resume, unchanged-gate, and no-scheduler contract. Lite reports `cook all` as full-mode-only.
6. Advance package, plugin, and lockfile versions together to `6.0.0-alpha.10`, then use the existing lockstep release checks. Do not add a second version assertion.

## Acceptance-criterion ledger

### AC1: ready set

- Disposition: `write`.
- Consumer-observable behavior: `cook ready` emits exactly `{id, slug, title, priority, deps}` per line. Only unclaimed pending/in-progress tasks whose dependencies are terminal live tasks or pruned ids appear. Blocked, missing, and live non-terminal dependencies remain unsatisfied. Rows sort by priority then numeric id.
- Deterministic outcome seam: `src/core/drain.test.js` builds one isolated matrix containing done, abandoned, blocked, missing, live, pruned, and claimed cases and compares parsed JSON lines exactly. `tests/cook-all.bats` checks the public CLI projection and ordering.

### AC2: claims

- Disposition: `write`.
- Consumer-observable behavior: `cook claim <id> [--by <label>]` creates exactly one `.claim/claim.json` with a nonempty holder and ISO timestamp. Concurrent callers admit one winner. An existing claim reports its holder. Blocked, done, and abandoned tasks are refused without claim residue.
- Deterministic outcome seam: concurrent `Promise.all` calls use one isolated task and an injected fixed clock; the result codes must be `[0,1]` and the persisted object must match the winner. A pre-existing fixed holder makes the holder error deterministic. Status cases assert both refusal and absent `.claim`. Bats covers explicit and omitted `--by` parsing.

### AC3: release and listing

- Disposition: `write`.
- Consumer-observable behavior: `cook release <id>` removes an active claim and errors on repetition. `cook claims` lists every active holder, timestamp, and age without auto-breaking even a very old claim.
- Deterministic outcome seam: core listing injects `2026-08-05T12:00:00.000Z` and asserts exact ages of 3600 and 7200 seconds. Release asserts directory removal followed by an `unclaimed` error. Bats parses JSON lines and confirms a claim dated in 2000 remains on disk.

### AC4: configuration

- Disposition: `write`.
- Consumer-observable behavior: absent `maxParallelTasks` resolves to `1`; positive integers are accepted; zero, negatives, fractional numbers, strings, null, and booleans fail validation.
- Deterministic outcome seam: a pure validation matrix and pure default accessor in `src/core/drain.test.js`, with no filesystem, clock, or network.

### AC5: operational claim state

- Disposition: `write`.
- Consumer-observable behavior: adding `.claim/claim.json` neither changes `collectTasks` output nor makes `cook validate` fail. Claims are never auto-broken.
- Deterministic outcome seam: the checked-JS test compares collection before and after adding a fixed claim. The Bats fixture validates a claimed full-mode task and separately confirms an old listed claim remains present.

### AC6: full-mode prose and lite refusal

- Disposition: `write`.
- Consumer-observable behavior: the shipped cook skill contains one scoped, complete model-owned `cook all` contract, removes the reserved text, names only the four CLI primitives, and tells lite consumers that `cook all` is full-mode-only. Drain primitives fail before task mutation in lite mode.
- Deterministic outcome seam: `tests/cook-all.bats` scopes marker checks to the `cook all` heading and checks commands, state names, invariant phrases, model ownership, no scheduler, and lite refusal. An isolated lite fixture calls all four primitives and confirms full-mode-only errors plus no claim mutation.

### AC7: parallel lanes and unchanged integration gate

- Disposition: `write`.
- Consumer-observable behavior: capacity two uses a task branch and linked worktree for every simultaneous claim; capacity one stays serial. Lanes run independently, integration lands in completion order at the main checkout, and every integrated task receives its existing named green/clean root-HEAD gate before done and release.
- Deterministic outcome seam: the new scoped prose tests bind capacity, worktree, branch, completion-order integration, root-HEAD gate, and cleanup requirements. Existing `tests/verify.bats` linked-worktree cases and `src/cli/record.test.js` named-task gate assertions are reused unchanged for executable gate/worktree behavior. No scheduler test is added because no scheduler is allowed.

### AC8: lockstep alpha release

- Disposition: `reuse`.
- Consumer-observable behavior: package, plugin, and lockfile metadata publish the same next unused version, `6.0.0-alpha.10`.
- Deterministic outcome seam: existing `tests/release-check.bats`, `tests/plugin-manifest.bats`, and package publishing checks remain the single lockstep release contract. The implementer changes metadata and later runs the established focused release checks; the plan adds no literal-version duplicate.

## Focused RED

Command:

```sh
sh -c 'node --test src/core/drain.test.js; node_rc=$?; bats tests/cook-all.bats; bats_rc=$?; [ "$node_rc" -eq 0 ] && [ "$bats_rc" -eq 0 ]'
```

Result: exit `1`.

Decisive output:

```text
node:test: tests 9, pass 1, fail 8
ERR_MODULE_NOT_FOUND: src/core/drain.js
AssertionError: invalid value passed validation: 0
Bats: 1..11; validate/collection characterization passed; 10 item-7 tests failed
cook: unknown subcommand: ready
cook: unknown subcommand: claim
cook: unknown subcommand: claims
cook: unknown subcommand: release
lite guard lacked a full-mode-only refusal
skills/cook/SKILL.md has no scoped cook all section
```

The green checked-JS and Bats cases are deliberate preservation seams for `.claim` collection and validation indifference. Every RED is caused by missing item 7 production or prose behavior, not syntax, fixture setup, network, uncontrolled timing, or shared state.

## Plan re-entry: checked-JS contract repair

### Decision

- Complexity: `complex`.
- Audit: required. The task still crosses filesystem containment, locking, concurrent mutation, task resolution, and model-owned Git worktree instructions.
- Refactor opportunity: `null`. This repair owes no behavior-preserving deduplication, deletion, or harmonization.
- Approach: preserve every assertion and runtime fixture, add only conventional JSDoc parameter types to `writeTask`, `writeClaim`, and `exists`, and declare the blocked/terminal fixture table as `Array<[number, string]>`. Leave `src/core/drain.js` unchanged so its dependency callback remains the focused implementation RED.

### Ordered remaining slices

1. Implement the type-only production repair at `src/core/drain.js:90` by explicitly typing the `deps.every` callback input without changing dependency-satisfaction behavior.
2. Run `node --test src/core/drain.test.js` and `make typecheck`; require all nine focused tests and the checked-JS gate to pass after the production repair.

### Acceptance-criterion disposition

#### AC1: ready set

- Disposition: `reuse`.
- Consumer-observable behavior: `cook ready` emits exactly the ready task projection ordered by priority then numeric id, with claimed tasks and tasks with unsatisfied dependencies excluded.
- Deterministic outcome seam: the existing ready-set matrix in `src/core/drain.test.js:64` compares parsed JSON lines exactly; its assertions are unchanged.

#### AC2: claims

- Disposition: `reuse`.
- Consumer-observable behavior: claiming writes one complete holder/timestamp record, admits one concurrent winner, reports an existing holder, and refuses blocked or terminal tasks without residue.
- Deterministic outcome seam: the existing fixed-clock and isolated-temp-root tests at `src/core/drain.test.js:95`, `src/core/drain.test.js:117`, and `src/core/drain.test.js:133` remain unchanged.

#### AC3: release and listing

- Disposition: `reuse`.
- Consumer-observable behavior: release removes an active claim and rejects repetition; claim listing reports every active claim with deterministic age and does not auto-break old claims.
- Deterministic outcome seam: the existing release and injected-clock listing tests at `src/core/drain.test.js:162` and `src/core/drain.test.js:181` remain unchanged.

#### AC4: configuration

- Disposition: `reuse`.
- Consumer-observable behavior: absent `maxParallelTasks` resolves to `1`; only positive integers are accepted.
- Deterministic outcome seam: the existing pure accessor and validation matrices at `src/core/drain.test.js:204` and `src/core/drain.test.js:212` remain unchanged.

#### AC5: operational claim state

- Disposition: `reuse`.
- Consumer-observable behavior: `.claim` state does not alter task collection or validation and is never auto-broken.
- Deterministic outcome seam: the existing before/after collection comparison at `src/core/drain.test.js:225` remains unchanged; the existing Bats validation seam remains the public CLI coverage.

#### AC6: full-mode prose and lite refusal

- Disposition: `reuse`.
- Consumer-observable behavior: the model-owned full-mode drain contract uses only the four atomic primitives, while lite mode refuses them before mutation.
- Deterministic outcome seam: the existing scoped assertions and isolated lite fixture in `tests/cook-all.bats` remain unchanged.

#### AC7: parallel lanes and unchanged integration gate

- Disposition: `reuse`.
- Consumer-observable behavior: capacity two uses independent linked worktrees with serialized integration, capacity one remains serial, and each task retains its existing green root-HEAD gate.
- Deterministic outcome seam: the existing scoped prose assertions in `tests/cook-all.bats`, linked-worktree coverage in `tests/verify.bats`, and named gate assertions in `src/cli/record.test.js` remain unchanged.

#### AC8: lockstep alpha release

- Disposition: `reuse`.
- Consumer-observable behavior: package, plugin, and lockfile metadata remain aligned at `6.0.0-alpha.10`.
- Deterministic outcome seam: existing release, manifest, and package publishing checks remain the single lockstep contract.

### Focused RED after plan repair

- `node --test src/core/drain.test.js`: exit `0`; 9 tests, 9 passed, 0 failed.
- `make typecheck`: exit `2`; sole diagnostic is `src/core/drain.js(90,37): error TS7006: Parameter 'id' implicitly has an 'any' type.`
- `src/core/drain.test.js` has no remaining checked-JS diagnostic. The plan repair changed annotations only; all assertions and runtime behavior are unchanged.

## Plan re-entry: legacy vacant audit archive

### Decision

- Complexity: `complex`.
- Audit: required. The task still crosses filesystem containment, locking, concurrent mutation, task resolution, and model-owned Git worktree instructions.
- Refactor opportunity: `null`. The production change is a compatibility correction at the archive boundary, not an additional behavior-preserving cleanup.
- Approach: preserve all existing recorder assertions and add one public-recorder regression. The fixture starts from the accepted legacy required-audit placeholder without `findings`, records a surviving review blocker routed through `plan`, records the replacement plan, and then records a green implementation. The observable contract is that the implementation return persists, advances to review, and archives a schema-valid canonical audit placeholder with `findings: []`.

### Ordered remaining slices

1. Normalize an accepted vacant legacy audit when `src/core/record.js` archives a code judgment row so the archived placeholder contains `findings: []` and retains its required flag, `na` verdict, null identity, and empty evidence.
2. Run `node --test --test-name-pattern "required vacant legacy audit" src/cli/record.test.js`, `node --test src/core/drain.test.js`, and `make typecheck`; require both focused contracts and checked-JS to pass. Do not run the full suite in this scoped repair.

### Acceptance-criterion disposition

- AC1-AC6: `reuse`. The ready, claim, release, listing, configuration, operational-state, prose, and lite-refusal consumer behaviors and deterministic seams recorded above are unchanged.
- AC7: `revise`. The parallel-lane and root-HEAD gate behavior is unchanged; the deterministic completion seam now additionally requires the public recorder to accept a green post-plan repair when the live task carries the historical-compatible vacant required-audit shape, archive it canonically, and advance to review.
- AC8: `reuse`. The lockstep release behavior and existing release seams are unchanged.

### Focused RED

Command:

```sh
node --test --test-name-pattern "required vacant legacy audit" src/cli/record.test.js
```

Result: exit `1`; 1 test, 0 passed, 1 failed.

Decisive output:

```text
Error: [schema] judgmentHistory[0].audit.findings is invalid
    at src/core/record.js:1152:34
    at async TestContext.<anonymous> (src/cli/record.test.js:6545:22)
```

The failure occurs while recording the green implementation return through the public recorder. `make typecheck` is green at checkpoint `5733792`, and `src/core/drain.js:90` now carries the implemented number annotation. The new regression adds one assertion path and changes no existing assertion.


## Plan re-entry: cycle-1 drain contract repair

### Decision

- Complexity: `complex`.
- Audit: required. The repair coordinates parallel worktrees, one authoritative task store and lock, a private Git integration checkpoint, the full-suite gate, judgment recording, and the terminal recorder's current-HEAD check.
- Refactor opportunity: `null`. This repair owes no behavior-preserving deduplication, deletion, or harmonization.
- Scope: revise only the shipped `cook all` orchestration prose during implementation. Add no scheduler, task state, CLI verb, dependency, schema field, gate, or production state mechanism.

### Coherent lane transition

1. Resolve the absolute main-checkout root once before opening lanes and export it as `COOK_ROOT`. Every drain CLI state read or write inherits that value, including ready/claims, claim/release, journal, record, approval/reverify, named verification, and validation. The existing CLI root resolver then directs every task lookup and mutation to the main `.jeff` store and its single `.record-lock`.
2. Keep lane work on its task branch and linked worktree. In completion order, reserve the main checkout for one landing lane, create a private integration checkpoint from current trunk, and integrate the lane into that checkpoint without moving trunk.
3. Run the sole `cook verify --task <id>` gate at the main root on that clean private checkpoint. Keep both the main checkout HEAD and trunk stable while review and required audit judge that exact checkpoint. Later completed lanes wait for the serialized landing slot.
4. Record every non-terminal judgment return immediately. A blocker is recorded and routed without advancing trunk. When the final required passing return arrives and every sibling judgment already passes, hold only that terminal-causing return during one reversible operation: fast-forward the trunk ref to the exact gated hash while leaving the main checkout HEAD at that same hash. Record the held return immediately afterward. The recorder therefore observes `tests.gate.hash === current main-root HEAD` and transitions the task to `done`.
5. Release the claim, remove the lane worktree, and perform the existing full-mode terminal prune and Git completion sequence. The exception to immediate recording is limited to the final passing return and only spans the exact-hash trunk fast-forward.

### Ordered slices

1. Add an explicit `cook all` routing-table row before the generic `cook <arg>` task-id fallback. The row selects the bounded drain in full mode and the full-mode-only refusal in lite mode.
2. Add one scoped root data-flow paragraph to the `cook all` section. It captures and exports the absolute main root through `COOK_ROOT`, names every drain CLI state operation, and binds them to the same `.record-lock`.
3. Replace the current completion step with the ordered private-checkpoint, one-gate, judgment, exact-hash trunk, terminal-record, release sequence above. State the one-return recording exception explicitly and leave the general Loop, Git, Verification, and terminal mechanics unchanged.
4. Run `bats tests/cook-all.bats`. The three new regressions must pass with all eleven existing focused contracts still intact.

### Acceptance-criterion ledger

#### AC1: ready set

- Disposition: `reuse`.
- Consumer-observable behavior: `cook ready` continues to emit the exact ready projection in priority then id order and excludes claimed or dependency-blocked tasks.
- Deterministic outcome seam: the existing isolated CLI and core ready-set matrices remain unchanged.

#### AC2: claims

- Disposition: `reuse`.
- Consumer-observable behavior: claims remain atomic, holder-identifying, ISO-dated, and unavailable to blocked or terminal tasks.
- Deterministic outcome seam: the existing isolated concurrent core test and CLI claim cases remain unchanged.

#### AC3: release and listing

- Disposition: `reuse`.
- Consumer-observable behavior: release removes one active claim and rejects an unclaimed task; claim listing retains every active claim.
- Deterministic outcome seam: the existing release and injected-clock listing tests remain unchanged.

#### AC4: configuration

- Disposition: `reuse`.
- Consumer-observable behavior: `maxParallelTasks` still defaults to 1 and accepts only positive integers.
- Deterministic outcome seam: the existing pure accessor and validation matrices remain unchanged.

#### AC5: operational claim state

- Disposition: `reuse`.
- Consumer-observable behavior: `.claim` remains operational state ignored by task collection and validation, and no claim is automatically broken.
- Deterministic outcome seam: the existing collection comparison and Bats validation case remain unchanged.

#### AC6: reachable full-mode drain and lite refusal

- Disposition: `write`.
- Consumer-observable behavior: a typed `cook all` reaches the bounded full-mode drain before the generic task-id fallback; in lite it reaches the explicit full-mode-only refusal.
- Deterministic outcome seam: `tests/cook-all.bats:269` extracts only the closed request-routing table, requires one row containing both outcomes, and proves that row precedes the fallback.

#### AC7: shared-root parallel lanes and one coherent gate

- Disposition: `write`.
- Consumer-observable behavior: every lane command reads or mutates one authoritative main store under one lock. Each completion uses a private integrated checkpoint while trunk is unchanged, gates that checkpoint once before judgments, advances trunk only to the identical passing hash, and records the terminal return while the main-root HEAD still equals `gate.hash`.
- Deterministic outcome seam: `tests/cook-all.bats:294` confines all named state operations, `COOK_ROOT`, the main root, and the shared lock to one paragraph. `tests/cook-all.bats:327` extracts completion step 4 and compares the line order of checkpoint, gate, judgments, trunk, final record, and release while requiring the narrowly scoped final-return exception.

#### AC8: lockstep alpha release

- Disposition: `reuse`.
- Consumer-observable behavior: package, plugin, and lockfile versions remain aligned at the allocated alpha.
- Deterministic outcome seam: existing release, manifest, and publishing checks remain the sole lockstep contract.

### Focused RED

Command:

```sh
bats tests/cook-all.bats
```

Result: exit `1`; 14 tests, 11 passed, 3 failed.

Exact output:

```text
1..14
ok 1 ready CLI emits exact task projections in priority then id order
ok 2 claim CLI accepts --by and persists a complete ISO-dated claim
ok 3 claim CLI supplies a nonempty holder when --by is omitted
ok 4 claims CLI emits each holder with a numeric age
ok 5 release CLI removes an active claim and refuses an unclaimed task
ok 6 validate and task collection ignore operational claim state
ok 7 drain primitives refuse lite mode before touching task state
ok 8 cook all contract replaces the reserved line and keeps orchestration model-owned
not ok 9 explicit cook all routes to the drain before task-id fallback
# (from function `require_regex' in file tests/cook-all.bats, line 131,
#  in test file tests/cook-all.bats, line 276)
#   `require_regex "$routing" '^\|.*explicit.*cook all.*\|.*pipeline.*\|.*full[- ]mode.*drain.*lite.*full[- ]mode[- ]only.*\|$' 'explicit cook all routing row with full and lite outcomes'' failed
# missing cook all contract: explicit cook all routing row with full and lite outcomes
ok 10 cook all contract refreshes capacity and isolates simultaneous lanes
not ok 11 cook all binds every lane state operation to one main store root
# (in test file tests/cook-all.bats, line 299)
#   `return 1' failed
# missing cook all contract: authoritative COOK_ROOT data flow
ok 12 cook all contract preserves lane gates and serialized completion-order landing
not ok 13 cook all orders one integrated checkpoint through terminal recording
# (from function `require_fixed' in file tests/cook-all.bats, line 123,
#  in test file tests/cook-all.bats, line 334)
#   `require_fixed "$completion" 'private integration checkpoint'' failed
# missing cook all contract marker: private integration checkpoint
ok 14 cook all contract handles hidden edges, lane-local stops, drain completion, and resume
```

The three failures map one-to-one to explicit routing, authoritative root propagation, and integrated terminal ordering. The eleven pre-existing focused tests pass unchanged. There is no syntax, fixture, clock, network, or unrelated production failure.