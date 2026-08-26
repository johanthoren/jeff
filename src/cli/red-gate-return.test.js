// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const COOK_JS = join(HERE, 'cook.js');

/** @param {Record<string, any>} [overrides] @returns {any} */
function canonicalTask(overrides = {}) {
  return {
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
    ...overrides,
  };
}

/** @param {Record<string, any>} [overrides] @returns {any} */
function operationTask(overrides = {}) {
  return {
    schemaVersion: 1,
    operationStateVersion: 1,
    id: 18,
    slug: 'record-operation',
    title: 'Record operation',
    category: 'operation',
    status: 'in_progress',
    stage: 'verify',
    priority: 'p2',
    deps: [],
    complexity: 'simple',
    createdAt: '2026-07-12T00:00:00Z',
    updatedAt: '2026-07-12T00:00:00Z',
    agents: {
      executor_agent_id: 'executor',
      verifier_agent_id: null,
      audit_agent_id: null,
    },
    audit: { required: false, verdict: 'na', audit_agent_id: null, findings: [], evidence: [] },
    commits: [],
    kickbacks: [],
    convergence: {
      cap: 2,
      stages: { verify: { blockingKickbacks: 0 }, audit: { blockingKickbacks: 0 } },
      council: { convened: false, stage: null, members: [], findings: [], verdict: null, outcome: null },
    },
    blockedReason: null,
    abandonReason: null,
    ...overrides,
  };
}

/** @param {any} [task] */
async function makeRoot(task = canonicalTask()) {
  const root = await mkdtemp(join(tmpdir(), 'jeff-red-gate-'));
  const taskDir = join(root, '.jeff', 'tasks', '018-record-specialists');
  await mkdir(taskDir, { recursive: true });
  await writeFile(join(root, '.jeff', 'config.json'), JSON.stringify({ mode: 'lite' }), 'utf8');
  await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  return { root, taskDir };
}

