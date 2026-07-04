// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * Test design (.jeff/tasks/item3a-reporters/notes.md, "## Test design"):
 * one node:test differential file spawning BOTH the frozen bash oracle
 * (`skills/cook/scripts/cook.sh`) and the JS port (`src/cli/cook.js`) over
 * shared fixture stores, asserting equal raw stdout, equal raw stderr, and
 * equal exit code. The expectation is always the oracle's OWN runtime output
 * — never a hardcoded golden string — so this is a genuine differential, not
 * a change-detector. Rows map to the plan's behavior × seam × disposition
 * table; see the per-test comment for the row number.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const COOK_SH = join(REPO_ROOT, 'skills', 'cook', 'scripts', 'cook.sh');
const COOK_JS = join(REPO_ROOT, 'src', 'cli', 'cook.js');

/**
 * @param {string} root - fixture COOK_ROOT
 * @param {string[]} args - e.g. ['ls'] / ['show', '3']
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

/** @returns {Promise<string>} a fresh fixture root with an empty .jeff/tasks */
async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'jeff-reporters-parity-'));
  await mkdir(join(root, '.jeff', 'tasks'), { recursive: true });
  return root;
}

/**
 * @param {string} root
 * @param {string} dirName
 * @param {object} task
 */
async function writeTaskDir(root, dirName, task) {
  const dir = join(root, '.jeff', 'tasks', dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'task.json'), JSON.stringify(task), 'utf8');
}

/**
 * @param {string} root
 * @param {string} dirName
 * @param {string} raw
 */
async function writeRawTaskDir(root, dirName, raw) {
  const dir = join(root, '.jeff', 'tasks', dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'task.json'), raw, 'utf8');
}

/**
 * @param {object} [overrides]
 */
function task(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 1,
    slug: 'task-one',
    title: 'Task One',
    status: 'pending',
    stage: 'capture',
    priority: 'p2',
    deps: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    branch: null,
    ...overrides,
  };
}

