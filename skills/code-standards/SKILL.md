---
name: code-standards
description: "Language-agnostic code standards for writing clean, maintainable code. Covers modular design, functional patterns, error handling, security, and testing. Make sure to use this skill whenever writing, refactoring, or reviewing any code, even for quick fixes, prototypes, or single-file changes. This is the baseline for all code quality. Language-specific skills, if present, may override these defaults."
---

# Code Standards

Language-agnostic defaults. Language-specific skills override where they conflict.

## Core Philosophy

- **Modular**: Small, focused, reusable components
- **Functional**: Pure functions, immutability, composition
- **Maintainable**: Self-documenting, testable, predictable
- **Single source of truth**: one authoritative owner per fact; no drifting duplicates
- **Separate by rate of change**: don't weld a fast-changing concern into a slow-changing one; couple the layers loosely so each moves at its own pace
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

## Critical Patterns

### Pure Functions
Same input = same output, no side effects.

```javascript
// Good
const add = (a, b) => a + b;
const formatUser = (user) => ({ ...user, fullName: `${user.first} ${user.last}` });

// Bad - side effects
let total = 0;
const addToTotal = (v) => { total += v; return total; };
```

### Immutability
Create new data, don't modify existing.

```javascript
// Good
const addItem = (items, item) => [...items, item];

// Bad
const addItem = (items, item) => { items.push(item); return items; };
```

### Composition
Build complex from simple functions.

```javascript
// Good
const processUser = pipe(validate, enrich, save);

// Bad
class ExtendedUserManagerWithValidation extends UserManager { }
```

### Small Functions
- < 50 lines per function
- < 100 lines per module
- Single responsibility

### Policy Predicates
Policy decisions (access gating, capability checks, state validation) must live in named predicates on the owning type, not as raw comparisons scattered at call sites.

```javascript
// Bad: policy duplicated at every call site
if (permissionManager.status === 'allGranted') { ... }
if (permissionManager.status === 'allGranted' && !licensed) { ... }

// Good: policy centralized on the owning type
if (permissionManager.areGranted) { ... }
if (permissionManager.areGranted && !licenseManager.isLicensed) { ... }
```

**When to extract**: If the same boolean check appears in more than one place, or if the check requires knowing internal state of another type, it belongs in a named predicate.

**Naming**: Use `is`, `has`, `can`, `are` prefixes, e.g., `isReady`, `hasPermission`, `canRecord`, `areGranted`.

**Migration**: Grep for raw field comparisons (`status == .X`, `type === 'Y'`), extract to a named predicate on the owning type, replace all call sites, add a unit test for the predicate.

### Dependency Injection

```javascript
// Good - explicit dependencies
function createService(database, logger) {
  return {
    create: (data) => {
      logger.info('Creating');
      return database.insert(data);
    }
  };
}

// Bad - hidden dependencies
import db from './database';
function create(data) { return db.insert(data); }
```

## Validation

Validate at boundaries:
- Check null/nil/None
- Validate types and ranges
- Sanitize user input
- Return clear error messages

## Error Handling

- Catch specific errors, not generic
- Log errors with context
- Return meaningful messages
- Don't expose internals to users

```javascript
function parseJSON(text) {
  try {
    return { success: true, data: JSON.parse(text) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
```

## Security

**NEVER**:
- Log passwords, tokens, API keys
- Hardcode credentials
- Expose internal errors to users
- Skip input validation

**ALWAYS**:
- Use environment variables for secrets
- Sanitize all user input
- Follow least privilege principle

## Naming

- **Files**: `lowercase-with-dashes.js`
- **Functions**: verbPhrases (`getUser`, `validateEmail`)
- **Predicates**: `isValid`, `hasPermission`, `canAccess`
- **Variables**: descriptive (`userCount` not `uc`)
- **Constants**: `UPPER_SNAKE_CASE`

## Anti-Patterns

- Mutation and side effects
- Deep nesting (> 3 levels)
- God modules (> 200 lines)
- Global state
- Large functions (> 50 lines)

## Logging Levels

- **Debug**: Development only, detailed info
- **Info**: Important events, milestones
- **Warning**: Potential issues, non-blocking
- **Error**: Failures, exceptions

## Code Review Checklist

- [ ] Error handling comprehensive
- [ ] Input validation present
- [ ] No hardcoded secrets
- [ ] Tests cover new code
- [ ] Documentation updated, and any claims about the code verified against it
- [ ] Follows project conventions
- [ ] Policy decisions use named predicates, not raw comparisons at call sites
