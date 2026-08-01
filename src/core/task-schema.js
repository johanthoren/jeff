// @ts-check

import { isAgentId, isSourceRefuteAgentForbidden } from './identity-policy.js';
import {
  hasBoundPendingApprovalRequest,
  hasCompletedApprovalProvenance,
  isAuthoritativeOperation,
  isAwaitingScopedOperationExecution,
  isOperationCycle,
  isSameApproval,
  latestApprovalRequest,
  OPERATION_STATE_VERSION,
} from './operation-state.js';
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
const OPERATION_FINDING_DESTINATIONS = ['capture', 'plan', 'execute'];
const CODE_JUDGMENT_SOURCES = ['review', 'review2', 'audit'];
const CODE_REPAIR_DESTINATIONS = ['implement', 'refactor'];
const CODE_JUDGMENT_DESTINATIONS = ['capture', 'plan', 'implement', 'refactor'];
const AUDIT_CATEGORIES = [
  'secrets',
  'injection_sql',
  'injection_command',
  'path_traversal',
  'insecure_deserialization',
  'weak_crypto',
  'dynamic_execution',
  'tls_transport',
  'xss',
  'sensitive_logging',
  'insecure_permissions',
];
const AUDIT_COVERAGE_STATUSES = ['covered_with_hits', 'covered_no_hits', 'not_covered'];
const OPERATION_JUDGMENT_SOURCES = ['verify', 'audit'];

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
 * Validate full-mode dependency provenance at the config trust boundary.
 * Lite mode does not interpret this full-mode field.
 *
 * @param {Record<string, unknown> | null} config
 * @param {{ lite: boolean }} options
 * @returns {string[]}
 */
export function configSchemaViolations(config, { lite }) {
  /** @type {string[]} */
  const out = [];
  if (!lite && config !== null && Object.hasOwn(config, 'prunedTaskIds')) {
    requireField(out, 'prunedTaskIds', Array.isArray(config.prunedTaskIds)
      && config.prunedTaskIds.every((id) => (
        typeof id === 'number' && Number.isInteger(id) && id > 0
      )));
  }
  return out;
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
    if (kickback.findings === undefined) return;
    requireField(out, `${field}.findings`, Array.isArray(kickback.findings));
    if (!Array.isArray(kickback.findings)) return;
    kickback.findings.forEach((/** @type {any} */ finding, /** @type {number} */ findingIndex) => {
      const findingField = `${field}.findings[${findingIndex}]`;
      requireField(out, findingField, isType(finding, 'object'));
      if (!isType(finding, 'object')) return;
      requireField(out, `${findingField}.source`, isOneOf(finding.source, CODE_JUDGMENT_SOURCES));
      requireField(out, `${findingField}.file`, isNonemptyString(finding.file));
      requireField(out, `${findingField}.line`, Number.isInteger(finding.line) && finding.line >= 1);
      requireField(out, `${findingField}.what`, isNonemptyString(finding.what));
      requireField(out, `${findingField}.kickTo`, isOneOf(finding.kickTo, CODE_JUDGMENT_DESTINATIONS));
    });
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

/** @param {unknown} value */
function isNonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/** @param {any} left @param {any} right */
function isSameEvidence(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => (
      item?.command === right[index]?.command
      && item?.output === right[index]?.output
    ));
}

/** @param {any} left @param {any} right */
function isSameRefute(left, right) {
  return isType(left, 'object')
    && isType(right, 'object')
    && left.agent_id === right.agent_id
    && left.source === right.source
    && left.finding === right.finding
    && left.verdict === right.verdict
    && left.rationale === right.rationale
    && isSameEvidence(left.evidence, right.evidence);
}

/**
 * @param {any} value
 * @param {string} field
 * @param {string[]} out
 * @param {'verify' | 'audit'} [expectedSource]
 * @param {string} [expectedFinding]
 */
function validateRefute(value, field, out, expectedSource, expectedFinding) {
  requireField(out, field, isType(value, 'object'));
  if (!isType(value, 'object')) return;
  requireField(out, `${field}.agent_id`, isNonemptyString(value.agent_id));
  requireField(out, `${field}.source`, isOneOf(value.source, OPERATION_JUDGMENT_SOURCES));
  if (expectedSource !== undefined) requireField(out, `${field}.source`, value.source === expectedSource);
  requireField(out, `${field}.finding`, isNonemptyString(value.finding));
  if (expectedFinding !== undefined) requireField(out, `${field}.finding`, value.finding === expectedFinding);
  requireField(out, `${field}.verdict`, isOneOf(value.verdict, ['survives', 'refuted']));
  requireField(out, `${field}.rationale`, isNonemptyString(value.rationale));
  validateEvidence(value.evidence, `${field}.evidence`, out);
  requireField(out, `${field}.evidence`, Array.isArray(value.evidence) && value.evidence.length > 0);
}

