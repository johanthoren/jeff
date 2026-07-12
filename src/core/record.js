// @ts-check

import { readFile, lstat, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { collectTasks, readMode, readTask, writeTask } from './store.js';
import { taskSchemaViolations } from './task-schema.js';
import { runInvariants } from './invariants.js';
import { validateSpecialistReturn } from './record-contract.js';

/** @typedef {import('./types.js').TaskJson} TaskJson */

const now = () => `${new Date().toISOString().slice(0, 19)}Z`;

/** @param {TaskJson} task @param {string} stage @param {Record<string, any>} result @returns {TaskJson} */
export function transitionTask(task, stage, result) {
  const at = now();
  const next = /** @type {any} */ (structuredClone(task));
  if (stage !== 'refute' && next.stage !== stage) {
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
    } else next.stage = 'refactor';
  } else if (stage === 'refactor') {
    next.refactor = { agent_id: result.agent_id, result: result.result, files: result.files, outsideDiff: result.outsideDiff, greenRun: result.greenRun, summary: result.summary };
    next.stage = 'review';
  } else if (stage === 'review') {
    const second = next.agents.reviewer_agent_id !== null;
    const target = second ? 'review2' : 'review';
    if (second) next.agents.reviewer2_agent_id = result.agent_id;
    else next.agents.reviewer_agent_id = result.agent_id;
    next[target] = { verdict: result.verdict, reviewer_agent_id: result.agent_id, findings: result.findings, evidence: result.evidence, acLedger: result.acLedger };
    if (result.verdict === 'needs-work') next.stage = 'review';
    else if (next.complexity !== 'simple' && !second) next.stage = 'review';
    else if (next.audit.required) next.stage = 'audit';
    else { next.stage = 'done'; next.status = 'done'; }
  } else if (stage === 'audit') {
    next.agents.audit_agent_id = result.agent_id;
    next.audit = { ...next.audit, verdict: result.verdict, audit_agent_id: result.agent_id, findings: result.findings, evidence: result.evidence, scan: result.scan, coverage: result.coverage };
    if (result.verdict === 'needs-work') next.stage = 'audit';
    else { next.stage = 'done'; next.status = 'done'; }
  } else {
    const source = next.audit?.verdict === 'needs-work'
      ? 'audit'
      : next.review2?.verdict === 'needs-work' ? 'review2' : 'review';
    const finding = next[source]?.findings?.find((/** @type {any} */ item) => result.finding.startsWith(`${item.file}:${item.line}`));
    if (!finding || finding.class !== 'blocking') throw new Error('[record-transition] refute finding is not an active blocker');
    const refute = { agent_id: result.agent_id, finding: result.finding, verdict: result.verdict, rationale: result.rationale, evidence: result.evidence };
    next.refutes = [...(next.refutes ?? []), refute];
    finding.refute = refute;
    const convergenceStage = source === 'audit' ? 'audit' : 'review';
    if (result.verdict === 'refuted') {
      finding.class = 'follow-up';
      next.stage = convergenceStage;
    } else {
      const counter = next.convergence.stages[convergenceStage];
      if (counter.blockingKickbacks < next.convergence.cap) {
        counter.blockingKickbacks += 1;
        next.kickbacks = [...next.kickbacks, { from: convergenceStage, to: finding.kickTo, reason: finding.what, at }];
        next.stage = finding.kickTo;
      } else {
        throw new Error(`[record-transition] ${convergenceStage} kickback cap reached; council return required`);
      }
    }
  }
  return /** @type {TaskJson} */ (next);
}

/** @param {string} root @param {string} id */
async function locateTask(root, id) {
  const matches = (await collectTasks(root)).filter((task) => String(task.id) === id);
  if (matches.length !== 1) throw new Error(`[record-task] task ${id} ${matches.length ? 'is ambiguous' : 'was not found'}`);
  const taskFile = resolve(root, matches[0]._dir);
  const taskDir = dirname(taskFile);
  const base = await realpath(join(root, '.jeff', 'tasks'));
  const actualDir = await realpath(taskDir);
  const rel = relative(base, actualDir);
  if (rel === '..' || rel.startsWith(`..${sep}`) || (await lstat(taskFile)).isSymbolicLink()) {
    throw new Error(`[record-task] task ${id} escapes .jeff/tasks`);
  }
  return taskDir;
}

/** @param {string} root @param {string} id @param {(task: TaskJson) => TaskJson} update */
export async function updateTask(root, id, update) {
  const taskDir = await locateTask(root, id);
  const task = await readTask(taskDir);
  const candidate = update(task);
  const lite = (await readMode(root)) === 'lite';
  const violations = [...taskSchemaViolations(candidate, { lite }), ...runInvariants([candidate], { lite })];
  if (violations.length) throw new Error(violations[0]);
  await writeTask(taskDir, candidate);
  return candidate;
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
