// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * Test design (.jeff/tasks/item3c-lifecycle/notes.md, "## Test design"):
 * one node:test differential file spawning BOTH the frozen bash oracle
 * (`skills/cook/scripts/cook.sh <verb>`) and the JS port
 * (`src/cli/cook.js <verb>`) with `COOK_ROOT=<fixture>`, asserting equality
 * against the oracle's OWN runtime output — never a hardcoded golden string.
 * Doctor (read-only) + the two die/reject rows use ONE shared fixture and
 * full byte-parity (`assertParity`). The three scaffold rows + idempotency
 * MUTATE, so they use a fixture PAIR (A=oracle, B=JS) with stdout
 * path-normalization plus `.jeff/` subtree parity. Rows map to the plan's
 * D1-D5 / I1-I6 table; see the per-test comment for the row.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const COOK_SH = join(REPO_ROOT, 'skills', 'cook', 'scripts', 'cook.sh');
const COOK_JS = join(REPO_ROOT, 'src', 'cli', 'cook.js');

/**
 * @param {string} root - fixture COOK_ROOT
 * @param {string[]} args - e.g. ['doctor']
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

/** @param {string} root */
async function assertNoScaffold(root) {
  await assert.rejects(
    stat(join(root, '.jeff')),
    /** @type {(err: any) => boolean} */ ((err) => err.code === 'ENOENT'),
    '.jeff/ must not exist: guard/reject must fire before any write',
  );
}

