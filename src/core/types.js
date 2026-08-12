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

/** @typedef {{command: string, output: string}} Evidence */
/** @typedef {{command: string, recommendation: 'PASS' | 'REVIEW' | 'BLOCK', reportPath: string}} AuditScan */
/** @typedef {'secrets' | 'injection_sql' | 'injection_command' | 'path_traversal' | 'insecure_deserialization' | 'weak_crypto' | 'dynamic_execution' | 'tls_transport' | 'xss' | 'sensitive_logging' | 'insecure_permissions'} AuditCategory */
/** @typedef {'covered_with_hits' | 'covered_no_hits' | 'not_covered'} AuditCoverageStatus */
/** @typedef {{category: AuditCategory, status: AuditCoverageStatus}} AuditCoverage */

/**
 * @typedef {Object} Refute
 * @property {string} agent_id
 * @property {'review' | 'review2' | 'verify' | 'audit'} source
 * @property {string} finding
 * @property {'survives' | 'refuted'} verdict
 * @property {string} rationale
 * @property {Evidence[]} evidence
 */

/**
 * @typedef {Object} Finding
 * @property {string} file
 * @property {number} line
 * @property {'critical' | 'high' | 'medium' | 'low'} severity
 * @property {'blocking' | 'follow-up'} class
 * @property {'capture' | 'plan' | 'implement' | 'refactor' | 'execute'} kickTo
 * @property {string} what
 * @property {string} why
 * @property {string | null} [cwe]
 * @property {Refute} [refute]
 */

/**
 * @typedef {Omit<Finding, 'kickTo'> & {
 *   kickTo: 'capture' | 'plan' | 'execute'
 * }} OperationFinding
 */

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
 * @property {AuditVerdict} [reportedVerdict]
 * @property {string | null} audit_agent_id
 * @property {Finding[]} [findings]
 * @property {Evidence[]} evidence
 * @property {AuditScan} [scan]
 * @property {AuditCoverage[]} [coverage]
 */

/**
 * @typedef {Object} Approval
 * @property {string} mutation
 * @property {string} grantedBy
 * @property {string} grantedAt
 */

/**
 * @typedef {Object} ApprovalRequest
 * @property {number} id
 * @property {string} mutation
 * @property {string} requestedBy
 * @property {string} requestedAt
 * @property {number} cycle
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
 * @typedef {Object} KickbackFinding
 * @property {'review' | 'review2' | 'audit'} source
 * @property {string} file
 * @property {number} line
 * @property {string} what
 * @property {'capture' | 'plan' | 'implement' | 'refactor'} kickTo
 */

/**
 * @typedef {Object} Kickback
 * @property {KickbackSource} from
 * @property {TaskStage} to
 * @property {string} reason
 * @property {string} at
 * @property {KickbackFinding[]} [findings]
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
 * @typedef {Object} CouncilFindingVote
 * @property {string} id
 * @property {boolean} blocking
 * @property {string} rationale
 */

/**
 * @typedef {Object} CouncilInquiry
 * @property {string} question
 * @property {string} problemRestatement
 * @property {string[]} causalHypotheses
 * @property {string[]} solutionStrategies
 * @property {CouncilFindingVote[]} findingVotes
 * @property {string[]} decisiveEvidence
 */

/**
 * @typedef {Object} CouncilSynthesis
 * @property {string} problemRestatement
 * @property {string[]} survivingBlockers
 * @property {string[]} causalHypotheses
 * @property {string[]} solutionStrategies
 * @property {string[]} rejectedAlternatives
 * @property {'confined-repair' | 'test-contract-repair' | 'refactor' | 'causal-subgraph-reconstruction' | 'full-replan' | 'scoped-execute' | 'operator-escalation'} selectedStrategy
 * @property {string[]} decisiveEvidence
 */

/**
 * @typedef {Object} OriginalDeliveryLineage
 * @property {'simple' | 'complex'} complexity
 * @property {boolean} audit_required
 * @property {('plan' | 'test_author_agent_id' | 'builder_agent_id' | 'implement')[]} absentLineage
 * @property {Record<string, unknown> | null} plan
 * @property {string | null} test_author_agent_id
 * @property {string | null} builder_agent_id
 * @property {Record<string, unknown> | null} implement
 */

/**
 * @typedef {Object} CouncilRecovery
 * @property {1} episode
 * @property {CouncilSynthesis['selectedStrategy']} route
 * @property {TestGate | null} baselineGate
 * @property {string | null} test_author_agent_id
 * @property {string | null} builder_agent_id
 * @property {OriginalDeliveryLineage} original
 */

/**
 * @typedef {Object} CouncilMember
 * @property {string} agent_id
 * @property {CouncilLens} lens
 * @property {number | null} temperature
 * @property {CouncilInquiry} [inquiry]
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
 * @typedef {Omit<CouncilFinding, 'source'> & {
 *   source: 'verify' | 'audit'
 * }} OperationCouncilFinding
 */

