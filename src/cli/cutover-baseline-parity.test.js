// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORACLE = join(ROOT, 'tests', 'fixtures', 'cook-baseline.sh');
const ORACLE_SHA256 = 'c1744abf1543cf3131add20182ecd669447d3dc3df13015b6e498ae1d59ec2f0';
const COOK = join(ROOT, 'src', 'cli', 'cook.js');

/** @param {string} root @param {string[]} args @param {boolean} oracle */
function run(root, args, oracle) {
  const command = oracle ? 'bash' : process.execPath;
  const argv = oracle ? [ORACLE, ...args] : [COOK, ...args];
  const result = spawnSync(command, argv, {
    cwd: root,
    env: { ...process.env, COOK_ROOT: root },
    encoding: 'utf8',
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** @param {string} value @param {string} from @param {string} to */
function normalize(value, from, to) {
  return value.split(from).join(to);
}

/** @param {string} oracleRoot @param {string} nodeRoot @param {string[]} args */
function assertPair(oracleRoot, nodeRoot, args) {
  const expected = run(oracleRoot, args, true);
  const actual = run(nodeRoot, args, false);
  assert.deepEqual(actual, {
    code: expected.code,
    stdout: normalize(expected.stdout, oracleRoot, nodeRoot),
    stderr: normalize(expected.stderr, oracleRoot, nodeRoot),
  }, `parity failed for cook ${args.join(' ')}`);
}

/** @param {string} root @param {string[]} args */
function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'Parity',
      GIT_AUTHOR_EMAIL: 'parity@example.com',
      GIT_COMMITTER_NAME: 'Parity',
      GIT_COMMITTER_EMAIL: 'parity@example.com',
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** @param {boolean} repository */
async function makeRoot(repository = true) {
  const root = await mkdtemp(join(tmpdir(), 'jeff-cutover-parity-'));
  if (repository) git(root, ['init', '-q']);
  return root;
}

/** @param {string} root @param {Record<string, unknown>} config */
async function seedConfig(root, config) {
  await mkdir(join(root, '.jeff', 'tasks'), { recursive: true });
  await writeFile(join(root, '.jeff', 'config.json'), JSON.stringify(config), 'utf8');
}

/** @param {(oracleRoot: string, nodeRoot: string) => Promise<void>} body @param {boolean} repository */
async function withPair(body, repository = true) {
  const oracleRoot = await makeRoot(repository);
  const nodeRoot = await makeRoot(repository);
  try {
    await body(oracleRoot, nodeRoot);
  } finally {
    await rm(oracleRoot, { recursive: true, force: true });
    await rm(nodeRoot, { recursive: true, force: true });
  }
}

test('immutable oracle fixture is the complete cycle-1 Bash baseline', async () => {
  const text = await readFile(ORACLE, 'utf8');
  assert.equal(createHash('sha256').update(text).digest('hex'), ORACLE_SHA256, 'oracle bytes from a10b7ea changed');
  assert.match(text, /^#!\/usr\/bin\/env bash\n/);
  for (const verb of ['cmd_lite', 'cmd_on', 'cmd_indiff', 'cmd_deinit', 'cmd_profile']) {
    assert.match(text, new RegExp(`^${verb}\\(\\)`, 'm'));
  }
  assert.match(text, /if \[ "\$\{COOK_SOURCE_ONLY:-0\}" != "1" \]/);
});

test('lite preserves baseline streams, exit codes, scaffolding, idempotency, and strict args', async () => {
  await withPair(async (oracleRoot, nodeRoot) => {
    assertPair(oracleRoot, nodeRoot, ['lite', 'extra']);
    assert.equal((await readdir(oracleRoot)).includes('.jeff'), false);
    assert.equal((await readdir(nodeRoot)).includes('.jeff'), false);
    assertPair(oracleRoot, nodeRoot, ['lite']);
    assertPair(oracleRoot, nodeRoot, ['lite']);
    assert.equal(await readFile(join(nodeRoot, '.jeff', 'config.json'), 'utf8'), await readFile(join(oracleRoot, '.jeff', 'config.json'), 'utf8'));
    assert.equal(await readFile(join(nodeRoot, '.git', 'info', 'exclude'), 'utf8'), await readFile(join(oracleRoot, '.git', 'info', 'exclude'), 'utf8'));
    assert.ok((await stat(join(nodeRoot, '.jeff', 'memory'))).isDirectory());
  });
  await withPair(async (oracleRoot, nodeRoot) => {
    assertPair(oracleRoot, nodeRoot, ['lite']);
  }, false);
});

test('on preserves baseline argument, mode, ref, adoption, and resume behavior', async () => {
  await withPair(async (oracleRoot, nodeRoot) => {
    assertPair(oracleRoot, nodeRoot, ['on', 'plan.md']);
    await seedConfig(oracleRoot, { schemaVersion: 1, mode: 'lite', active: true });
    await seedConfig(nodeRoot, { schemaVersion: 1, mode: 'lite', active: true });
    assertPair(oracleRoot, nodeRoot, ['on']);
    assertPair(oracleRoot, nodeRoot, ['on', 'plan.md', 'extra']);
    assertPair(oracleRoot, nodeRoot, ['on', 'missing.md']);
    await writeFile(join(oracleRoot, 'plan.md'), '# Plan\n', 'utf8');
    await writeFile(join(nodeRoot, 'plan.md'), '# Plan\n', 'utf8');
    assertPair(oracleRoot, nodeRoot, ['on', 'plan.md']);
    assertPair(oracleRoot, nodeRoot, ['on', 'plan.md']);
    const oracleTask = (await readdir(join(oracleRoot, '.jeff', 'tasks'))).find((name) => name !== '.gitkeep');
    const nodeTask = (await readdir(join(nodeRoot, '.jeff', 'tasks'))).find((name) => name !== '.gitkeep');
    assert.equal(nodeTask, oracleTask);
    const expected = JSON.parse(await readFile(join(oracleRoot, '.jeff', 'tasks', oracleTask, 'task.json'), 'utf8'));
    const actual = JSON.parse(await readFile(join(nodeRoot, '.jeff', 'tasks', nodeTask, 'task.json'), 'utf8'));
    delete expected.createdAt;
    delete expected.updatedAt;
    delete actual.createdAt;
    delete actual.updatedAt;
    assert.deepEqual(actual, expected);
  });
});

test('indiff preserves baseline mode, argument, bad-ref, subset, and excess-file verdicts', async () => {
  const root = await makeRoot();
  try {
    await writeFile(join(root, 'a.txt'), 'base\n', 'utf8');
    git(root, ['add', 'a.txt']);
    git(root, ['commit', '-q', '-m', 'base']);
    const base = git(root, ['rev-parse', 'HEAD']);
    await writeFile(join(root, 'a.txt'), 'implement\n', 'utf8');
    await writeFile(join(root, 'b.txt'), 'implement\n', 'utf8');
    git(root, ['add', 'a.txt', 'b.txt']);
    git(root, ['commit', '-q', '-m', 'implement']);
    const pre = git(root, ['rev-parse', 'HEAD']);

    assert.deepEqual(run(root, ['indiff', base, pre], false), run(root, ['indiff', base, pre], true));
    await seedConfig(root, { schemaVersion: 1, mode: 'lite', active: true });
    for (const args of [['indiff'], ['indiff', base, pre, 'extra'], ['indiff', 'missing', pre]]) {
      assert.deepEqual(run(root, args, false), run(root, args, true));
    }
    await writeFile(join(root, 'a.txt'), 'refactor\n', 'utf8');
    assert.deepEqual(run(root, ['indiff', base, pre], false), run(root, ['indiff', base, pre], true));
    await writeFile(join(root, 'outside.txt'), 'outside\n', 'utf8');
    assert.deepEqual(run(root, ['indiff', base, pre], false), run(root, ['indiff', base, pre], true));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('deinit preserves baseline absent, active, repeated, and strict-argument behavior', async () => {
  await withPair(async (oracleRoot, nodeRoot) => {
    assertPair(oracleRoot, nodeRoot, ['deinit', 'extra']);
    assertPair(oracleRoot, nodeRoot, ['deinit']);
    await seedConfig(oracleRoot, { schemaVersion: 1, system: 'jeff', active: true });
    await seedConfig(nodeRoot, { schemaVersion: 1, system: 'jeff', active: true });
    assertPair(oracleRoot, nodeRoot, ['deinit']);
    assertPair(oracleRoot, nodeRoot, ['deinit']);
    assert.equal(await readFile(join(nodeRoot, '.jeff', 'config.json'), 'utf8'), await readFile(join(oracleRoot, '.jeff', 'config.json'), 'utf8'));
  });
});

test('profile preserves baseline streams, conformance, no-clobber, and strict args for regular files', async () => {
  await withPair(async (oracleRoot, nodeRoot) => {
    assertPair(oracleRoot, nodeRoot, ['profile']);
    assertPair(oracleRoot, nodeRoot, ['profile', 'unknown']);
    assertPair(oracleRoot, nodeRoot, ['profile', 'init', 'extra']);
    assertPair(oracleRoot, nodeRoot, ['profile', 'init']);
    assertPair(oracleRoot, nodeRoot, ['profile']);
    assertPair(oracleRoot, nodeRoot, ['profile', 'init']);
    assert.equal(await readFile(join(nodeRoot, '.jeff', 'profile.md'), 'utf8'), await readFile(join(oracleRoot, '.jeff', 'profile.md'), 'utf8'));
  });
  await withPair(async (oracleRoot, nodeRoot) => {
    await mkdir(join(oracleRoot, '.jeff'));
    await mkdir(join(nodeRoot, '.jeff'));
    await writeFile(join(oracleRoot, '.jeff', 'profile.md'), 'invalid\n', 'utf8');
    await writeFile(join(nodeRoot, '.jeff', 'profile.md'), 'invalid\n', 'utf8');
    assertPair(oracleRoot, nodeRoot, ['profile']);
  });
});

test('help destination keeps all four successful entry forms on one exact Node stream', () => {
  const forms = [[], ['help'], ['-h'], ['--help']];
  const results = forms.map((args) => run(ROOT, args, false));
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal(results[0].code, 0);
  assert.equal(results[0].stderr, '');
  assert.match(results[0].stdout, /lite[\s\S]*on <ref>[\s\S]*indiff[\s\S]*deinit[\s\S]*profile/);
});
