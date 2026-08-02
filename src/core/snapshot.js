// @ts-check

/**
 * Read-only machine projection of the active store for external observers.
 * Projects; does not judge. No lock, no writes.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertStoreContained, collectTasks, readConfig, readMode } from './store.js';

/**
 * @typedef {Object} SnapshotClaim
 * @property {string} by
 * @property {string} at
 */

/**
 * @typedef {Object} SnapshotEscalation
 * @property {string} fork
 * @property {string[]} options
 */

/**
 * @typedef {Object} SnapshotTask
 * @property {string | number} id
 * @property {unknown} slug
 * @property {unknown} title
 * @property {unknown} status
 * @property {unknown} stage
 * @property {unknown} [category]
 * @property {unknown} priority
 * @property {unknown} deps
 * @property {unknown} [discoveredFrom]
 * @property {unknown} blockedReason
 * @property {SnapshotEscalation} [escalation]
 * @property {SnapshotClaim} [claim]
 */

/**
 * @typedef {Object} SnapshotDocument
 * @property {number} schemaVersion
 * @property {string} generatedAt
 * @property {'lite' | 'full'} mode
 * @property {number} [maxParallelTasks]
 * @property {SnapshotTask[]} tasks
 */

/**
 * @typedef {Object} SnapshotReport
 * @property {number} code
 * @property {string[]} stdout
 * @property {string[]} stderr
 */

/**
 * Same total order as reporters `compareById` / `cook ls` (jq `sort_by(.id)`).
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
 * Read item-7 claim side file beside the task dir. Missing or malformed ⇒ null.
 * Source: `.jeff/tasks/<dir>/.claim/claim.json` from `task._dir`.
 *
 * @param {string} root
 * @param {any} task
 * @returns {Promise<SnapshotClaim | null>}
 */
async function readClaim(root, task) {
  const relDir = typeof task?._dir === 'string' ? task._dir : '';
  if (!relDir) return null;
  const claimPath = join(root, dirname(relDir), '.claim', 'claim.json');
  try {
    await assertStoreContained(root, [claimPath]);
    const raw = await readFile(claimPath, 'utf8');
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { by, at } = /** @type {{ by?: unknown, at?: unknown }} */ (value);
    if (typeof by !== 'string' || typeof at !== 'string') return null;
    return { by, at };
  } catch {
    return null;
  }
}

/**
 * Whitelist one collected task into the snapshot projection.
 *
 * @param {string} root
 * @param {any} task
 * @returns {Promise<SnapshotTask>}
 */
async function projectTask(root, task) {
  /** @type {SnapshotTask} */
  const out = {
    id: task.id,
    slug: task.slug,
    title: task.title,
    status: task.status,
    stage: task.stage,
    priority: task.priority,
    deps: task.deps,
    blockedReason: task.blockedReason ?? null,
  };

  if (task.category !== undefined) out.category = task.category;
  if (task.discoveredFrom !== undefined) out.discoveredFrom = task.discoveredFrom;

  const plan = task.plan;
  const escalation = plan && typeof plan === 'object' ? plan.escalation : null;
  if (escalation != null && typeof escalation === 'object' && !Array.isArray(escalation)) {
    const esc = /** @type {{ fork?: string, options?: string[] }} */ (escalation);
    out.escalation = {
      fork: /** @type {string} */ (esc.fork),
      options: /** @type {string[]} */ (esc.options),
    };
  }

  const claim = await readClaim(root, task);
  if (claim) out.claim = claim;

  return out;
}

/**
 * Build the versioned snapshot document for `root`.
 *
 * @param {string} root
 * @param {{ now?: () => Date }} [options]
 * @returns {Promise<SnapshotDocument>}
 */
export async function buildSnapshot(root, options = {}) {
  const now = options.now ?? (() => new Date());
  const config = await readConfig(root);
  if (!config) throw new Error('no readable .jeff/config.json');

  const mode = await readMode(root);
  const collected = await collectTasks(root);
  const tasks = await Promise.all(collected.map((task) => projectTask(root, task)));
  tasks.sort(compareById);

  /** @type {SnapshotDocument} */
  const doc = {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    mode,
    tasks,
  };

  if (Object.hasOwn(config, 'maxParallelTasks')) {
    doc.maxParallelTasks = /** @type {number} */ (config.maxParallelTasks);
  }

  return doc;
}

/**
 * CLI/report verdict for `cook snapshot --json`.
 *
 * @param {string} root
 * @param {{ now?: () => Date }} [options]
 * @returns {Promise<SnapshotReport>}
 */
export async function snapshotReport(root, options = {}) {
  try {
    const doc = await buildSnapshot(root, options);
    return { code: 0, stdout: [JSON.stringify(doc)], stderr: [] };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const line = detail.startsWith('cook: snapshot:')
      ? detail
      : `cook: snapshot: ${detail}`;
    return { code: 1, stdout: [], stderr: [line] };
  }
}
