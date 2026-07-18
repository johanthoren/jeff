// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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
