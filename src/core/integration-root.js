// @ts-check

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { git } from './git.js';

/**
 * @param {string} root
 * @param {string[]} args
 * @param {string} message
 */
function gitOk(root, args, message) {
  const result = git(root, args);
  if (result.status !== 0) {
    const detail = (result.stderr ?? result.stdout ?? '').trim();
    throw new Error(detail ? `${message}: ${detail}` : message);
  }
  return (result.stdout ?? '').trim();
}

/** @param {string} trunkRef */
function trunkRefName(trunkRef) {
  return trunkRef.startsWith('refs/') ? trunkRef : `refs/heads/${trunkRef}`;
}

/** @param {string} taskId */
function integrationHomePrefix(taskId) {
  return `jeff-integrate-${taskId}-`;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function listedWorktrees(root) {
  const out = gitOk(root, ['worktree', 'list', '--porcelain'], '[integration-root] could not list worktrees');
  /** @type {string[]} */
  const paths = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) paths.push(line.slice('worktree '.length));
  }
  return paths;
}

/**
 * @param {string} root
 * @param {{ taskId: string, checkoutRoot?: string }} options
 * @returns {Promise<{ checkoutRoot: string, home: string }>}
 */
async function requireOwnedCheckout(root, options) {
  const prefix = integrationHomePrefix(options.taskId);
  const rootReal = await realpath(root);
  /** @type {{ checkoutRoot: string, home: string }[]} */
  const owned = [];
  for (const listed of listedWorktrees(root)) {
    const checkoutRoot = await realpath(listed);
    if (checkoutRoot === rootReal) continue;
    const home = dirname(checkoutRoot);
    if (!basename(home).startsWith(prefix)) continue;
    owned.push({ checkoutRoot, home });
  }
  if (options.checkoutRoot !== undefined) {
    const wanted = await realpath(options.checkoutRoot);
    const match = owned.find((item) => item.checkoutRoot === wanted);
    if (!match) throw new Error('[integration-root] unattributable integration checkout');
    return match;
  }
  if (owned.length !== 1) {
    throw new Error('[integration-root] could not identify leftover integration checkout');
  }
  return owned[0];
}

/**
 * Create a private clean checkout at the current trunk OID without changing
 * the state-root branch or files.
 *
 * @param {string} root
 * @param {{ trunkRef: string, taskId: string }} options
 * @returns {Promise<{ checkoutRoot: string, trunkOid: string }>}
 */
export async function createIntegrationCheckout(root, options) {
  const trunkOid = gitOk(
    root,
    ['rev-parse', '--verify', `${options.trunkRef}^{commit}`],
    `[integration-root] trunk ref '${options.trunkRef}' is not resolvable`,
  );
  const home = await mkdtemp(join(tmpdir(), integrationHomePrefix(options.taskId)));
  const checkoutRoot = join(home, 'checkout');
  gitOk(
    root,
    ['worktree', 'add', '--detach', '-q', checkoutRoot, trunkOid],
    '[integration-root] could not create integration checkout',
  );
  return { checkoutRoot, trunkOid };
}

/**
 * Advance trunk O→G from the integration checkout with expected-old CAS.
 *
 * @param {{
 *   checkoutRoot: string,
 *   trunkRef: string,
 *   expectedOld: string,
 *   next: string,
 * }} options
 * @returns {Promise<void>}
 */
export async function compareAndSwapTrunk(options) {
  gitOk(
    options.checkoutRoot,
    ['merge-base', '--is-ancestor', options.expectedOld, options.next],
    '[integration-root] gated checkpoint is not a descendant of expected-old trunk',
  );
  gitOk(
    options.checkoutRoot,
    ['update-ref', trunkRefName(options.trunkRef), options.next, options.expectedOld],
    '[integration-root] stale trunk compare-and-swap',
  );
}

/**
 * Reuse a still-valid owned leftover integration checkout without creating
 * another worktree or moving HEAD.
 *
 * @param {string} root
 * @param {{ taskId: string, checkoutRoot?: string }} options
 * @returns {Promise<{ checkoutRoot: string }>}
 */
export async function resumeIntegrationCheckout(root, options) {
  const owned = await requireOwnedCheckout(root, options);
  const status = gitOk(
    owned.checkoutRoot,
    ['status', '--porcelain'],
    '[integration-root] could not read leftover checkout status',
  );
  if (status !== '') {
    throw new Error('[integration-root] leftover integration checkout is not clean');
  }
  return { checkoutRoot: owned.checkoutRoot };
}

/**
 * Remove only an owned integration worktree and its home.
 *
 * @param {string} root
 * @param {{ taskId: string, checkoutRoot: string }} options
 * @returns {Promise<void>}
 */
export async function discardIntegrationCheckout(root, options) {
  const owned = await requireOwnedCheckout(root, options);
  gitOk(
    root,
    ['worktree', 'remove', owned.checkoutRoot],
    '[integration-root] could not remove integration checkout',
  );
  await rm(owned.home, { recursive: true, force: true });
}