// --- row 1: ls on empty store -> "no tasks", rc 0 (AC1) ---
test('ls on empty store matches the oracle (no tasks)', async () => {
  const root = await makeRoot();
  try {
    assertParity(root, ['ls']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- row 2: ls on populated numeric-id store, sorted numerically (AC1) ---
test('ls on a numeric-id store sorts by id numerically, matching the oracle', async () => {
  const root = await makeRoot();
  try {
    // Dir names scrambled so path order != id order; a mix of statuses.
    await writeTaskDir(root, 't-a', task({ id: 10, slug: 'ten', title: 'Ten', status: 'done' }));
    await writeTaskDir(root, 't-b', task({ id: 2, slug: 'two', title: 'Two', status: 'in_progress', stage: 'implement' }));
    await writeTaskDir(root, 't-c', task({ id: 1, slug: 'one', title: 'One', status: 'pending' }));
    assertParity(root, ['ls']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- row 2b: ls on populated string-id (lite/live) store, sorted by codepoint (AC1) ---
test('ls on a string-id (lite) store sorts by codepoint, matching the oracle', async () => {
  const root = await makeRoot();
  try {
    // Scrambled dir names so path order != id order != a numeric-NaN no-op order.
    await writeTaskDir(root, 't-item3a', task({ id: 'item3a', slug: 'item3a', title: 'Item 3a', status: 'in_progress', stage: 'test' }));
    await writeTaskDir(root, 't-3', task({ id: '#3', slug: 'ref-3', title: 'Ref 3', status: 'done' }));
    await writeTaskDir(root, 't-8', task({ id: '#8', slug: 'ref-8', title: 'Ref 8', status: 'pending' }));
    await writeTaskDir(root, 't-5', task({ id: '#5', slug: 'ref-5', title: 'Ref 5', status: 'pending' }));
    assertParity(root, ['ls']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- row 3: ls on unparseable task.json -> collect_tasks warn + rc 1 (AC1, N4) ---
//
// NOT a full byte-exact assertParity: the oracle's stderr is TWO lines (jq's
// own `jq: parse error: …` tokenizer line, then `cook: validation FAILED:
// unparseable task.json at …`); the zero-dep JS port runs without jq and can
// only reproduce the second, deterministic, port-reproducible line (plan N4:
// "reporters' unparseable line is collect_tasks's single warn … reproduce the
// single-line shape"). So this row asserts: rc parity, empty-stdout parity,
// and that JS stderr CONTAINS the oracle's own `cook: validation FAILED: …`
// line (extracted from the oracle's actual output, not a golden string — still
// a genuine differential). It stays discriminating: a missing warn line, a
// non-1 rc, or non-empty stdout still fails it.
test('ls on a store with an unparseable task.json matches the oracle warn + rc 1', async () => {
  const root = await makeRoot();
  try {
    await writeTaskDir(root, 't-ok', task({ id: 1 }));
    await writeRawTaskDir(root, 't-bad', '{ this is not valid json');

    const oracle = runOracle(root, ['ls']);
    const js = runJs(root, ['ls']);

    const warnLine = oracle.stderr.split('\n').find((line) => line.includes('cook: validation FAILED:'));
    assert.ok(warnLine, `oracle stderr did not contain the expected warn line: ${oracle.stderr}`);

    assert.equal(js.code, 1, 'JS should exit 1 on an unparseable task.json');
    assert.equal(oracle.code, 1, 'oracle should exit 1 on an unparseable task.json');
    assert.equal(js.stdout, '', 'JS should print no task lines on an unparseable store');
    assert.equal(oracle.stdout, '', 'oracle should print no task lines on an unparseable store');
    assert.ok(
      js.stderr.includes(warnLine),
      `JS stderr missing the collect-warn line.\nexpected to contain: ${warnLine}\nactual: ${js.stderr}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- row 4: status on empty store (AC2) ---
test('status on empty store matches the oracle', async () => {
  const root = await makeRoot();
  try {
    assertParity(root, ['status']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- row 5: status populated, collect order (not id-sorted), tally (AC2, N2) ---
test('status on a populated store reports in-flight lines in collect order, matching the oracle', async () => {
  const root = await makeRoot();
  try {
    // Path order (t-a, t-b) != id order (10, 2): pins N2 (status uses collect
    // order; a wrong id-sort here would go red).
    await writeTaskDir(root, 't-a', task({ id: 10, slug: 'ten', title: 'Ten', status: 'in_progress', stage: 'implement' }));
    await writeTaskDir(root, 't-b', task({ id: 2, slug: 'two', title: 'Two', status: 'in_progress', stage: 'test' }));
    await writeTaskDir(root, 't-c', task({ id: 1, slug: 'one', title: 'One', status: 'done' }));
    await writeTaskDir(root, 't-d', task({ id: 3, slug: 'three', title: 'Three', status: 'blocked' }));
    await writeTaskDir(root, 't-e', task({ id: 4, slug: 'four', title: 'Four', status: 'abandoned' }));
    assertParity(root, ['status']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- row 6: status "> 8" pending boundary, S2 (8 -> no warning) and S3 (9 -> warning) (AC2) ---
test('status shows no backlog warning at exactly 8 pending, matching the oracle', async () => {
  const root = await makeRoot();
  try {
    for (let i = 1; i <= 8; i++) {
      await writeTaskDir(root, `t-${i}`, task({ id: i, slug: `p-${i}`, title: `Pending ${i}`, status: 'pending' }));
    }
    assertParity(root, ['status']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('status shows the backlog warning at 9 pending, matching the oracle', async () => {
  const root = await makeRoot();
  try {
    for (let i = 1; i <= 9; i++) {
      await writeTaskDir(root, `t-${i}`, task({ id: i, slug: `p-${i}`, title: `Pending ${i}`, status: 'pending' }));
    }
    assertParity(root, ['status']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- row 7: show <present-id> -> pretty-printed task.json, byte-exact (AC3) ---
test('show on a present id pretty-prints byte-exact with the oracle', async () => {
  const root = await makeRoot();
  try {
    // Stressors: non-ASCII, an ampersand/angle-bracket, nested object/array.
    await writeTaskDir(root, 't-2', task({
      id: 2,
      slug: 'two',
      title: 'Café Ünïcode ☕ & <tag>',
      status: 'in_progress',
      stage: 'test',
      deps: [1],
      agents: { plan_agent_id: 'a1', implementer_agent_id: null },
      tests: { authored_by_agent_id: null, green: false, evidence: [] },
    }));
    assertParity(root, ['show', '2']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- row 8: show <missing-id> -> "no task with id <id>", rc 1 (AC3) ---
test('show on a missing id matches the oracle error + rc 1', async () => {
  const root = await makeRoot();
  try {
    await writeTaskDir(root, 't-2', task({ id: 2 }));
    assertParity(root, ['show', '999']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- row 9: show (no id) -> usage error, rc 1 (AC3) ---
test('show with no id matches the oracle usage error + rc 1', async () => {
  const root = await makeRoot();
  try {
    assertParity(root, ['show']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- row 10: show <id> <extra> -> unexpected argument error, rc 1 (AC3) ---
test('show with an extra argument matches the oracle error + rc 1', async () => {
  const root = await makeRoot();
  try {
    await writeTaskDir(root, 't-2', task({ id: 2 }));
    assertParity(root, ['show', '2', 'extra']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- row 11: unknown subcommand rejected fail-closed (rc != 0 only) (AC4) ---
test('an unknown subcommand is rejected fail-closed by both the oracle and the JS port', async () => {
  const root = await makeRoot();
  try {
    const oracle = runOracle(root, ['bogus']);
    const js = runJs(root, ['bogus']);
    assert.notEqual(oracle.code, 0, 'oracle should reject an unknown subcommand');
    assert.notEqual(js.code, 0, 'JS port should reject an unknown subcommand');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
