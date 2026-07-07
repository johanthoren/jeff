// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * Test design (.jeff/tasks/item3b-verify/notes.md, "## Test design"):
 * one node:test differential file spawning BOTH the frozen bash oracle
 * (`skills/cook/scripts/cook.sh verify`) and the JS port (`src/cli/cook.js
 * verify`) over shared fixture stores (lite + an isolated full-mode git
 * fixture), asserting equal raw stdout, equal raw stderr, and equal exit
 * code (byte-exact for L-rows), plus a timestamp-tolerant comparison of the
 * appended `.jeff/test-runs.jsonl` line for F-rows. The expectation is always
 * the oracle's OWN runtime output — never a hardcoded golden string. Rows map
 * to the plan's L1-L7 / F1-F5 table; see the per-test comment for the row.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const COOK_SH = join(REPO_ROOT, 'skills', 'cook', 'scripts', 'cook.sh');
const COOK_JS = join(REPO_ROOT, 'src', 'cli', 'cook.js');

/** UTC ISO, second precision, no millis (the oracle's `date -u +%Y-%m-%dT%H:%M:%SZ` shape). */
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * @param {string} root - fixture COOK_ROOT
 * @param {string[]} args - e.g. ['verify']
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
 * A lite-mode fixture: `.jeff/config.json` with `mode:"lite"`, and (unless
 * omitted) a `.jeff/profile.md` carrying the given raw content as the whole
 * file (the caller supplies the `Test command:` prose line verbatim, or
 * omits it to test the absent-profile case, L3).
 *
 * @param {string} [profileContent] - raw profile.md content, or undefined to omit the file
 * @returns {Promise<string>}
 */
