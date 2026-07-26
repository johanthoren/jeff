// @ts-check

/**
 * Canonical checked-JS vocabulary for Jeff's persisted task and config state.
 * Runtime readers separately accept the documented legacy-only fields.
 */

/** @typedef {'pending' | 'in_progress' | 'blocked' | 'done' | 'abandoned'} TaskStatus */
/** @typedef {'code' | 'operation'} TaskCategory */
/** @typedef {'capture' | 'plan' | 'implement' | 'refactor' | 'execute' | 'review' | 'verify' | 'audit' | 'done'} TaskStage */
/** @typedef {'p0' | 'p1' | 'p2' | 'p3' | 'p4'} TaskPriority */
/** @typedef {'simple' | 'complex'} TaskComplexity */
/** @typedef {'pass' | 'needs-work' | null} ReviewVerdict */
/** @typedef {'pass' | 'needs-work' | 'na'} AuditVerdict */
/** @typedef {'integrity' | 'security' | 'pragmatist'} CouncilLens */
/** @typedef {'ship' | 'block' | null} CouncilVerdict */
/** @typedef {'shipped' | 'scoped-fix-shipped' | 'blocked-to-operator' | null} CouncilOutcome */
/** @typedef {TaskStage | 'verify'} KickbackSource */

/**
 * @typedef {Object} Review
 * @property {ReviewVerdict} verdict
 * @property {string | null} reviewer_agent_id
 * @property {unknown[]} evidence
 */

/**
 * @typedef {Object} Audit
 * @property {boolean} required
 * @property {AuditVerdict} verdict
 * @property {string | null} audit_agent_id
 * @property {unknown[]} evidence
 */

/**
 * @typedef {Object} Approval
 * @property {string} mutation
 * @property {string} grantedBy
 * @property {string} grantedAt
 */

/**
 * @typedef {Object} PlanEscalation
 * @property {string} fork
 * @property {string[]} options
 */

/**
 * @typedef {Object} TaskPlan
 * @property {string} result
 * @property {string[]} slices
 * @property {string[]} [testFiles]
 * @property {{command: string | null, output: string}} [redRun]
 * @property {PlanEscalation | null} escalation
 * @property {string | null} [refactorOpportunity]
 * @property {string[]} [runbook]
 * @property {string[]} [preconditions]
 * @property {string} [recoveryBoundary]
 * @property {string} [approvalBoundary]
 * @property {boolean} [requiresApproval]
 * @property {string[]} [postconditions]
 * @property {string[]} [verificationSeams]
 */


/**
 * @typedef {Object} TaskAgents
 * @property {string | null} [implementer_agent_id]
 * @property {string | null} [reviewer_agent_id]
 * @property {string | null} [reviewer2_agent_id]
 * @property {string | null} audit_agent_id
 * @property {string | null} [executor_agent_id]
 * @property {string | null} [verifier_agent_id]
 */

/**
 * @typedef {Object} TestGate
 * @property {string} hash
 * @property {boolean} clean
 * @property {boolean} green
 * @property {string} command
 * @property {string} at
 */

/**
 * @typedef {Object} TaskTests
 * @property {string | null} authored_by_agent_id
 * @property {boolean | 'na'} green
 * @property {unknown[]} evidence
 * @property {TestGate} [gate]
 */

/**
 * @typedef {Object} Kickback
 * @property {KickbackSource} from
 * @property {TaskStage} to
 * @property {string} reason
 * @property {string} at
 */

/**
 * Reader-only kickback shape for records that still name the retired `test`
 * stage. Canonical task stages and current kickback destinations stay strict.
 *
 * @typedef {Object} LegacyKickback
 * @property {KickbackSource | 'test'} from
 * @property {TaskStage | 'test'} to
 * @property {string} reason
 * @property {string} at
 */

/**
 * @typedef {Object} CouncilMember
 * @property {string} agent_id
 * @property {CouncilLens} lens
 * @property {number | null} temperature
 */

