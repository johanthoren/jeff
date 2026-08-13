# Task context

## Relevant paths and symbols

- `src/pi/role-session.js:145`: `createDispatchAgentRegistry` creates the private registry passed to OMP child sessions.
- `src/pi/role-session.js:313`: `prepareOmpSession` builds isolated OMP session options.
- `src/pi/role-session.js:345`: `agentRegistry` receives the private registry instance.
- `src/pi/role-session.js:415`: `dispatchRoleSession` calls the injected SDK's `createAgentSession`.
- `src/pi/role-session.test.js:291`: `ompSdk` is the injected OMP SDK harness.
- `src/pi/role-session.test.js:366`: the harness performs SDK-style session registration and initialization.
- `src/pi/role-session.test.js:838`: the focused private-registry initialization test.
- `.jeff/tasks/lite-244-3242526080/task.md`: locked goal, AC1 through AC6, constraints, audit requirement, and non-goals.
- `/Users/jthoren/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/sdk.ts:3584`: the installed SDK attaches the constructed session and sets its status against the preregistered ref.
- `/Users/jthoren/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/registry/agent-registry.ts:134`: the installed registry matches an expected ref or expected session.

## Commands

Focused test:

```text
node --test --test-name-pattern='dispatchRoleSession initializes its private OMP registry with boolean stale-ref guards' src/pi/role-session.test.js
```

Ledger validation:

```text
node src/cli/cook.js validate
```

## Mechanical constraints

- Plan-owned files are `src/pi/role-session.test.js`, `.jeff/tasks/lite-244-3242526080/notes.md`, and `.jeff/tasks/lite-244-3242526080/context.md`.
- Production files are not plan-stage write targets.
- The locked category is `code`, complexity is `simple`, and audit is required.
- The base checkpoint is `3ab01a300642faec2295a0bf1578f12c748160e6`.
- `package.json` carries version `6.1.0`.
- Plan-stage verification excludes formatter, linter, typecheck, full-suite, and project-wide commands.
