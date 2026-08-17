# Operation tasks: plan, execution, and the cooperative boundary

Read this once a task's locked `category` is `operation`. `skills/cook/SKILL.md` owns the loop, the gate model, convergence, and Git; this file owns the operation-only contracts between plan, execute, and verify.

## Operation plan and execution

An operation plan returns `result:"plan"`; nonempty `runbook`, `preconditions`, `recoveryBoundary`, `approvalBoundary`, `postconditions`, and deterministic `verificationSeams`; and boolean `requiresApproval`. It returns no `refactorOpportunity`, `testFiles`, or `redRun`. A genuine unresolved operation fork instead returns `result:"escalation"` with only complexity, audit call, nonempty slices, and nonnull `{fork, options}`; the recorder retains that minimal plan and does not advance or create execution state.

Execute records nonempty action strings and command/output evidence. For `requiresApproval:true`, `approvalBoundary` is exact operator-facing text. The executor returns `approval-required` with the same text in `approvalRequired` and stops by role contract. Jeff presents the request to the Chef. After explicit approval, Jeff runs `cook approve <id> <operator>`; under the task lock, the recorder copies the still-active pending request into append-only `{mutation, grantedBy, grantedAt, requestId}` history. Historical grants may omit `requestId` and stay valid through the old latest-request checks, including two-request re-stop ledgers. It rejects a missing, changed, stale, duplicate, or executor-attributed grant. The executor return never contains a grant.

Jeff then re-fires a fresh execute specialist with ordinary host-native tools. The recorder carries only the retained matching grant into completed execution. A `requiresApproval:true` plan cannot advance directly to verification. A kickback may return only to `capture` or `plan`. Successful execution advances to a fresh verifier whose result rows must match `plan.postconditions` exactly in length, order, and text.

## Cooperative operation boundary

Execute and verify use ordinary host-native stage dispatch. Role instructions narrow the expected behavior of cooperative agents; they do not sandbox tools available from the host. Verification methods may differ by host, and unavailable methods produce a `needs-work` finding rather than a confinement adapter. Never substitute executor or execution evidence for independent verification.

`cook reverify <id>` is available only for an in-progress operation with completed execution, a current `needs-work` verification-only failure, and an untouched recovery state before any refute, kickback, or council recovery; no blocking finding may be routed to `execute`. The atomic transition appends the whole superseded judgment and its evidence to `judgmentHistory`, clears only the live verification slot, leaves recorded execution and approvals unchanged, and returns the task to `verify`; the next verifier must be fresh and distinct from both the executor and every archived verifier.
