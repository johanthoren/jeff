import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateStore } from './validate-store.js';

/**
 * Test design (.jeff/tasks/lite-6-438678379/notes.md, "Validator core (AC4)"):
 * one representative behavior per branch of `validateStore(root)`. The
 * exhaustive per-invariant enumeration lives in the parity oracle (the
 * existing bats files); this suite must NOT re-enumerate it.
 */

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'jeff-validate-store-test-'));
  await mkdir(join(root, '.jeff', 'tasks'), { recursive: true });
  return root;
}

/**
 * @param {string} root
 * @param {object} config
 */
async function writeConfig(root, config) {
  await writeFile(join(root, '.jeff', 'config.json'), JSON.stringify(config), 'utf8');
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

/** A minimal, fully-compliant full-mode TaskJson (status: pending). */
function validTask(overrides = {}) {
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
    ...overrides,
  };
}

test('validateStore: empty full-mode store returns ok:true and "nothing to validate"', async () => {
  const root = await makeRoot();
  try {
    const result = await validateStore(root);
    assert.equal(result.ok, true);
    assert.ok(result.stdout.some((line) => line.includes('nothing to validate')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateStore: clean full-mode single valid task returns ok:true and the OK count', async () => {
  const root = await makeRoot();
  try {
    await writeTaskDir(root, '0001-task-one', validTask());

    const result = await validateStore(root);
    assert.equal(result.ok, true);
    assert.ok(result.stdout.some((line) => line.includes('validation OK (1 task(s))')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateStore: test author == implementer fails with [inv1]', async () => {
  const root = await makeRoot();
  try {
    await writeTaskDir(
      root,
      '0001-task-one',
      validTask({
        agents: {
          plan_agent_id: null,
          test_author_agent_id: null,
          implementer_agent_id: 'agent-a',
          reviewer_agent_id: null,
          audit_agent_id: null,
        },
        tests: { authored_by_agent_id: 'agent-a', green: false, evidence: [] },
      }),
    );

    const result = await validateStore(root);
    assert.equal(result.ok, false);
    assert.equal(result.code, 1);
    assert.ok(result.stderr.some((line) => line.includes('[inv1]')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateStore: lite gating discriminator — string id passes under lite, fails under full', async () => {
  const rootLite = await makeRoot();
  const rootFull = await makeRoot();
  try {
    const stringIdTask = validTask({ id: 'JIRA-42' });
    await writeTaskDir(rootLite, '0001-task-one', stringIdTask);
    await writeConfig(rootLite, { mode: 'lite' });

    const liteResult = await validateStore(rootLite);
    assert.equal(liteResult.ok, true);

    await writeTaskDir(rootFull, '0001-task-one', stringIdTask);

    const fullResult = await validateStore(rootFull);
    assert.equal(fullResult.ok, false);
    assert.ok(
      fullResult.stderr.some(
        (line) => line.includes('.jeff/tasks/0001-task-one') && line.includes('id must be a number'),
      ),
    );
  } finally {
    await rm(rootLite, { recursive: true, force: true });
    await rm(rootFull, { recursive: true, force: true });
  }
});

test('validateStore: [gate] pre-flight short-circuits before the main invariant pass', async () => {
  const root = await makeRoot();
  try {
    await writeTaskDir(
      root,
      '0001-gated-task',
      validTask({
        id: 1,
        status: 'done',
        stage: 'done',
        tests: {
          authored_by_agent_id: 'agent-a',
          green: true,
          evidence: ['make test'],
          gate: { hash: 'deadbeef', clean: true, green: false, command: 'make test', at: '2026-01-01T00:00:00.000Z' },
        },
        review: { verdict: 'pass', reviewer_agent_id: 'agent-b', evidence: [] },
      }),
    );
    // A second task with an obvious main-pass violation (missing title): if the
    // pre-flight did NOT short-circuit, its violation would also surface here.
    await writeTaskDir(root, '0002-broken-task', validTask({ id: 2, title: '' }));

    const result = await validateStore(root);
    assert.equal(result.ok, false);
    assert.ok(result.stderr.some((line) => line.includes('[gate]')));
    assert.ok(!result.stderr.some((line) => line.includes('title is required')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateStore: fails closed (never ok:true) when a task.json is unparseable', async () => {
  const root = await makeRoot();
  try {
    const dir = join(root, '.jeff', 'tasks', '0001-broken');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'task.json'), '{ not valid json', 'utf8');

    const result = await validateStore(root);
    assert.equal(result.ok, false);
    assert.equal(result.code, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateStore: a malformed .jeff/profile.md (missing a required key) fails the verdict', async () => {
  const validProfile = [
    '```json',
    '{',
    '  "mode": "lite",',
    '  "plan_store": ".jeff/tasks",',
    '  "ledger": ".jeff/run-ledger.json",',
    '  "sources": [',
    '    { "path": ".jeff/profile.md", "hash": "sha256:0000000000000000000000000000000000000000000000000000000000000" }',
    '  ]',
    '}',
    '```',
    '',
  ].join('\n');
  const malformedProfile = [
    '```json',
    '{',
    '  "mode": "lite",',
    '  "plan_store": ".jeff/tasks"',
    '}',
    '```',
    '',
  ].join('\n');

  const rootMalformed = await makeRoot();
  const rootValid = await makeRoot();
  try {
    await writeTaskDir(rootMalformed, '0001-task-one', validTask());
    await writeFile(join(rootMalformed, '.jeff', 'profile.md'), malformedProfile, 'utf8');

    const malformedResult = await validateStore(rootMalformed);
    assert.equal(malformedResult.ok, false);

    await writeTaskDir(rootValid, '0001-task-one', validTask());
    await writeFile(join(rootValid, '.jeff', 'profile.md'), validProfile, 'utf8');

    const validResult = await validateStore(rootValid);
    assert.equal(validResult.ok, true);
  } finally {
    await rm(rootMalformed, { recursive: true, force: true });
    await rm(rootValid, { recursive: true, force: true });
  }
});
