// @ts-check

import { isOneOf, isType } from './validate.js';

const STATUSES = ['pending', 'in_progress', 'blocked', 'done', 'abandoned'];
const STAGES = ['capture', 'plan', 'test', 'implement', 'refactor', 'review', 'audit', 'done'];
const PRIORITIES = ['p0', 'p1', 'p2', 'p3', 'p4'];
const REVIEW_VERDICTS = ['pass', 'needs-work', null];
const HISTORICAL_REVIEW_VERDICTS = [...REVIEW_VERDICTS, 'na'];
const KICKBACK_SOURCES = [...STAGES, 'verify'];
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
 */
function validateAgents(value, out) {
  requireField(out, 'agents', isType(value, 'object'));
  if (!isType(value, 'object')) return;
  for (const field of ['implementer_agent_id', 'reviewer_agent_id', 'audit_agent_id']) {
    requireField(out, `agents.${field}`, isNullableString(value[field]));
  }
  if (value.reviewer2_agent_id !== undefined) {
    requireField(out, 'agents.reviewer2_agent_id', isNullableString(value.reviewer2_agent_id));
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
 */
function validateConvergence(value, out) {
  requireField(out, 'convergence', isType(value, 'object'));
  if (!isType(value, 'object')) return;
  requireField(out, 'convergence.cap', Number.isInteger(value.cap));
  requireField(out, 'convergence.stages', isType(value.stages, 'object'));
  if (isType(value.stages, 'object')) {
    for (const stage of ['review', 'audit']) {
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
  requireField(out, 'convergence.council.stage', isOneOf(council.stage, ['review', 'audit', null]));
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
        requireField(out, `${field}.source`, isOneOf(finding.source, ['review', 'review2', 'audit']));
      }
      requireField(out, `${field}.blockingVotes`, Number.isInteger(finding.blockingVotes));
      requireField(out, `${field}.survived`, typeof finding.survived === 'boolean');
      if (finding.followupTaskId !== undefined) {
        requireField(out, `${field}.followupTaskId`, finding.followupTaskId === null || isId(finding.followupTaskId));
      }
    });
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
  requireField(out, 'id', lite ? isId(task.id) : Number.isInteger(task.id) && task.id > 0);
  requireField(out, 'slug', typeof task.slug === 'string' && (lite || KEBAB_SLUG.test(task.slug)));
  requireField(out, 'title', typeof task.title === 'string');
  requireField(out, 'status', isOneOf(task.status, STATUSES));
  requireField(out, 'stage', isOneOf(task.stage, STAGES));
  requireField(out, 'priority', isOneOf(task.priority, PRIORITIES));
  requireField(out, 'deps', Array.isArray(task.deps) && task.deps.every(isId));
  requireField(out, 'createdAt', isIsoDateTime(task.createdAt));
  requireField(out, 'updatedAt', isIsoDateTime(task.updatedAt));
  if (task.complexity !== undefined) requireField(out, 'complexity', isOneOf(task.complexity, ['simple', 'complex']));
  if (task.externalRef !== undefined) requireField(out, 'externalRef', typeof task.externalRef === 'string');
  if (task.branch !== undefined) requireField(out, 'branch', isNullableString(task.branch));
  validateAgents(task.agents, out);
  validateTests(task.tests, out);
  validateReview(task.review, 'review', out, HISTORICAL_REVIEW_VERDICTS);
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
  for (const field of ['blockedReason', 'abandonReason']) {
    requireField(out, field, isNullableString(task[field]));
  }
  if (task.convergence !== undefined) validateConvergence(task.convergence, out);
  return out;
}
