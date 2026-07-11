// @ts-check

/**
 * JSDoc typedefs for the jeff `task.json` state schema.
 *
 * Source of truth: `skills/cook/reference/jeff-state-schema.md` (§`task.json`).
 * Types-only module: it exports nothing at runtime and exists so `tsc
 * --checkJs` can exercise the store's annotations. The `convergence` and
 * `config.json` shapes are intentionally out of scope for this slice (they land
 * with the validator port).
 */

/** @typedef {'pending' | 'in_progress' | 'blocked' | 'done' | 'abandoned'} TaskStatus */
/** Persisted stages; `test` is legacy resume-only. @typedef {'capture' | 'plan' | 'test' | 'implement' | 'refactor' | 'review' | 'audit' | 'done'} TaskStage */
/** @typedef {'p0' | 'p1' | 'p2' | 'p3' | 'p4'} TaskPriority */
/** @typedef {'simple' | 'complex'} TaskComplexity */
/** @typedef {'pass' | 'needs-work' | null} ReviewVerdict */
/** @typedef {'pass' | 'needs-work' | 'na'} AuditVerdict */

/**
 * The `review` stage outcome record.
 * @typedef {Object} Review
 * @property {ReviewVerdict} verdict
 * @property {string | null} reviewer_agent_id
 * @property {Array<unknown>} evidence
 */

/**
 * The `audit` stage outcome record.
 * @typedef {Object} Audit
 * @property {boolean} required
 * @property {AuditVerdict} verdict
 * @property {string | null} audit_agent_id
 * @property {Array<unknown>} evidence
 */

/**
 * Specialist identities. Historical plan/test identity fields may still be
 * present on old ledgers but are not canonical or used for separation.
 * @typedef {Object} TaskAgents
 * @property {string | null} implementer_agent_id
 * @property {string | null} reviewer_agent_id
 * @property {string | null} [reviewer2_agent_id]
 * @property {string | null} audit_agent_id
 * @property {string | null} [plan_agent_id]
 * @property {string | null} [test_author_agent_id]
 */

/**
 * The canonical per-task state persisted to `task.json`.
 *
 * `id` is a positive integer in full (registry) mode; in lite mode it may be an
 * external tracker ref string, so the type admits both.
 *
 * @typedef {Object} TaskJson
 * @property {number} schemaVersion
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
 * @property {string | null} [branch] Deprecated legacy state; ignored when present.
 * @property {TaskAgents} [agents]
 * @property {Object} [tests]
 * @property {Review} [review]
 * @property {Audit} [audit]
 * @property {Array<unknown>} [commits]
 * @property {Array<unknown>} [kickbacks]
 * @property {string | null} [blockedReason]
 * @property {string | null} [abandonReason]
 * @property {string} [externalRef]
 */

export {};
