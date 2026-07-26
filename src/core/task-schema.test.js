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
 * Canonical operation ledger. Code-only identities and outcome containers are
 * deliberately absent so validation cannot make compatibility scaffolding mandatory.
 *
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function canonicalOperationTask(overrides = {}) {
  return {
    schemaVersion: 1,
    id: '#28',
    externalRef: '#28',
    slug: 'operation-one',
    title: 'Operation One',
    category: 'operation',
    status: 'in_progress',
    stage: 'execute',
    priority: 'p2',
    deps: [],
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
    complexity: 'complex',
    agents: {
      executor_agent_id: null,
      verifier_agent_id: null,
      audit_agent_id: null,
    },
    audit: {
      required: false,
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

/** @param {Record<string, any>} [overrides] */
function completedOperationTask(overrides = {}) {
  return canonicalOperationTask({
    status: 'done',
    stage: 'done',
    agents: {
      executor_agent_id: 'executor',
      verifier_agent_id: 'verifier',
      audit_agent_id: null,
    },
    plan: {
      result: 'plan',
      slices: ['Move the bounded registry entry.'],
      runbook: ['Confirm the source entry, then move it to the destination.'],
      preconditions: ['The source entry exists exactly once.'],
      recoveryBoundary: 'Before the shared registry write, restore the captured source entry.',
      approvalBoundary: 'The shared registry write requires approval when it is irreversible.',
      requiresApproval: false,
      postconditions: ['The registry has exactly one destination entry.'],
      verificationSeams: ['Read the source and destination entries independently.'],
      escalation: null,
    },
    execution: {
      result: 'executed',
      executor_agent_id: 'executor',
      actions: ['Moved the bounded registry entry.'],
      evidence: [{ command: 'inspect registry', output: 'entry moved' }],
      approvalRequired: null,
    },
    verification: {
      verdict: 'pass',
      verifier_agent_id: 'verifier',
      postconditions: [{
        postcondition: 'The registry has exactly one destination entry.',
        ok: true,
        evidence: 'source absent; destination present once',
      }],
      findings: [],
      evidence: [{ command: 'inspect registry', output: 'postconditions satisfied' }],
    },
    ...overrides,
  });
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

test('issue 101 canonical operation ledger omits all code-only scaffolding and rejects malformed fields when present', async (t) => {
  const operation = canonicalOperationTask();
  const accepted = await verdictFor(operation);
  assert.equal(accepted.ok, true, accepted.stderr.join('\n'));

  /** @type {Array<[string, Record<string, any>, string]>} */
  const malformed = [
    ['tests', { ...operation, tests: null }, '[schema] tests'],
    ['review', { ...operation, review: null }, '[schema] review'],
    ['review2', { ...operation, review2: {} }, '[schema] review2'],
    ['code identity', {
      ...operation,
      agents: { ...operation.agents, implementer_agent_id: 42 },
    }, '[schema] agents.implementer_agent_id'],
  ];
  for (const [name, task, failure] of malformed) {
    await t.test(name, async () => {
      const result = await verdictFor(task);
      assertNamedFailure(result, failure);
    });
  }
});

test('issue 101 category defaults historical tasks to code and keeps both graphs closed', async (t) => {
  const operation = canonicalOperationTask();

  for (const task of [canonicalTask(), canonicalTask({ category: 'code' }), operation]) {
    const result = await verdictFor(task);
    assert.equal(result.ok, true, result.stderr.join('\n'));
  }

  await t.test('unknown category fails closed', async () => {
    const result = await verdictFor(canonicalTask({ category: 'documentation' }));
    assertNamedFailure(result, '[schema] category');
  });

  await t.test('historical omission stays on the code graph', async () => {
    const result = await verdictFor(canonicalTask({ stage: 'execute' }));
    assertNamedFailure(result, '[category-stage]');
  });

  await t.test('operation cannot enter the code graph', async () => {
    const result = await verdictFor({ ...operation, stage: 'implement' });
    assertNamedFailure(result, '[category-stage]');
  });

  for (const destination of ['capture', 'plan', 'execute']) {
    await t.test(`operation judgment can kick back to ${destination}`, async () => {
      const result = await verdictFor({
        ...operation,
        kickbacks: [{
          from: 'verify',
          to: destination,
          reason: 'A deterministic postcondition failed.',
          at: '2026-07-12T01:00:00Z',
        }],
      });
      assert.equal(result.ok, true, result.stderr.join('\n'));
    });
  }

  await t.test('operation kickback cannot target a code stage', async () => {
    const result = await verdictFor({
      ...operation,
      kickbacks: [{
        from: 'verify',
        to: 'implement',
        reason: 'Wrong graph.',
        at: '2026-07-12T01:00:00Z',
      }],
    });
    assertNamedFailure(result, '[category-stage]');
  });
});

test('issue 101 operation done gate requires execution, independent verification, and conditional audit only', async (t) => {
  const doneOperation = completedOperationTask();

  const accepted = await verdictFor(doneOperation);
  assert.equal(accepted.ok, true, accepted.stderr.join('\n'));

  /** @type {Array<[string, Record<string, any>, string]>} */
  const invalid = [
    ['execution actions', {
      ...doneOperation,
      execution: { ...doneOperation.execution, actions: [] },
    }, '[inv4]'],
    ['execution evidence', {
      ...doneOperation,
      execution: { ...doneOperation.execution, evidence: [] },
    }, '[inv4]'],
    ['verification pass', {
      ...doneOperation,
      verification: { ...doneOperation.verification, verdict: 'needs-work' },
    }, '[inv4]'],
    ['successful postconditions', {
      ...doneOperation,
      verification: {
        ...doneOperation.verification,
        postconditions: [{ ...doneOperation.verification.postconditions[0], ok: false }],
      },
    }, '[inv4]'],
    ['verification evidence', {
      ...doneOperation,
      verification: { ...doneOperation.verification, evidence: [] },
    }, '[inv4]'],
    ['executor/verifier separation', {
      ...doneOperation,
      agents: { ...doneOperation.agents, verifier_agent_id: 'executor' },
      verification: { ...doneOperation.verification, verifier_agent_id: 'executor' },
    }, '[inv2]'],
    ['required audit pass', {
      ...doneOperation,
      audit: { ...doneOperation.audit, required: true },
    }, '[inv4]'],
  ];

  for (const [name, task, failure] of invalid) {
    await t.test(`done rejects missing ${name}`, async () => {
      const result = await verdictFor(task);
      assertNamedFailure(result, failure);
    });
  }
});

test('issue 101 surviving blocker: persisted done operation requires exact planned postconditions', async (t) => {
  const planned = [
    'AC1: The source is absent.',
    'AC2: The destination exists exactly once.',
  ];
  const base = completedOperationTask();
  const verified = planned.map((postcondition, index) => ({
    postcondition,
    ok: true,
    evidence: `independent check ${index + 1} passed`,
  }));
  const exact = completedOperationTask({
    plan: { ...base.plan, postconditions: planned },
    verification: { ...base.verification, postconditions: verified },
  });
  const accepted = await verdictFor(exact);
  assert.equal(accepted.ok, true, accepted.stderr.join('\n'));

  const withoutPlan = structuredClone(exact);
  delete withoutPlan.plan;
  /** @type {Array<[string, Record<string, any>]>} */
  const invalid = [
    ['missing plan', withoutPlan],
    ['omitted result', {
      ...exact,
      verification: { ...exact.verification, postconditions: [verified[0]] },
    }],
    ['duplicate result', {
      ...exact,
      verification: { ...exact.verification, postconditions: [verified[0], verified[0]] },
    }],
    ['extra result', {
      ...exact,
      verification: {
        ...exact.verification,
        postconditions: [...verified, {
          postcondition: 'AC3: The audit log is unchanged.',
          ok: true,
          evidence: 'independent check passed',
        }],
      },
    }],
    ['renamed result', {
      ...exact,
      verification: {
        ...exact.verification,
        postconditions: [verified[0], {
          ...verified[1],
          postcondition: 'AC2: A destination exists.',
        }],
      },
    }],
    ['reordered results', {
      ...exact,
      verification: { ...exact.verification, postconditions: [verified[1], verified[0]] },
    }],
  ];
  for (const [name, task] of invalid) {
    await t.test(name, async () => {
      const result = await verdictFor(task);
      assertNamedFailure(result, '[inv4]');
    });
  }
});

test('issue 101 surviving blocker: persisted operation action and evidence content is nonempty', async (t) => {
  const done = completedOperationTask();
  /** @type {Array<[string, Record<string, any>, string]>} */
  const invalid = [
    ['non-string execution action', {
      ...done,
      execution: { ...done.execution, actions: [42] },
    }, '[schema] execution.actions[0]'],
    ['empty execution action', {
      ...done,
      execution: { ...done.execution, actions: [''] },
    }, '[schema] execution.actions[0]'],
    ['empty execution evidence command', {
      ...done,
      execution: {
        ...done.execution,
        evidence: [{ ...done.execution.evidence[0], command: '' }],
      },
    }, '[schema] execution.evidence[0].command'],
    ['empty execution evidence output', {
      ...done,
      execution: {
        ...done.execution,
        evidence: [{ ...done.execution.evidence[0], output: '' }],
      },
    }, '[schema] execution.evidence[0].output'],
    ['empty verified postcondition', {
      ...done,
      verification: {
        ...done.verification,
        postconditions: [{ ...done.verification.postconditions[0], postcondition: '' }],
      },
    }, '[schema] verification.postconditions[0].postcondition'],
    ['empty postcondition evidence', {
      ...done,
      verification: {
        ...done.verification,
        postconditions: [{ ...done.verification.postconditions[0], evidence: '' }],
      },
    }, '[schema] verification.postconditions[0].evidence'],
    ['empty verification evidence command', {
      ...done,
      verification: {
        ...done.verification,
        evidence: [{ ...done.verification.evidence[0], command: '' }],
      },
    }, '[schema] verification.evidence[0].command'],
    ['empty verification evidence output', {
      ...done,
      verification: {
        ...done.verification,
        evidence: [{ ...done.verification.evidence[0], output: '' }],
      },
    }, '[schema] verification.evidence[0].output'],
  ];
  for (const [name, task, failure] of invalid) {
    await t.test(name, async () => {
      const result = await verdictFor(task);
      assertNamedFailure(result, failure);
    });
  }
});

test('issue 101 irreversible operation done gate requires an exact retained operator approval', async (t) => {
  const mutation = 'Rewrite the shared release registry entry from source to destination.';
  const approval = {
    mutation,
    grantedBy: 'Chef',
    grantedAt: '2026-07-26T15:30:00Z',
  };
  const approved = completedOperationTask({
    plan: {
      ...completedOperationTask().plan,
      requiresApproval: true,
    },
    approvals: [approval],
    execution: {
      ...completedOperationTask().execution,
      approval,
    },
  });

  const accepted = await verdictFor(approved);
  assert.equal(accepted.ok, true, accepted.stderr.join('\n'));

  /** @type {Array<[string, Record<string, any>, string]>} */
  const invalid = [
    ['approval-gated plan without operator grant', completedOperationTask({
      plan: {
        ...completedOperationTask().plan,
        requiresApproval: true,
      },
    }), '[inv4]'],
    ['missing retained grant', {
      ...approved,
      approvals: [],
    }, '[inv4]'],
    ['different granted mutation', {
      ...approved,
      approvals: [{ ...approval, mutation: 'Delete the shared release registry entry.' }],
    }, '[inv4]'],
    ['malformed grant time', {
      ...approved,
      approvals: [{ ...approval, grantedAt: 'tomorrow' }],
    }, '[schema] approvals[0].grantedAt'],
    ['malformed executed grant', {
      ...approved,
      execution: {
        ...approved.execution,
        approval: { ...approval, grantedAt: 'tomorrow' },
      },
    }, '[schema] execution.approval.grantedAt'],
  ];
  for (const [name, task, failure] of invalid) {
    await t.test(name, async () => {
      const result = await verdictFor(task);
      assertNamedFailure(result, failure);
    });
  }
});

test('issue 101 cycle 2: operation auditor identity is ledger-bound and differs from the executor', async (t) => {
  const completed = completedOperationTask();
  const audited = completedOperationTask({
    agents: {
      ...completed.agents,
      audit_agent_id: 'operation-auditor',
    },
    audit: {
      required: true,
      verdict: 'pass',
      audit_agent_id: 'operation-auditor',
      findings: [],
      evidence: [{ command: 'inspect operation boundary', output: 'no findings' }],
    },
  });
  const accepted = await verdictFor(audited);
  assert.equal(accepted.ok, true, accepted.stderr.join('\n'));

  await t.test('container identity must equal the ledger identity', async () => {
    const result = await verdictFor({
      ...audited,
      audit: { ...audited.audit, audit_agent_id: 'different-auditor' },
    });
    assertNamedFailure(result, '[inv2]');
  });

  await t.test('auditor cannot reuse the executor identity', async () => {
    const result = await verdictFor({
      ...audited,
      agents: { ...audited.agents, audit_agent_id: audited.agents.executor_agent_id },
      audit: { ...audited.audit, audit_agent_id: audited.agents.executor_agent_id },
    });
    assertNamedFailure(result, '[inv2]');
  });
});

test('issue 95 persisted plan refactor opportunity preserves omission and validates present values', async (t) => {
  /** @type {Array<[string, Record<string, any>]>} */
  const validPlans = [
    ['historical omission', { result: 'red' }],
    ['explicit null', { result: 'red', refactorOpportunity: null }],
    ['named opportunity', { result: 'red', refactorOpportunity: 'Deduplicate plan routing.' }],
  ];
  for (const [name, plan] of validPlans) {
    await t.test(name, async () => {
      const result = await verdictFor(canonicalTask({ plan }));
      assert.equal(result.ok, true, result.stderr.join('\n'));
    });
  }

  /** @type {Array<[string, any]>} */
  const invalidRefactorOpportunities = [
    ['whitespace', '   '],
    ['empty', ''],
    ['false', false],
    ['object', {}],
  ];
  for (const [name, refactorOpportunity] of invalidRefactorOpportunities) {
    await t.test(name, async () => {
      const result = await verdictFor(canonicalTask({
        plan: { result: 'red', refactorOpportunity },
      }));
      assertNamedFailure(result, '[schema] plan.refactorOpportunity');
    });
  }
});

test('issue 95 persisted plan container preserves absence and rejects non-objects', async (t) => {
  await t.test('historical absence', async () => {
    const result = await verdictFor(canonicalTask());
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  /** @type {Array<[string, any]>} */
  const invalidPlans = [
    ['null', null],
    ['boolean', false],
    ['string', 'not-a-plan'],
    ['array', []],
    ['number', 0],
  ];
  for (const [name, plan] of invalidPlans) {
    await t.test(name, async () => {
      const result = await verdictFor(canonicalTask({ plan }));
      assertNamedFailure(result, '[schema] plan');
    });
  }
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

test('issue 70 existing terminal ledger remains readable without a live Git repository', async () => {
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

test('issue 70 INV-4 rejects scoped recovery with a stale needs-work review', async () => {
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

  assertNamedFailure(result, '[inv4]');
  assert.ok(result.stderr.some((line) => line.includes('review2.verdict')));
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
