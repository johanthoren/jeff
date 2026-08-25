// @ts-check

import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { compareById } from './reporters.js';
import { assertStoreContained, collectTasks, readConfig } from './store.js';
import { locateTask, withStoreLock } from './store-lock.js';
import { isTerminalStatus } from './task-schema.js';

/**
 * @typedef {Object} Report
 * @property {number} code
 * @property {string[]} stdout
 * @property {string[]} stderr
 */

/** @param {string} message @returns {Report} */
function failure(message) {
  return { code: 1, stdout: [], stderr: [`cook: ${message}`] };
}

/** @param {string} root @param {any} task */
function claimPaths(root, task) {
  const claimDir = join(root, dirname(task._dir), '.claim');
  return { claimDir, claimPath: join(claimDir, 'claim.json') };
}

/** @param {string} root @param {any} task */
async function hasClaim(root, task) {
  const { claimDir, claimPath } = claimPaths(root, task);
  await assertStoreContained(root, [claimDir, claimPath]);
  try {
    if (!(await lstat(claimDir)).isDirectory()) {
      throw new Error(`task ${task.id} has an invalid claim directory`);
    }
    return true;
  } catch (error) {
    if (/** @type {any} */ (error).code === 'ENOENT') return false;
    throw error;
  }
}

/** @param {string} root @param {any} task */
async function readClaim(root, task) {
  const { claimPath } = claimPaths(root, task);
  await assertStoreContained(root, [claimPath]);
  let value;
  try {
    value = JSON.parse(await readFile(claimPath, 'utf8'));
  } catch (error) {
    throw new Error(`task ${task.id} has an unreadable claim`, { cause: error });
  }
  const by = value && typeof value === 'object' && !Array.isArray(value) ? value.by : undefined;
  const at = value && typeof value === 'object' && !Array.isArray(value) ? value.at : undefined;
  if (typeof by !== 'string' || by.trim() === '' || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) {
    throw new Error(`task ${task.id} has an invalid claim`);
  }
  return { by, at };
}

/**
 * Return the configured lane capacity after config validation.
 *
 * @param {Record<string, unknown> | null} config
 */
export function maxParallelTasks(config) {
  const value = config?.maxParallelTasks;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : 1;
}

/** @param {string} root @returns {Promise<Report>} */
export async function readyReport(root) {
  try {
    const [tasks, config] = await Promise.all([collectTasks(root), readConfig(root, { strict: true })]);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const pruned = new Set(Array.isArray(config?.prunedTaskIds) ? config.prunedTaskIds : []);
    const ready = [];
    for (const task of tasks) {
      if (!['pending', 'in_progress'].includes(task.status) || await hasClaim(root, task)) continue;
      const deps = Array.isArray(task.deps) ? task.deps : [];
      const satisfied = deps.every((/** @type {number} */ id) => {
        const dependency = byId.get(id);
        return pruned.has(id) || (dependency !== undefined && isTerminalStatus(dependency.status));
      });
      if (satisfied) ready.push(task);
    }
    ready.sort((left, right) => (
      left.priority < right.priority ? -1
        : left.priority > right.priority ? 1
          : compareById(left, right)
    ));
    return {
      code: 0,
      stdout: ready.map(({ id, slug, title, priority, deps }) => JSON.stringify({ id, slug, title, priority, deps })),
      stderr: [],
    };
  } catch (error) {
    return failure(`ready: ${/** @type {Error} */ (error).message}`);
  }
}

/**
 * @param {string} root
 * @param {string} id
 * @param {{ by?: string, now?: () => Date }} [options]
 * @returns {Promise<Report>}
 */
export async function claimReport(root, id, options = {}) {
  const by = options.by ?? 'cook';
  if (typeof by !== 'string' || by.trim() === '') return failure('claim: holder must be nonempty');
  try {
    return await withStoreLock(root, async () => {
      const tasks = await collectTasks(root);
      const { taskDir, taskPath } = await locateTask(root, id, tasks);
      const task = tasks.find((candidate) => candidate._dir === taskPath);
      if (task.status === 'blocked' || isTerminalStatus(task.status)) {
        return failure(`claim: task ${id} is ${task.status}`);
      }
      const claimDir = join(taskDir, '.claim');
      const claimPath = join(claimDir, 'claim.json');
      await assertStoreContained(root, [claimDir, claimPath]);
      try {
        await mkdir(claimDir);
      } catch (error) {
        if (/** @type {any} */ (error).code !== 'EEXIST') throw error;
        const claim = await readClaim(root, task);
        return failure(`claim: task ${id} is already claimed by ${claim.by}`);
      }
      const claim = { by, at: (options.now ?? (() => new Date()))().toISOString() };
      try {
        await writeFile(claimPath, `${JSON.stringify(claim)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      } catch (error) {
        await rm(claimDir, { recursive: true, force: true });
        throw error;
      }
      return { code: 0, stdout: [], stderr: [] };
    });
  } catch (error) {
    return failure(`claim: ${/** @type {Error} */ (error).message}`);
  }
}

/** @param {string} root @param {string} id @returns {Promise<Report>} */
export async function releaseReport(root, id) {
  try {
    return await withStoreLock(root, async () => {
      const tasks = await collectTasks(root);
      const { taskDir, taskPath } = await locateTask(root, id, tasks);
      const task = tasks.find((candidate) => candidate._dir === taskPath);
      if (!await hasClaim(root, task)) return failure(`release: task ${id} is unclaimed`);
      const claimDir = join(taskDir, '.claim');
      await assertStoreContained(root, [claimDir]);
      await rm(claimDir, { recursive: true });
      return { code: 0, stdout: [], stderr: [] };
    });
  } catch (error) {
    return failure(`release: ${/** @type {Error} */ (error).message}`);
  }
}

/**
 * @param {string} root
 * @param {{ now?: () => Date }} [options]
 * @returns {Promise<Report>}
 */
export async function claimsReport(root, options = {}) {
  try {
    return await withStoreLock(root, async () => {
      const tasks = [...await collectTasks(root)].sort(compareById);
      const now = (options.now ?? (() => new Date()))().getTime();
      const stdout = [];
      for (const task of tasks) {
        if (!await hasClaim(root, task)) continue;
        const claim = await readClaim(root, task);
        const ageSeconds = Math.max(0, Math.floor((now - Date.parse(claim.at)) / 1000));
        stdout.push(JSON.stringify({ id: task.id, ...claim, ageSeconds }));
      }
      return { code: 0, stdout, stderr: [] };
    });
  } catch (error) {
    return failure(`claims: ${/** @type {Error} */ (error).message}`);
  }
}
