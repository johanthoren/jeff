---
name: code-standards
description: "Language-agnostic code standards for writing clean, maintainable code. Covers modular design, functional patterns, error handling, security, and testing. Make sure to use this skill whenever writing, refactoring, or reviewing any code, even for quick fixes, prototypes, or single-file changes. This is the baseline for all code quality. Language-specific skills, if present, may override these defaults."
---

# Code Standards

Language-agnostic defaults. Language-specific skills override where they conflict. These are the Chef's taste stated as directives: apply them as written, and do not substitute your own or your provider's defaults where they differ.

## Core Philosophy

- **Modular**: small, focused, reusable components.
- **Functional first**: pure functions, immutability, composition. A house choice, not a suggestion.
- **Maintainable**: self-documenting, testable, predictable.
- **Single source of truth**: one authoritative owner per fact; no drifting duplicates.
- **Separate by rate of change**: don't weld a fast-changing concern into a slow-changing one; couple the layers loosely so each moves at its own pace.
- **Docs are part of the system**: incorrect documentation is a bug. When a change alters docs that describe the system's behavior, verify them against the code as it stands, not just for prose. (OpenBSD.)

**Golden Rule**: If you can't easily test it, refactor it.

## Laziness (the YAGNI ladder)

The best code is the code you never wrote. Before writing any, stop at the first rung that holds:

1. **Does this need to exist?** Speculative need = skip it, say so in one line.
2. **Stdlib does it?** Use it.
3. **Native platform feature covers it?** (`<input type="date">` over a picker lib; a DB constraint over app code.) Use it.
4. **An already-installed dependency solves it?** Use it. Never add one for what a few lines do.
5. **One line?** One line.
6. **Only then:** the minimum code that works.

- **Question every addition, including your own and the system's own docs and process: "do you need X, or does Y already cover it?"** The lazy lens applies hardest to your own work, not just to feature code; ceremony, prose, and citations are over-build too.
- Lazy means less code, not the flimsier choice: when two correct approaches are the same size, take the more edge-case-correct one.
- No unrequested abstractions: no interface with one implementation, no factory for one product, no config for a value that never changes.
- Deletion over addition. Boring over clever. Fewest files, shortest working diff.
- Mark a deliberate shortcut with a `kiss:` comment naming its ceiling and upgrade path (`# kiss: O(n^2) scan, index it if the list grows`). Simple should read as intent, not ignorance.
- **Laziness governs the process too, but selectively; this is the harder cut.** Separate the *function* a step protects from the *ceremony* that only resembles it. To drop a step, name the outcome it protects and show that outcome is covered elsewhere or no longer at risk. If you can't name it, it's load-bearing: keep it. (See `reference/load-bearing-vs-liturgy.md` for the test and worked examples.)
- **Never cut the steering or the safety carve-outs.** Validation at trust boundaries, error handling that prevents data loss, and security; plus the verification that stops you declaring done when it isn't: tests with meaningful coverage (they steer you and catch a premature "done"), independent review, the done-gate. For an agent this is asymmetric: completion bias pushes you to cut the steering and keep the ritual, so weight against both.

*Ladder adapted from [ponytail](https://github.com/DietrichGebert/ponytail) (MIT); see NOTICE.*

## The House Style, as Directives

- **Pure functions**: same input, same output, no side effects. `const addToTotal = (v) => { total += v; }` is the smell; `const add = (a, b) => a + b` is the rule.
- **Immutability**: create new data, never mutate what you were given. `items.push(item)` → `[...items, item]`.
- **Composition over inheritance**: `pipe(validate, enrich, save)`, not `class ExtendedUserManagerWithValidation extends UserManager`.
- **Explicit dependencies**: inject collaborators (`createService(database, logger)`), never import-and-reach from inside (`import db from './database'`). Hidden dependencies kill testability.
- **Small units, single responsibility**: functions < 50 lines, modules < 200 lines. Deep nesting (> 3 levels), global state, and god modules are refusals, not warnings.

### Policy Predicates

Policy decisions (access gating, capability checks, state validation) must live in named predicates on the owning type, not as raw comparisons scattered at call sites.

```javascript
// Bad: policy duplicated at every call site
if (permissionManager.status === 'allGranted' && !licensed) { ... }

// Good: policy centralized on the owning type
if (permissionManager.areGranted && !licenseManager.isLicensed) { ... }
```

**When to extract**: the same boolean check appears in more than one place, or the check requires knowing another type's internal state. **Migration**: grep for raw field comparisons (`status == .X`, `type === 'Y'`), extract to a named predicate on the owning type, replace all call sites, add a unit test for the predicate.

## Validation, Errors, Security

- Validate at boundaries: check null/nil/None, validate types and ranges, sanitize all user input, return clear error messages.
- Catch specific errors, not generic; log them with context; return meaning to the caller (`parseJSON` returns `{ success, data | error }`, it does not rethrow soup). Never expose internals to users.
- **NEVER**: log passwords/tokens/API keys; hardcode credentials; skip input validation. **ALWAYS**: secrets from the environment or a secret manager; least privilege.
- Log at conventional levels (debug/info/warning/error); errors always carry context.

## Naming

Files `lowercase-with-dashes`; functions are verb phrases (`getUser`, `validateEmail`); predicates read as questions (`isValid`, `hasPermission`, `canAccess`, `areGranted`); variables descriptive (`userCount`, not `uc`); constants `UPPER_SNAKE_CASE`.

## Code Review Checklist

- [ ] Error handling comprehensive
- [ ] Input validation present
- [ ] No hardcoded secrets
- [ ] Tests cover new code
- [ ] Documentation updated, and any claims about the code verified against it
- [ ] Follows project conventions
- [ ] Policy decisions use named predicates, not raw comparisons at call sites