async function makeLiteRoot(profileContent) {
  const root = await mkdtemp(join(tmpdir(), 'jeff-verify-parity-lite-'));
  await mkdir(join(root, '.jeff'), { recursive: true });
  await writeFile(join(root, '.jeff', 'config.json'), JSON.stringify({ mode: 'lite' }), 'utf8');
  if (profileContent !== undefined) {
    await writeFile(join(root, '.jeff', 'profile.md'), profileContent, 'utf8');
  }
  return root;
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
 * An ISOLATED full-mode git fixture: `mkdtemp` -> `git init` + local
 * user.email/user.name -> a seeded, committed file (gpg signing disabled so
 * the commit is env-independent) -> `.jeff/config.json` with the given
 * testCommand (NO `mode:"lite"`; omit the key entirely to test the
 * no-testCommand fail-closed case, F5). Runs entirely under the OS tmpdir;
 * NEVER touches this repo's real `.jeff/`, `.git/`, or `.git/info/exclude`.
 *
 * @param {string} [testCommand] - the configured suite, or undefined to omit the key
 * @returns {Promise<string>}
 */
async function makeFullRoot(testCommand) {
  const config = testCommand === undefined ? {} : { testCommand };
  return makeFullRootWithConfig(config);
}

/**
 * @param {unknown} config
 * @returns {Promise<string>}
 */
async function makeFullRootWithConfig(config) {
  const root = await mkdtemp(join(tmpdir(), 'jeff-verify-parity-full-'));
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.email', 'jeff-verify-parity@example.com']);
  runGit(root, ['config', 'user.name', 'Jeff Verify Parity']);
  await writeFile(join(root, 'seed.txt'), 'seed\n', 'utf8');
  runGit(root, ['add', 'seed.txt']);
  runGit(root, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed']);
  await mkdir(join(root, '.jeff'), { recursive: true });
  await writeFile(join(root, '.jeff', 'config.json'), JSON.stringify(config), 'utf8');
  return root;
}

/** @param {string} root */
function logPath(root) {
  return join(root, '.jeff', 'test-runs.jsonl');
}

/**
 * Read `.jeff/test-runs.jsonl` as its single line (asserting there is
 * exactly one when the file exists), or `null` if the file is absent.
 *
 * @param {string} root
 * @returns {Promise<string | null>}
 */
async function readLogLine(root) {
  let raw;
  try {
    raw = await readFile(logPath(root), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
  const lines = raw.split('\n').filter((l) => l.length > 0);
  assert.equal(lines.length, 1, `expected exactly one log line, got ${lines.length}: ${JSON.stringify(raw)}`);
  return lines[0];
}

/** @param {string} root */
async function clearLog(root) {
  await rm(logPath(root), { force: true });
}

/**
 * Timestamp-tolerant parity on a pair of `.jeff/test-runs.jsonl` lines (one
 * from the oracle, one from the JS port, captured from the SAME fixture so
 * `hash` is comparable): equal on every field except `at`, byte-equal on the
 * raw line once `at` is masked (pins compactness/key order/boolean `dirty`),
 * and both `at` values well-formed per the oracle's own format — never a
 * byte comparison of the non-deterministic value itself.
 *
 * @param {string} oracleLine
 * @param {string} jsLine
 */
function assertLogParity(oracleLine, jsLine) {
  const oracleObj = JSON.parse(oracleLine);
  const jsObj = JSON.parse(jsLine);
  const pick = (/** @type {any} */ o) => ({ hash: o.hash, dirty: o.dirty, result: o.result, suite: o.suite });
  assert.deepEqual(pick(jsObj), pick(oracleObj), 'log fields (excl. at) mismatch between JS and oracle');

  const maskAt = (/** @type {string} */ line) => line.replace(/"at":"[^"]*"/, '"at":"X"');
  assert.equal(
    maskAt(jsLine),
    maskAt(oracleLine),
    'masked raw log line mismatch (compactness / key order / dirty-as-boolean)',
  );

  assert.match(oracleObj.at, AT_RE, `oracle "at" not a well-formed UTC ISO (second precision): ${oracleObj.at}`);
  assert.match(jsObj.at, AT_RE, `JS "at" not a well-formed UTC ISO (second precision): ${jsObj.at}`);
}

// --- L1: lite, `true` -> green, rc 0, NO log written (lite = no log) (AC1, AC3, AC4) ---
test('lite verify with a real command goes green and writes no run log, matching the oracle', async () => {
  const root = await makeLiteRoot('Test command: `true`.\n');
  try {
    assertParity(root, ['verify']);
    assert.equal(await readLogLine(root), null, 'lite mode must never write test-runs.jsonl');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- L2: lite, red + passthrough (stdio-inherit byte-exact, no added newline) (AC3) ---
test('lite verify passes the child\'s stdout/stderr through byte-exact on a red command, matching the oracle', async () => {
  const root = await makeLiteRoot('Test command: `printf out; printf err >&2; false`.\n');
  try {
    assertParity(root, ['verify']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- L3: lite, no profile.md -> fail-closed before exec, rc 1 (AC1 absent->empty, AC2) ---
test('lite verify with no profile.md fails closed before executing anything, matching the oracle', async () => {
  const root = await makeLiteRoot(undefined);
  try {
    assertParity(root, ['verify']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- L4: lite, Test command line with no backticks -> sed-span empty -> fail-closed (AC1, AC2) ---
test('lite verify with a backtick-less Test command line fails closed, matching the oracle', async () => {
  const root = await makeLiteRoot('Test command: true\n');
  try {
    assertParity(root, ['verify']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- L5: lite, whitespace-only span -> trim->empty -> fail-closed (AC2, silent-green guard) ---
test('lite verify with a whitespace-only command fails closed (no silent green), matching the oracle', async () => {
  const root = await makeLiteRoot('Test command: `   `.\n');
  try {
    assertParity(root, ['verify']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- L6: lite, comment-only span -> first non-ws char `#` -> fail-closed (AC2) ---
test('lite verify with a comment-only command fails closed (no silent green), matching the oracle', async () => {
  const root = await makeLiteRoot('Test command: `# nope`.\n');
  try {
    assertParity(root, ['verify']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- L7: lite, real cmd + trailing comment -> NOT rejected (discriminator) (AC2) ---
test('lite verify with a real command plus a trailing comment is NOT rejected, matching the oracle', async () => {
  const root = await makeLiteRoot('Test command: `true # all`.\n');
  try {
    assertParity(root, ['verify']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('full-mode verify rejects non-string testCommand before shell execution', async () => {
  const root = await makeFullRootWithConfig({ testCommand: ['true'] });
  try {
    const js = runJs(root, ['verify']);
    assert.equal(js.code, 1);
    assert.match(js.stderr, /no test command configured/);
    assert.equal(js.stdout, '');
    assert.equal(await readLogLine(root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- F1: full, testCommand:"true", clean tree -> green + one timestamp-tolerant log line (AC3, AC4) ---
test('full-mode verify goes green and appends one timestamp-tolerant-parity log line, matching the oracle', async () => {
  const root = await makeFullRoot('true');
  try {
    const oracle = runOracle(root, ['verify']);
    const oracleLine = await readLogLine(root);
    assert.ok(oracleLine, 'oracle should append exactly one log line');
    await clearLog(root);

    const js = runJs(root, ['verify']);
    const jsLine = await readLogLine(root);
    assert.ok(jsLine, 'JS should append exactly one log line');

    assert.equal(js.stdout, oracle.stdout, 'stdout mismatch for verify');
    assert.equal(js.stderr, oracle.stderr, 'stderr mismatch for verify');
    assert.equal(js.code, oracle.code, 'exit code mismatch for verify');

    assertLogParity(/** @type {string} */ (oracleLine), /** @type {string} */ (jsLine));
    assert.equal(JSON.parse(/** @type {string} */ (oracleLine)).result, 'green');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- F2: full, testCommand:"false", clean tree -> red + log parity (AC3, AC4) ---
test('full-mode verify goes red and appends a matching log line, matching the oracle', async () => {
  const root = await makeFullRoot('false');
  try {
    const oracle = runOracle(root, ['verify']);
    const oracleLine = await readLogLine(root);
    assert.ok(oracleLine, 'oracle should append exactly one log line');
    await clearLog(root);

    const js = runJs(root, ['verify']);
    const jsLine = await readLogLine(root);
    assert.ok(jsLine, 'JS should append exactly one log line');

    assert.equal(js.stdout, oracle.stdout, 'stdout mismatch for verify');
    assert.equal(js.stderr, oracle.stderr, 'stderr mismatch for verify');
    assert.equal(js.code, oracle.code, 'exit code mismatch for verify');

    assertLogParity(/** @type {string} */ (oracleLine), /** @type {string} */ (jsLine));
    assert.equal(JSON.parse(/** @type {string} */ (oracleLine)).result, 'red');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- F3: full, tracked file dirtied outside .jeff/ -> dirty:true parity (AC4) ---
test('full-mode verify marks a dirty tree as dirty:true, matching the oracle', async () => {
  const root = await makeFullRoot('true');
  try {
    await writeFile(join(root, 'seed.txt'), 'seed\nmodified outside .jeff\n', 'utf8');

    const oracle = runOracle(root, ['verify']);
    const oracleLine = await readLogLine(root);
    assert.ok(oracleLine, 'oracle should append exactly one log line');
    await clearLog(root);

    const js = runJs(root, ['verify']);
    const jsLine = await readLogLine(root);
    assert.ok(jsLine, 'JS should append exactly one log line');

    assert.equal(js.stdout, oracle.stdout, 'stdout mismatch for verify');
    assert.equal(js.stderr, oracle.stderr, 'stderr mismatch for verify');
    assert.equal(js.code, oracle.code, 'exit code mismatch for verify');

    assertLogParity(/** @type {string} */ (oracleLine), /** @type {string} */ (jsLine));
    assert.equal(JSON.parse(/** @type {string} */ (oracleLine)).dirty, true, 'oracle sanity: dirtied tree should log dirty:true');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- F4: full, oracle THEN JS in the same fixture -> exclude append-once idempotency (AC4) ---
test('git-exclude append for the run log stays idempotent across oracle and JS runs', async () => {
  const root = await makeFullRoot('true');
  try {
    const oracle = runOracle(root, ['verify']);
    const js = runJs(root, ['verify']);
    // Idempotency is only meaningful if the JS run itself actually performed
    // verify (and its own append) rather than merely being spawned and
    // ignored — pin JS's own exit code to the oracle's (AC3), so this row
    // cannot pass vacuously while the JS verb is absent.
    assert.equal(js.code, oracle.code, 'exit code mismatch for verify');

    const excludeRaw = await readFile(join(root, '.git', 'info', 'exclude'), 'utf8');
    const matches = excludeRaw.split('\n').filter((l) => l === '.jeff/test-runs.jsonl');
    assert.equal(matches.length, 1, `expected exactly one exclude line, got ${matches.length}: ${JSON.stringify(excludeRaw)}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- F5: full, config.json with no testCommand -> fail-closed naming config.json, no log line (AC2, AC4) ---
test('full-mode verify with no configured testCommand fails closed naming config.json and appends no log line', async () => {
  const root = await makeFullRoot(undefined);
  try {
    assertParity(root, ['verify']);
    assert.equal(await readLogLine(root), null, 'no log line should be appended on a fail-closed die');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
