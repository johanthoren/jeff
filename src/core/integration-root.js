// @ts-check

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const home = await mkdtemp(join(tmpdir(), `jeff-integrate-${options.taskId}-`));
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
