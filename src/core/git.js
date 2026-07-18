// @ts-check

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readMode } from './store.js';

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
  if (res.status !== 0) {
    throw new Error('[git-status] working tree cleanliness probe failed');
  }
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

/**
 * Ensure a lite refactor touched only files already changed by implementation.
 *
 * @param {string} root
 * @param {...string} args
 * @returns {Promise<{ code: number, stdout: string[], stderr: string[] }>}
 */
export async function indiffReport(root, ...args) {
  if ((await readMode(root)) !== 'lite') {
    return {
      code: 1,
      stdout: [],
      stderr: ['cook: `cook indiff` is a lite-mode command; run `cook lite` first (the in-diff guard bounds refactor in shared repos).'],
    };
  }
  if (args.length < 2 || args.slice(0, 2).some((arg) => arg === '')) {
    return { code: 1, stdout: [], stderr: ['cook: usage: cook indiff <base-ref> <pre-ref>'] };
  }
  if (args.length > 2) {
    return { code: 1, stdout: [], stderr: [`cook: indiff: unexpected argument '${args[2]}'`] };
  }
  const [baseRef, preRef] = args;
  if (git(root, ['rev-parse', '--show-toplevel']).status !== 0) {
    return { code: 1, stdout: [], stderr: [`cook: not a git repository: ${root} (indiff compares git diffs).`] };
  }

  const allowedResult = git(root, ['diff', '--name-only', '--end-of-options', baseRef, preRef, '--']);
  if (allowedResult.status !== 0) {
    return { code: 1, stdout: [], stderr: [`cook: indiff: could not diff ${baseRef}..${preRef} (bad ref?).`] };
  }
  const actualResult = git(root, ['diff', '--name-only', '--end-of-options', preRef, '--']);
  if (actualResult.status !== 0) {
    return { code: 1, stdout: [], stderr: [`cook: indiff: could not diff ${preRef} against the working tree (bad ref?).`] };
  }

  /** @param {string | null | undefined} value */
  const paths = (value) => new Set((value ?? '').split(/\r?\n/).filter(Boolean));
  const allowed = paths(allowedResult.stdout);
  const offending = [...paths(actualResult.stdout)].filter((path) => !allowed.has(path)).sort();
  if (offending.length === 0) return { code: 0, stdout: [], stderr: [] };
  return {
    code: 1,
    stdout: [],
    stderr: [
      `cook: indiff: refactor touched files outside the implement diff (base ${baseRef} → pre ${preRef}):`,
      ...offending.map((path) => `cook:   ${path}`),
    ],
  };
}