/**
 * @typedef {Object} CouncilFinding
 * @property {string} id
 * @property {string} summary
 * @property {'review' | 'review2' | 'verify' | 'audit'} [source]
 * @property {number} blockingVotes
 * @property {boolean} survived
 * @property {number | string | null} followupTaskId
 */

/**
 * @typedef {Object} CodeConvergence
 * @property {number} cap
 * @property {{review: {blockingKickbacks: number}, audit: {blockingKickbacks: number}}} stages
 * @property {{convened: boolean, stage: 'review' | 'audit' | null, members: CouncilMember[], findings: CouncilFinding[], verdict: CouncilVerdict, outcome: CouncilOutcome}} council
 */

/**
 * @typedef {Object} OperationConvergence
 * @property {number} cap
 * @property {{verify: {blockingKickbacks: number}, audit: {blockingKickbacks: number}}} stages
 * @property {{convened: boolean, stage: 'verify' | 'audit' | null, members: CouncilMember[], findings: CouncilFinding[], verdict: CouncilVerdict, outcome: CouncilOutcome}} council
 */

/** @typedef {CodeConvergence | OperationConvergence} Convergence */

/**
 * The canonical per-task state persisted to `task.json`. `id` is numeric in
 * full mode and may be an external tracker ref string in lite mode.
 *
 * @typedef {Object} CanonicalTaskJson
 * @property {1} schemaVersion
 * @property {number | string} id
 * @property {string} slug
 * @property {string} title
 * @property {TaskStatus} status
 * @property {TaskCategory} [category]
 * @property {TaskStage} stage
 * @property {TaskPriority} priority
 * @property {Array<number | string>} deps
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {TaskComplexity} [complexity]
 * @property {TaskPlan} [plan]
 * @property {TaskAgents} agents
 * @property {TaskTests} [tests]
 * @property {Review} [review]
 * @property {Review | null} [review2]
 * @property {Audit} audit
 * @property {{result: 'executed' | 'kickback' | 'approval-required', executor_agent_id: string | null, actions: string[], evidence: unknown[], approvalRequired: string | null, approval?: Approval}} [execution]
 * @property {Approval[]} [approvals]
 * @property {{verdict: ReviewVerdict, verifier_agent_id: string | null, postconditions: Array<{postcondition: string, ok: boolean, evidence: string}>, findings: unknown[], evidence: unknown[]}} [verification]
 * @property {unknown[]} commits
 * @property {Kickback[]} kickbacks
 * @property {string | null} blockedReason
 * @property {string | null} abandonReason
 * @property {string} [externalRef]
 * @property {Convergence} [convergence]
 */

/**
 * Compatibility-only shape for records persisted at the retired `test` stage.
 * Canonical writers cannot select this branch and therefore cannot emit the
 * historical plan/test identities.
 *
 * @typedef {Object} LegacyTaskAgents
 * @property {string | null} implementer_agent_id
 * @property {string | null} reviewer_agent_id
 * @property {string | null} [reviewer2_agent_id]
 * @property {string | null} audit_agent_id
 * @property {string | null} [plan_agent_id]
 * @property {string | null} [test_author_agent_id]
 */

/**
 * @typedef {Omit<CanonicalTaskJson, 'stage' | 'agents' | 'kickbacks'> & {
 *   stage: 'test',
 *   agents?: LegacyTaskAgents,
 *   branch?: string | null,
 *   kickbacks: LegacyKickback[]
 * }} LegacyTaskJson
 */

/** @typedef {CanonicalTaskJson | LegacyTaskJson} TaskJson */

/**
 * @typedef {Object} JeffConfig
 * @property {1} schemaVersion
 * @property {'jeff'} system
 * @property {'full' | 'lite'} [mode]
 * @property {boolean} active
 * @property {string} [testCommand]
 */

export {};