/**
 * @param {any} value
 * @param {string} field
 * @param {'verify' | 'audit'} source
 * @param {any} task
 * @param {string[]} out
 */
function validateOperationFinding(value, field, source, task, out) {
  requireField(out, field, isType(value, 'object'));
  if (!isType(value, 'object')) return;
  requireField(out, `${field}.file`, isNonemptyString(value.file));
  requireField(out, `${field}.line`, Number.isInteger(value.line) && value.line > 0);
  requireField(out, `${field}.severity`, isOneOf(value.severity, ['critical', 'high', 'medium', 'low']));
  requireField(out, `${field}.class`, isOneOf(value.class, ['blocking', 'follow-up']));
  if (source === 'audit') {
    requireField(out, `${field}.cwe`, value.cwe === null || isNonemptyString(value.cwe));
  }
  requireField(out, `${field}.kickTo`, isOneOf(value.kickTo, OPERATION_FINDING_DESTINATIONS));
  requireField(out, `${field}.what`, isNonemptyString(value.what));
  requireField(out, `${field}.why`, isNonemptyString(value.why));
  if (value.refute === undefined) return;
  const finding = `${value.file}:${value.line} ${value.what}`;
  validateRefute(value.refute, `${field}.refute`, out, source, finding);
  requireField(out, `${field}.refute retained`, Array.isArray(task.refutes)
    && task.refutes.some((/** @type {any} */ refute) => isSameRefute(refute, value.refute)));
}

/**
 * @param {any} value
 * @param {string} field
 * @param {'verify' | 'audit'} source
 * @param {any} task
 * @param {string[]} out
 */
function validateOperationFindings(value, field, source, task, out) {
  requireField(out, field, Array.isArray(value));
  if (!Array.isArray(value)) return;
  value.forEach((/** @type {any} */ finding, /** @type {number} */ index) => (
    validateOperationFinding(finding, `${field}[${index}]`, source, task, out)
  ));
}

/**
 * @param {any} task
 * @param {(source: 'verify' | 'audit', finding: any, judgeAgentId: unknown) => void} visit
 */
function forEachOperationFinding(task, visit) {
  const visitOutcome = (
    /** @type {'verify' | 'audit'} */ source,
    /** @type {any} */ outcome,
  ) => {
    if (!Array.isArray(outcome?.findings)) return;
    const judgeAgentId = source === 'verify'
      ? outcome.verifier_agent_id
      : outcome.audit_agent_id;
    outcome.findings.forEach((/** @type {any} */ finding) => visit(source, finding, judgeAgentId));
  };
  visitOutcome('verify', task.verification);
  visitOutcome('audit', task.audit);
  if (!Array.isArray(task.judgmentHistory)) return;
  task.judgmentHistory.forEach((/** @type {any} */ entry) => {
    visitOutcome('verify', entry?.verification);
    visitOutcome('audit', entry?.audit);
  });
}

