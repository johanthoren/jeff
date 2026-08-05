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
