// @ts-check

/**
 * Canonical checked-JS vocabulary for Jeff's persisted task and config state.
 * Runtime readers separately accept the documented legacy-only fields.
 */

/** @typedef {'pending' | 'in_progress' | 'blocked' | 'done' | 'abandoned'} TaskStatus */
/** @typedef {'capture' | 'plan' | 'implement' | 'refactor' | 'review' | 'audit' | 'done'} TaskStage */
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
 * @typedef {Object} TaskAgents
 * @property {string | null} implementer_agent_id
 * @property {string | null} reviewer_agent_id
 * @property {string | null} [reviewer2_agent_id]
 * @property {string | null} audit_agent_id
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
 * @property {'review' | 'review2' | 'audit'} [source]
 * @property {number} blockingVotes
 * @property {boolean} survived
 * @property {number | string | null} followupTaskId
 */

/**
 * @typedef {Object} Convergence
 * @property {number} cap
 * @property {{review: {blockingKickbacks: number}, audit: {blockingKickbacks: number}}} stages
 * @property {{convened: boolean, stage: 'review' | 'audit' | null, members: CouncilMember[], findings: CouncilFinding[], verdict: CouncilVerdict, outcome: CouncilOutcome}} council
 */

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
 * @property {TaskStage} stage
 * @property {TaskPriority} priority
 * @property {Array<number | string>} deps
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {TaskComplexity} [complexity]
 * @property {{result: string, slices: string[], testFiles: string[], redRun: {command: string | null, output: string}, escalation: {fork: string, options: string[]} | null, refactorOpportunity?: string | null}} [plan]
 * @property {TaskAgents} agents
 * @property {TaskTests} tests
 * @property {Review} review
 * @property {Review | null} [review2]
 * @property {Audit} audit
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
