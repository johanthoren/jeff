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
/** @typedef {'capture' | 'plan' | 'test' | 'implement' | 'refactor' | 'review' | 'audit' | 'done'} TaskStage */
/** @typedef {Exclude<TaskStage, 'done'>} BrainStage */
/** @typedef {'p0' | 'p1' | 'p2' | 'p3' | 'p4'} TaskPriority */
/** @typedef {'simple' | 'complex'} TaskComplexity */
/** @typedef {'haiku' | 'sonnet' | 'opus' | 'fable'} BrainModel */
/** @typedef {'low' | 'med' | 'high' | 'xhigh'} BrainEffort */
/** @typedef {'pass' | 'needs-work' | null} ReviewVerdict */
/** @typedef {'pass' | 'needs-work' | 'na'} AuditVerdict */

/**
 * Per-stage `{ model, effort }` intent record. Informational: the validator
 * does not read it.
 * @typedef {Object} Brain
 * @property {BrainModel} model
 * @property {BrainEffort} effort
 */

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
 * @property {string | null} branch
 * @property {Partial<Record<BrainStage, Brain>>} [brains]
 * @property {Object} [agents]
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
