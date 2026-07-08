// @ts-check

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readMode, readConfig } from './store.js';
import { git, treeDirty, testRunsLogPath } from './git.js';

/** @typedef {{ code: number, stdout: string[], stderr: string[] }} Verdict */

/**
 * Resolve the configured test command, at parity with cook.sh's
 * `verify_resolve_command` (skills/cook/scripts/cook.sh:1382). A missing
 * file/key/line, or an unparseable config, resolves to `''` (the caller then
 * fails closed). Read-only; never executes anything.
 *
 * @param {string} root
 * @param {'lite' | 'full'} mode
 * @returns {Promise<string>}
 */
async function resolveCommand(root, mode) {
  if (mode === 'lite') {
    let profile;
    try {
      profile = await readFile(join(root, '.jeff', 'profile.md'), 'utf8');
    } catch {
      return '';
    }
    // Port of `sed -n 's/^Test command:[^`]*`\([^`]*\)`.*/\1/p' | head -1`:
    // the first `Test command:` line's first backtick-delimited span.
    for (const line of profile.split('\n')) {
      const m = line.match(/^Test command:[^`]*`([^`]*)`/);
      if (m) return m[1];
    }
    return '';
  }
  // full: `jq -r '.testCommand // empty' .jeff/config.json` (absent/unparseable → '').
  const cfg = await readConfig(root);
  if (!cfg) return '';
  const tc = cfg.testCommand;
  // Fail closed on non-strings instead of inventing shell from malformed JSON.
  return typeof tc === 'string' ? tc : '';
}

/**
 * Append `line` to `file` at most once, at parity with cook.sh's
 * `append_line_once` (skills/cook/scripts/cook.sh:731): create the parent dir,
 * skip if an exact-line match already exists, else append `line\n`.
 *
 * @param {string} file
 * @param {string} line
 */
function appendLineOnce(file, line) {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8').split('\n');
    if (existing.includes(line)) return;
  }
  appendFileSync(file, `${line}\n`);
}

/**
 * UTC ISO at second precision, matching the oracle's `date -u
 * +%Y-%m-%dT%H:%M:%SZ` shape (no millis) : a bare `toISOString()` emits `.mmm`
 * and would be rejected by the format assertion.
 *
 * @returns {string}
 */
function utcSecond() {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch (e) {
    if (/** @type {any} */ (e).code === 'ENOENT') return false;
    throw e;
  }
}

/**
 * Full-mode run log: append one HEAD-keyed jsonl line to
 * `.jeff/test-runs.jsonl` and git-exclude it, but only in a git repo with a
 * resolvable HEAD. Side-effecting; kept separate from the pure verdict build
 * in `runVerify` (lite mode never calls this : its `.jeff/` is already
 * git-excluded).
 *
 * @param {string} root
 * @param {string} cmd
 * @param {'green' | 'red'} result
 */
function logTestRun(root, cmd, result) {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return;
  const head = git(root, ['rev-parse', 'HEAD']);
  const hash = head.status === 0 ? (head.stdout ?? '').trim() : '';
  if (!hash) return;
  const line = JSON.stringify({ hash, dirty: treeDirty(root), result, suite: cmd, at: utcSecond() });
  appendFileSync(testRunsLogPath(root), `${line}\n`);
  appendLineOnce(join(root, '.git', 'info', 'exclude'), '.jeff/test-runs.jsonl');
}

/**
 * `cook verify`: run the configured test command and report the verdict; in
 * full mode + a git repo, append one HEAD-keyed line to `.jeff/test-runs.jsonl`
 * and git-exclude it. Port of cook.sh's `cmd_verify`
 * (skills/cook/scripts/cook.sh:1395). Returns the 3a verdict shape; the child's
 * own stdout/stderr stream straight through the inherited fds (NOT captured),
 * so the verdict arrays carry only cook's own line.
 *
 * @param {string} root
 * @returns {Promise<Verdict>}
 */
export async function runVerify(root) {
  const mode = await readMode(root);
  const cmd = await resolveCommand(root, mode);

  if (mode !== 'lite') {
    if (isSymlink(join(root, '.jeff')) || isSymlink(testRunsLogPath(root))) {
      return { code: 1, stdout: [], stderr: [`cook: refusing symlinked test-runs log: ${testRunsLogPath(root)}`] };
    }
  }

  // Fail CLOSED before any `sh -c`: empty, whitespace-only, or comment-only
  // (first non-ws char `#`) is treated as unconfigured, never a silent green.
  const trimmed = cmd.trim();
  if (trimmed === '' || trimmed[0] === '#') {
    const msg = mode === 'lite'
      ? 'cook: no test command configured (set a `Test command: `…`.` line in .jeff/profile.md): refusing to run a default (fail-closed).'
      : 'cook: no test command configured (set "testCommand" in .jeff/config.json): refusing to run a default (fail-closed).';
    return { code: 1, stdout: [], stderr: [msg] };
  }

  // Run the resolved command with the SAME shell semantics as `sh -c "$cmd"`.
  // stdio:'inherit' streams the child's stdout/stderr straight through (no
  // capture-and-reprint, which would inject a newline and lose interleaving).
  const res = spawnSync('sh', ['-c', cmd], { stdio: 'inherit' });
  const rc = res.status ?? 1;

  /** @type {Verdict} */
  const verdict = rc === 0
    ? { code: rc, stdout: [`cook: verify green (${cmd})`], stderr: [] }
    : { code: rc, stdout: [], stderr: [`cook: verify red (exit ${rc}): ${cmd}`] };

  // Lite mode appends NOTHING (its .jeff/ is git-excluded).
  if (mode !== 'lite') logTestRun(root, cmd, rc === 0 ? 'green' : 'red');

  return verdict;
}
