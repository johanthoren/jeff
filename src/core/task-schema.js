// @ts-check

import { isOneOf, isType } from './validate.js';

const STATUSES = ['pending', 'in_progress', 'blocked', 'done', 'abandoned'];
const CODE_STAGES = ['capture', 'plan', 'test', 'implement', 'refactor', 'review', 'audit', 'done'];
const OPERATION_STAGES = ['capture', 'plan', 'execute', 'verify', 'audit', 'done'];
const STAGES = [...new Set([...CODE_STAGES, ...OPERATION_STAGES])];
const PRIORITIES = ['p0', 'p1', 'p2', 'p3', 'p4'];
const REVIEW_VERDICTS = ['pass', 'needs-work', null];
const HISTORICAL_REVIEW_VERDICTS = [...REVIEW_VERDICTS, 'na'];
const KICKBACK_SOURCES = [...STAGES];
const KICKBACK_DESTINATIONS = STAGES;
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const KEBAB_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** @param {unknown} value */
function isId(value) {
  return typeof value === 'string' || typeof value === 'number';
}

/** @param {unknown} value */
function isNullableString(value) {
  return value === null || typeof value === 'string';
}

/** @param {unknown} value */
export function isIsoDateTime(value) {
  if (typeof value !== 'string') return false;
  const match = ISO_DATETIME.exec(value);
  if (match === null) return false;

  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = match
    .slice(1)
    .map((part) => Number(part ?? 0));
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth[month - 1]
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59;
}

/**
 * @param {string[]} out
 * @param {string} field
 * @param {boolean} valid
 */
function requireField(out, field, valid) {
  if (!valid) out.push(`[schema] ${field} is invalid`);
}

/**
 * @param {any} value
 * @param {string} field
 * @param {string[]} out
 * @param {(string | null)[]} [verdicts]
 */
function validateReview(value, field, out, verdicts = REVIEW_VERDICTS) {
  requireField(out, field, isType(value, 'object'));
  if (!isType(value, 'object')) return;
  requireField(out, `${field}.verdict`, isOneOf(value.verdict, verdicts));
  requireField(out, `${field}.reviewer_agent_id`, isNullableString(value.reviewer_agent_id));
  requireField(out, `${field}.evidence`, Array.isArray(value.evidence));
}

/**
 * @param {any} value
 * @param {string[]} out
 * @param {boolean} operation
 */
function validateAgents(value, out, operation) {
  requireField(out, 'agents', isType(value, 'object'));
  if (!isType(value, 'object')) return;
  const requiredFields = operation
    ? ['executor_agent_id', 'verifier_agent_id', 'audit_agent_id']
    : ['implementer_agent_id', 'reviewer_agent_id', 'audit_agent_id'];
  for (const field of requiredFields) {
    requireField(out, `agents.${field}`, isNullableString(value[field]));
  }
  const compatibilityFields = operation
    ? ['implementer_agent_id', 'reviewer_agent_id', 'reviewer2_agent_id']
    : ['reviewer2_agent_id', 'executor_agent_id', 'verifier_agent_id'];
  for (const field of compatibilityFields) {
    if (value[field] !== undefined) requireField(out, `agents.${field}`, isNullableString(value[field]));
  }
}

/**
 * @param {any} value
 * @param {string[]} out
 */
function validateTests(value, out) {
  requireField(out, 'tests', isType(value, 'object'));
  if (!isType(value, 'object')) return;
  requireField(out, 'tests.authored_by_agent_id', isNullableString(value.authored_by_agent_id));
  requireField(out, 'tests.green', typeof value.green === 'boolean' || value.green === 'na');
  requireField(out, 'tests.evidence', Array.isArray(value.evidence));
  if (value.gate === undefined) return;
  requireField(out, 'tests.gate', isType(value.gate, 'object'));
  if (!isType(value.gate, 'object')) return;
  requireField(out, 'tests.gate.hash', typeof value.gate.hash === 'string');
  requireField(out, 'tests.gate.clean', typeof value.gate.clean === 'boolean');
  requireField(out, 'tests.gate.green', typeof value.gate.green === 'boolean');
  requireField(out, 'tests.gate.command', typeof value.gate.command === 'string');
  requireField(out, 'tests.gate.at', isIsoDateTime(value.gate.at));
}

