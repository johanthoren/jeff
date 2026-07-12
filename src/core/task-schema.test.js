// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateStore } from './validate-store.js';

async function makeStore(mode = 'lite') {
  const root = await mkdtemp(join(tmpdir(), 'jeff-task-schema-test-'));
  await mkdir(join(root, '.jeff', 'tasks'), { recursive: true });
  if (mode === 'lite') {
    await writeFile(
      join(root, '.jeff', 'config.json'),
      JSON.stringify({ mode }),
      'utf8',
    );
  }
  return root;
}

/**
 * @param {string} root
 * @param {Record<string, any>} task
 * @param {string} [dir]
 */
async function writeTask(root, task, dir = '0001-task-one') {
  const taskDir = join(root, '.jeff', 'tasks', dir);
  await mkdir(taskDir, { recursive: true });
  await writeFile(join(taskDir, 'task.json'), JSON.stringify(task), 'utf8');
}

/**
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function canonicalTask(overrides = {}) {
  return {
    schemaVersion: 1,
    id: '#27',
    externalRef: '#27',
    slug: 'task-one',
    title: 'Task One',
    status: 'in_progress',
    stage: 'implement',
    priority: 'p2',
    deps: [],
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    complexity: 'complex',
    agents: {
      implementer_agent_id: 'implementer',
      reviewer_agent_id: null,
      reviewer2_agent_id: null,
      audit_agent_id: null,
    },
    tests: { authored_by_agent_id: 'plan', green: false, evidence: [] },
    review: { verdict: null, reviewer_agent_id: null, evidence: [] },
    review2: null,
    audit: {
      required: true,
      verdict: 'na',
      audit_agent_id: null,
      evidence: [],
    },
    commits: [],
    kickbacks: [],
    blockedReason: null,
    abandonReason: null,
    ...overrides,
  };
}

/**
 * @param {Record<string, any>} task
 * @param {'lite' | 'full'} [mode]
 */