/** @param {string} prefix @returns {Promise<string>} */
async function makeBareRoot(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

/** @param {string} prefix @returns {Promise<string>} a bare mkdtemp with a real `git init -q` */
async function makeGitRoot(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  runGit(root, ['init', '-q']);
  return root;
}

/**
 * @param {string} root
 * @param {unknown} config
 */
async function seedConfig(root, config) {
  await mkdir(join(root, '.jeff'), { recursive: true });
  await writeFile(join(root, '.jeff', 'config.json'), JSON.stringify(config), 'utf8');
}

// =====================================================================
// DOCTOR — shared fixture, assertParity, byte-exact (AC1)
// =====================================================================

// --- D1: lite + active (AC1) ---
test('doctor on a lite active store matches the oracle', async () => {
  const root = await makeBareRoot('jeff-lifecycle-parity-d1-');
  try {
    await seedConfig(root, { mode: 'lite', schemaVersion: 1, system: 'jeff', active: true });
    assertParity(root, ['doctor']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- D2: full + active (AC1) ---
test('doctor on a full active store matches the oracle (no mode key, no git-hook line)', async () => {
  const root = await makeBareRoot('jeff-lifecycle-parity-d2-');
  try {
    await seedConfig(root, { schemaVersion: 1, system: 'jeff', active: true });
    assertParity(root, ['doctor']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- D3: full + inactive (AC1) ---
test('doctor on a full inactive store matches the oracle', async () => {
  const root = await makeBareRoot('jeff-lifecycle-parity-d3-');
  try {
    await seedConfig(root, { schemaVersion: 1, system: 'jeff', active: false });
    assertParity(root, ['doctor']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- D4: config absent -> degrade path, distinct oracle input, same output as D3 (AC1) ---
test('doctor with no config.json degrades to full/inactive, matching the oracle', async () => {
  const root = await makeBareRoot('jeff-lifecycle-parity-d4-');
  try {
    assertParity(root, ['doctor']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- D5: stray arg fail-closed (AC1) ---
test('doctor rejects a stray argument fail-closed, matching the oracle', async () => {
  const root = await makeBareRoot('jeff-lifecycle-parity-d5-');
  try {
    assertParity(root, ['doctor', 'zzz']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// =====================================================================
// INIT — die/reject rows, shared fixture (no mutation), assertParity + no-scaffold (AC3)
// =====================================================================

// --- I4: git guard (AC3) ---
test('init in a non-git dir dies before any write, matching the oracle', async () => {
  const root = await makeBareRoot('jeff-lifecycle-parity-i4-');
  try {
    assertParity(root, ['init']);
    await assertNoScaffold(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- I6: reject before write (AC3/AC6) ---
test('init rejects a stray argument before any write, matching the oracle', async () => {
  const root = await makeGitRoot('jeff-lifecycle-parity-i6-');
  try {
    assertParity(root, ['init', 'zzz']);
    await assertNoScaffold(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('init refuses non-object config.json instead of reporting false activation', async () => {
  const root = await makeGitRoot('jeff-lifecycle-nonobject-root-');
  try {
    await seedConfig(root, 42);

    const js = runJs(root, ['init']);
    const raw = await readFile(join(root, '.jeff', 'config.json'), 'utf8');

    assert.notEqual(js.code, 0);
    assert.match(js.stderr, /config\.json must be an object/);
    assert.equal(raw, '42');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('init refuses a symlinked .jeff/tasks before writing outside the repo', async () => {
  const root = await makeGitRoot('jeff-lifecycle-tasks-symlink-root-');
  const outside = await mkdtemp(join(tmpdir(), 'jeff-lifecycle-tasks-symlink-outside-'));
  try {
    await mkdir(join(root, '.jeff'));
    await symlink(outside, join(root, '.jeff', 'tasks'), 'dir');

    const js = runJs(root, ['init']);

    assert.notEqual(js.code, 0);
    assert.match(js.stderr, /refusing \.jeff\/tasks symlink/);
    await assert.rejects(
      stat(join(outside, '.gitkeep')),
      /** @type {(err: any) => boolean} */ ((err) => err.code === 'ENOENT'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('init refuses a .jeff symlink before writing outside the repo', async () => {
  const root = await makeGitRoot('jeff-lifecycle-symlink-root-');
  const outside = await mkdtemp(join(tmpdir(), 'jeff-lifecycle-symlink-outside-'));
  try {
    await symlink(outside, join(root, '.jeff'), 'dir');

    const js = runJs(root, ['init']);

    assert.notEqual(js.code, 0);
    assert.match(js.stderr, /refusing \.jeff symlink/);
    await assert.rejects(
      stat(join(outside, 'config.json')),
      /** @type {(err: any) => boolean} */ ((err) => err.code === 'ENOENT'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

// =====================================================================
// INIT — scaffold rows, fixture PAIR (A=oracle, B=JS), stdout normalization
// + `.jeff/` subtree parity (AC4, AC5)
// =====================================================================

/**
 * Assert the resulting `.jeff/` subtree matches byte-for-byte between the
 * two fixtures (the oracle-vs-JS parity, since A and B started identical).
 *
 * @param {string} aRoot
 * @param {string} bRoot
 */
async function assertScaffoldSubtreeParity(aRoot, bRoot) {
  const aConfig = await readFile(join(aRoot, '.jeff', 'config.json'), 'utf8');
  const bConfig = await readFile(join(bRoot, '.jeff', 'config.json'), 'utf8');
  assert.equal(bConfig, aConfig, 'config.json bytes must match between oracle and JS runs');

  for (const root of [aRoot, bRoot]) {
    const gitkeep = await readFile(join(root, '.jeff', 'tasks', '.gitkeep'), 'utf8');
    assert.equal(gitkeep, '', `.jeff/tasks/.gitkeep must be empty in ${root}`);
    assert.ok((await stat(join(root, '.jeff', 'tasks'))).isDirectory(), `.jeff/tasks/ must exist in ${root}`);
    assert.ok((await stat(join(root, '.jeff', 'memory'))).isDirectory(), `.jeff/memory/ must exist in ${root}`);
  }
}

/**
 * Run `init` on both fixtures and assert normalized stdout parity (init's
 * stdout embeds `<ROOT>`, so A!=B paths mean raw stdout is not byte-equal:
 * normalize by swapping the oracle's root for the JS root, keeping the
 * oracle as source of truth).
 *
 * @param {string} aRoot
 * @param {string} bRoot
 */
function runInitPairAndAssertStdoutParity(aRoot, bRoot) {
  const oracle = runOracle(aRoot, ['init']);
  const js = runJs(bRoot, ['init']);
  assert.equal(js.code, oracle.code, 'exit code mismatch for init');
  assert.equal(js.stderr, oracle.stderr, 'stderr mismatch for init');
  assert.equal(js.stdout, oracle.stdout.split(aRoot).join(bRoot), 'normalized stdout mismatch for init');
  return { oracle, js };
}

// --- I1: absent config (AC4) ---
test('init scaffolds an absent config with the jq-form pretty-print, matching the oracle', async () => {
  const aRoot = await makeGitRoot('jeff-lifecycle-parity-i1a-');
  const bRoot = await makeGitRoot('jeff-lifecycle-parity-i1b-');
  try {
    runInitPairAndAssertStdoutParity(aRoot, bRoot);
    await assertScaffoldSubtreeParity(aRoot, bRoot);
  } finally {
    await rm(aRoot, { recursive: true, force: true });
    await rm(bRoot, { recursive: true, force: true });
  }
});

// --- I2: existing config, `.active` present -> update in place, order preserved (AC4) ---
test('init on an existing config updates .active in place preserving key order, matching the oracle', async () => {
  const aRoot = await makeGitRoot('jeff-lifecycle-parity-i2a-');
  const bRoot = await makeGitRoot('jeff-lifecycle-parity-i2b-');
  try {
    const seed = { schemaVersion: 1, system: 'jeff', mode: 'lite', active: false };
    await seedConfig(aRoot, seed);
    await seedConfig(bRoot, seed);
    runInitPairAndAssertStdoutParity(aRoot, bRoot);
    await assertScaffoldSubtreeParity(aRoot, bRoot);
  } finally {
    await rm(aRoot, { recursive: true, force: true });
    await rm(bRoot, { recursive: true, force: true });
  }
});

// --- I3: existing config, `.active` absent -> appended last (AC4) ---
test('init on an existing config with no .active appends it last, matching the oracle', async () => {
  const aRoot = await makeGitRoot('jeff-lifecycle-parity-i3a-');
  const bRoot = await makeGitRoot('jeff-lifecycle-parity-i3b-');
  try {
    const seed = { schemaVersion: 1, system: 'jeff', mode: 'lite' };
    await seedConfig(aRoot, seed);
    await seedConfig(bRoot, seed);
    runInitPairAndAssertStdoutParity(aRoot, bRoot);
    await assertScaffoldSubtreeParity(aRoot, bRoot);
  } finally {
    await rm(aRoot, { recursive: true, force: true });
    await rm(bRoot, { recursive: true, force: true });
  }
});

// --- I5: idempotency / non-clobber across two consecutive runs (AC5) ---
test('re-running init on an already-scaffolded store is byte-stable, matching the oracle', async () => {
  const aRoot = await makeGitRoot('jeff-lifecycle-parity-i5a-');
  const bRoot = await makeGitRoot('jeff-lifecycle-parity-i5b-');
  try {
    // First run on each (setup, not itself asserted beyond exit code parity).
    const firstOracle = runOracle(aRoot, ['init']);
    const firstJs = runJs(bRoot, ['init']);
    assert.equal(firstJs.code, firstOracle.code, 'exit code mismatch for first init run');

    // Second run is the row under test.
    runInitPairAndAssertStdoutParity(aRoot, bRoot);
    await assertScaffoldSubtreeParity(aRoot, bRoot);
  } finally {
    await rm(aRoot, { recursive: true, force: true });
    await rm(bRoot, { recursive: true, force: true });
  }
});
