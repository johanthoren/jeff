// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * Test design (.jeff/tasks/item5a2-baseline/notes.md, "## Test design"):
 * one node:test differential file spawning BOTH the frozen bash oracle
 * (`skills/cook/scripts/cook.sh baseline …`) and the JS port (`src/cli/cook.js
 * baseline …`) over the SAME isolated git fixture, byte-comparing raw stdout,
 * raw stderr, and exit code (the `assertParity` shape from
 * verify-parity.test.js : never trims, never a golden string). Rows map to
 * the plan's B1-B13 table; see the per-test comment for the row.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const COOK_SH = join(REPO_ROOT, 'skills', 'cook', 'scripts', 'cook.sh');
const COOK_JS = join(REPO_ROOT, 'src', 'cli', 'cook.js');

/**
 * @param {string} root - fixture COOK_ROOT
 * @param {string[]} args - e.g. ['baseline', 'check']
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runOracle(root, args) {
  const res = spawnSync('bash', [COOK_SH, ...args], {
    env: { ...process.env, COOK_ROOT: root },
    encoding: 'utf8',
  });
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

/**
 * @param {string} root
 * @param {string[]} args
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runJs(root, args) {
  const res = spawnSync(process.execPath, [COOK_JS, ...args], {
    env: { ...process.env, COOK_ROOT: root },
    encoding: 'utf8',
  });
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

/**
 * Assert full parity (raw stdout, raw stderr, exit code) between the oracle
 * and the JS port for the same fixture + args. Never trims: trailing-newline
 * parity is part of the contract.
 *
 * @param {string} root
 * @param {string[]} args
 */
function assertParity(root, args) {
  const oracle = runOracle(root, args);
  const js = runJs(root, args);
  assert.equal(js.stdout, oracle.stdout, `stdout mismatch for cook ${args.join(' ')}`);
  assert.equal(js.stderr, oracle.stderr, `stderr mismatch for cook ${args.join(' ')}`);
  assert.equal(js.code, oracle.code, `exit code mismatch for cook ${args.join(' ')}`);
}

/**
 * @param {string} root
 * @param {string[]} args
 */
