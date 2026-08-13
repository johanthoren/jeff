# Plan

## Approach

Revise the existing injected OMP SDK harness to enforce the current ref-bound boolean initialization contract, then add one focused role-session test that replaces the registered ref, observes stale operations, restores the live ref, and lets SDK-style session initialization proceed. This is the smallest consumer-observable contract because it exercises `dispatchRoleSession` through its injected SDK boundary without exporting or directly testing the private adapter.

## Plan fields

- Complexity: `simple`
- Audit: required
- Refactor opportunity: `null`
- Changed test files: `src/pi/role-session.test.js`

## Ordered slices

1. Harmonize the injected SDK harness with ref-bound `attachSession` and `setStatus` initialization, add one focused stale-ref regression, and prove its pre-repair RED through the single named test.

## Acceptance-criterion ledger

| Criterion | Disposition | Consumer-observable behavior | Deterministic outcome seam |
| --- | --- | --- | --- |
| AC1 | `revise` | An injected SDK can initialize an isolated role session through the private registry's minimal register, lookup, attach, status, and cleanup surface. | The focused `dispatchRoleSession` test reaches the injected SDK, uses only that registry surface, and completes only when the SDK-style initialization guard succeeds. |
| AC2 | `write` | Live-ref attachment and status transition return `true`; operations using a replaced ref return `false` and leave the replacement unchanged. | The focused test records both stale return values, snapshots the replacement's session and status, and asserts `false`, `false`, and `{ session: null, status: 'running' }`; the harness separately requires truthy live-ref results. |
| AC3 | `write` | Session creation no longer reports that the registered agent was replaced before the specialist prompt. | Before production repair, the named test fails at injected SDK initialization with `Error: Agent "omp-review" was replaced during session initialization.` After repair, the same test must reach `session.prompt`. |
| AC4 | `reuse` | Checked JavaScript, targeted Pi behavior, the repository suite, and ledger validation remain green. | Plan runs only the named RED and `node src/cli/cook.js validate`; later gates reuse `make typecheck`, the targeted Pi tests, and `make test` as required by the task. |
| AC5 | `skip` | The change remains limited to the PR #240 stack and keeps package version `6.1.0`. | Integration checks compare the task branch ancestry with checkpoint `3ab01a300642faec2295a0bf1578f12c748160e6`, inspect the changed-file set, and read `package.json` version before the stacked PR is opened. No plan-stage test is owed. |
| AC6 | `skip` | A locally installed repaired package lets a fresh ParrotScribe `cook_dispatch` reach the specialist prompt. | After the complete code gate, local OMP installation and a fresh dispatch provide the host-native observation: child creation returns an agent id and the child transcript contains the delivered specialist prompt. No plan-stage test is owed. |

## Targeted RED

Command:

```text
node --test --test-name-pattern='dispatchRoleSession initializes its private OMP registry with boolean stale-ref guards' src/pi/role-session.test.js
```

Decisive output:

```text
✖ dispatchRoleSession initializes its private OMP registry with boolean stale-ref guards
ℹ tests 1
ℹ pass 0
ℹ fail 1

Error: Agent "omp-review" was replaced during session initialization.
    at Object.createAgentSession (file:///private/tmp/jeff-task-244/src/pi/role-session.test.js:403:15)
    at async dispatchRoleSession (file:///private/tmp/jeff-task-244/src/pi/role-session.js:415:15)
```

Exit code: `1`.
