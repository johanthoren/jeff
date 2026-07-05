// @ts-check

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * `git -C root ...args`, captured as utf8 and never throwing on a non-zero
 * exit (callers read `.status`/`.stdout`). Centralizes the `-C root` +
 * `encoding` pair shared by every git call the verbs make.
 *
 * @param {string} root
 * @param {string[]} args
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
export function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

/**
 * Whether the working tree is dirty OUTSIDE `.jeff/`, at parity with cook.sh's
 * `tree_dirty` (skills/cook/scripts/cook.sh:163): `git status --porcelain --
 * ':(exclude).jeff'` non-empty.
 *
 * @param {string} root
 * @returns {boolean}
 */
export function treeDirty(root) {
  const res = git(root, ['status', '--porcelain', '--', ':(exclude).jeff']);
  return (res.stdout ?? '').length > 0;
}

/**
 * The single named home for the HEAD-keyed run log
 * (`.jeff/test-runs.jsonl`): written by `cook verify` (full mode), read by
 * `cook baseline check`.
 *
 * @param {string} root
 * @returns {string}
 */
export function testRunsLogPath(root) {
  return join(root, '.jeff', 'test-runs.jsonl');
}
