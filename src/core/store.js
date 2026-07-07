// @ts-check

import { readFile, writeFile, rename, unlink, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { isType } from './validate.js';

/** @typedef {import('./types.js').TaskJson} TaskJson */

const TASK_FILE = 'task.json';

/**
 * Build the "unparseable task.json" error `collectTasks` throws for a corrupt
 * or non-object task file, tagged with `.dir` = its root-relative path.
 *
 * @param {string} rel - root-relative path (`.jeff/tasks/<dir>/task.json`)
 * @returns {Error}
 */
function unparseableTaskError(rel) {
  const err = new Error(`unparseable task.json at ${rel}`);
  /** @type {any} */ (err).dir = rel;
  return err;
}

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
 * The temp file is created exclusively (`flag: 'wx'`, fail if it already exists,
 * never follow/truncate a pre-existing path) with owner-only perms (`mode: 0o600`);
 * rename preserves the source mode, so the persisted `task.json` inherits 0600. A
 * failed rename unlinks the temp file (no orphan) and re-rejects (fails closed).
 *
 * @param {string} taskDir - path to the task directory (must exist)
 * @param {TaskJson} task
 * @returns {Promise<void>}
 */
export async function writeTask(taskDir, task) {
  const target = join(taskDir, TASK_FILE);
  const tmp = join(taskDir, `.${TASK_FILE}.${randomBytes(6).toString('hex')}.tmp`);
  const json = `${JSON.stringify(task, null, 2)}\n`;
  await writeFile(tmp, json, { flag: 'wx', mode: 0o600, encoding: 'utf8' });
  try {
    await rename(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
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
    if ((await lstat(tasksDir)).isSymbolicLink()) {
      throw new Error(`refusing .jeff/tasks symlink: ${tasksDir}`);
    }
    entries = await readdir(tasksDir, { withFileTypes: true });
  } catch (e) {
    if (/** @type {any} */ (e).code === 'ENOENT') return [];
    throw e;
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
      throw unparseableTaskError(cand.rel);
    }
    // Reject a non-object whole-task value (42/[]/true/"str"/null) the same way,
    // BEFORE `obj._dir = …`. cook.sh's `jq '. + {_dir:$dir}'` aborts on such a
    // value ("… and object cannot be added") → its per-file "unparseable task.json
    // at DIR" line, so throwing here reproduces that line. Without this guard JS
    // diverges: 42/true/"str" TypeError on the `_dir` assignment (generic line
    // only), and `[]` silently flows into the invariant pass emitting misleading
    // spurious violations. `null` is rejected too — stricter than cook.sh, which
    // quirkily degrades `null` into a `{_dir}`-only object; deliberate fail-closed
    // strictness on untrusted input (Chef call 2026-07-03). Ceiling: cook.sh also
    // leaks a raw `jq: error (… absolute tmp path …)` line we do NOT replicate
    // (non-deterministic), so full merged-stream parity on this shape is
    // unreachable; no fixture exercises it and the test asserts JS's own line.
    if (!isType(obj, 'object')) {
      throw unparseableTaskError(cand.rel);
    }
    obj._dir = cand.rel;
    tasks.push(obj);
  }
  return tasks;
}

/**
 * Read and parse `<root>/.jeff/config.json`, or `null` on a missing or
 * unparseable file (never throws). The shared degrade-to-null primitive
 * every soft config reader builds on: `readMode` below, `verify`'s
 * test-command resolver, `doctor`'s active check, `topbrain`, and `flavor`
 * all read+parse this same file and fall back to their own per-caller
 * default when it's absent or corrupt. `init`'s read-modify-write is
 * deliberately NOT one of these callers: it must tell "absent" (fresh
 * scaffold) apart from "present but corrupt" (fail closed rather than
 * clobber a user's project), so it keeps its own bespoke read.
 *
 * A top-level non-object JSON value (`42`, `[1,2]`, `"s"`, `true`, `null`)
 * degrades to `null` too, so the return type is honestly object-or-null:
 * every caller then reads a missing property (→ its default) instead of the
 * `in` operator or a property access throwing on a primitive.
 *
 * @param {string} root
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readConfig(root) {
  try {
    const raw = await readFile(join(root, '.jeff', 'config.json'), 'utf8');
    const v = JSON.parse(raw);
    return isType(v, 'object') ? /** @type {Record<string, unknown>} */ (v) : null;
  } catch {
    return null;
  }
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
  const cfg = await readConfig(root);
  return cfg && cfg.mode === 'lite' ? 'lite' : 'full';
}
