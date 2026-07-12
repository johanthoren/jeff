// @ts-check

import { readFile, lstat, mkdir, realpath, rmdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { collectTasks, readMode, readTask, writeTask } from './store.js';
import { taskSchemaViolations } from './task-schema.js';
import { runInvariants } from './invariants.js';
import { validateSpecialistReturn } from './record-contract.js';

/** @typedef {import('./types.js').TaskJson} TaskJson */

const now = () => `${new Date().toISOString().slice(0, 19)}Z`;
const wait = (/** @type {number} */ milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

/** @param {any} outcome */
function hasBlockingFinding(outcome) {
  return outcome?.findings?.some((/** @type {any} */ finding) => finding.class === 'blocking') === true;
}

/** @param {TaskJson} task */
function settleJudgments(task) {
  const requiredReviews = task.complexity === 'simple' ? 1 : 2;
  const reviews = [task.review, task.review2].filter((outcome) => outcome?.reviewer_agent_id);
  const blockingReview = reviews.some(hasBlockingFinding);
  const blockingAudit = hasBlockingFinding(task.audit);

  task.status = 'in_progress';
  if (blockingAudit) task.stage = 'audit';
  else if (blockingReview || reviews.length < requiredReviews) task.stage = 'review';
  else if (task.audit.required && !task.audit.audit_agent_id) task.stage = 'audit';
  else {
    task.stage = 'done';
    task.status = 'done';
  }
}

/** @param {TaskJson} task @param {string} at */
function resetJudgmentsAfterFix(task, at) {
  const lastKickback = task.kickbacks.at(-1);
  if (!lastKickback || !['review', 'audit'].includes(lastKickback.from)) return;

  task.judgmentHistory = [
    ...(task.judgmentHistory ?? []),
    { at, review: task.review, review2: task.review2 ?? null, audit: task.audit },
  ];
  task.agents.reviewer_agent_id = null;
  task.agents.reviewer2_agent_id = null;
  task.agents.audit_agent_id = null;
  task.review = { verdict: null, reviewer_agent_id: null, findings: [], evidence: [] };
  task.review2 = null;
  task.audit = {
    required: task.audit.required,
    verdict: 'na',
    audit_agent_id: null,
    findings: [],
    evidence: [],
  };
}

/** @param {TaskJson} task @param {Record<string, any>} result */
function recordReview(task, result) {
  const second = task.agents.reviewer_agent_id !== null;
  const target = second ? 'review2' : 'review';
  if (second) task.agents.reviewer2_agent_id = result.agent_id;
  else task.agents.reviewer_agent_id = result.agent_id;
  const blocking = result.findings.some((/** @type {any} */ finding) => finding.class === 'blocking');
  task[target] = {
    verdict: blocking ? 'needs-work' : 'pass',
    reportedVerdict: result.verdict,
    reviewer_agent_id: result.agent_id,
    findings: result.findings,
    evidence: result.evidence,
    acLedger: result.acLedger,
  };
  settleJudgments(task);
}

/** @param {TaskJson} task @param {Record<string, any>} result */
function recordAudit(task, result) {
  const blocking = result.findings.some((/** @type {any} */ finding) => finding.class === 'blocking');
  task.agents.audit_agent_id = result.agent_id;
  task.audit = {
    ...task.audit,
    verdict: blocking ? 'needs-work' : result.verdict,
    reportedVerdict: result.verdict,
    audit_agent_id: result.agent_id,
    findings: result.findings,
    evidence: result.evidence,
    scan: result.scan,
    coverage: result.coverage,
  };
  settleJudgments(task);
}

/** @param {TaskJson} task @param {Record<string, any>} result @param {string} at */
function recordRefute(task, result, at) {
  const source = task.audit?.verdict === 'needs-work'
    ? 'audit'
    : task.review2?.verdict === 'needs-work' ? 'review2' : 'review';
  const finding = task[source]?.findings?.find((/** @type {any} */ item) => result.finding.startsWith(`${item.file}:${item.line}`));
  if (!finding || finding.class !== 'blocking') throw new Error('[record-transition] refute finding is not an active blocker');
  const refute = { agent_id: result.agent_id, finding: result.finding, verdict: result.verdict, rationale: result.rationale, evidence: result.evidence };
  task.refutes = [...(task.refutes ?? []), refute];
  finding.refute = refute;
  const convergenceStage = source === 'audit' ? 'audit' : 'review';
  if (result.verdict === 'refuted') {
    finding.class = 'follow-up';
    task[source].verdict = hasBlockingFinding(task[source]) ? 'needs-work' : 'pass';
    settleJudgments(task);
    return;
  }

  const counter = task.convergence.stages[convergenceStage];
  if (counter.blockingKickbacks >= task.convergence.cap) {
    throw new Error(`[record-transition] ${convergenceStage} kickback cap reached; council return required`);
  }
  counter.blockingKickbacks += 1;
  task.kickbacks = [...task.kickbacks, { from: convergenceStage, to: finding.kickTo, reason: finding.what, at }];
  task.stage = finding.kickTo;
  task.status = 'in_progress';
}

/** @param {TaskJson} task @param {string} stage @param {Record<string, any>} result @returns {TaskJson} */
export function transitionTask(task, stage, result) {
  const at = now();
  const next = /** @type {any} */ (structuredClone(task));
  const isJudgment = stage === 'review' || stage === 'audit';
  if (!isJudgment && stage !== 'refute' && next.stage !== stage) {
    throw new Error(`[record-transition] task is at ${next.stage}, not ${stage}`);
  }
  if (isJudgment && !['review', 'audit', 'done'].includes(next.stage)) {
    throw new Error(`[record-transition] task is at ${next.stage}, not ${stage}`);
  }
  next.updatedAt = at;

  if (stage === 'plan') {
    next.tests.authored_by_agent_id = result.agent_id;
    next.complexity = result.complexity;
    next.audit.required = result.auditRequired;
    next.plan = { result: result.result, slices: result.slices, testFiles: result.testFiles, redRun: result.redRun, escalation: result.escalation };
    next.stage = result.result === 'escalation' ? 'capture' : 'implement';
  } else if (stage === 'implement') {
    next.agents.implementer_agent_id = result.agent_id;
    next.implement = { result: result.result, files: result.files, greenRun: result.greenRun };
    if (result.kickback) {
      next.kickbacks = [...next.kickbacks, { from: 'implement', to: result.kickback.to, reason: result.kickback.reason, at }];
      next.stage = result.kickback.to;
    } else {
      resetJudgmentsAfterFix(next, at);
      next.stage = 'refactor';
    }
  } else if (stage === 'refactor') {
    next.refactor = { agent_id: result.agent_id, result: result.result, files: result.files, outsideDiff: result.outsideDiff, greenRun: result.greenRun, summary: result.summary };
    next.stage = 'review';
  } else if (stage === 'review') recordReview(next, result);
  else if (stage === 'audit') recordAudit(next, result);
  else recordRefute(next, result, at);
  return /** @type {TaskJson} */ (next);
}

/** @param {string} root */
async function assertStoreContained(root) {
  const rootPath = await realpath(root);
  const jeffPath = join(root, '.jeff');
  if ((await lstat(jeffPath)).isSymbolicLink()) throw new Error('[record-task] .jeff symlink escapes repository');
  const actualJeff = await realpath(jeffPath);
  const rel = relative(rootPath, actualJeff);
  if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('[record-task] .jeff is outside repository');
}

/** @param {string} root @param {() => Promise<any>} operation */
async function withStoreLock(root, operation) {
  await assertStoreContained(root);
  const lock = join(root, '.jeff', '.record-lock');
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (/** @type {any} */ (error).code !== 'EEXIST') throw error;
      await wait(5);
    }
  }
  try {
    return await operation();
  } finally {
    await rmdir(lock);
  }
}

