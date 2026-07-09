// @ts-check

/**
 * The read-only reporter verbs : `ls`, `status`, `show` : as pure functions
 * over the task store. Ports of cook.sh's `cmd_ls` (skills/cook/scripts/cook.sh:634),
 * `cmd_status` (:645), and `cmd_show` (:661), returning the same verdict shape
 * as `validate-store.js` (`{ code, stdout, stderr }`) instead of printing +
 * exiting, so the CLI and the future pi extension both consume them without
 * spawning a subprocess. Built on the already-ported `collectTasks` (AC5): no
 * re-implementation of task collection here.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectTasks } from './store.js';

/**
 * @typedef {Object} Report
 * @property {number} code - process exit code (0 OK, 1 any failure)
 * @property {string[]} stdout - lines to print to stdout
 * @property {string[]} stderr - lines to print to stderr
 */

/**
 * Collect the store, or map the single `collectTasks` throw (unparseable
 * task.json) to the reporter failure verdict. This is `collect_tasks`'s single
 * `warn` line + rc 1 (nuance N4) : the shell aborts under `set -e` when the
 * `tasks="$(collect_tasks)"` substitution fails, having already emitted the
 * warn to stderr : NOT `validateStore`'s richer two-line failure.
 *
 * @param {string} root
 * @returns {Promise<{ tasks: any[] } | { fail: Report }>}
 */
async function collectOrFail(root) {
  try {
    return { tasks: await collectTasks(root) };
  } catch (err) {
    const dir = err && /** @type {any} */ (err).dir;
    const line = dir
      ? `cook: validation FAILED: unparseable task.json at ${dir}`
      : 'cook: validation FAILED: could not parse the task store.';
    return { fail: { code: 1, stdout: [], stderr: [line] } };
  }
}

/**
 * Replicate jq `sort_by(.id)`'s total order for the reporter id domain: jq
 * orders numbers before strings, numbers numerically, strings by codepoint;
 * the sort is stable, so ties keep `collectTasks` (path) order. A homogeneous
 * store (lite = all strings, full = all numbers) exercises one branch; the
 * cross-type branch is covered for free. `kiss:` astral-plane ids would need
 * true codepoint order (not UTF-16 code-unit order); not in the tracker-ref
 * domain.
 *
 * @param {any} a
 * @param {any} b
 * @returns {number}
 */
function compareById(a, b) {
  const x = a.id;
  const y = b.id;
  const xNum = typeof x === 'number';
  const yNum = typeof y === 'number';
  if (xNum && !yNum) return -1;
  if (!xNum && yNum) return 1;
  if (xNum && yNum) return x - y;
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * `cook ls`: one tab-separated line per task, sorted by id (N1), or `no tasks`.
 *
 * @param {string} root
 * @returns {Promise<Report>}
 */
export async function lsReport(root) {
  const got = await collectOrFail(root);
  if ('fail' in got) return got.fail;
  const { tasks } = got;
  if (tasks.length === 0) return { code: 0, stdout: ['no tasks'], stderr: [] };
  const sorted = [...tasks].sort(compareById);
  const stdout = sorted.map(
    (t) => `${t.id}\t${t.status}\t${t.stage}\t${t.priority}\t${t.title}`,
  );
  return { code: 0, stdout, stderr: [] };
}

/**
 * `cook status`: in-flight count + per-active line (in collect/path order, NOT
 * id-sorted : nuance N2), the pending backlog count with a `⚠` suffix iff
 * pending > 8, then the done/blocked/abandoned tally.
 *
 * @param {string} root
 * @returns {Promise<Report>}
 */
export async function statusReport(root) {
  const got = await collectOrFail(root);
  if ('fail' in got) return got.fail;
  const { tasks } = got;
  /** @param {string} s */
  const count = (s) => tasks.filter((t) => t.status === s).length;
  const active = tasks.filter((t) => t.status === 'in_progress');
  const pending = count('pending');

  const stdout = [`in flight: ${active.length}`];
  for (const t of active) stdout.push(`  #${t.id} ${t.stage}: ${t.title}`);
  stdout.push(
    `ready/pending backlog: ${pending}` +
      (pending > 8
        ? '  ⚠ backlog is growing: consider finishing or pruning before adding more'
        : ''),
  );
  stdout.push(
    `done: ${count('done')}  blocked: ${count('blocked')}  abandoned: ${count('abandoned')}`,
  );
  return { code: 0, stdout, stderr: [] };
}

/**
 * `cook show <id>`: pretty-print the first task.json (collect/path order) whose
 * id's string form equals `id` (nuance N3). Empty id → usage error; no match →
 * `no task with id <id>`. The extra-argument guard is a CLI-arg concern handled
 * by the dispatcher before this runs (cook.sh order: empty-id, then extra-arg).
 *
 * The success path re-serializes the RAW file (not the `collectTasks` object,
 * which carries an injected `_dir`) as `JSON.stringify(JSON.parse(raw), null, 2)`
 * : byte-exact with cook.sh's `jq '.' "$f"` over the task.json schema (contract
 * C; the caller appends the single trailing newline).
 *
 * @param {string} root
 * @param {string} id
 * @returns {Promise<Report>}
 */
export async function showReport(root, id) {
  if (!id) return { code: 1, stdout: [], stderr: ['cook: usage: cook show <id>'] };
  const got = await collectOrFail(root);
  if ('fail' in got) return got.fail;
  const match = got.tasks.find((t) => String(t.id) === id);
  if (!match) return { code: 1, stdout: [], stderr: [`cook: no task with id ${id}`] };
  const raw = await readFile(join(root, match._dir), 'utf8');
  const pretty = JSON.stringify(JSON.parse(raw), null, 2);
  return { code: 0, stdout: [pretty], stderr: [] };
}