/** @param {any} task @param {string[]} out */
function validateOperationRefutes(task, out) {
  if (task.refutes === undefined) return;
  requireField(out, 'refutes', Array.isArray(task.refutes));
  if (!Array.isArray(task.refutes)) return;
  task.refutes.forEach((/** @type {any} */ refute, /** @type {number} */ index) => {
    const field = `refutes[${index}]`;
    validateRefute(refute, field, out);
    let attached = false;
    forEachOperationFinding(task, (_source, finding) => {
      if (isSameRefute(refute, finding?.refute)) attached = true;
    });
    requireField(out, `${field} attached`, attached);
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


/** @param {any} task @param {string[]} out */
function validateApprovalRequests(task, out) {
  if (task.approvalRequests === undefined) return;
  requireField(out, 'approvalRequests', Array.isArray(task.approvalRequests));
  if (!Array.isArray(task.approvalRequests)) return;
  task.approvalRequests.forEach((/** @type {any} */ request, /** @type {number} */ index) => {
    const field = `approvalRequests[${index}]`;
    const keys = ['id', 'mutation', 'requestedBy', 'requestedAt', 'cycle'];
    requireField(out, field, isType(request, 'object')
      && Object.keys(request).length === keys.length
      && keys.every((key) => Object.hasOwn(request, key)));
    if (!isType(request, 'object')) return;
    requireField(out, `${field}.id`, request.id === index);
    requireField(out, `${field}.mutation`, isNonemptyString(request.mutation));
    requireField(out, `${field}.requestedBy`, isAgentId(request.requestedBy));
    requireField(out, `${field}.requestedAt`, isIsoDateTime(request.requestedAt));
    requireField(out, `${field}.cycle`, isOperationCycle(request.cycle));
    const previous = task.approvalRequests[index - 1];
    if (previous !== undefined) {
      requireField(out, `${field}.requestedAt ordering`,
        Date.parse(previous.requestedAt) <= Date.parse(request.requestedAt));
      requireField(out, `${field}.cycle ordering`, previous.cycle <= request.cycle);
    }
  });
}

/** @param {any} task @param {string[]} out @param {boolean} authoritative */
function validateOperationApproval(task, out, authoritative) {
  if (task.plan?.result !== 'plan' || !isType(task.execution, 'object')) return;
  const requiresApproval = task.plan.requiresApproval === true;
  const planned = task.plan.approvalBoundary;
  const execution = task.execution;
  const grant = execution.approval;

  if (execution.result === 'approval-required') {
    requireField(out, 'execution.approvalRequired', requiresApproval
      && execution.approvalRequired === planned);
    requireField(out, 'execution.executor_agent_id provenance', isNonemptyString(execution.executor_agent_id));
    if (authoritative && !hasBoundPendingApprovalRequest(task)) {
      out.push('[approval-provenance] pending approval must retain its exact latest request');
    }
  }
  if (grant !== undefined) {
    requireField(out, 'execution.approval.mutation', requiresApproval
      && grant?.mutation === planned);
    requireField(out, 'execution.approval.grantedBy provenance',
      grant?.grantedBy !== execution.executor_agent_id);
    requireField(out, 'execution.approval retained', Array.isArray(task.approvals)
      && task.approvals.some((/** @type {any} */ approval) => isSameApproval(approval, grant)));
    if (authoritative) {
      const request = latestApprovalRequest(task);
      if (request === undefined
        || request.requestedBy === grant.grantedBy
        || Date.parse(request.requestedAt) > Date.parse(grant.grantedAt)) {
        out.push('[approval-provenance] operator grant must follow and differ from its exact requester');
      }
    }
  }
  if (authoritative && execution.result === 'executed' && requiresApproval
    && !isAwaitingScopedOperationExecution(task)
    && !hasCompletedApprovalProvenance(task)) {
    out.push('[approval-provenance] completed approval must bind the latest request, grant, and execution');
  }
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


/** @param {any} value @param {string[]} out @param {boolean} authoritative */
function validateExecution(value, out, authoritative) {
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
  if (value.approvalRequestId !== undefined) {
    requireField(out, 'execution.approvalRequestId', isOperationCycle(value.approvalRequestId));
  }
  if (authoritative && (!isOperationCycle(value.cycle) || !isIsoDateTime(value.recordedAt))) {
    out.push('[operation-version] authoritative execution requires cycle and recordedAt provenance');
  }
}

/** @param {any} value @param {string} field @param {string[]} out @param {any} task */
function validateVerification(value, field, out, task) {
  if (value === undefined) return;
  requireField(out, field, isType(value, 'object'));
  if (!isType(value, 'object')) return;
  requireField(out, `${field}.verdict`, isOneOf(value.verdict, ['pass', 'needs-work', null]));
  if (value.reportedVerdict !== undefined) {
    requireField(out, `${field}.reportedVerdict`, isOneOf(value.reportedVerdict, ['pass', 'needs-work']));
  }
  requireField(out, `${field}.verifier_agent_id`, isNullableString(value.verifier_agent_id));
  requireField(out, `${field}.postconditions`, Array.isArray(value.postconditions));
  if (Array.isArray(value.postconditions)) {
    value.postconditions.forEach((/** @type {any} */ item, /** @type {number} */ index) => {
      const itemField = `${field}.postconditions[${index}]`;
      requireField(out, itemField, isType(item, 'object'));
      if (!isType(item, 'object')) return;
      requireField(out, `${itemField}.postcondition`, isNonemptyString(item.postcondition));
      requireField(out, `${itemField}.ok`, typeof item.ok === 'boolean');
      requireField(out, `${itemField}.evidence`, isNonemptyString(item.evidence));
    });
  }
  validateOperationFindings(value.findings, `${field}.findings`, 'verify', task, out);
  validateEvidence(value.evidence, `${field}.evidence`, out);
  if (value.verdict !== null) {
    requireField(out, `${field}.evidence`, Array.isArray(value.evidence) && value.evidence.length > 0);
  }
}

/** @param {any} value @param {string} field @param {string[]} out */
function validateAuditScan(value, field, out) {
  requireField(out, field, isType(value, 'object'));
  if (!isType(value, 'object')) return;
  requireField(out, `${field}.command`, isNonemptyString(value.command));
  requireField(out, `${field}.recommendation`, isOneOf(value.recommendation, ['PASS', 'REVIEW', 'BLOCK']));
  requireField(out, `${field}.reportPath`, isNonemptyString(value.reportPath));
}

/** @param {any} value @param {string} field @param {string[]} out */
function validateAuditCoverage(value, field, out) {
  requireField(out, field, Array.isArray(value));
  if (!Array.isArray(value)) return;
  const categories = new Set();
  value.forEach((item, index) => {
    const itemField = `${field}[${index}]`;
    requireField(out, itemField, isType(item, 'object'));
    if (!isType(item, 'object')) return;
    requireField(out, `${itemField}.category`, isOneOf(item.category, AUDIT_CATEGORIES));
    requireField(out, `${itemField}.status`, isOneOf(item.status, AUDIT_COVERAGE_STATUSES));
    categories.add(item.category);
  });
  requireField(out, field, value.length === AUDIT_CATEGORIES.length
    && categories.size === AUDIT_CATEGORIES.length);
}

/**
 * @param {any} value
 * @param {string} field
 * @param {string[]} out
 * @param {boolean} operation
 * @param {any} task
 */
function validateAudit(value, field, out, operation, task) {
  requireField(out, field, isType(value, 'object'));
  if (!isType(value, 'object')) return;
  requireField(out, `${field}.required`, typeof value.required === 'boolean');
  requireField(out, `${field}.verdict`, isOneOf(value.verdict, ['pass', 'needs-work', 'na']));
  if (value.reportedVerdict !== undefined) {
    requireField(out, `${field}.reportedVerdict`, isOneOf(value.reportedVerdict, ['pass', 'needs-work', 'na']));
  }
  requireField(out, `${field}.audit_agent_id`, isNullableString(value.audit_agent_id));
  if (!operation) {
    requireField(out, `${field}.evidence`, Array.isArray(value.evidence));
    return;
  }

  const recorded = value.audit_agent_id !== null || value.verdict !== 'na';
  if (recorded || value.findings !== undefined) {
    validateOperationFindings(value.findings, `${field}.findings`, 'audit', task, out);
  }
  validateEvidence(value.evidence, `${field}.evidence`, out);
  if (recorded) {
    requireField(out, `${field}.evidence`, Array.isArray(value.evidence) && value.evidence.length > 0);
    validateAuditScan(value.scan, `${field}.scan`, out);
    validateAuditCoverage(value.coverage, `${field}.coverage`, out);
  } else {
    if (value.scan !== undefined) validateAuditScan(value.scan, `${field}.scan`, out);
    if (value.coverage !== undefined) validateAuditCoverage(value.coverage, `${field}.coverage`, out);
  }
}

/** @param {any} task @param {string[]} out @param {boolean} authoritative */
function validateJudgmentHistory(task, out, authoritative) {
  if (task.judgmentHistory === undefined) return;
  requireField(out, 'judgmentHistory', Array.isArray(task.judgmentHistory)
    && task.judgmentHistory.length > 0);
  if (!Array.isArray(task.judgmentHistory)) return;
  task.judgmentHistory.forEach((/** @type {any} */ entry, /** @type {number} */ index) => {
    const field = `judgmentHistory[${index}]`;
    requireField(out, field, isType(entry, 'object'));
    if (!isType(entry, 'object')) return;
    if (authoritative) requireField(out, `${field}.cycle`, entry.cycle === index);
    requireField(out, `${field}.at`, isIsoDateTime(entry.at));
    validateVerification(entry.verification, `${field}.verification`, out, task);
    validateAudit(entry.audit, `${field}.audit`, out, true, task);
    requireField(out, `${field}.agents`, isType(entry.agents, 'object'));
    if (!isType(entry.agents, 'object')) return;
    requireField(out, `${field}.agents.verifier_agent_id`, isNullableString(entry.agents.verifier_agent_id));
    requireField(out, `${field}.agents.audit_agent_id`, isNullableString(entry.agents.audit_agent_id));
    if (entry.verification?.verdict !== null) {
      requireField(out, `${field}.verification identity`, isNonemptyString(entry.agents.verifier_agent_id)
        && entry.agents.verifier_agent_id === entry.verification?.verifier_agent_id);
    }
    if (entry.audit?.audit_agent_id !== null || entry.audit?.verdict !== 'na') {
      requireField(out, `${field}.audit identity`, isNonemptyString(entry.agents.audit_agent_id)
        && entry.agents.audit_agent_id === entry.audit?.audit_agent_id
        && entry.agents.audit_agent_id !== entry.agents.verifier_agent_id);
    }
  });
}

/** @param {any} task @param {string[]} out */
function validateCodeJudgmentHistory(task, out) {
  if (task.judgmentHistory === undefined) return;
  requireField(out, 'judgmentHistory', Array.isArray(task.judgmentHistory)
    && task.judgmentHistory.length > 0);
  if (!Array.isArray(task.judgmentHistory)) return;
  task.judgmentHistory.forEach((/** @type {any} */ entry, /** @type {number} */ index) => {
    const field = `judgmentHistory[${index}]`;
    requireField(out, field, isType(entry, 'object'));
    if (!isType(entry, 'object')) return;
    requireField(out, `${field}.at`, isIsoDateTime(entry.at));

    const authoritative = entry.agents !== undefined;
    if (authoritative || entry.review !== undefined) {
      if (!isType(entry.review, 'object')) requireField(out, `${field}.review`, false);
      else if (authoritative || Object.keys(entry.review).length > 0) {
        validateReview(entry.review, `${field}.review`, out, HISTORICAL_REVIEW_VERDICTS);
      }
    }
    if (authoritative || entry.review2 !== undefined) {
      requireField(out, `${field}.review2`, entry.review2 === null || isType(entry.review2, 'object'));
      if (isType(entry.review2, 'object')
        && (authoritative || Object.keys(entry.review2).length > 0)) {
        validateReview(entry.review2, `${field}.review2`, out, HISTORICAL_REVIEW_VERDICTS);
      }
    }
    if (authoritative || entry.audit !== undefined) {
      if (!isType(entry.audit, 'object')) requireField(out, `${field}.audit`, false);
      else if (authoritative || Object.keys(entry.audit).length > 0) {
        validateAudit(entry.audit, `${field}.audit`, out, false, task);
      }
    }
    if (!authoritative) return;

    requireField(out, `${field}.agents`, isType(entry.agents, 'object'));
    if (!isType(entry.agents, 'object')) return;
    for (const identity of ['reviewer_agent_id', 'reviewer2_agent_id', 'audit_agent_id']) {
      requireField(out, `${field}.agents.${identity}`, isNullableString(entry.agents[identity]));
    }
    requireField(out, `${field}.review identity`,
      entry.review?.reviewer_agent_id == null
      || entry.review.reviewer_agent_id === entry.agents.reviewer_agent_id);
    requireField(out, `${field}.review2 identity`,
      entry.review2?.reviewer_agent_id == null
      || entry.review2.reviewer_agent_id === entry.agents.reviewer2_agent_id);
    requireField(out, `${field}.audit identity`,
      entry.audit?.audit_agent_id == null
      || entry.audit.audit_agent_id === entry.agents.audit_agent_id);
  });
}


/** @param {any} task @param {string[]} out */
function validateOperationVersion(task, out) {
  if (task.category === 'operation') {
    if (task.operationStateVersion !== undefined
      && task.operationStateVersion !== OPERATION_STATE_VERSION) {
      out.push(`[operation-version] unsupported operationStateVersion ${String(task.operationStateVersion)}`);
    }
  } else if (task.operationStateVersion !== undefined) {
    out.push('[category-stage] code task contains operation-only state');
  }
}

/** @param {any} task @param {string[]} out */
function validateOperationState(task, out) {
  const planComplete = task.plan?.result === 'plan';
  const executionComplete = task.execution?.result === 'executed';
  const verificationComplete = task.verification?.verdict === 'pass'
    || task.verification?.verdict === 'needs-work';
  const terminalMatches = (task.status === 'done') === (task.stage === 'done');
  const escalationAtPlan = task.plan?.result !== 'escalation' || task.stage === 'plan';
  const predecessorComplete = task.stage === 'capture' || task.stage === 'plan'
    || (task.stage === 'execute' && planComplete)
    || (task.stage === 'verify' && planComplete && executionComplete)
    || (task.stage === 'audit' && planComplete && executionComplete && verificationComplete)
    || (task.stage === 'done' && planComplete && executionComplete && verificationComplete);
  if (!terminalMatches || !escalationAtPlan || !predecessorComplete) {
    out.push('[operation-state] operation stage must retain its exact predecessor state');
  }
}

/** @param {any} task @param {string[]} out */
function validateOperationIdentities(task, out) {
  const ids = [
    task.agents?.executor_agent_id,
    task.agents?.verifier_agent_id,
    task.agents?.audit_agent_id,
  ];
  const recorded = [
    [task.execution !== undefined, task.agents?.executor_agent_id, task.execution?.executor_agent_id],
    [task.verification?.verdict !== null && task.verification?.verdict !== undefined,
      task.agents?.verifier_agent_id, task.verification?.verifier_agent_id],
    [task.audit?.audit_agent_id !== null || task.audit?.verdict !== 'na',
      task.agents?.audit_agent_id, task.audit?.audit_agent_id],
  ];
  if (ids.some((agentId) => agentId !== null && !isAgentId(agentId))
    || recorded.some(([occupied, ledgerId, outcomeId]) => (
      occupied && (!isAgentId(ledgerId) || !isAgentId(outcomeId))
    ))) {
    out.push('[operation-identity] recorded operation identities must be nonempty and null only while vacant');
  }
}

/** @param {any} task @param {string[]} out */
function validateOperationAuditState(task, out) {
  if (task.audit?.required === true && task.audit.verdict === 'na'
    && task.audit.audit_agent_id !== null) {
    out.push('[operation-audit] required audit na is valid only as the vacant placeholder');
  }
}

/** @param {any} task @param {string[]} out */
function validateOperationCouncil(task, out) {
  const council = task.convergence?.council;
  if (council?.convened !== true) return;
  const counter = task.convergence?.stages?.[council.stage]?.blockingKickbacks;
  if (!isOperationCycle(council.cycle)
    || !isAgentId(council.executor_agent_id)
    || counter !== task.convergence?.cap) {
    out.push('[operation-council] convened council requires its exact capped source and baseline provenance');
  }
}

/** @param {any} task @param {string[]} out */
function validateOperationRefuteIdentities(task, out) {
  let invalid = false;
  forEachOperationFinding(task, (_source, finding, judgeAgentId) => {
    if (isSourceRefuteAgentForbidden(judgeAgentId, finding?.refute?.agent_id)) invalid = true;
  });
  if (invalid) {
    out.push('[operation-refute-identity] source judge cannot refute its own operation finding');
  }
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
  if (Object.hasOwn(task, 'pipelineVersion')) {
    requireField(out, 'pipelineVersion', typeof task.pipelineVersion === 'string' && task.pipelineVersion.length > 0);
  }
  requireField(out, 'id', lite ? isId(task.id) : Number.isInteger(task.id) && task.id > 0);
  requireField(out, 'slug', typeof task.slug === 'string' && (lite || KEBAB_SLUG.test(task.slug)));
  requireField(out, 'title', typeof task.title === 'string');
  requireField(out, 'status', isOneOf(task.status, STATUSES));
  const operation = task.category === 'operation';
  const authoritativeOperation = isAuthoritativeOperation(task);
  validateOperationVersion(task, out);
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
  validateExecution(task.execution, out, authoritativeOperation);
  validateVerification(task.verification, 'verification', out, task);
  if (task.approvals !== undefined) {
    requireField(out, 'approvals', Array.isArray(task.approvals));
    if (Array.isArray(task.approvals)) {
      task.approvals.forEach((approval, index) => validateApproval(approval, `approvals[${index}]`, out));
    }
  }
  if (authoritativeOperation) validateApprovalRequests(task, out);
  if (operation) validateOperationApproval(task, out, authoritativeOperation);
  if (operation) validateJudgmentHistory(task, out, authoritativeOperation);
  else validateCodeJudgmentHistory(task, out);
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
  validateAudit(task.audit, 'audit', out, operation, task);
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
  if (operation) validateOperationRefutes(task, out);
  if (authoritativeOperation) {
    validateOperationState(task, out);
    validateOperationIdentities(task, out);
    validateOperationAuditState(task, out);
    validateOperationCouncil(task, out);
    validateOperationRefuteIdentities(task, out);
  }
  return out;
}