/** @param {string} root @param {string} id @param {any[]} tasks */
async function locateTask(root, id, tasks) {
  const matches = tasks.filter((task) => String(task.id) === id);
  if (matches.length !== 1) throw new Error(`[record-task] task ${id} ${matches.length ? 'is ambiguous' : 'was not found'}`);
  const taskFile = resolve(root, matches[0]._dir);
  const taskDir = dirname(taskFile);
  const base = await realpath(join(root, '.jeff', 'tasks'));
  const actualDir = await realpath(taskDir);
  const rel = relative(base, actualDir);
  if (rel === '..' || rel.startsWith(`..${sep}`) || (await lstat(taskFile)).isSymbolicLink()) {
    throw new Error(`[record-task] task ${id} escapes .jeff/tasks`);
  }
  return { taskDir, taskPath: matches[0]._dir };
}

/** @param {string} root @param {string} id @param {(task: TaskJson) => TaskJson} update */
export async function updateTask(root, id, update) {
  return withStoreLock(root, async () => {
    const tasks = await collectTasks(root);
    const { taskDir, taskPath } = await locateTask(root, id, tasks);
    const task = await readTask(taskDir);
    const candidate = update(task);
    const lite = (await readMode(root)) === 'lite';
    const store = tasks.map((stored) => stored._dir === taskPath ? { ...candidate, _dir: taskPath } : stored);
    const violations = [...taskSchemaViolations(candidate, { lite }), ...runInvariants(store, { lite })];
    if (violations.length) throw new Error(violations[0]);
    await writeTask(taskDir, candidate);
    return candidate;
  });
}

/** @param {string} root @param {string} stage @param {string} id @param {string} file */
export async function recordSpecialistFile(root, stage, id, file) {
  let parsed;
  try { parsed = JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error(`[record-json] invalid JSON in ${file}`); }
  return recordSpecialistReturn(root, stage, id, parsed);
}

/** @param {string} root @param {string} stage @param {string} id @param {unknown} value */
export async function recordSpecialistReturn(root, stage, id, value) {
  const specialistReturn = validateSpecialistReturn(stage, value);
  return updateTask(root, id, (task) => transitionTask(task, stage, specialistReturn));
}
