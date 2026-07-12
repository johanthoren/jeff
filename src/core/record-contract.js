// @ts-check

import { isType } from './validate.js';

const STAGES = ['plan', 'implement', 'refactor', 'review', 'audit', 'refute', 'council'];
const RESULTS = {
  plan: ['red', 'plan', 'escalation'],
  implement: ['green', 'kickback'],
  refactor: ['refactored', 'clean'],
};

/** @param {string} path */
function invalid(path) {
  throw new Error(`[record-schema] ${path} is invalid`);
}

/** @param {any} value @param {string} path @param {string[]} keys */
function closed(value, path, keys) {
  if (!isType(value, 'object')) invalid(path);
  for (const key of Object.keys(value)) if (!keys.includes(key)) invalid(path ? `${path}.${key}` : key);
  for (const key of keys) if (!Object.hasOwn(value, key)) invalid(path ? `${path}.${key}` : key);
}

/** @param {any} value @param {string} path @param {string[]} required @param {string[]} optional */
function closedOptional(value, path, required, optional) {
  if (!isType(value, 'object')) invalid(path);
  const keys = [...required, ...optional];
  for (const key of Object.keys(value)) if (!keys.includes(key)) invalid(path ? `${path}.${key}` : key);
  for (const key of required) if (!Object.hasOwn(value, key)) invalid(path ? `${path}.${key}` : key);
}

/** @param {any} value @param {string} path */
function string(value, path) {
  if (typeof value !== 'string' || value.length === 0) invalid(path);
}

/** @param {any} value @param {string} path */
function strings(value, path) {
  if (!Array.isArray(value)) invalid(path);
  value.forEach((/** @type {any} */ item, /** @type {number} */ index) => string(item, `${path}[${index}]`));
}

/** @param {any} value @param {string} path @param {readonly any[]} choices */
function oneOf(value, path, choices) {
  if (!choices.includes(value)) invalid(path);
}

/** @param {any} value @param {string} path */
function nonnegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) invalid(path);
}

/** @param {any} value @param {string} path */
function run(value, path) {
  closed(value, path, ['command', 'output']);
  if (value.command !== null) string(value.command, `${path}.command`);
  string(value.output, `${path}.output`);
}

/** @param {any} value @param {string} path */
function evidence(value, path) {
  if (!Array.isArray(value)) invalid(path);
  value.forEach((/** @type {any} */ item, /** @type {number} */ index) => {
    const at = `${path}[${index}]`;
    closed(item, at, ['command', 'output']);
    string(item.command, `${at}.command`);
    string(item.output, `${at}.output`);
  });
}

/** @param {any} value @param {string} path @param {readonly string[]} destinations @param {boolean} audit */
function findings(value, path, destinations, audit) {
  if (!Array.isArray(value)) invalid(path);
  value.forEach((/** @type {any} */ item, /** @type {number} */ index) => {
    const at = `${path}[${index}]`;
    const keys = ['file', 'line', 'severity', 'class', ...(audit ? ['cwe'] : []), 'kickTo', 'what', 'why'];
    closed(item, at, keys);
    string(item.file, `${at}.file`);
    if (!Number.isInteger(item.line) || item.line < 1) invalid(`${at}.line`);
    oneOf(item.severity, `${at}.severity`, ['critical', 'high', 'medium', 'low']);
    oneOf(item.class, `${at}.class`, ['blocking', 'follow-up']);
    if (audit && item.cwe !== null) string(item.cwe, `${at}.cwe`);
    oneOf(item.kickTo, `${at}.kickTo`, destinations);
    string(item.what, `${at}.what`);
    string(item.why, `${at}.why`);
  });
}

