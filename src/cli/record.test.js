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

function canonicalTask(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 18,
    slug: 'record-specialists',
    title: 'Record specialists',
    status: 'in_progress',
    stage: 'plan',
    priority: 'p2',
    deps: [],
    complexity: 'simple',
    createdAt: '2026-07-12T00:00:00Z',
    updatedAt: '2026-07-12T00:00:00Z',
    agents: {
      implementer_agent_id: null,
      reviewer_agent_id: null,
      reviewer2_agent_id: null,
      audit_agent_id: null,
    },
    tests: { authored_by_agent_id: null, green: false, evidence: [] },
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

async function makeRoot(task = canonicalTask()) {
  const root = await mkdtemp(join(tmpdir(), 'jeff-record-'));
  const taskDir = join(root, '.jeff', 'tasks', '018-record-specialists');
  await mkdir(taskDir, { recursive: true });
  await writeFile(join(root, '.jeff', 'config.json'), JSON.stringify({ mode: 'lite' }), 'utf8');
  await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  return { root, taskDir };
}

/** @param {string} root @param {string[]} args */
function runCook(root, args) {
  const result = spawnSync(process.execPath, [COOK_JS, ...args], {
    env: { ...process.env, COOK_ROOT: root },
    encoding: 'utf8',
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** @param {string} root @param {unknown} value @param {string} [name] */
async function writeReturn(root, value, name = 'return.json') {
  const file = join(root, name);
  const raw = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(file, raw, 'utf8');
  return file;
}

/** @param {string} taskDir */
async function readTask(taskDir) {
  return JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf8'));
}

function planReturn(overrides = {}) {
  return {
    agent_id: 'plan-agent',
    stage: 'plan',
    result: 'red',
    complexity: 'simple',
    auditRequired: true,
    slices: ['Add the recording boundary'],
    testFiles: ['src/cli/record.test.js'],
    redRun: { command: 'node --test src/cli/record.test.js', output: 'record is unavailable' },
    escalation: null,
    ...overrides,
  };
}

test('record accepts the strict plan return and advances the task atomically', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const file = await writeReturn(root, planReturn());

    const result = runCook(root, ['record', 'plan', '18', file]);
    const task = await readTask(taskDir);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(task.tests.authored_by_agent_id, 'plan-agent');
    assert.equal(task.complexity, 'simple');
    assert.equal(task.audit.required, true);
    assert.equal(task.stage, 'implement');
    assert.equal(task.status, 'in_progress');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('record rejects malformed JSON with a named error and preserves the task byte-for-byte', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const file = await writeReturn(root, '{');

    const result = runCook(root, ['record', 'plan', '18', file]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /\[record-json\]/);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('record rejects extra return fields with a named schema error and preserves the task', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const file = await writeReturn(root, planReturn({ extra: true }));

    const result = runCook(root, ['record', 'plan', '18', file]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /\[record-schema\].*extra/);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('record validates closed finding fields and final-stage evidence before writing', async () => {
  const task = canonicalTask({
    stage: 'review',
    agents: {
      implementer_agent_id: 'implementer',
      reviewer_agent_id: null,
      reviewer2_agent_id: null,
      audit_agent_id: null,
    },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['full gate'] },
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const file = await writeReturn(root, {
      agent_id: 'reviewer',
      stage: 'review',
      verdict: 'needs-work',
      acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: false }],
      findings: [{
        file: 'src/core/record.js',
        line: 10,
        severity: 'high',
        class: 'blocker',
        kickTo: 'implement',
        what: 'The write can tear.',
        why: 'Readers can observe partial state.',
      }],
      evidence: [],
    });

    const result = runCook(root, ['record', 'review', '18', file]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /\[record-schema\].*findings\[0\]\.class/);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('record rejects a plan author reused as implementer before writing', async () => {
  const task = canonicalTask({
    stage: 'implement',
    tests: { authored_by_agent_id: 'same-agent', green: false, evidence: [] },
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const file = await writeReturn(root, {
      agent_id: 'same-agent',
      stage: 'implement',
      result: 'green',
      files: ['src/core/record.js'],
      greenRun: { command: 'node --test src/cli/record.test.js', output: 'pass' },
      kickback: null,
    });

    const result = runCook(root, ['record', 'implement', '18', file]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /\[inv1\]/);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('record rejects an implementer reused as reviewer before writing', async () => {
  const task = canonicalTask({
    stage: 'review',
    agents: {
      implementer_agent_id: 'same-agent',
      reviewer_agent_id: null,
      reviewer2_agent_id: null,
      audit_agent_id: null,
    },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['full gate'] },
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const file = await writeReturn(root, {
      agent_id: 'same-agent',
      stage: 'review',
      verdict: 'pass',
      acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: true }],
      findings: [],
      evidence: [{ command: 'git diff', output: 'No findings.' }],
    });

    const result = runCook(root, ['record', 'review', '18', file]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /\[inv2\]/);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('record accepts a valid review return and persists its closed findings and evidence', async () => {
  const task = canonicalTask({
    stage: 'review',
    agents: {
      implementer_agent_id: 'implementer',
      reviewer_agent_id: null,
      reviewer2_agent_id: null,
      audit_agent_id: null,
    },
    tests: {
      authored_by_agent_id: 'plan-agent',
      green: true,
      evidence: [{ command: 'make test', output: 'pass' }],
      gate: {
        hash: '0123456789abcdef',
        clean: true,
        green: true,
        command: 'make test',
        at: '2026-07-12T01:00:00Z',
      },
    },
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    const specialistReturn = {
      agent_id: 'reviewer',
      stage: 'review',
      verdict: 'pass',
      acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: true }],
      findings: [],
      evidence: [{ command: 'git diff --check', output: 'clean' }],
    };
    const file = await writeReturn(root, specialistReturn);

    const result = runCook(root, ['record', 'review', '18', file]);
    const recorded = await readTask(taskDir);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(recorded.agents.reviewer_agent_id, 'reviewer');
    assert.equal(recorded.review.reviewer_agent_id, 'reviewer');
    assert.equal(recorded.review.verdict, 'pass');
    assert.deepEqual(recorded.review.findings, specialistReturn.findings);
    assert.deepEqual(recorded.review.evidence, specialistReturn.evidence);
    assert.equal(recorded.stage, 'done');
    assert.equal(recorded.status, 'done');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