/**
 * @param {any} value
 * @param {string[]} out
 */
function validateKickbacks(value, out) {
  requireField(out, 'kickbacks', Array.isArray(value));
  if (!Array.isArray(value)) return;
  value.forEach((/** @type {any} */ kickback, /** @type {number} */ index) => {
    const field = `kickbacks[${index}]`;
    requireField(out, field, isType(kickback, 'object'));
    if (!isType(kickback, 'object')) return;
    requireField(out, `${field}.from`, isOneOf(kickback.from, KICKBACK_SOURCES));
    requireField(out, `${field}.to`, isOneOf(kickback.to, KICKBACK_DESTINATIONS));
    requireField(out, `${field}.reason`, typeof kickback.reason === 'string');
    requireField(out, `${field}.at`, isIsoDateTime(kickback.at));
  });
}

/**
 * @param {any} value
 * @param {string[]} out
 * @param {boolean} operation
 */
function validateConvergence(value, out, operation) {
  requireField(out, 'convergence', isType(value, 'object'));
  if (!isType(value, 'object')) return;
  requireField(out, 'convergence.cap', Number.isInteger(value.cap));
  requireField(out, 'convergence.stages', isType(value.stages, 'object'));
  const judgmentStages = operation ? ['verify', 'audit'] : ['review', 'audit'];
  if (isType(value.stages, 'object')) {
    for (const stage of judgmentStages) {
      const record = value.stages[stage];
      requireField(out, `convergence.stages.${stage}`, isType(record, 'object'));
      if (isType(record, 'object')) {
        requireField(out, `convergence.stages.${stage}.blockingKickbacks`, Number.isInteger(record.blockingKickbacks));
      }
    }
  }
  const council = value.council;
  requireField(out, 'convergence.council', isType(council, 'object'));
  if (!isType(council, 'object')) return;
  requireField(out, 'convergence.council.convened', typeof council.convened === 'boolean');
  requireField(out, 'convergence.council.stage', isOneOf(council.stage, [...judgmentStages, null]));
  requireField(out, 'convergence.council.members', Array.isArray(council.members));
  requireField(out, 'convergence.council.findings', Array.isArray(council.findings));
  requireField(out, 'convergence.council.verdict', isOneOf(council.verdict, ['ship', 'block', null]));
  requireField(out, 'convergence.council.outcome', isOneOf(council.outcome, ['shipped', 'scoped-fix-shipped', 'blocked-to-operator', null]));
  if (Array.isArray(council.members)) {
    council.members.forEach((/** @type {any} */ member, /** @type {number} */ index) => {
      const field = `convergence.council.members[${index}]`;
      requireField(out, field, isType(member, 'object'));
      if (!isType(member, 'object')) return;
      requireField(out, `${field}.agent_id`, typeof member.agent_id === 'string');
      requireField(out, `${field}.lens`, isOneOf(member.lens, ['integrity', 'security', 'pragmatist']));
      if (member.temperature !== undefined) {
        requireField(out, `${field}.temperature`, member.temperature === null || typeof member.temperature === 'number');
      }
    });
  }
  if (Array.isArray(council.findings)) {
    council.findings.forEach((/** @type {any} */ finding, /** @type {number} */ index) => {
      const field = `convergence.council.findings[${index}]`;
      requireField(out, field, isType(finding, 'object'));
      if (!isType(finding, 'object')) return;
      requireField(out, `${field}.id`, typeof finding.id === 'string');
      requireField(out, `${field}.summary`, typeof finding.summary === 'string');
      if (finding.source !== undefined) {
        requireField(out, `${field}.source`, isOneOf(finding.source, operation ? ['verify', 'audit'] : ['review', 'review2', 'audit']));
      }
      requireField(out, `${field}.blockingVotes`, Number.isInteger(finding.blockingVotes));
      requireField(out, `${field}.survived`, typeof finding.survived === 'boolean');
      if (finding.followupTaskId !== undefined) {
        requireField(out, `${field}.followupTaskId`, finding.followupTaskId === null || isId(finding.followupTaskId));
      }
    });
  }
}