async function verdictFor(task, mode = 'lite') {
  const root = await makeStore(mode);
  try {
    await writeTask(root, task);
    return await validateStore(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * @param {{ ok: boolean, stderr: string[] }} result
 * @param {string} name
 */
function assertNamedFailure(result, name) {
  assert.equal(result.ok, false);
  assert.ok(
    result.stderr.some((line) => line.includes(name)),
    `expected a named ${name} failure, got:\n${result.stderr.join('\n')}`,
  );
}

test('canonical task shape validates through the authoritative core', async () => {
  const result = await verdictFor(canonicalTask());
  assert.equal(result.ok, true);
});

test('schema failures name malformed required and nested fields', async (t) => {
  /** @type {Array<[string, Record<string, any>]>} */
  const cases = [
    ['schemaVersion', { schemaVersion: 2 }],
    ['createdAt', { createdAt: 'not-an-iso-date' }],
    [
      'agents.reviewer2_agent_id',
      {
        agents: { ...canonicalTask().agents, reviewer2_agent_id: 42 },
      },
    ],
    [
      'review2.evidence',
      {
        review2: {
          verdict: 'pass',
          reviewer_agent_id: 'reviewer-two',
          evidence: 'not-an-array',
        },
      },
    ],
    [
      'convergence.council.members',
      {
        convergence: {
          cap: 2,
          stages: {
            review: { blockingKickbacks: 0 },
            audit: { blockingKickbacks: 0 },
          },
          council: {
            convened: false,
            stage: null,
            members: 'not-an-array',
            findings: [],
            verdict: null,
            outcome: null,
          },
        },
      },
    ],
  ];

  for (const [field, overrides] of cases) {
    await t.test(field, async () => {
      const result = await verdictFor(canonicalTask(overrides));
      assertNamedFailure(result, `[schema] ${field}`);
    });
  }
});

test('runtime compatibility accepts legacy-only fields and omitted optional destination shapes', async () => {
  const legacy = canonicalTask({
    stage: 'test',
    branch: 'legacy-branch',
    brains: { plan: { model: 'opus', effort: 'xhigh' } },
    agents: {
      plan_agent_id: 'legacy-plan',
      test_author_agent_id: 'legacy-test-author',
      implementer_agent_id: 'implementer',
      reviewer_agent_id: null,
      audit_agent_id: null,
    },
  });
  delete legacy.review2;

  const result = await verdictFor(legacy);
  assert.equal(result.ok, true);
});

test('INV-2 rejects either reviewer identity when it is the implementer', async (t) => {
  for (const reviewerField of ['reviewer_agent_id', 'reviewer2_agent_id']) {
    await t.test(reviewerField, async () => {
      const result = await verdictFor(
        canonicalTask({
          agents: { ...canonicalTask().agents, [reviewerField]: 'implementer' },
        }),
      );
      assertNamedFailure(result, '[inv2]');
    });
  }
});

test('INV-4 requires both recorded reviews to pass when a second review is present', async () => {
  const result = await verdictFor(
    canonicalTask({
      status: 'done',
      stage: 'done',
      tests: {
        authored_by_agent_id: 'plan',
        green: true,
        evidence: ['make test'],
      },
      agents: {
        ...canonicalTask().agents,
        reviewer_agent_id: 'reviewer-one',
        reviewer2_agent_id: 'reviewer-two',
      },
      review: {
        verdict: 'pass',
        reviewer_agent_id: 'reviewer-one',
        evidence: ['review one'],
      },
      review2: {
        verdict: 'needs-work',
        reviewer_agent_id: 'reviewer-two',
        evidence: ['review two'],
      },
    }),
  );
  assertNamedFailure(result, '[inv4]');
  assert.ok(result.stderr.some((line) => line.includes('review2.verdict')));
});

test('single-review done path remains null-tolerant and historical gate omission remains accepted', async () => {
  const task = canonicalTask({
    status: 'done',
    stage: 'done',
    complexity: 'simple',
    tests: {
      authored_by_agent_id: 'plan',
      green: true,
      evidence: ['make test'],
    },
    agents: {
      ...canonicalTask().agents,
      reviewer_agent_id: 'reviewer-one',
      reviewer2_agent_id: null,
    },
    review: {
      verdict: 'pass',
      reviewer_agent_id: 'reviewer-one',
      evidence: ['review one'],
    },
    review2: null,
  });
  const result = await verdictFor(task);
  assert.equal(result.ok, true);
});

test('INV-5 and full-only registry rules are enforced in full mode and skipped in lite mode', async (t) => {
  await t.test('missing dependency', async () => {
    const result = await verdictFor(
      canonicalTask({ id: 1, externalRef: undefined, deps: [2] }),
      'full',
    );
    assertNamedFailure(result, '[inv5]');
  });

  await t.test('terminal task pruning', async () => {
    const task = canonicalTask({
      id: 1,
      externalRef: undefined,
      status: 'abandoned',
      abandonReason: 'superseded',
    });
    const fullResult = await verdictFor(task, 'full');
    assertNamedFailure(fullResult, '[prune]');

    const liteResult = await verdictFor(task);
    assert.equal(liteResult.ok, true);
  });
});

/**
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function convergence(overrides = {}) {
  return {
    cap: 2,
    stages: {
      review: { blockingKickbacks: 0 },
      audit: { blockingKickbacks: 0 },
    },
    council: {
      convened: false,
      stage: null,
      members: [],
      findings: [],
      verdict: null,
      outcome: null,
    },
    ...overrides,
  };
}

test('convergence INV-7 through INV-11 are enforced by the authoritative core', async (t) => {
  /** @type {Array<[string, Record<string, any>]>} */
  const cases = [
    ['inv7', convergence({ cap: 0 })],
    [
      'inv8',
      convergence({
        council: {
          convened: true,
          stage: 'review',
          members: [],
          findings: [
            {
              id: 'f1',
              summary: 'finding',
              blockingVotes: 2,
              survived: true,
              followupTaskId: null,
            },
          ],
          verdict: 'block',
          outcome: 'blocked-to-operator',
        },
      }),
    ],
    [
      'inv9',
      convergence({
        council: {
          convened: true,
          stage: 'review',
          members: [
            { agent_id: 'c1', lens: 'integrity', temperature: null },
            { agent_id: 'c2', lens: 'security', temperature: null },
            { agent_id: 'c3', lens: 'pragmatist', temperature: null },
          ],
          findings: [
            {
              id: 'f1',
              summary: 'finding',
              blockingVotes: 2,
              survived: false,
              followupTaskId: 1,
            },
          ],
          verdict: 'ship',
          outcome: 'shipped',
        },
      }),
    ],
    [
      'inv10',
      convergence({
        council: {
          convened: true,
          stage: 'review',
          members: [
            { agent_id: 'c1', lens: 'integrity', temperature: null },
            { agent_id: 'c2', lens: 'security', temperature: null },
            { agent_id: 'c3', lens: 'pragmatist', temperature: null },
          ],
          findings: [
            {
              id: 'f1',
              summary: 'finding',
              blockingVotes: 1,
              survived: false,
              followupTaskId: null,
            },
          ],
          verdict: 'ship',
          outcome: 'shipped',
        },
      }),
    ],
    [
      'inv11',
      convergence({
        council: {
          convened: true,
          stage: 'review',
          members: [
            { agent_id: 'c1', lens: 'integrity', temperature: null },
            { agent_id: 'c2', lens: 'security', temperature: null },
            { agent_id: 'c3', lens: 'pragmatist', temperature: null },
          ],
          findings: [
            {
              id: 'f1',
              summary: 'finding',
              blockingVotes: 2,
              survived: true,
              followupTaskId: null,
            },
          ],
          verdict: 'block',
          outcome: 'blocked-to-operator',
        },
      }),
    ],
  ];

  for (const [invariant, value] of cases) {
    await t.test(invariant, async () => {
      const result = await verdictFor(canonicalTask({ convergence: value }));
      assertNamedFailure(result, `[${invariant}]`);
    });
  }
});
