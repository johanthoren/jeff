// @ts-check

import { readFile, writeFile, rename, readdir } from 'node:fs/promises';
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

/**
 * Collect every `.jeff/tasks/<dir>/task.json`, parse it, augment each object
 * with a root-relative `_dir` (`.jeff/tasks/<dir>/task.json`, matching cook.sh's
 * `${f#$ROOT/}`), sorted by path. Port of cook.sh's `collect_tasks`
 * (skills/cook/scripts/cook.sh:139-157).
 *
 * Fails **closed**: any unparseable `task.json` throws (the thrown error carries
 * `.dir` = its root-relative path), so the caller `die`s rather than treating a
 * corrupt store as empty/clean. A missing `.jeff/tasks` dir yields `[]`.
 *
 * @param {string} root - repository root (COOK_ROOT-resolved)
 * @returns {Promise<any[]>}
 */
export async function collectTasks(root) {
  const tasksDir = join(root, '.jeff', 'tasks');
  let entries;
  try {
    entries = await readdir(tasksDir, { withFileTypes: true });
  } catch {
    return [];
  }

  // Depth-2 `task.json` files only (mindepth 2 / maxdepth 2): the task.json
  // directly inside each immediate subdirectory of tasks/.
  const candidates = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const full = join(tasksDir, ent.name, 'task.json');
    const rel = ['.jeff', 'tasks', ent.name, 'task.json'].join('/');
    let raw;
    try {
      raw = await readFile(full, 'utf8');
    } catch {
      continue; // no task.json in this dir (find -name task.json would not match)
    }
    candidates.push({ full, rel, raw });
  }

  // Sort by full path, matching cook.sh's `find … | sort`.
  candidates.sort((a, b) => (a.full < b.full ? -1 : a.full > b.full ? 1 : 0));

  const tasks = [];
  for (const cand of candidates) {
    let obj;
    try {
      obj = JSON.parse(cand.raw);
    } catch {
      const err = new Error(`unparseable task.json at ${cand.rel}`);
      /** @type {any} */ (err).dir = cand.rel;
      throw err;
    }
    obj._dir = cand.rel;
    tasks.push(obj);
  }
  return tasks;
}

/**
 * Echo the active mode: `"lite"` iff `.jeff/config.json` carries `.mode ==
 * "lite"`, else `"full"`. Port of cook.sh's `bake_mode`
 * (skills/cook/scripts/cook.sh:71-78): degrade to `"full"` on a missing or
 * unparseable config (fail back to the strict full-mode validator).
 *
 * @param {string} root
 * @returns {Promise<'lite' | 'full'>}
 */
export async function readMode(root) {
  try {
    const raw = await readFile(join(root, '.jeff', 'config.json'), 'utf8');
    const cfg = JSON.parse(raw);
    return (cfg && cfg.mode === 'lite') ? 'lite' : 'full';
  } catch {
    return 'full';
  }
}
