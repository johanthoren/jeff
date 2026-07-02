#!/usr/bin/env node
// @ts-check

/**
 * `cook.js`: the JS CLI entry for the `validate` verb (spec item 4). Resolves
 * the store root like cook.sh (skills/cook/scripts/cook.sh:44) — `COOK_ROOT`,
 * else `git rev-parse --show-toplevel`, else cwd — runs `validateStore`, prints
 * its streams, and exits with the verdict code. Imports only node stdlib +
 * `src/core/*` (no pi SDK): the §6 boundary.
 *
 * Only `validate` is ported this slice; every other verb stays on cook.sh (the
 * parity wrapper delegates them there), so this entry rejects them with a
 * usage error rather than pretending to handle them.
 */

import { execFileSync } from 'node:child_process';
import { validateStore } from '../core/validate-store.js';

/** @returns {string} the git top-level of cwd, or '' if not a git repo */
function gitTopLevel() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];

  if (sub !== 'validate') {
    process.stderr.write(`cook: unknown subcommand: ${sub === undefined ? 'help' : sub} (this JS entry supports only \`validate\`)\n`);
    process.exit(1);
    return;
  }

  // Reject unknown args fail-closed (parity with cook.sh's reject_unknown_args).
  const rest = argv.slice(1);
  if (rest.length > 0) {
    const first = rest[0];
    if (first.startsWith('-')) process.stderr.write(`cook: validate: unknown option '${first}'\n`);
    else process.stderr.write(`cook: validate: unexpected argument '${first}'\n`);
    process.exit(1);
    return;
  }

  const root = process.env.COOK_ROOT || gitTopLevel() || process.cwd();
  const verdict = await validateStore(root);
  for (const line of verdict.stdout) process.stdout.write(`${line}\n`);
  for (const line of verdict.stderr) process.stderr.write(`${line}\n`);
  process.exit(verdict.code);
}

main();