/** @param {any} value */
function validatePlan(value) {
  closed(value, '', ['agent_id', 'stage', 'result', 'complexity', 'auditRequired', 'slices', 'testFiles', 'redRun', 'escalation']);
  oneOf(value.result, 'result', RESULTS.plan);
  oneOf(value.complexity, 'complexity', ['simple', 'complex']);
  if (typeof value.auditRequired !== 'boolean') invalid('auditRequired');
  strings(value.slices, 'slices');
  strings(value.testFiles, 'testFiles');
  run(value.redRun, 'redRun');
  if (value.escalation !== null) {
    closed(value.escalation, 'escalation', ['fork', 'options']);
    string(value.escalation.fork, 'escalation.fork');
    strings(value.escalation.options, 'escalation.options');
  }
}

/** @param {any} value */
function validateImplement(value) {
  closed(value, '', ['agent_id', 'stage', 'result', 'files', 'greenRun', 'kickback']);
  oneOf(value.result, 'result', RESULTS.implement);
  strings(value.files, 'files');
  run(value.greenRun, 'greenRun');
  if (value.kickback !== null) {
    closed(value.kickback, 'kickback', ['to', 'reason']);
    oneOf(value.kickback.to, 'kickback.to', ['plan']);
    string(value.kickback.reason, 'kickback.reason');
  }
  if ((value.result === 'green') !== (value.kickback === null)) invalid('kickback');
}

/** @param {any} value */
function validateRefactor(value) {
  closed(value, '', ['agent_id', 'stage', 'result', 'files', 'outsideDiff', 'greenRun', 'summary']);
  oneOf(value.result, 'result', RESULTS.refactor);
  strings(value.files, 'files');
  strings(value.outsideDiff, 'outsideDiff');
  run(value.greenRun, 'greenRun');
  strings(value.summary, 'summary');
}

/** @param {any} value */
function validateReview(value) {
  closed(value, '', ['agent_id', 'stage', 'cycle', 'verdict', 'acLedger', 'findings', 'evidence']);
  nonnegativeInteger(value.cycle, 'cycle');
  oneOf(value.verdict, 'verdict', ['pass', 'needs-work']);
  if (!Array.isArray(value.acLedger)) invalid('acLedger');
  value.acLedger.forEach((/** @type {any} */ item, /** @type {number} */ index) => {
    const at = `acLedger[${index}]`;
    closed(item, at, ['ac', 'claimed', 'rederived', 'ok']);
    string(item.ac, `${at}.ac`);
    oneOf(item.claimed, `${at}.claimed`, ['write', 'revise', 'reuse', 'delete', 'skip']);
    oneOf(item.rederived, `${at}.rederived`, ['write', 'revise', 'reuse', 'delete', 'skip']);
    if (typeof item.ok !== 'boolean') invalid(`${at}.ok`);
  });
  findings(value.findings, 'findings', ['capture', 'plan', 'implement', 'refactor'], false);
  evidence(value.evidence, 'evidence');
  if (value.verdict === 'pass' && value.findings.length !== 0) invalid('findings');
  if (value.verdict === 'needs-work' && value.findings.length === 0) invalid('findings');
  if (value.evidence.length === 0) invalid('evidence');
}

/** @param {any} value */
function validateAudit(value) {
  closed(value, '', ['agent_id', 'stage', 'cycle', 'verdict', 'scan', 'coverage', 'findings', 'evidence']);
  nonnegativeInteger(value.cycle, 'cycle');
  oneOf(value.verdict, 'verdict', ['pass', 'needs-work', 'na']);
  closed(value.scan, 'scan', ['command', 'recommendation', 'reportPath']);
  string(value.scan.command, 'scan.command');
  oneOf(value.scan.recommendation, 'scan.recommendation', ['PASS', 'REVIEW', 'BLOCK']);
  string(value.scan.reportPath, 'scan.reportPath');
  if (!Array.isArray(value.coverage)) invalid('coverage');
  value.coverage.forEach((/** @type {any} */ item, /** @type {number} */ index) => {
    const at = `coverage[${index}]`;
    closed(item, at, ['category', 'status']);
    string(item.category, `${at}.category`);
    oneOf(item.status, `${at}.status`, ['covered_with_hits', 'covered_no_hits', 'not_covered']);
  });
  findings(value.findings, 'findings', ['plan', 'implement', 'refactor'], true);
  evidence(value.evidence, 'evidence');
  if (value.verdict !== 'needs-work' && value.findings.length !== 0) invalid('findings');
  if (value.verdict === 'needs-work' && value.findings.length === 0) invalid('findings');
  if (value.verdict !== 'needs-work' && value.coverage.length === 0) invalid('coverage');
  if (value.evidence.length === 0) invalid('evidence');
}

