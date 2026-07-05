---
name: testing
description: "Language-agnostic testing standards for writing effective tests. Covers test structure, what to test, mocking, and coverage goals. Make sure to use this skill whenever writing tests, doing TDD, reviewing test coverage, or when code changes should have tests added; testing standards apply to all code, not just dedicated test tasks. Language-specific skills, if present, may override these defaults."
---

# Testing Standards

Language-agnostic defaults. Language-specific skills override where they conflict.

**Golden Rule**: If you can't test it easily, refactor it.

## Structure and Naming

- Arrange, act, assert: set up the data, execute the code, verify the result. One behavior per test.
- Names state the expectation: `validateEmail returns false for invalid format`, not `it works` or `test user`.

## What to Test

- **DO**: happy path; edge cases (boundaries, empty, null); error cases (invalid input, failures); business logic; public APIs.
- **DON'T**: third-party libraries; framework internals; simple getters/setters; private implementation details.

## Coverage

Coverage is an outcome of testing the right intersections, not a target to chase. Not every line, and not every one-liner, needs a test; a one-line pass-through does not. Cover each behavior and its real edges; a task's acceptance criteria are the floor.

## Principles

- **Test behavior, not implementation**: focus on what, not how. Assert results, never that a mock was called with particular arguments: `expect(mock).toHaveBeenCalledWith(...)` pins procedure and goes red on a behavior-preserving refactor.
- **Would it survive a refactor?** If a behavior-preserving refactor would turn the test red, it tests procedure; rewrite it to assert the result. Procedure-coupled tests lock in design flaws.
- **Mock through injected boundaries**: dependency injection makes a hand-rolled fake (`{ findById: () => fixture }`) sufficient; no framework magic required.
- **Independent tests**: no shared state, any order, one assertion's worth of behavior each.
- **Fast and reliable**: run tests frequently; fix failures immediately.

## Change-Detector Tests Are a Banned Smell

A change-detector test asserts a value or call shape that no consumer observes, so it goes red on any edit to that value and catches no regression the edit would not. It is configuration duplicated into the test as a second place to edit. Do not write one.

- **Revise-for-behavior is correct; mutate-for-implementation is the smell** (Google, "Change-Detector Tests Considered Harmful"). Revising a test because the *behavior* a consumer observes changed is a legitimate **Change**. Mutating a test to track an *implementation detail or configuration value* is the smell. They look identical until you apply the discriminator.
- **Consumer-observable discriminator**: ask *"would a consumer notice if this value changed?"* If no consumer would notice, it was never a behavior change: it is **Preserve** (reuse the existing behavioral test, add none) or **None** (no test owed), and writing or revising an assertion for it *is* the smell.
- **Prefer a declarative constraint over a tautological assertion**. Do not assert `const FOO == "foo"` (the value restated). If the value must be constrained, bind it through a consumer-observable contract: e.g. assert the published manifest version satisfies a documented bound, not that a literal equals itself.
- **Reuse rule**: an internal-only optimization or refactor (no observable change) relies on the *existing* behavioral tests staying green. Add no new test for it.
- **Reject the "temporary implementation-check, auto-remove" pattern**. A test you intend to delete later because it only pins implementation is a change-detector test now. Do not add it.
- **Redundancy rule**: do not write a test for behavior already covered by an existing green test (overlapping objectives add maintenance cost, not signal). When a feature is removed, delete its now-obsolete tests; git is the archive.

## Determinism (prevent flaky tests)

A flaky test is a defect. Tests must be deterministic by construction; a single run cannot detect flakiness, so prevent it at design time.

- **Ban** real wall-clock reads, network calls, real filesystem timestamps, test-ordering dependence, shared mutable state across tests, unseeded randomness, and sleep-based timing.
- **Require** injected/faked boundaries (clock, network, filesystem, RNG) and a seeded RNG so each test is a pure function of its own fixture and passes in any order.

## Parallel Safety and Speed

**Parallel-safe by construction.** A suite must be safe to run in parallel: a correctness property, not an optimization, and the same independence that prevents flakiness is what makes parallel-by-default free.

- Each test owns isolated scratch: a fresh temp dir / fresh fixture per test, never a path two tests can both touch.
- Isolate from shared *host* state too: a test must not depend on or mutate global tooling config, daemons, or shared resources the host also uses (e.g. fixture `git commit`s inheriting the host's `commit.gpgsign` can exhaust a shared GPG agent and fail nondeterministically; give fixtures hermetic config).

**Default the runner to parallel** when setting up a project's test command; it is a one-time setup decision (`bats --jobs N`, `pytest -n auto`, `cargo nextest`, `go test`, `jest`), safe only because of the isolation above.

**Profile when slow, not speculatively.** Keep a rough wall-clock budget; when the suite exceeds it, profile per-file/per-test timings and fix the actual hot spots. A speculative speed need is one you skip until measured (the YAGNI/`kiss:` lens in `code-standards`).