/**
 * Per-source convergence counter. `bonusGranted` records that the source has
 * spent its single evidence-scaled bonus cycle; absent means false.
 *
 * @typedef {{blockingKickbacks: number, bonusGranted?: boolean}} ConvergenceCounter
 */

/**
 * @typedef {Object} CodeConvergence
 * @property {number} cap
 * @property {{review: ConvergenceCounter, audit: ConvergenceCounter}} stages
 * @property {{convened: boolean, stage: 'review' | 'audit' | null, synthesizer_agent_id?: string, members: CouncilMember[], findings: CouncilFinding[], synthesis?: CouncilSynthesis, verdict: CouncilVerdict, outcome: CouncilOutcome}} council
 * @property {CouncilRecovery} [recovery]
 */

/**
 * @typedef {Object} OperationConvergence
 * @property {number} cap
 * @property {{verify: ConvergenceCounter, audit: ConvergenceCounter}} stages
 * @property {{convened: boolean, stage: 'verify' | 'audit' | null, cycle?: number, executor_agent_id?: string, synthesizer_agent_id?: string, members: CouncilMember[], findings: OperationCouncilFinding[], synthesis?: CouncilSynthesis, verdict: CouncilVerdict, outcome: CouncilOutcome}} council
 */

/** @typedef {CodeConvergence | OperationConvergence} Convergence */

/**
 * @typedef {Object} OperationVerification
 * @property {ReviewVerdict} verdict
 * @property {'pass' | 'needs-work'} [reportedVerdict]
 * @property {string | null} verifier_agent_id
 * @property {Array<{postcondition: string, ok: boolean, evidence: string}>} postconditions
 * @property {OperationFinding[]} findings
 * @property {Evidence[]} evidence
 */

/**
 * @typedef {Omit<Review, 'verdict'> & {
 *   verdict: ReviewVerdict | 'na',
 *   reportedVerdict?: 'pass' | 'needs-work',
 *   findings: Finding[],
 *   acLedger?: unknown[]
 * }} HistoricalCodeReview
 */

/**
 * @typedef {Omit<Audit, 'findings'> & {
 *   findings: Finding[]
 * }} HistoricalCodeAuditOutcome
 */

/**
 * @typedef {{
 *   required: false,
 *   verdict: 'na',
 *   audit_agent_id: null,
 *   evidence: [],
 *   reportedVerdict?: never,
 *   findings?: never,
 *   scan?: never,
 *   coverage?: never
 * }} ArchivedUnauditedCodeAudit
 */

/** @typedef {HistoricalCodeAuditOutcome | ArchivedUnauditedCodeAudit} HistoricalCodeAudit */

/**
 * @typedef {Object} CodeJudgmentHistory
 * @property {string} at
 * @property {HistoricalCodeReview} review
 * @property {HistoricalCodeReview | null} review2
 * @property {HistoricalCodeAudit} audit
 * @property {{reviewer_agent_id: string | null, reviewer2_agent_id: string | null, audit_agent_id: string | null}} [agents]
 */

/**
 * @typedef {Object} OperationJudgmentHistory
 * @property {number} [cycle]
 * @property {string} at
 * @property {OperationVerification} verification
 * @property {Audit} audit
 * @property {{verifier_agent_id: string | null, audit_agent_id: string | null}} agents
 */

/**
 * The canonical per-task state persisted to `task.json`. `id` is numeric in
 * full mode and may be an external tracker ref string in lite mode.
 *
 * @typedef {Object} CanonicalTaskJson
 * @property {1} schemaVersion
 * @property {1} [operationStateVersion]
 * @property {string} [pipelineVersion]
 * @property {number | string} id
 * @property {string} slug
 * @property {string} title
 * @property {TaskStatus} status
 * @property {TaskCategory} [category]
 * @property {TaskStage} stage
 * @property {TaskPriority} priority
 * @property {Array<number | string>} deps
 * @property {number | string} [discoveredFrom]
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {TaskComplexity} [complexity]
 * @property {TaskPlan} [plan]
 * @property {TaskAgents} agents
 * @property {TaskTests} [tests]
 * @property {Review} [review]
 * @property {Review | null} [review2]
 * @property {Audit} audit
 * @property {{result: 'executed' | 'kickback' | 'approval-required', executor_agent_id: string | null, cycle?: number, recordedAt?: string, approvalRequestId?: number, actions: string[], evidence: Evidence[], approvalRequired: string | null, approval?: Approval}} [execution]
 * @property {ApprovalRequest[]} [approvalRequests]
 * @property {Approval[]} [approvals]
 * @property {OperationVerification} [verification]
 * @property {Refute[]} [refutes]
 * @property {Array<CodeJudgmentHistory | OperationJudgmentHistory>} [judgmentHistory]
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
 * @property {number[]} [prunedTaskIds]
 */

export {};
