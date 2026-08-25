// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { appendTaskJournal } from './journal.js';
import { runVerify } from './verify.js';
/** @returns {Promise<typeof import('./integration-root.js')>} */
function loadIntegrationRoot() {
  return import('./integration-root.js');
}

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Jeff Test',
  GIT_AUTHOR_EMAIL: 'test@jeff.example',
  GIT_COMMITTER_NAME: 'Jeff Test',
  GIT_COMMITTER_EMAIL: 'test@jeff.example',
};

const COOK_JS = join(dirname(fileURLToPath(import.meta.url)), '../cli/cook.js');

const DIRTY_REL = 'unrelated-state-root.txt';
const DIRTY_CONTENTS = 'state-root dirt that must survive checkout create\n';

/** @param {string} root @param {string[]} args */
function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], { env: GIT_ENV, encoding: 'utf8' });
}

/** @param {string} root @param {string[]} args */
function gitOk(root, args) {
  const result = git(root, args);
  assert.equal(result.status, 0, result.stderr);
  return (result.stdout ?? '').trim();
}

/** @param {string} root @param {string[]} args @param {string} cwd */
function runCook(root, args, cwd) {
  const result = spawnSync(process.execPath, [COOK_JS, ...args], {
    cwd,
    env: { ...GIT_ENV, COOK_ROOT: root },
    encoding: 'utf8',
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** @param {string} root */
function snapshotStateRoot(root) {
  return {
    branch: gitOk(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    head: gitOk(root, ['rev-parse', 'HEAD']),
    trunk: gitOk(root, ['rev-parse', 'master']),
    status: gitOk(root, ['status', '--porcelain']),
  };
}

/**
 * @param {'lite' | 'full'} mode
 * @returns {Promise<{ root: string, taskDir: string, trunkOid: string, featureHead: string }>}
 */
async function makeDirtyOffTrunkRoot(mode) {
  const root = await mkdtemp(join(tmpdir(), 'jeff-integration-root-'));
  const taskDir = join(root, '.jeff', 'tasks', '018-record-specialists');
  await mkdir(taskDir, { recursive: true });
  const config = mode === 'lite'
    ? { schemaVersion: 1, mode: 'lite', active: true }
    : { schemaVersion: 1, active: true, testCommand: 'true' };
  await writeFile(join(root, '.jeff', 'config.json'), `${JSON.stringify(config)}\n`, 'utf8');
  if (mode === 'lite') {
    await writeFile(join(root, '.jeff', 'profile.md'), 'Test command: `true`.\n', 'utf8');
  }
  await writeFile(join(taskDir, 'task.json'), `${JSON.stringify({
    schemaVersion: 1,
    id: 18,
    slug: 'record-specialists',
    title: 'Record specialists',
    status: 'in_progress',
    stage: 'review',
    priority: 'p2',
    deps: [],
    complexity: 'simple',
    createdAt: '2026-07-12T00:00:00Z',
    updatedAt: '2026-07-12T00:00:00Z',
    agents: {
      implementer_agent_id: 'implementer',
      reviewer_agent_id: null,
      reviewer2_agent_id: null,
      audit_agent_id: null,
    },
    tests: { authored_by_agent_id: 'plan-agent', green: false, evidence: [] },
    review: { verdict: null, reviewer_agent_id: null, findings: [], evidence: [] },
    audit: { required: false, verdict: 'na', audit_agent_id: null, findings: [], evidence: [] },
    commits: [],
    kickbacks: [],
    convergence: {
      cap: 2,
      stages: { review: { blockingKickbacks: 0 }, audit: { blockingKickbacks: 0 } },
      council: { convened: false, stage: null, members: [], findings: [], verdict: null, outcome: null },
    },
    blockedReason: null,
    abandonReason: null,
  }, null, 2)}\n`, 'utf8');

  gitOk(root, ['init', '-q', '-b', 'master']);
  gitOk(root, ['config', 'user.email', 'test@jeff.example']);
  gitOk(root, ['config', 'user.name', 'Jeff Test']);
  gitOk(root, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(root, 'seed.txt'), 'seed\n', 'utf8');
  gitOk(root, ['add', 'seed.txt', '.jeff/config.json']);
  gitOk(root, ['commit', '-qm', 'trunk seed']);
  const trunkOid = gitOk(root, ['rev-parse', 'HEAD']);

  gitOk(root, ['checkout', '-q', '-b', 'task/284']);
  await writeFile(join(root, 'feature.txt'), 'lane work\n', 'utf8');
  gitOk(root, ['add', 'feature.txt']);
  gitOk(root, ['commit', '-qm', 'feature commit']);
  const featureHead = gitOk(root, ['rev-parse', 'HEAD']);
  await writeFile(join(root, DIRTY_REL), DIRTY_CONTENTS, 'utf8');

  return { root, taskDir, trunkOid, featureHead };
}

test('createIntegrationCheckout leaves a dirty off-trunk state root unchanged in both modes', async (t) => {
  for (const mode of /** @type {const} */ (['lite', 'full'])) {
    await t.test(mode, async () => {
      const { root, trunkOid, featureHead } = await makeDirtyOffTrunkRoot(mode);
      try {
        const { createIntegrationCheckout } = await loadIntegrationRoot();
        const before = snapshotStateRoot(root);
        const created = await createIntegrationCheckout(root, { trunkRef: 'master', taskId: '18' });
        const after = snapshotStateRoot(root);

        assert.equal(created.trunkOid, trunkOid);
        assert.equal(gitOk(created.checkoutRoot, ['rev-parse', 'HEAD']), trunkOid);
        assert.equal(gitOk(created.checkoutRoot, ['status', '--porcelain']), '');
        assert.notEqual(created.checkoutRoot, root);
        assert.deepEqual(after, before);
        assert.equal(after.branch, 'task/284');
        assert.equal(after.head, featureHead);
        assert.equal(await readFile(join(root, DIRTY_REL), 'utf8'), DIRTY_CONTENTS);
        assert.match(after.status, /unrelated-state-root\.txt/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('createIntegrationCheckout failure leaves the state root untouched', async () => {
  const { root, featureHead } = await makeDirtyOffTrunkRoot('full');
  try {
    const { createIntegrationCheckout } = await loadIntegrationRoot();
    const before = snapshotStateRoot(root);
    const beforeTask = await readFile(join(root, '.jeff', 'tasks', '018-record-specialists', 'task.json'), 'utf8');
    await assert.rejects(
      () => createIntegrationCheckout(root, { trunkRef: 'no-such-trunk', taskId: '18' }),
    );
    assert.deepEqual(snapshotStateRoot(root), before);
    assert.equal(gitOk(root, ['rev-parse', '--abbrev-ref', 'HEAD']), 'task/284');
    assert.equal(gitOk(root, ['rev-parse', 'HEAD']), featureHead);
    assert.equal(await readFile(join(root, DIRTY_REL), 'utf8'), DIRTY_CONTENTS);
    assert.equal(
      await readFile(join(root, '.jeff', 'tasks', '018-record-specialists', 'task.json'), 'utf8'),
      beforeTask,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('task-state after create still lives only on the state root store', async () => {
  const { root, taskDir } = await makeDirtyOffTrunkRoot('lite');
  try {
    const { createIntegrationCheckout } = await loadIntegrationRoot();
    const beforeTask = await readFile(join(taskDir, 'task.json'), 'utf8');
    const created = await createIntegrationCheckout(root, { trunkRef: 'master', taskId: '18' });
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), beforeTask);
    await assert.rejects(() => readFile(join(created.checkoutRoot, '.jeff', 'tasks', '018-record-specialists', 'task.json'), 'utf8'));

    await appendTaskJournal(root, '18', { event: 'intent', stage: 'review', note: 'state-root store write' });
    const journal = await readFile(join(taskDir, 'journal.jsonl'), 'utf8');
    assert.match(journal, /state-root store write/);
    await assert.rejects(() => readFile(join(created.checkoutRoot, '.jeff', 'tasks', '018-record-specialists', 'journal.jsonl'), 'utf8'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runVerify --task lite binds the task-lane HEAD not trunk', async () => {
  const { root, taskDir, trunkOid, featureHead } = await makeDirtyOffTrunkRoot('lite');
  const laneHome = await mkdtemp(join(tmpdir(), 'jeff-lite-lane-'));
  const lane = join(laneHome, 'checkout');
  try {
    gitOk(root, ['checkout', '-q', 'master']);
    gitOk(root, ['worktree', 'add', '--detach', '-q', lane, featureHead]);
    assert.equal(gitOk(root, ['rev-parse', 'HEAD']), trunkOid);
    assert.equal(gitOk(lane, ['rev-parse', 'HEAD']), featureHead);
    assert.equal(gitOk(lane, ['status', '--porcelain']), '');

    const before = snapshotStateRoot(root);
    const verification = await runVerify(root, '18', { checkpointRoot: lane });
    assert.equal(verification.code, 0, verification.stderr?.join?.('\n') ?? verification.stderr);

    const gated = JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf8'));
    assert.equal(gated.tests.gate.hash, featureHead);
    assert.notEqual(gated.tests.gate.hash, trunkOid);
    assert.equal(gated.tests.gate.clean, true);
    assert.equal(gated.tests.green, true);
    assert.equal(gitOk(root, ['rev-parse', '--abbrev-ref', 'HEAD']), before.branch);
    assert.equal(gitOk(root, ['rev-parse', 'HEAD']), before.head);
    assert.equal(gitOk(root, ['rev-parse', 'master']), before.trunk);
    assert.equal(await readFile(join(root, DIRTY_REL), 'utf8'), DIRTY_CONTENTS);
    assert.match(gitOk(root, ['status', '--porcelain']), /unrelated-state-root\.txt/);
  } finally {
    git(root, ['worktree', 'remove', '--force', lane]);
    await rm(laneHome, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('runVerify --task full binds the integrated HEAD not the bare trunk checkout', async () => {
  const { root, taskDir, trunkOid, featureHead } = await makeDirtyOffTrunkRoot('full');
  const checkoutHome = await mkdtemp(join(tmpdir(), 'jeff-full-integrate-'));
  const checkout = join(checkoutHome, 'checkout');
  try {
    gitOk(root, ['worktree', 'add', '--detach', '-q', checkout, trunkOid]);
    gitOk(checkout, ['merge', '--no-ff', '-m', 'integrate task lane', featureHead]);
    const integrated = gitOk(checkout, ['rev-parse', 'HEAD']);
    assert.notEqual(integrated, trunkOid);
    assert.notEqual(integrated, featureHead);
    assert.equal(gitOk(checkout, ['status', '--porcelain']), '');

    const before = snapshotStateRoot(root);
    const verification = await runVerify(root, '18', { checkpointRoot: checkout });
    assert.equal(verification.code, 0, verification.stderr?.join?.('\n') ?? verification.stderr);

    const gated = JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf8'));
    assert.equal(gated.tests.gate.hash, integrated);
    assert.notEqual(gated.tests.gate.hash, trunkOid);
    assert.notEqual(gated.tests.gate.hash, featureHead);
    assert.equal(gated.tests.gate.clean, true);
    assert.equal(gated.tests.green, true);
    assert.equal(gitOk(root, ['rev-parse', '--abbrev-ref', 'HEAD']), before.branch);
    assert.equal(gitOk(root, ['rev-parse', 'HEAD']), featureHead);
    assert.equal(gitOk(root, ['rev-parse', 'master']), before.trunk);
    assert.equal(await readFile(join(root, DIRTY_REL), 'utf8'), DIRTY_CONTENTS);
    assert.match(gitOk(root, ['status', '--porcelain']), /unrelated-state-root\.txt/);
  } finally {
    git(root, ['worktree', 'remove', '--force', checkout]);
    await rm(checkoutHome, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 284 cook verify --task binds cwd checkout HEAD not COOK_ROOT', async () => {
  const { root, taskDir, trunkOid, featureHead } = await makeDirtyOffTrunkRoot('full');
  const checkoutHome = await mkdtemp(join(tmpdir(), 'jeff-cli-checkpoint-'));
  const checkout = join(checkoutHome, 'checkout');
  try {
    gitOk(root, ['worktree', 'add', '--detach', '-q', checkout, trunkOid]);
    gitOk(checkout, ['merge', '--no-ff', '-m', 'integrate task lane', featureHead]);
    const integrated = gitOk(checkout, ['rev-parse', 'HEAD']);
    assert.notEqual(integrated, trunkOid);
    assert.notEqual(integrated, featureHead);
    assert.equal(gitOk(checkout, ['status', '--porcelain']), '');

    await writeFile(join(root, '.jeff', 'config.json'), `${JSON.stringify({
      schemaVersion: 1,
      active: true,
      testCommand: `test "$(git rev-parse HEAD)" = '${integrated}' && printf ran > "$COOK_ROOT/.jeff/suite-ran"`,
    })}\n`, 'utf8');

    const before = snapshotStateRoot(root);
    const verification = runCook(root, ['verify', '--task', '18'], checkout);
    assert.equal(verification.code, 0, verification.stderr);

    const gated = JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf8'));
    assert.equal(gated.tests.gate.hash, integrated);
    assert.notEqual(gated.tests.gate.hash, trunkOid);
    assert.notEqual(gated.tests.gate.hash, featureHead);
    assert.notEqual(gated.tests.gate.hash, before.head);
    assert.equal(gated.tests.gate.clean, true);
    assert.equal(gated.tests.green, true);
    assert.equal(await readFile(join(root, '.jeff', 'suite-ran'), 'utf8'), 'ran');
    await assert.rejects(() => readFile(join(checkout, '.jeff', 'suite-ran'), 'utf8'));
    await assert.rejects(() => readFile(join(checkout, '.jeff', 'tasks', '018-record-specialists', 'task.json'), 'utf8'));
    await assert.rejects(() => readFile(join(checkout, '.jeff', 'tasks', '018-record-specialists', 'journal.jsonl'), 'utf8'));
    await assert.rejects(() => readFile(join(checkout, '.jeff', '.record-lock'), 'utf8'));
    assert.match(await readFile(join(taskDir, 'journal.jsonl'), 'utf8'), /"event":"gate"/);
    assert.equal(gitOk(root, ['rev-parse', '--abbrev-ref', 'HEAD']), before.branch);
    assert.equal(gitOk(root, ['rev-parse', 'HEAD']), featureHead);
    assert.equal(gitOk(root, ['rev-parse', 'master']), before.trunk);
    assert.equal(await readFile(join(root, DIRTY_REL), 'utf8'), DIRTY_CONTENTS);
    assert.match(gitOk(root, ['status', '--porcelain']), /unrelated-state-root\.txt/);
  } finally {
    git(root, ['worktree', 'remove', '--force', checkout]);
    await rm(checkoutHome, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('full-mode compare-and-swap from the integration checkout advances trunk without moving the state root', async () => {
  const { root, trunkOid, featureHead } = await makeDirtyOffTrunkRoot('full');
  try {
    const { createIntegrationCheckout, compareAndSwapTrunk } = await loadIntegrationRoot();
    const created = await createIntegrationCheckout(root, { trunkRef: 'master', taskId: '18' });
    await writeFile(join(created.checkoutRoot, 'landed.txt'), 'gated checkpoint\n', 'utf8');
    gitOk(created.checkoutRoot, ['add', 'landed.txt']);
    gitOk(created.checkoutRoot, ['commit', '-qm', 'gated integration']);
    const gated = gitOk(created.checkoutRoot, ['rev-parse', 'HEAD']);
    assert.notEqual(gated, trunkOid);

    const before = snapshotStateRoot(root);
    await compareAndSwapTrunk({
      checkoutRoot: created.checkoutRoot,
      trunkRef: 'master',
      expectedOld: trunkOid,
      next: gated,
    });

    assert.equal(gitOk(root, ['rev-parse', 'master']), gated);
    assert.equal(gitOk(root, ['rev-parse', '--abbrev-ref', 'HEAD']), 'task/284');
    assert.equal(gitOk(root, ['rev-parse', 'HEAD']), featureHead);
    assert.equal(await readFile(join(root, DIRTY_REL), 'utf8'), DIRTY_CONTENTS);
    assert.equal(gitOk(root, ['status', '--porcelain']), before.status);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stale trunk compare-and-swap from the integration checkout leaves trunk and the state root untouched', async () => {
  const { root, trunkOid, featureHead } = await makeDirtyOffTrunkRoot('full');
  try {
    const { createIntegrationCheckout, compareAndSwapTrunk } = await loadIntegrationRoot();
    const created = await createIntegrationCheckout(root, { trunkRef: 'master', taskId: '18' });
    await writeFile(join(created.checkoutRoot, 'landed.txt'), 'gated checkpoint\n', 'utf8');
    gitOk(created.checkoutRoot, ['add', 'landed.txt']);
    gitOk(created.checkoutRoot, ['commit', '-qm', 'gated integration']);
    const gated = gitOk(created.checkoutRoot, ['rev-parse', 'HEAD']);

    gitOk(root, ['update-ref', 'refs/heads/master', featureHead]);
    const before = snapshotStateRoot(root);
    await assert.rejects(() => compareAndSwapTrunk({
      checkoutRoot: created.checkoutRoot,
      trunkRef: 'master',
      expectedOld: trunkOid,
      next: gated,
    }));

    assert.equal(gitOk(root, ['rev-parse', 'master']), featureHead);
    assert.deepEqual(snapshotStateRoot(root), before);
    assert.equal(gitOk(root, ['rev-parse', 'HEAD']), featureHead);
    assert.equal(await readFile(join(root, DIRTY_REL), 'utf8'), DIRTY_CONTENTS);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