/** @param {any} value @param {string} field @param {string[]} out */
function validateEvidence(value, field, out) {
  requireField(out, field, Array.isArray(value));
  if (!Array.isArray(value)) return;
  value.forEach((/** @type {any} */ item, /** @type {number} */ index) => {
    const itemField = `${field}[${index}]`;
    requireField(out, itemField, isType(item, 'object'));
    if (!isType(item, 'object')) return;
    requireField(out, `${itemField}.command`, typeof item.command === 'string' && item.command.length > 0);
    requireField(out, `${itemField}.output`, typeof item.output === 'string' && item.output.length > 0);
  });
}

/** @param {any} value @param {string} field @param {string[]} out */
function validateApproval(value, field, out) {
  const keys = ['mutation', 'grantedBy', 'grantedAt'];
  requireField(out, field, isType(value, 'object')
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key)));
  if (!isType(value, 'object')) return;
  requireField(out, `${field}.mutation`, typeof value.mutation === 'string' && value.mutation.length > 0);
  requireField(out, `${field}.grantedBy`, typeof value.grantedBy === 'string' && value.grantedBy.length > 0);
  requireField(out, `${field}.grantedAt`, isIsoDateTime(value.grantedAt));
}

/** @param {any} value @param {string} field @param {string[]} out */
function validateEscalation(value, field, out) {
  const keys = ['fork', 'options'];
  requireField(out, field, isType(value, 'object')
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key)));
  if (!isType(value, 'object')) return;
  requireField(out, `${field}.fork`, typeof value.fork === 'string' && value.fork.length > 0);
  requireField(out, `${field}.options`, Array.isArray(value.options)
    && value.options.length > 0
    && value.options.every((/** @type {unknown} */ option) => typeof option === 'string' && option.length > 0));
}


/** @param {any} value @param {string[]} out */
function validateExecution(value, out) {
  if (value === undefined) return;
  requireField(out, 'execution', isType(value, 'object'));
  if (!isType(value, 'object')) return;
  requireField(out, 'execution.result', isOneOf(value.result, ['executed', 'kickback', 'approval-required']));
  requireField(out, 'execution.executor_agent_id', isNullableString(value.executor_agent_id));
  requireField(out, 'execution.actions', Array.isArray(value.actions));
  if (Array.isArray(value.actions)) {
    value.actions.forEach((/** @type {any} */ action, /** @type {number} */ index) => {
      requireField(out, `execution.actions[${index}]`, typeof action === 'string' && action.length > 0);
    });
  }
  validateEvidence(value.evidence, 'execution.evidence', out);
  requireField(out, 'execution.approvalRequired', value.approvalRequired === null
    || (typeof value.approvalRequired === 'string' && value.approvalRequired.length > 0));
  if (value.approval !== undefined) validateApproval(value.approval, 'execution.approval', out);
}

/** @param {any} value @param {string[]} out */
function validateVerification(value, out) {
  if (value === undefined) return;
  requireField(out, 'verification', isType(value, 'object'));
  if (!isType(value, 'object')) return;
  requireField(out, 'verification.verdict', isOneOf(value.verdict, ['pass', 'needs-work', null]));
  requireField(out, 'verification.verifier_agent_id', isNullableString(value.verifier_agent_id));
  requireField(out, 'verification.postconditions', Array.isArray(value.postconditions));
  if (Array.isArray(value.postconditions)) {
    value.postconditions.forEach((/** @type {any} */ item, /** @type {number} */ index) => {
      const itemField = `verification.postconditions[${index}]`;
      requireField(out, itemField, isType(item, 'object'));
      if (!isType(item, 'object')) return;
      requireField(out, `${itemField}.postcondition`, typeof item.postcondition === 'string' && item.postcondition.length > 0);
      requireField(out, `${itemField}.ok`, typeof item.ok === 'boolean');
      requireField(out, `${itemField}.evidence`, typeof item.evidence === 'string' && item.evidence.length > 0);
    });
  }
  requireField(out, 'verification.findings', Array.isArray(value.findings));
  validateEvidence(value.evidence, 'verification.evidence', out);
}

