// @ts-check

import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** @typedef {import('./types.js').TaskJson} TaskJson */

const TASK_FILE = 'task.json';

/**
 * Read and parse `<taskDir>/task.json`.
 *
 * Fails **closed**: a missing or unparseable file rejects rather than resolving
 * to a default. Callers get an error, never a silently-empty task.
 *
 * @param {string} taskDir - path to the task directory
 * @returns {Promise<TaskJson>}
 */
export async function readTask(taskDir) {
  const raw = await readFile(join(taskDir, TASK_FILE), 'utf8');
  return /** @type {TaskJson} */ (JSON.parse(raw));
}

/**
 * Serialize `task` to `<taskDir>/task.json`.
 *
 * Atomic: writes a uniquely-named temp file in the same directory, then renames
 * it over the target. rename() is atomic on a single filesystem, so a reader
 * never observes a partially-written file. Mirrors cook.sh's `mktemp` + `mv -f`.
 *
 * @param {string} taskDir - path to the task directory (must exist)
 * @param {TaskJson} task
 * @returns {Promise<void>}
 */
export async function writeTask(taskDir, task) {
  const target = join(taskDir, TASK_FILE);
  const tmp = join(taskDir, `.${TASK_FILE}.${randomBytes(6).toString('hex')}.tmp`);
  const json = `${JSON.stringify(task, null, 2)}\n`;
  await writeFile(tmp, json, 'utf8');
  await rename(tmp, target);
}