function runGit(root, args) {
  const res = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (status ${res.status}): ${res.stderr}`);
  }
  return res;
}

/**
 * headSha(root) = `git -C root rev-parse HEAD` trimmed : fetched at runtime
 * for rows whose expected message embeds HEAD.
 *
 * @param {string} root
 * @returns {string}
 */
function headSha(root) {
  return runGit(root, ['rev-parse', 'HEAD']).stdout.trim();
}

/**
 * An isolated git fixture for `baseline check`, per the plan's fixture
 * column: `mkdtemp` -> `git init -q` -> local user.email/user.name -> (if
 * `commit`) seed + committed `seed.txt` (gpg signing disabled, env-
 * independent) -> `mkdir .jeff`. `logLines`: array of raw JSONL line
 * strings -> written verbatim as `lines.join('\n') + '\n'`; `''` -> a
 * ZERO-BYTE log file; `undefined` -> no log file at all. `dirtyOutside` ->
 * an uncommitted change to `seed.txt` (dirty OUTSIDE `.jeff/`).
 *
 * @param {{ commit?: boolean, logLines?: string[] | '', dirtyOutside?: boolean }} [opts]
 * @returns {Promise<string>}
 */
async function makeBaselineRoot({ commit = true, logLines, dirtyOutside = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jeff-baseline-parity-'));
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.email', 'jeff-baseline-parity@example.com']);
  runGit(root, ['config', 'user.name', 'Jeff Baseline Parity']);
  if (commit) {
    await writeFile(join(root, 'seed.txt'), 'seed\n', 'utf8');
    runGit(root, ['add', 'seed.txt']);
    runGit(root, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed']);
  }
  await mkdir(join(root, '.jeff'), { recursive: true });
  if (logLines === '') {
    await writeFile(join(root, '.jeff', 'test-runs.jsonl'), '', 'utf8');
  } else if (logLines !== undefined) {
    await writeFile(join(root, '.jeff', 'test-runs.jsonl'), logLines.join('\n') + '\n', 'utf8');
  }
  if (dirtyOutside) {
    await writeFile(join(root, 'seed.txt'), 'seed\nmodified outside .jeff\n', 'utf8');
  }
  return root;
}

// --- B1: no subcommand -> die: usage (AC1) ---
test('baseline with no subcommand dies with usage, matching the oracle', async () => {
  const root = await makeBaselineRoot();
  try {
    assertParity(root, ['baseline']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- B2: unknown subcommand -> die (AC1) ---
test('baseline frob dies with unknown-subcommand, matching the oracle', async () => {
  const root = await makeBaselineRoot();
  try {
    assertParity(root, ['baseline', 'frob']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- B3: check + 2 positionals -> die naming the 2ND positional (AC1) ---
test('baseline check with an extra positional argument names the 2nd positional, matching the oracle', async () => {
  const root = await makeBaselineRoot();
  try {
    assertParity(root, ['baseline', 'check', 'aaa', 'bbb']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- B4: non-git dir -> die: not a git repository (die #4) (AC2) ---
test('baseline check in a non-git directory dies with not-a-git-repository, matching the oracle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jeff-baseline-parity-nongit-'));
  try {
    assertParity(root, ['baseline', 'check']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- B5: unborn HEAD (no commit) -> die: could not determine HEAD (die #5) (AC2) ---
test('baseline check with an unborn HEAD dies with could-not-determine-HEAD, matching the oracle', async () => {
  const root = await makeBaselineRoot({ commit: false });
  try {
    assertParity(root, ['baseline', 'check']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- B6: HEAD != requested hash -> die (die #6) (AC2) ---
test('baseline check with a requested hash that is not HEAD dies with a not-a-baseline message, matching the oracle', async () => {
  const root = await makeBaselineRoot();
  try {
    assertParity(root, ['baseline', 'check', '0000000000000000000000000000000000000000']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- B7: dirty tree outside .jeff/ -> die (die #7) (AC2) ---
test('baseline check with a dirty working tree dies with a not-a-clean-baseline message, matching the oracle', async () => {
  const root = await makeBaselineRoot({ dirtyOutside: true });
  try {
    assertParity(root, ['baseline', 'check']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- B8: no log file at all (absent) -> die: no run log (die #8) (AC2) ---
test('baseline check with no run log at all dies with a no-run-log message, matching the oracle', async () => {
  const root = await makeBaselineRoot({ logLines: undefined });
  try {
    assertParity(root, ['baseline', 'check']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- B9: zero-byte log file -> die: no run log (die #8, byte-size gate) (AC2) ---
test('baseline check with a zero-byte run log dies with a no-run-log message, matching the oracle', async () => {
  const root = await makeBaselineRoot({ logLines: '' });
  try {
    assertParity(root, ['baseline', 'check']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- B10: matching green+clean line for HEAD, default (no arg) hash -> OK (AC2) ---
test('baseline check with a matching green+clean log line goes OK against the default HEAD, matching the oracle', async () => {
  const root = await makeBaselineRoot();
  try {
    const H = headSha(root);
    await writeFile(
      join(root, '.jeff', 'test-runs.jsonl'),
      JSON.stringify({ hash: H, dirty: false, result: 'green' }) + '\n',
      'utf8',
    );
    assertParity(root, ['baseline', 'check']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- B11: three near-miss log lines, none satisfy all three fields -> die (die #10) (AC2) ---
test('baseline check with only near-miss log lines dies with a no-green-clean-run message, matching the oracle', async () => {
  const root = await makeBaselineRoot();
  try {
    const H = headSha(root);
    const OTHER = '1111111111111111111111111111111111111111';
    await writeFile(
      join(root, '.jeff', 'test-runs.jsonl'),
      [
        JSON.stringify({ hash: OTHER, dirty: false, result: 'green' }),
        JSON.stringify({ hash: H, dirty: true, result: 'green' }),
        JSON.stringify({ hash: H, dirty: false, result: 'red' }),
      ].join('\n') + '\n',
      'utf8',
    );
    assertParity(root, ['baseline', 'check']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- B12: explicit hash arg == HEAD, matching log line -> OK (want=pos[0] path) (AC2) ---
test('baseline check with an explicit hash matching HEAD goes OK, matching the oracle', async () => {
  const root = await makeBaselineRoot();
  try {
    const H = headSha(root);
    await writeFile(
      join(root, '.jeff', 'test-runs.jsonl'),
      JSON.stringify({ hash: H, dirty: false, result: 'green' }) + '\n',
      'utf8',
    );
    assertParity(root, ['baseline', 'check', H]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- B13: valid green+clean match line FOLLOWED BY a genuinely-unparseable line -> die (die #10) ---
// The slurp/malformed discriminator: a naive scan-first-return-on-match impl
// would wrongly pass this row; the oracle's slurp-first `jq -s` dies even
// though a matching line precedes the malformed one.
test('baseline check with a matching line followed by an unparseable log line still dies, matching the oracle (slurp-first, not scan-first)', async () => {
  const root = await makeBaselineRoot();
  try {
    const H = headSha(root);
    await writeFile(
      join(root, '.jeff', 'test-runs.jsonl'),
      [JSON.stringify({ hash: H, dirty: false, result: 'green' }), '{ not json'].join('\n') + '\n',
      'utf8',
    );
    assertParity(root, ['baseline', 'check']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