/** @param {string} root @param {string[]} args */
function runCook(root, args) {
  const result = spawnSync(process.execPath, [COOK_JS, ...args], {
    cwd: root,
    env: { ...process.env, COOK_ROOT: root },
    encoding: 'utf8',
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** @param {string} root @param {string[]} args */
function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** @param {string} taskDir */
async function readTask(taskDir) {
  return JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf8'));
}

/** @param {string} root */
function initRepo(root) {
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.email', 'tests@example.com']);
  runGit(root, ['config', 'user.name', 'Tests']);
  runGit(root, ['config', 'commit.gpgsign', 'false']);
}

/**
 * @param {string} root
 * @param {string} taskDir
 * @param {string} command
 */
async function stampGate(root, taskDir, command) {
  const task = await readTask(taskDir);
  const green = command === 'true';
  task.tests = {
    ...task.tests,
    green,
    evidence: [
      ...task.tests.evidence,
      { command, output: green ? `cook: verify green (${command})` : `cook: verify red (exit 1): ${command}` },
    ],
    gate: {
      hash: runGit(root, ['rev-parse', 'HEAD']),
      clean: true,
      green,
      command,
      at: '2026-07-12T01:00:00Z',
    },
  };
  await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
}

/**
 * @param {string} root
 * @param {string} command
 */
async function bindRedVerify(root, command = 'false') {
  await writeFile(join(root, '.jeff', 'profile.md'), `Test command: \`${command}\`\n`, 'utf8');
  initRepo(root);
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-qm', 'baseline']);
  const hash = runGit(root, ['rev-parse', 'HEAD']);
  const result = runCook(root, ['verify', '--task', '18']);
  return { result, hash, command };
}

test('issue 293 red verify writes gate evidence without a review return', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const before = await readTask(taskDir);
    const { result, hash, command } = await bindRedVerify(root);
    const gated = await readTask(taskDir);

    assert.notEqual(result.code, 0, result.stdout);
    assert.match(result.stderr, /cook: verify red/);
    assert.deepEqual({
      stage: gated.stage,
      green: gated.tests.green,
      evidence: gated.tests.evidence,
      gate: {
        hash: gated.tests.gate.hash,
        clean: gated.tests.gate.clean,
        green: gated.tests.gate.green,
        command: gated.tests.gate.command,
      },
      review: gated.review,
      kickbacks: gated.kickbacks,
    }, {
      stage: 'review',
      green: false,
      evidence: [{
        command,
        output: `cook: verify red (exit ${result.code}): ${command}`,
      }],
      gate: {
        hash,
        clean: true,
        green: false,
        command,
      },
      review: before.review,
      kickbacks: before.kickbacks,
    });
    assert.equal(typeof gated.tests.gate.at, 'string');
    assert.ok(gated.tests.gate.at.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 293 return records implement after a red task-bound gate', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const { result: verify } = await bindRedVerify(root);
    assert.notEqual(verify.code, 0, verify.stdout);
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    const result = runCook(root, ['return', '18', 'implement']);
    const returned = await readTask(taskDir);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(returned.stage, 'implement');
    assert.equal(returned.tests.gate.green, false);
    assert.equal(returned.review.verdict, null);
    assert.deepEqual(returned.review.findings, []);
    const kickback = returned.kickbacks.at(-1);
    assert.equal(kickback.from, 'verify');
    assert.equal(kickback.to, 'implement');
    assert.equal(typeof kickback.reason, 'string');
    assert.ok(kickback.reason.length > 0);
    assert.notEqual(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 293 return records plan after a red task-bound gate', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const { result: verify } = await bindRedVerify(root);
    assert.notEqual(verify.code, 0, verify.stdout);

    const result = runCook(root, ['return', '18', 'plan']);
    const returned = await readTask(taskDir);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(returned.stage, 'plan');
    assert.equal(returned.tests.gate.green, false);
    assert.equal(returned.review.verdict, null);
    const kickback = returned.kickbacks.at(-1);
    assert.equal(kickback.from, 'verify');
    assert.equal(kickback.to, 'plan');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 293 return rejects a missing latest gate without changing the task', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const result = runCook(root, ['return', '18', 'implement']);
    assert.notEqual(result.code, 0);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 293 return rejects a green latest gate without changing the task', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    initRepo(root);
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'baseline']);
    await stampGate(root, taskDir, 'true');
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    const result = runCook(root, ['return', '18', 'plan']);
    assert.notEqual(result.code, 0);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 293 return rejects any target other than implement or plan', async (t) => {
  for (const target of ['review', 'audit', 'refactor', 'execute', 'capture', 'done']) {
    await t.test(target, async () => {
      const { root, taskDir } = await makeRoot();
      try {
        initRepo(root);
        runGit(root, ['add', '.']);
        runGit(root, ['commit', '-qm', 'baseline']);
        await stampGate(root, taskDir, 'false');
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');

        const result = runCook(root, ['return', '18', target]);
        assert.notEqual(result.code, 0);
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 293 return rejects an operation task without changing the task', async () => {
  const { root, taskDir } = await makeRoot(operationTask());
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const result = runCook(root, ['return', '18', 'implement']);
    assert.notEqual(result.code, 0);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 293 review still requires a green latest gate', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const { result: verify } = await bindRedVerify(root);
    assert.notEqual(verify.code, 0, verify.stdout);
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const file = join(root, 'return.json');
    await writeFile(file, `${JSON.stringify({
      stage: 'review',
      cycle: 0,
      verdict: 'needs-work',
      acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: true }],
      findings: [{
        file: 'src/core/verify.js',
        line: 1,
        severity: 'high',
        class: 'blocking',
        kickTo: 'implement',
        what: 'full suite is red',
        why: 'manufactured review return',
      }],
      evidence: [{ command: 'cook verify --task 18', output: 'red' }],
    }, null, 2)}\n`, 'utf8');

    const result = runCook(root, ['record', 'review', '18', 'reviewer', file]);
    assert.notEqual(result.code, 0);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
