// @ts-check

import { readFileSync } from 'node:fs';
import { git, treeDirty, testRunsLogPath } from './git.js';

/** @typedef {{ code: number, stdout: string[], stderr: string[] }} Verdict */

/**
 * A `die`: exit 1 with a single `cook: <msg>` line on stderr (the `cook: `
 * prefix is part of the string; `emit` adds the newline — same shape verify.js
 * uses).
 *
 * @param {string} msg
 * @returns {Verdict}
 */
function die(msg) {
  return { code: 1, stdout: [], stderr: [`cook: ${msg}`] };
}

/**
 * The run-log half of `cmd_baseline`: exit 0 IFF `.jeff/test-runs.jsonl`
 * carries a line `{ hash == want, dirty == false, result == "green" }`.
 * Read-only port of cook.sh's `cmd_baseline` (skills/cook/scripts/cook.sh:1470),
 * the log-scan tail (after the git/HEAD/dirty gates in `runBaseline` below).
 *
 * Two-pass, slurp-first (mirrors `jq -e -s`): read the whole file first; an
 * absent or zero-byte file is the `[ -s ]` gate (die #8). Then parse EVERY
 * non-blank line — ANY parse failure fails the whole check (die #10), even if
 * a valid match appears earlier (row B13). Only once all lines parse does the
 * record scan decide OK vs die #10. This can NOT be scan-first-return-on-match:
 * the oracle's `jq -s` slurps the whole file before evaluating, so one
 * malformed line poisons a scan that already found its match.
 *
 * @param {string} root
 * @param {string} want - the hash being checked (HEAD, already confirmed by the caller)
 * @returns {Verdict}
 */
function scanRunLog(root, want) {
  let content;
  try {
    content = readFileSync(testRunsLogPath(root), 'utf8');
  } catch {
    content = '';
  }
  if (content.length === 0) {
    return die(`baseline check: no run log (.jeff/test-runs.jsonl absent or empty): nothing anchored at ${want}.`);
  }

  const noGreen = () => die(`baseline check: no green+clean run logged for ${want}: not a baseline.`);

  const records = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    try {
      records.push(JSON.parse(t));
    } catch {
      return noGreen();
    }
  }

  const match = records.some(
    (o) => o && typeof o === 'object' && o.hash === want && o.dirty === false && o.result === 'green',
  );
  return match
    ? { code: 0, stdout: [`cook: baseline OK: ${want} is a green+clean baseline.`], stderr: [] }
    : noGreen();
}

/**
 * `cook baseline check [<hash>]`: exit 0 IFF the run log carries a line
 * `{ hash == <hash>, dirty == false, result == "green" }` AND the tree is
 * currently clean OUTSIDE `.jeff/` AND current HEAD == `<hash>`. Default hash =
 * current HEAD. Read-only port of cook.sh's `cmd_baseline`
 * (skills/cook/scripts/cook.sh:1470). `<hash>` is only string-compared and
 * interpolated into messages — never passed to git as a revision.
 *
 * @param {string} root
 * @param {string[]} args - argv after `baseline`
 * @returns {Promise<Verdict>}
 */
export async function runBaseline(root, args) {
  const sub = args[0];
  if (sub !== 'check') {
    if (sub === undefined || sub === '') return die('usage: cook baseline check [<hash>]');
    return die(`unknown baseline subcommand: ${sub} (try \`cook baseline check\`)`);
  }
  const pos = args.slice(1);

  // Count-only guard, naming the 2ND positional (the first token BEYOND the
  // allowed hash) — parity with cook.sh's `[ "$#" -le 1 ] || die … '$2'`. NO
  // dash-prefixed "unknown option" special case (`check --foo` is a hash).
  if (pos.length > 1) return die(`baseline check: unexpected argument '${pos[1]}'`);

  if (git(root, ['rev-parse', '--show-toplevel']).status !== 0) {
    return die(`not a git repository: ${root} (baseline check reads the git HEAD + tree state).`);
  }

  const headRes = git(root, ['rev-parse', 'HEAD']);
  if (headRes.status !== 0) return die('baseline check: could not determine the current HEAD.');
  const head = (headRes.stdout ?? '').trim();

  // `${1:-$head}`: empty-string or absent hash falls to HEAD; '0' and other
  // non-empty strings are kept.
  const want = pos[0] || head;

  if (head !== want) {
    return die(`baseline check: HEAD (${head}) is not at the requested hash (${want}): not a baseline.`);
  }

  if (treeDirty(root)) {
    return die('baseline check: working tree is currently dirty: not a clean baseline.');
  }

  return scanRunLog(root, want);
}
