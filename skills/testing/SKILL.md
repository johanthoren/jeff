---
name: testing
description: "Language-agnostic testing standards for writing effective tests. Covers test structure, what to test, mocking, and coverage goals. Make sure to use this skill whenever writing tests, doing TDD, reviewing test coverage, or when code changes should have tests added; testing standards apply to all code, not just dedicated test tasks. Language-specific skills, if present, may override these defaults."
---

# Testing Standards

Language-agnostic defaults. Language-specific skills override where they conflict.

**Golden Rule**: If you can't test it easily, refactor it.

## Test Structure (AAA Pattern)

```javascript
test('calculateTotal returns sum of item prices', () => {
  // Arrange - Set up test data
  const items = [{ price: 10 }, { price: 20 }];
  
  // Act - Execute code
  const result = calculateTotal(items);
  
  // Assert - Verify result
  expect(result).toBe(30);
});
```

## What to Test

### DO Test
- Happy path (normal usage)
- Edge cases (boundaries, empty, null)
- Error cases (invalid input, failures)
- Business logic (core functionality)
- Public APIs (exported functions)

### DON'T Test
- Third-party libraries
- Framework internals
- Simple getters/setters
- Private implementation details

## Coverage Goals

Coverage is an outcome of testing the right intersections, not a target to chase. Not every line, and not every one-liner, needs a test; a one-line pass-through does not. Cover each behavior and its real edges; a task's acceptance criteria are the floor.

| Priority | Target | Examples |
|----------|--------|----------|
| Critical | 100% | Business logic, data transforms |
| High | 90%+ | Public APIs, user-facing features |
| Medium | 80%+ | Utilities, helpers |
| Low | Optional | Simple wrappers, configs |

## Testing Pure Functions

```javascript
function add(a, b) { return a + b; }

test('add returns sum', () => {
  expect(add(2, 3)).toBe(5);
  expect(add(-1, 1)).toBe(0);
  expect(add(0, 0)).toBe(0);
});
```

## Testing with Dependencies

Use dependency injection for testability:

```javascript
function createUserService(database) {
  return {
    getUser: (id) => database.findById('users', id)
  };
}

test('getUser retrieves from database', () => {
  const mockDb = {
    findById: jest.fn().mockReturnValue({ id: 1, name: 'John' })
  };
  
  const service = createUserService(mockDb);
  const user = service.getUser(1);
  
  expect(user).toEqual({ id: 1, name: 'John' });
  // Don't assert toHaveBeenCalledWith(...): that pins procedure and goes red on a
  // behavior-preserving refactor. Assert the result, not that the mock was called.
});
```

## Test Naming

```javascript
// Good - descriptive, clear expectation
test('calculateDiscount returns 10% off for premium users', () => {});
test('validateEmail returns false for invalid format', () => {});
test('createUser throws error when email exists', () => {});

// Bad - vague
test('it works', () => {});
test('test user', () => {});
```

## Principles

- **Test behavior, not implementation**: Focus on what, not how
- **Would it survive a refactor?**: If a behavior-preserving refactor would turn the test red, it tests procedure; rewrite it to assert the result. Procedure-coupled tests lock in design flaws.
- **Keep tests simple**: One assertion per test, clear names
- **Independent tests**: No shared state, run in any order
- **Fast and reliable**: Quick execution, no flaky tests

## Change-Detector Tests Are a Banned Smell

A change-detector test asserts a value or call shape that no consumer observes, so it
goes red on any edit to that value and catches no regression the edit would not. It is
configuration duplicated into the test as a second place to edit. Do not write one.

- **Revise-for-behavior is correct; mutate-for-implementation is the smell** (Google,
  "Change-Detector Tests Considered Harmful"). Revising a test because the *behavior* a
  consumer observes changed is a legitimate **Change**. Mutating a test to track an
  *implementation detail or configuration value* is the smell. They look identical until
  you apply the discriminator.
- **Consumer-observable discriminator**: ask *"would a consumer notice if this value
  changed?"* If no consumer would notice, it was never a behavior change: it is
  **Preserve** (reuse the existing behavioral test, add none) or **None** (no test owed),
  and writing or revising an assertion for it *is* the smell.
- **Prefer a declarative constraint over a tautological assertion**. Do not assert
  `const FOO == "foo"` (the value restated). If the value must be constrained, bind it
  through a consumer-observable contract: e.g. assert the published manifest version
  satisfies a documented bound, not that a literal equals itself.
- **Reuse rule**: an internal-only optimization or refactor (no observable change) relies
  on the *existing* behavioral tests staying green. Add no new test for it.
- **Reject the "temporary implementation-check, auto-remove" pattern**. A test you intend
  to delete later because it only pins implementation is a change-detector test now. Do
  not add it.
- **Redundancy rule**: do not write a test for behavior already covered by an existing
  green test (overlapping objectives add maintenance cost, not signal). When a feature is
  removed, delete its now-obsolete tests; git is the archive.

## Determinism (prevent flaky tests)

A flaky test is a defect. Tests must be deterministic by construction; a single run
cannot detect flakiness, so prevent it at design time.

- **Ban** real wall-clock reads, network calls, real filesystem timestamps, test-ordering
  dependence, shared mutable state across tests, unseeded randomness, and sleep-based
  timing.
- **Require** injected/faked boundaries (clock, network, filesystem, RNG) and a seeded RNG
  so each test is a pure function of its own fixture and passes in any order.

## Parallel Safety and Speed

**Parallel-safe by construction.** A suite must be safe to run in parallel. This is a
correctness property, not an optimization: the same independence that prevents flakiness
(no shared mutable state, no ordering assumptions; see Determinism) is what makes
parallel-by-default free.

- Each test owns isolated scratch: a fresh temp dir / fresh fixture per test, never a path
  two tests can both touch.
- Isolate from shared *host* state too, not just in-suite state: a test must not depend on
  or mutate global tooling config, daemons, or shared resources the host also uses.
  - Cautionary example: fixture `git commit`s that inherit the host's global `commit.gpgsign`
    can exhaust a shared GPG agent and fail nondeterministically under parallel jobs; give
    fixtures hermetic config.

**Default the runner to parallel.** When setting up a project's test command, enable parallel
execution from the start; it is a one-time setup decision, not a per-test choice. This is safe
only because of the isolation above. Tool-agnostic examples:

- `bats --jobs N`
- `pytest -n auto` (pytest-xdist)
- `cargo nextest` (parallel by default)
- `go test` (parallel by default; `t.Parallel()` for sub-tests)
- `jest` (parallel by default)

**Profile when slow, not speculatively.** Keep a rough wall-clock budget for the suite. When
it exceeds budget, profile the waterfall (per-file / per-test timings) and fix or parallelize
the actual hot spots. Do NOT micro-optimize speculatively; apply the YAGNI/`kiss:` lens
("Laziness (the YAGNI ladder)" in the `code-standards` skill): a speculative speed need is one
you skip until measured.

## Best Practices

- Test one thing per test
- Use descriptive test names
- Keep tests independent
- Mock external dependencies
- Test edge cases and errors
- Make tests readable
- Run tests frequently
- Fix failing tests immediately