/**
 * Validate one persisted task at the trust boundary. Unknown properties remain
 * tolerated so documented historical fields can be read without migration.
 *
 * @param {Record<string, any>} task
 * @param {{ lite: boolean }} options
 * @returns {string[]}
 */
export function taskSchemaViolations(task, { lite }) {
  /** @type {string[]} */
  const out = [];
  requireField(out, 'schemaVersion', task.schemaVersion === 1);
  requireField(out, 'id', lite ? isId(task.id) : Number.isInteger(task.id) && task.id > 0);
  requireField(out, 'slug', typeof task.slug === 'string' && (lite || KEBAB_SLUG.test(task.slug)));
  requireField(out, 'title', typeof task.title === 'string');
  requireField(out, 'status', isOneOf(task.status, STATUSES));
  const operation = task.category === 'operation';
  requireField(out, 'category', task.category === undefined || isOneOf(task.category, ['code', 'operation']));
  requireField(out, 'stage', isOneOf(task.stage, STAGES));
  requireField(out, 'priority', isOneOf(task.priority, PRIORITIES));
  const categoryStages = operation ? OPERATION_STAGES : CODE_STAGES;
  if (!categoryStages.includes(task.stage)) out.push(`[category-stage] ${operation ? 'operation' : 'code'} task cannot use stage ${String(task.stage)}`);
  requireField(out, 'deps', Array.isArray(task.deps) && task.deps.every(isId));
  requireField(out, 'createdAt', isIsoDateTime(task.createdAt));
  requireField(out, 'updatedAt', isIsoDateTime(task.updatedAt));
  if (task.complexity !== undefined) requireField(out, 'complexity', isOneOf(task.complexity, ['simple', 'complex']));
  if (task.externalRef !== undefined) requireField(out, 'externalRef', typeof task.externalRef === 'string');
  if (task.branch !== undefined) requireField(out, 'branch', isNullableString(task.branch));
  if (Object.hasOwn(task, 'plan')) {
    const validPlan = isType(task.plan, 'object');
    requireField(out, 'plan', validPlan);
    if (validPlan && operation) {
      requireField(out, 'plan.result', isOneOf(task.plan.result, ['plan', 'escalation']));
      if (task.plan.result === 'escalation') {
        requireField(out, 'plan.slices', Array.isArray(task.plan.slices)
          && task.plan.slices.length > 0
          && task.plan.slices.every((/** @type {unknown} */ item) => typeof item === 'string' && item.length > 0));
        validateEscalation(task.plan.escalation, 'plan.escalation', out);
        if ([
          'runbook', 'preconditions', 'recoveryBoundary', 'approvalBoundary', 'requiresApproval',
          'postconditions', 'verificationSeams', 'refactorOpportunity', 'testFiles', 'redRun',
        ].some((field) => Object.hasOwn(task.plan, field))) {
          out.push('[category-stage] operation escalation contains completed plan or code-only state');
        }
      } else {
        for (const field of ['runbook', 'preconditions', 'postconditions', 'verificationSeams']) {
          requireField(out, `plan.${field}`, Array.isArray(task.plan[field])
            && task.plan[field].length > 0
            && task.plan[field].every((item) => typeof item === 'string' && item.length > 0));
        }
        for (const field of ['recoveryBoundary', 'approvalBoundary']) {
          requireField(out, `plan.${field}`, typeof task.plan[field] === 'string' && task.plan[field].length > 0);
        }
        requireField(out, 'plan.requiresApproval', typeof task.plan.requiresApproval === 'boolean');
        if (['refactorOpportunity', 'testFiles', 'redRun'].some((field) => Object.hasOwn(task.plan, field))) {
          out.push('[category-stage] operation plan contains code-only state');
        }
      }
    } else if (validPlan) {
      if (task.plan.result === 'plan') out.push('[category-stage] code task contains an operation plan result');
      if (Object.hasOwn(task.plan, 'refactorOpportunity')) {
        const value = task.plan.refactorOpportunity;
        requireField(out, 'plan.refactorOpportunity', value === null
          || (typeof value === 'string' && value.trim().length > 0));
      }
      if (['runbook', 'preconditions', 'recoveryBoundary', 'approvalBoundary', 'requiresApproval', 'postconditions', 'verificationSeams']
        .some((field) => Object.hasOwn(task.plan, field))) {
        out.push('[category-stage] code plan contains operation-only state');
      }
    }
  }
  validateAgents(task.agents, out, operation);
  validateExecution(task.execution, out);
  validateVerification(task.verification, out);
  if (task.approvals !== undefined) {
    requireField(out, 'approvals', Array.isArray(task.approvals));
    if (Array.isArray(task.approvals)) {
      task.approvals.forEach((approval, index) => validateApproval(approval, `approvals[${index}]`, out));
    }
  }
  if (operation) {
    const codeIdentity = [
      task.agents?.implementer_agent_id,
      task.agents?.reviewer_agent_id,
      task.agents?.reviewer2_agent_id,
    ].some((agentId) => agentId != null);
    const codeOutcome = task.implement !== undefined
      || task.refactor !== undefined
      || task.review?.verdict != null
      || task.review?.reviewer_agent_id != null
      || task.review2 != null
      || task.tests?.authored_by_agent_id != null
      || (task.tests?.green !== undefined && task.tests.green !== false)
      || (task.tests?.evidence !== undefined && task.tests.evidence.length !== 0)
      || task.tests?.gate !== undefined;
    if (codeIdentity || codeOutcome) out.push('[category-stage] operation task contains code-only state');
  } else if (task.execution !== undefined || task.verification !== undefined
    || task.approvals !== undefined
    || task.agents?.executor_agent_id != null || task.agents?.verifier_agent_id != null) {
    out.push('[category-stage] code task contains operation-only state');
  }
  if (!operation || task.tests !== undefined) validateTests(task.tests, out);
  if (!operation || task.review !== undefined) {
    validateReview(task.review, 'review', out, HISTORICAL_REVIEW_VERDICTS);
  }
  if (task.review2 !== undefined && task.review2 !== null) validateReview(task.review2, 'review2', out);
  requireField(out, 'audit', isType(task.audit, 'object'));
  if (isType(task.audit, 'object')) {
    requireField(out, 'audit.required', typeof task.audit.required === 'boolean');
    requireField(out, 'audit.verdict', isOneOf(task.audit.verdict, ['pass', 'needs-work', 'na']));
    requireField(out, 'audit.audit_agent_id', isNullableString(task.audit.audit_agent_id));
    requireField(out, 'audit.evidence', Array.isArray(task.audit.evidence));
  }
  requireField(out, 'commits', Array.isArray(task.commits));
  validateKickbacks(task.kickbacks, out);
  if (Array.isArray(task.kickbacks)) {
    const destinations = operation ? ['capture', 'plan', 'execute'] : CODE_STAGES;
    const sources = operation ? ['execute', 'verify', 'audit'] : [...CODE_STAGES, 'verify'];
    if (task.kickbacks.some((kickback) => !sources.includes(kickback?.from) || !destinations.includes(kickback?.to))) {
      out.push(`[category-stage] ${operation ? 'operation' : 'code'} task has a cross-category kickback`);
    }
  }
  for (const field of ['blockedReason', 'abandonReason']) {
    requireField(out, field, isNullableString(task[field]));
  }
  if (task.convergence !== undefined) validateConvergence(task.convergence, out, operation);
  return out;
}