/** @param {any} value */
function validateRefute(value) {
  closedOptional(value, '', ['agent_id', 'stage', 'cycle', 'finding', 'verdict', 'rationale', 'evidence'], ['source']);
  nonnegativeInteger(value.cycle, 'cycle');
  if (value.source !== undefined) oneOf(value.source, 'source', ['review', 'review2', 'audit']);
  string(value.finding, 'finding');
  oneOf(value.verdict, 'verdict', ['survives', 'refuted']);
  string(value.rationale, 'rationale');
  evidence(value.evidence, 'evidence');
}

/** @param {any} value */
function validateCouncil(value) {
  closed(value, '', ['stage', 'council']);
  const council = value.council;
  closed(council, 'council', ['convened', 'stage', 'members', 'findings', 'verdict', 'outcome']);
  if (council.convened !== true) invalid('council.convened');
  oneOf(council.stage, 'council.stage', ['review', 'audit']);
  if (!Array.isArray(council.members) || council.members.length !== 3) invalid('council.members');
  council.members.forEach((/** @type {any} */ member, /** @type {number} */ index) => {
    const at = `council.members[${index}]`;
    closed(member, at, ['agent_id', 'lens', 'temperature']);
    string(member.agent_id, `${at}.agent_id`);
    oneOf(member.lens, `${at}.lens`, ['integrity', 'security', 'pragmatist']);
    if (member.temperature !== null && typeof member.temperature !== 'number') invalid(`${at}.temperature`);
  });
  if (!Array.isArray(council.findings) || council.findings.length === 0) invalid('council.findings');
  council.findings.forEach((/** @type {any} */ finding, /** @type {number} */ index) => {
    const at = `council.findings[${index}]`;
    closed(finding, at, ['id', 'summary', 'blockingVotes', 'survived', 'followupTaskId']);
    string(finding.id, `${at}.id`);
    string(finding.summary, `${at}.summary`);
    if (!Number.isInteger(finding.blockingVotes) || finding.blockingVotes < 0 || finding.blockingVotes > 3) invalid(`${at}.blockingVotes`);
    if (typeof finding.survived !== 'boolean') invalid(`${at}.survived`);
    if (finding.followupTaskId !== null && !['string', 'number'].includes(typeof finding.followupTaskId)) invalid(`${at}.followupTaskId`);
  });
  oneOf(council.verdict, 'council.verdict', ['ship', 'block']);
  oneOf(council.outcome, 'council.outcome', [null, 'shipped', 'scoped-fix-shipped', 'blocked-to-operator']);
  if (council.verdict === 'ship' && council.outcome !== 'shipped') invalid('council.outcome');
  if (council.verdict === 'block' && council.outcome === 'shipped') invalid('council.outcome');
}

/** @type {Record<string, (value: any) => void>} */
const VALIDATORS = { plan: validatePlan, implement: validateImplement, refactor: validateRefactor, review: validateReview, audit: validateAudit, refute: validateRefute, council: validateCouncil };

/** @param {string} stage @param {unknown} value @returns {Record<string, any>} */
export function validateSpecialistReturn(stage, value) {
  if (!STAGES.includes(stage)) invalid('stage');
  if (!isType(value, 'object')) invalid('$');
  const record = /** @type {Record<string, any>} */ (value);
  if (stage !== 'council') string(record.agent_id, 'agent_id');
  if (record.stage !== stage) invalid('stage');
  VALIDATORS[stage](record);
  return record;
}
