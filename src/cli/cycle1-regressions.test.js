// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readlink, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { collectTasks } from '../core/store.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COOK = join(REPO_ROOT, 'src', 'cli', 'cook.js');

/** @param {string} root @param {string[]} args */
function runCook(root, args) {
  const result = spawnSync(process.execPath, [COOK, ...args], {
    cwd: root,
    env: { ...process.env, COOK_ROOT: root },
    encoding: 'utf8',
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** @param {string} root @param {string[]} args */
function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function makeGitRoot() {
  const root = await mkdtemp(join(tmpdir(), 'jeff-cycle1-root-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'cycle1@example.com']);
  git(root, ['config', 'user.name', 'Cycle One']);
  await writeFile(join(root, 'plan.md'), '# Plan\n', 'utf8');
  git(root, ['add', 'plan.md']);
  git(root, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'seed']);
  return root;
}

async function assertOnlySentinel(outside) {
  assert.deepEqual(await readdir(outside), ['sentinel']);
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'outside\n');
}

test('changed store writers refuse a symlinked .jeff without outside writes', async () => {
  for (const args of [['lite'], ['deinit'], ['profile', 'init'], ['on', 'plan.md']]) {
    const root = await makeGitRoot();
    const outside = await mkdtemp(join(tmpdir(), 'jeff-cycle1-outside-'));
    try {
      await writeFile(join(outside, 'sentinel'), 'outside\n', 'utf8');
      await writeFile(join(outside, 'config.json'), JSON.stringify({ mode: 'lite', active: true }), 'utf8');
      await symlink(outside, join(root, '.jeff'), 'dir');

      const result = runCook(root, args);

      assert.notEqual(result.code, 0, `cook ${args.join(' ')} must refuse the store symlink`);
      assert.match(result.stderr, /refusing \.jeff symlink/);
      assert.deepEqual((await readdir(outside)).sort(), ['config.json', 'sentinel']);
      assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'outside\n');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  }
});

test('cook on refuses a symlinked tasks leaf without creating an outside ledger', async () => {
  const root = await makeGitRoot();
  const outside = await mkdtemp(join(tmpdir(), 'jeff-cycle1-tasks-outside-'));
  try {
    await writeFile(join(outside, 'sentinel'), 'outside\n', 'utf8');
    await mkdir(join(root, '.jeff'));
    await writeFile(join(root, '.jeff', 'config.json'), JSON.stringify({ mode: 'lite', active: true }), 'utf8');
    await symlink(outside, join(root, '.jeff', 'tasks'), 'dir');

    const result = runCook(root, ['on', 'plan.md']);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /refusing \.jeff\/tasks symlink/);
    await assertOnlySentinel(outside);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('init and lite refuse symlinked store directories before scaffolding outside', async () => {
  for (const args of [['init'], ['lite']]) {
    for (const leaf of ['tasks', 'memory']) {
      const root = await makeGitRoot();
      const outside = await mkdtemp(join(tmpdir(), 'jeff-cycle1-dir-outside-'));
      try {
        await writeFile(join(outside, 'sentinel'), 'outside\n', 'utf8');
        await mkdir(join(root, '.jeff'));
        await symlink(outside, join(root, '.jeff', leaf), 'dir');

        const result = runCook(root, args);

        assert.notEqual(result.code, 0);
        assert.match(result.stderr, new RegExp(`refusing \\.jeff/${leaf} symlink`));
        await assertOnlySentinel(outside);
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    }
  }
});

test('init, lite, and deinit refuse a config leaf escaping the repository', async () => {
  for (const args of [['init'], ['lite'], ['deinit']]) {
    const root = await makeGitRoot();
    const outside = await mkdtemp(join(tmpdir(), 'jeff-cycle1-config-outside-'));
    try {
      const target = join(outside, 'config.json');
      await writeFile(target, '{"secret":"CONFIG-SECRET-SENTINEL"}\n', 'utf8');
      await mkdir(join(root, '.jeff'));
      await symlink(target, join(root, '.jeff', 'config.json'));

      const result = runCook(root, args);

      assert.notEqual(result.code, 0);
      assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, /CONFIG-SECRET-SENTINEL/);
      assert.match(result.stderr, /refusing \.jeff\/config\.json symlink/);
      assert.equal(await readFile(target, 'utf8'), '{"secret":"CONFIG-SECRET-SENTINEL"}\n');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  }
});

test('lite and deinit fail closed on malformed and non-object config without unintended writes', async (t) => {
  const cases = [
    ['malformed JSON', '{"active":\n'],
    ['a top-level array', '[]\n'],
    ['top-level null', 'null\n'],
  ];
  for (const verb of ['lite', 'deinit']) {
    for (const [name, raw] of cases) {
      await t.test(`${verb} rejects ${name}`, async () => {
        const root = await makeGitRoot();
        try {
          const store = join(root, '.jeff');
          const exclude = join(root, '.git', 'info', 'exclude');
          await mkdir(store);
          await writeFile(join(store, 'config.json'), raw, 'utf8');
          const excludeBefore = await readFile(exclude, 'utf8');

          const result = runCook(root, [verb]);

          assert.equal(result.code, 1);
          assert.equal(result.stdout, '');
          assert.match(result.stderr, /^cook: .*config\.json.*\n$/);
          assert.doesNotMatch(result.stderr, /SyntaxError|node:internal|\n\s+at /);
          assert.equal(await readFile(join(store, 'config.json'), 'utf8'), raw);
          assert.equal(await readFile(exclude, 'utf8'), excludeBefore);
          if (verb === 'lite') {
            assert.deepEqual((await readdir(store)).sort(), ['config.json', 'memory', 'tasks']);
            assert.deepEqual(await readdir(join(store, 'tasks')), ['.gitkeep']);
            assert.deepEqual(await readdir(join(store, 'memory')), []);
          } else {
            assert.deepEqual(await readdir(store), ['config.json']);
          }
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
});

test('cook lite refuses a symlinked Git info/exclude leaf without changing outside bytes', async () => {
  const root = await makeGitRoot();
  const outside = await mkdtemp(join(tmpdir(), 'jeff-cycle1-exclude-outside-'));
  try {
    const exclude = join(root, '.git', 'info', 'exclude');
    const target = join(outside, 'exclude');
    const outsideBytes = 'OUTSIDE-EXCLUDE-SENTINEL\n';
    await writeFile(target, outsideBytes, 'utf8');
    await rm(exclude);
    await symlink(target, exclude);

    const result = runCook(root, ['lite']);

    assert.deepEqual({
      code: result.code,
      stdout: result.stdout,
      boundedError: /^cook: .*info\/exclude.*\n$/.test(result.stderr)
        && !/node:internal|\n\s+at /.test(result.stderr),
      outside: await readFile(target, 'utf8'),
      link: await readlink(exclude),
    }, {
      code: 1,
      stdout: '',
      boundedError: true,
      outside: outsideBytes,
      link: target,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('cook on refuses a derived-directory collision without replacing progressed ledger history', async () => {
  const root = await makeGitRoot();
  try {
    const tasks = join(root, '.jeff', 'tasks');
    await mkdir(tasks, { recursive: true });
    await writeFile(join(root, '.jeff', 'config.json'), '{"mode":"lite","active":true}\n', 'utf8');
    await writeFile(join(root, 'README.md'), '# Collision fixture\n', 'utf8');
    const prefix = 'a'.repeat(170);
    const firstRef = `README.md#${prefix}5OTY2TU3Gsbd`;
    const secondRef = `README.md#${prefix}a25LmoRiAk1p`;

    const first = runCook(root, ['on', firstRef]);
    assert.equal(first.code, 0, first.stderr);
    const entries = await readdir(tasks);
    assert.equal(entries.length, 1);
    const ledger = join(tasks, entries[0], 'task.json');
    const adopted = JSON.parse(await readFile(ledger, 'utf8'));
    const progressed = {
      ...adopted,
      status: 'in_progress',
      stage: 'implement',
      updatedAt: '2026-01-02T00:00:00Z',
      kickbacks: [{
        from: 'review',
        to: 'implement',
        reason: 'Progressed history must survive a colliding adoption.',
        at: '2026-01-02T00:00:00Z',
      }],
    };
    await writeFile(ledger, `${JSON.stringify(progressed, null, 2)}\n`, 'utf8');
    const before = await readFile(ledger, 'utf8');

    const second = runCook(root, ['on', secondRef]);

    const after = await readFile(ledger, 'utf8');
    assert.deepEqual({
      code: second.code,
      stdout: second.stdout,
      boundedError: /^cook: .*collision.*\n$/i.test(second.stderr)
        && !/node:internal|\n\s+at /.test(second.stderr),
      entries: await readdir(tasks),
      preserved: after === before,
      owner: JSON.parse(after).externalRef,
      status: JSON.parse(after).status,
      kickbacks: JSON.parse(after).kickbacks,
    }, {
      code: 1,
      stdout: '',
      boundedError: true,
      entries,
      preserved: true,
      owner: firstRef,
      status: 'in_progress',
      kickbacks: progressed.kickbacks,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cook profile refuses a symlinked profile leaf without leaking target bytes', async () => {
  const root = await makeGitRoot();
  const outside = await mkdtemp(join(tmpdir(), 'jeff-cycle1-profile-outside-'));
  try {
    await mkdir(join(root, '.jeff'));
    const target = join(outside, 'secret');
    await writeFile(target, 'PROFILE-SECRET-SENTINEL\n', 'utf8');
    await symlink(target, join(root, '.jeff', 'profile.md'));

    const result = runCook(root, ['profile']);

    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /PROFILE-SECRET-SENTINEL/);
    assert.match(result.stderr, /refusing \.jeff\/profile\.md symlink/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('lite verify refuses an outside profile leaf without running its test command', async () => {
  const root = await makeGitRoot();
  const outside = await mkdtemp(join(tmpdir(), 'jeff-cycle1-verify-profile-'));
  try {
    await mkdir(join(root, '.jeff'));
    await writeFile(
      join(root, '.jeff', 'config.json'),
      JSON.stringify({ schemaVersion: 1, mode: 'lite', active: true }),
      'utf8',
    );
    const sentinel = join(outside, 'executed');
    const target = join(outside, 'profile.md');
    const profile = `Test command: \`printf compromised > ${JSON.stringify(sentinel)}\`.\n`;
    await writeFile(target, profile, 'utf8');
    await symlink(target, join(root, '.jeff', 'profile.md'));

    const result = runCook(root, ['verify']);
    const sentinelCreated = await readFile(sentinel, 'utf8').then(() => true, () => false);

    assert.deepEqual({
      refused: result.code !== 0,
      stdout: result.stdout,
      sentinelCreated,
      target: await readFile(target, 'utf8'),
      link: await readlink(join(root, '.jeff', 'profile.md')),
    }, {
      refused: true,
      stdout: '',
      sentinelCreated: false,
      target: profile,
      link: target,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('collect, validate, and show refuse a readable outside task leaf without disclosure or mutation', async () => {
  const root = await makeGitRoot();
  const outside = await mkdtemp(join(tmpdir(), 'jeff-cycle1-task-leaf-'));
  const taskDir = join(root, '.jeff', 'tasks', '938475-outside-json');
  const target = join(outside, 'task.json');
  const sentinel = 'OUTSIDE-TASK-CONTENT-938475';
  const task = {
    schemaVersion: 1,
    id: 938475,
    slug: 'outside-json',
    title: sentinel,
    status: 'pending',
    stage: 'capture',
    priority: 'p2',
    deps: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    branch: null,
    agents: {
      plan_agent_id: null,
      test_author_agent_id: null,
      implementer_agent_id: null,
      reviewer_agent_id: null,
      audit_agent_id: null,
    },
    tests: { authored_by_agent_id: null, green: false, evidence: [] },
    review: { verdict: null, reviewer_agent_id: null, evidence: [] },
    audit: { required: false, verdict: 'na', audit_agent_id: null, evidence: [] },
    commits: [],
    kickbacks: [],
    blockedReason: null,
    abandonReason: null,
  };
  const targetBytes = `${JSON.stringify(task, null, 2)}\n`;
  try {
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      join(root, '.jeff', 'config.json'),
      JSON.stringify({ schemaVersion: 1, system: 'jeff', active: true }),
      'utf8',
    );
    await writeFile(target, targetBytes, 'utf8');
    await symlink(target, join(taskDir, 'task.json'));
    const beforeRepo = await readdir(taskDir);
    const beforeOutside = await readdir(outside);

    let collected = [];
    let collectRefused = false;
    try {
      collected = await collectTasks(root);
    } catch {
      collectRefused = true;
    }
    const validate = runCook(root, ['validate']);
    const show = runCook(root, ['show', String(task.id)]);

    assert.deepEqual({
      collectRefused,
      collectLeaked: JSON.stringify(collected).includes(sentinel),
      validateRefused: validate.code !== 0,
      validateLeaked: `${validate.stdout}${validate.stderr}`.includes(sentinel),
      showRefused: show.code !== 0,
      showLeaked: `${show.stdout}${show.stderr}`.includes(sentinel),
      repoMutated: JSON.stringify(await readdir(taskDir)) !== JSON.stringify(beforeRepo),
      outsideMutated: JSON.stringify(await readdir(outside)) !== JSON.stringify(beforeOutside)
        || await readFile(target, 'utf8') !== targetBytes,
      link: await readlink(join(taskDir, 'task.json')),
    }, {
      collectRefused: true,
      collectLeaked: false,
      validateRefused: true,
      validateLeaked: false,
      showRefused: true,
      showLeaked: false,
      repoMutated: false,
      outsideMutated: false,
      link: target,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('cook on names the first excess argument and creates no ledger', async () => {
  const root = await makeGitRoot();
  try {
    await mkdir(join(root, '.jeff', 'tasks'), { recursive: true });
    await writeFile(join(root, '.jeff', 'config.json'), JSON.stringify({ mode: 'lite', active: true }), 'utf8');
    const before = await readdir(join(root, '.jeff', 'tasks'));

    const result = runCook(root, ['on', 'plan.md', 'extra', 'ignored']);

    assert.deepEqual(result, {
      code: 1,
      stdout: '',
      stderr: "cook: on: unexpected argument 'extra'\n",
    });
    assert.deepEqual(await readdir(join(root, '.jeff', 'tasks')), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cook indiff names the first excess argument without changing Git state', async () => {
  const root = await makeGitRoot();
  try {
    await mkdir(join(root, '.jeff'), { recursive: true });
    await writeFile(join(root, '.jeff', 'config.json'), JSON.stringify({ mode: 'lite', active: true }), 'utf8');
    const beforeHead = git(root, ['rev-parse', 'HEAD']);
    const beforeStatus = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);

    const result = runCook(root, ['indiff', 'HEAD', 'HEAD', 'extra', 'ignored']);

    assert.deepEqual(result, {
      code: 1,
      stdout: '',
      stderr: "cook: indiff: unexpected argument 'extra'\n",
    });
    assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(git(root, ['status', '--porcelain=v1', '--untracked-files=all']), beforeStatus);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
