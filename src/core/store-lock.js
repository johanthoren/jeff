// @ts-check

import { lstat, mkdir, realpath, rmdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { assertStoreContained } from './store.js';

const LOCK_ATTEMPTS = 100;
const wait = (/** @type {number} */ milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

/**
 * Serialize task-store mutations through the existing `.record-lock`.
 *
 * @template T
 * @param {string} root
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function withStoreLock(root, operation) {
  try {
    await assertStoreContained(root);
  } catch (error) {
    throw new Error(`[record-task] ${/** @type {Error} */ (error).message}`);
  }
  const lock = join(root, '.jeff', '.record-lock');
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (/** @type {any} */ (error).code !== 'EEXIST') throw error;
      if (attempt + 1 === LOCK_ATTEMPTS) {
        throw new Error('[record-lock] store lock is busy or unavailable');
      }
      await wait(5);
    }
  }
  try {
    return await operation();
  } finally {
    await rmdir(lock);
  }
}

/**
 * Resolve one collected task while rejecting ambiguity, symlinks, and escapes.
 *
 * @param {string} root
 * @param {string} id
 * @param {any[]} tasks
 */
export async function locateTask(root, id, tasks) {
  const matches = tasks.filter((task) => String(task.id) === id);
  if (matches.length !== 1) {
    throw new Error(`[record-task] task ${id} ${matches.length ? 'is ambiguous' : 'was not found'}`);
  }
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
