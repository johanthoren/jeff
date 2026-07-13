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

test('persisted timestamps reject impossible calendar dates with field-named failures', async (t) => {
  /** @type {Array<[string, Record<string, any>]>} */
  const cases = [
    ['createdAt', { createdAt: '2026-02-31T00:00:00Z' }],
    ['updatedAt', { updatedAt: '2026-02-31T00:00:00Z' }],
    [
      'tests.gate.at',
      {
        tests: {
          ...canonicalTask().tests,
          gate: {
            hash: 'deadbeef',
            clean: true,
            green: true,
            command: 'make test',
            at: '2026-02-31T00:00:00Z',
          },
        },
      },
    ],
    [
      'kickbacks[0].at',
      {
        kickbacks: [{
          from: 'review',
          to: 'implement',
          reason: 'review kickback',
          at: '2026-02-31T00:00:00Z',
        }],
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

test('persisted timestamps accept real leap dates with offsets and fractional seconds', async () => {
  const result = await verdictFor(
    canonicalTask({
      createdAt: '2024-02-29T23:59:59.123456+05:30',
      updatedAt: '2024-02-29T23:59:59.5-04:00',
      tests: {
        ...canonicalTask().tests,
        gate: {
          hash: 'deadbeef',
          clean: true,
          green: true,
          command: 'make test',
          at: '2024-02-29T23:59:59.123456+05:30',
        },
      },
      kickbacks: [{
        from: 'review',
        to: 'implement',
        reason: 'review kickback',
        at: '2024-02-29T23:59:59.5-04:00',
      }],
    }),
  );
  assert.equal(result.ok, true, result.stderr.join('\n'));
});

test('runtime compatibility accepts legacy-only fields, lifecycle sentinels, and omitted optional destination shapes', async () => {
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
    review: { verdict: 'na', reviewer_agent_id: null, evidence: [] },
  });
  delete legacy.review2;

  const result = await verdictFor(legacy);
  assert.equal(result.ok, true, result.stderr.join('\n'));
});

test('INV-2 accepts compatible primary reviewer identity representations and separates every present identity', async (t) => {
  /** @type {Array<[string, Record<string, any>, boolean]>} */
  const cases = [
    [
      'outcome-only identity',
      {
        review: {
          verdict: 'pass',
          reviewer_agent_id: 'reviewer-one',
          evidence: ['primary review'],
        },
      },
      true,
    ],
    [
      'outcome-only identity matching the implementer',
      {
        review: {
          verdict: 'pass',
          reviewer_agent_id: 'implementer',
          evidence: ['primary review'],
        },
      },
      false,
    ],
    [
      'agents-only identity',
      {
        agents: {
          ...canonicalTask().agents,
          reviewer_agent_id: 'reviewer-one',
        },
      },
      true,
    ],
    [
      'agents-only identity matching the implementer',
      {
        agents: {
          ...canonicalTask().agents,
          reviewer_agent_id: 'implementer',
        },
      },
      false,
    ],
    [
      'equal identities in both representations',
      {
        agents: {
          ...canonicalTask().agents,
          reviewer_agent_id: 'reviewer-one',
        },
        review: {
          verdict: 'pass',
          reviewer_agent_id: 'reviewer-one',
          evidence: ['primary review'],
        },
      },
      true,
    ],
    [
      'contradictory identities in both representations',
      {
        agents: {
          ...canonicalTask().agents,
          reviewer_agent_id: 'reviewer-one',
        },
        review: {
          verdict: 'pass',
          reviewer_agent_id: 'implementer',
          evidence: ['primary review'],
        },
      },
      false,
    ],
  ];

  for (const [name, overrides, accepted] of cases) {
    await t.test(name, async () => {
      const result = await verdictFor(canonicalTask(overrides));
      if (accepted) {
        assert.equal(result.ok, true, result.stderr.join('\n'));
      } else {
        assertNamedFailure(result, '[inv2]');
      }
    });
  }
});

test('INV-2 keeps second-review outcomes bound to the canonical agent identity', async () => {
  const result = await verdictFor(
    canonicalTask({
      agents: {
        ...canonicalTask().agents,
        reviewer2_agent_id: 'reviewer-two',
      },
      review2: {
        verdict: 'pass',
        reviewer_agent_id: 'different-reviewer',
        evidence: ['second review'],
      },
    }),
  );
  assertNamedFailure(result, '[inv2]');
});

test('kickback members fail closed by field while current and historical transitions remain readable', async (t) => {
  await t.test('scalar member', async () => {
    const result = await verdictFor(canonicalTask({ kickbacks: ['invalid'] }));
    assertNamedFailure(result, '[schema] kickbacks[0]');
  });

  await t.test('malformed member fields', async () => {
    const result = await verdictFor(
      canonicalTask({
        kickbacks: [{ from: 'invalid', to: 42, reason: null, at: 'not-a-date' }],
      }),
    );
    for (const field of ['from', 'to', 'reason', 'at']) {
      assertNamedFailure(result, `[schema] kickbacks[0].${field}`);
    }
  });

  await t.test('current verify source and historical test destination', async () => {
    const result = await verdictFor(
      canonicalTask({
        kickbacks: [
          {
            from: 'verify',
            to: 'implement',
            reason: 'full gate failed',
            at: '2026-07-12T01:00:00.000Z',
          },
          {
            from: 'review',
            to: 'test',
            reason: 'historical test-author kickback',
            at: '2026-07-12T02:00:00.000Z',
          },
        ],
      }),
    );
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });
});

test('full-mode registry ids and slugs enforce the persisted naming contract', async (t) => {
  for (const id of [0, -1, 1.5]) {
    await t.test(`id ${id}`, async () => {
      const result = await verdictFor(
        canonicalTask({ id, externalRef: undefined }),
        'full',
      );
      assertNamedFailure(result, '[schema] id');
    });
  }

  await t.test('non-kebab slug', async () => {
    const result = await verdictFor(
      canonicalTask({ id: 1, externalRef: undefined, slug: 'Not_Kebab' }),
      'full',
    );
    assertNamedFailure(result, '[schema] slug');
  });
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

test('INV-4 requires a recorded second reviewer and passing outcome for complex done tasks', async () => {
  const result = await verdictFor(
    canonicalTask({
      status: 'done',
      stage: 'done',
      complexity: 'complex',
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
    }),
  );
  assertNamedFailure(result, '[inv4]');
  assert.ok(result.stderr.some((line) => line.includes('second review')));
});

test('INV-4 defaults omitted complexity to complex without legacy identity bypasses', async (t) => {
  const singleReviewDoneTask = canonicalTask({
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
      reviewer2_agent_id: null,
    },
    review: {
      verdict: 'pass',
      reviewer_agent_id: 'reviewer-one',
      evidence: ['review one'],
    },
    review2: null,
  });

  await t.test('omitted complexity requires a second review', async () => {
    const { complexity: _, ...withoutComplexity } = singleReviewDoneTask;
    const result = await verdictFor(withoutComplexity);
    assertNamedFailure(result, '[inv4]');
    assert.ok(result.stderr.some((line) => line.includes('second review')));
  });

  await t.test('legacy identity fields do not exempt an explicitly complex task', async () => {
    const result = await verdictFor({
      ...singleReviewDoneTask,
      complexity: 'complex',
      agents: {
        ...singleReviewDoneTask.agents,
        plan_agent_id: 'legacy-plan',
        test_author_agent_id: 'legacy-test-author',
      },
    });
    assertNamedFailure(result, '[inv4]');
    assert.ok(result.stderr.some((line) => line.includes('second review')));
  });

  await t.test('explicit-complex ledger without review2 retains historical single-review compatibility', async () => {
    const {
      review2: _,
      ...historicalTask
    } = singleReviewDoneTask;
    const result = await verdictFor({
      ...historicalTask,
      trivial: false,
      brains: { review: { model: 'opus', effort: 'high' } },
      agents: {
        ...singleReviewDoneTask.agents,
        test_author_agent_id: 'legacy-test-author',
      },
    });
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });
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

test('issue 65 cycle 1 INV-4 accepts scoped recovery when review2 found the council blocker', async () => {
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
        evidence: ['review two blocker'],
      },
      convergence: convergence({
        stages: {
          review: { blockingKickbacks: 2 },
          audit: { blockingKickbacks: 0 },
        },
        council: {
          convened: true,
          stage: 'review',
          members: [
            { agent_id: 'c1', lens: 'integrity', temperature: null },
            { agent_id: 'c2', lens: 'security', temperature: null },
            { agent_id: 'c3', lens: 'pragmatist', temperature: null },
          ],
          findings: [{
            id: 'F1',
            summary: 'The review2 blocker survived.',
            blockingVotes: 2,
            survived: true,
            followupTaskId: null,
          }],
          verdict: 'block',
          outcome: 'scoped-fix-shipped',
        },
      }),
    }),
  );

  assert.equal(result.ok, true, result.stderr.join('\n'));
});

test('issue 65 cycle 2 INV-4 rejects a non-convened scoped recovery marker', async () => {
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
        audit_agent_id: 'auditor',
      },
      review: {
        verdict: 'needs-work',
        reviewer_agent_id: 'reviewer-one',
        evidence: ['review blocker'],
      },
      review2: {
        verdict: 'pass',
        reviewer_agent_id: 'reviewer-two',
        evidence: ['review two'],
      },
      audit: {
        required: true,
        verdict: 'pass',
        audit_agent_id: 'auditor',
        evidence: ['audit'],
      },
      convergence: convergence({
        stages: {
          review: { blockingKickbacks: 2 },
          audit: { blockingKickbacks: 0 },
        },
        council: {
          convened: false,
          stage: 'review',
          members: [],
          findings: [],
          verdict: null,
          outcome: 'scoped-fix-shipped',
        },
      }),
    }),
  );

  assertNamedFailure(result, '[inv4]');
  assert.ok(result.stderr.some((line) => line.includes('review.verdict')));
});

test('issue 65 council fix INV-4 rejects a non-convened audit recovery marker', async () => {
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
        audit_agent_id: 'auditor',
      },
      review: {
        verdict: 'pass',
        reviewer_agent_id: 'reviewer-one',
        evidence: ['review one'],
      },
      review2: {
        verdict: 'pass',
        reviewer_agent_id: 'reviewer-two',
        evidence: ['review two'],
      },
      audit: {
        required: true,
        verdict: 'needs-work',
        audit_agent_id: 'auditor',
        evidence: ['audit blocker'],
      },
      convergence: convergence({
        stages: {
          review: { blockingKickbacks: 0 },
          audit: { blockingKickbacks: 2 },
        },
        council: {
          convened: false,
          stage: 'audit',
          members: [],
          findings: [],
          verdict: null,
          outcome: 'scoped-fix-shipped',
        },
      }),
    }),
  );

  assertNamedFailure(result, '[inv4]');
  assert.ok(result.stderr.some((line) => line.includes('audit.verdict')));
});

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
