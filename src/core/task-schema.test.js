// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateStore } from './validate-store.js';
const AUDIT_CATEGORIES = [
  'secrets',
  'injection_sql',
  'injection_command',
  'path_traversal',
  'insecure_deserialization',
  'weak_crypto',
  'dynamic_execution',
  'tls_transport',
  'xss',
  'sensitive_logging',
  'insecure_permissions',
];

/** @param {string} [status] */
function auditCoverage(status = 'covered_no_hits') {
  return AUDIT_CATEGORIES.map((category) => ({ category, status }));
}

/** @param {Record<string, any>} [overrides] */
function operationFinding(overrides = {}) {
  return {
    file: 'src/core/record.js',
    line: 10,
    severity: 'high',
    class: 'blocking',
    kickTo: 'execute',
    what: 'The destination registry contains two entries.',
    why: 'The independently observed duplicate violates the planned postcondition.',
    ...overrides,
  };
}

/** @param {Record<string, any>} finding @param {Record<string, any>} [overrides] */
function operationRefute(finding, overrides = {}) {
  return {
    agent_id: 'verify-refuter',
    source: 'verify',
    finding: `${finding.file}:${finding.line} ${finding.what}`,
    verdict: 'survives',
    rationale: 'The duplicate is independently observable.',
    evidence: [{ command: 'inspect registry', output: 'two entries' }],
    ...overrides,
  };
}

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
    operationStateVersion: 1,
    id: '#28',
    externalRef: '#28',
    slug: 'operation-one',
    title: 'Operation One',
    category: 'operation',
    status: 'in_progress',
    stage: 'plan',
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
      approvalBoundary: 'Rewrite the shared release registry entry from source to destination.',
      requiresApproval: false,
      postconditions: ['The registry has exactly one destination entry.'],
      verificationSeams: ['Read the source and destination entries independently.'],
      escalation: null,
    },
    execution: {
      result: 'executed',
      executor_agent_id: 'executor',
      cycle: 0,
      recordedAt: '2026-07-12T00:20:00Z',
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

  /** @type {Array<[string, (task: Record<string, any>) => Record<string, any>]>} */
  const codeStateCases = [
    ['execution', (task) => ({
      ...task,
      execution: {
        result: 'executed',
        executor_agent_id: null,
        actions: ['Inspected the operation boundary.'],
        evidence: [{ command: 'inspect boundary', output: 'boundary is stable' }],
        approvalRequired: null,
      },
    })],
    ['verification', (task) => ({
      ...task,
      verification: {
        verdict: null,
        verifier_agent_id: null,
        postconditions: [],
        findings: [],
        evidence: [],
      },
    })],
    ['approval history', (task) => ({ ...task, approvals: [] })],
    ['executor identity', (task) => ({
      ...task,
      agents: { ...task.agents, executor_agent_id: 'executor' },
    })],
    ['verifier identity', (task) => ({
      ...task,
      agents: { ...task.agents, verifier_agent_id: 'verifier' },
    })],
  ];
  for (const [, addState] of codeStateCases) {
    for (const task of [canonicalTask(), canonicalTask({ category: 'code' })]) {
      const result = await verdictFor(addState(task));
      assertNamedFailure(result, '[category-stage]');
    }
  }

  /** @type {Array<[string, Record<string, any>]>} */
  const operationCodeStateCases = [
    ['identity', {
      ...operation,
      agents: { ...operation.agents, implementer_agent_id: 'implementer' },
    }],
    ['outcome', {
      ...operation,
      tests: { authored_by_agent_id: 'plan-agent', green: false, evidence: [] },
    }],
  ];
  for (const [, task] of operationCodeStateCases) {
    const result = await verdictFor(task);
    assertNamedFailure(result, '[category-stage]');
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

test('issue 107 persisted operation stages require their exact predecessor state and preserve escalation at plan', async (t) => {
  const completed = completedOperationTask();
  const verificationPlaceholder = {
    verdict: null,
    verifier_agent_id: null,
    postconditions: [],
    findings: [],
    evidence: [],
  };
  const escalation = canonicalOperationTask({
    plan: {
      result: 'escalation',
      slices: ['Resolve the registry ownership fork.'],
      escalation: {
        fork: 'The authoritative registry is not established.',
        options: ['Use the local registry.', 'Use the remote registry.'],
      },
    },
  });
  const validStates = [
    canonicalOperationTask({ status: 'pending', stage: 'capture' }),
    canonicalOperationTask(),
    canonicalOperationTask({ stage: 'execute', plan: completed.plan }),
    completedOperationTask({
      status: 'in_progress',
      stage: 'verify',
      agents: {
        executor_agent_id: 'executor',
        verifier_agent_id: null,
        audit_agent_id: null,
      },
      verification: verificationPlaceholder,
    }),
    completedOperationTask({
      status: 'in_progress',
      stage: 'audit',
      audit: {
        required: true,
        verdict: 'na',
        audit_agent_id: null,
        findings: [],
        evidence: [],
      },
    }),
    escalation,
    completed,
  ];
  for (const task of validStates) {
    const result = await verdictFor(task);
    assert.equal(result.ok, true, result.stderr.join('\n'));
  }

  /** @type {Array<[string, Record<string, any>]>} */
  const unreachableStates = [
    ['execute without a completed plan', canonicalOperationTask({ stage: 'execute' })],
    ['verify without completed execution', canonicalOperationTask({
      stage: 'verify',
      plan: completed.plan,
      verification: verificationPlaceholder,
    })],
    ['audit without completed execution', canonicalOperationTask({
      stage: 'audit',
      plan: completed.plan,
      agents: {
        executor_agent_id: null,
        verifier_agent_id: 'verifier',
        audit_agent_id: null,
      },
      verification: completed.verification,
      audit: {
        required: true,
        verdict: 'na',
        audit_agent_id: null,
        findings: [],
        evidence: [],
      },
    })],
    ['escalation advanced beyond plan', { ...escalation, stage: 'execute' }],
    ['done status before done stage', { ...completed, stage: 'verify' }],
    ['done stage before done status', { ...completed, status: 'in_progress' }],
  ];
  for (const [name, task] of unreachableStates) {
    await t.test(name, async () => {
      const result = await verdictFor(task);
      assertNamedFailure(result, '[operation-state]');
    });
  }
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

test('issue 107 completed approval state retains the exact latest request and its ordering', async (t) => {
  const mutation = 'Rewrite the shared release registry entry from source to destination.';
  const request = {
    id: 0,
    mutation,
    requestedBy: 'approval-requester',
    requestedAt: '2026-07-26T15:20:00Z',
    cycle: 0,
  };
  const approval = {
    mutation,
    grantedBy: 'Chef',
    grantedAt: '2026-07-26T15:30:00Z',
  };
  const completed = completedOperationTask();
  const approved = completedOperationTask({
    plan: {
      ...completed.plan,
      approvalBoundary: mutation,
      requiresApproval: true,
    },
    approvalRequests: [request],
    approvals: [approval],
    execution: {
      ...completed.execution,
      recordedAt: '2026-07-26T15:40:00Z',
      approvalRequestId: request.id,
      approval,
    },
  });

  const accepted = await verdictFor(approved);
  assert.equal(accepted.ok, true, accepted.stderr.join('\n'));

  /** @type {Array<[string, Record<string, any>, string]>} */
  const invalidExistingContracts = [
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
    ['grant does not match the planned approval boundary', {
      ...approved,
      plan: {
        ...approved.plan,
        approvalBoundary: 'Delete the shared release registry entry.',
      },
    }, '[inv4]'],
    ['executor identity cannot be the recorded operator provenance', {
      ...approved,
      approvals: [{ ...approval, grantedBy: approved.agents.executor_agent_id }],
      execution: {
        ...approved.execution,
        approval: { ...approval, grantedBy: approved.agents.executor_agent_id },
      },
    }, '[inv2]'],
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
  for (const [name, task, failure] of invalidExistingContracts) {
    await t.test(name, async () => {
      const result = await verdictFor(task);
      assertNamedFailure(result, failure);
    });
  }

  const withoutRequest = structuredClone(approved);
  delete withoutRequest.approvalRequests;
  /** @type {Array<[string, Record<string, any>]>} */
  const invalidProvenance = [
    ['missing immutable request', withoutRequest],
    ['stale same-text grant from an earlier request', {
      ...approved,
      approvalRequests: [
        request,
        {
          ...request,
          id: 1,
          requestedBy: 'later-requester',
          requestedAt: '2026-07-26T15:35:00Z',
        },
      ],
    }],
    ['grant recorded before its request', {
      ...approved,
      approvalRequests: [{
        ...request,
        requestedAt: '2026-07-26T15:31:00Z',
      }],
    }],
    ['execution recorded before its grant', {
      ...approved,
      execution: {
        ...approved.execution,
        recordedAt: '2026-07-26T15:29:00Z',
      },
    }],
    ['final executor reused the immediate requester', {
      ...approved,
      agents: {
        ...approved.agents,
        executor_agent_id: request.requestedBy,
      },
      execution: {
        ...approved.execution,
        executor_agent_id: request.requestedBy,
      },
    }],
  ];
  for (const [name, task] of invalidProvenance) {
    await t.test(name, async () => {
      const result = await verdictFor(task);
      assertNamedFailure(result, '[approval-provenance]');
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
      scan: {
        command: 'review-security --json',
        recommendation: 'PASS',
        reportPath: 'scratchpads/operation-audit.md',
      },
      coverage: auditCoverage(),
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

test('issue 107 operation identities are nonempty when recorded and null only while vacant', async (t) => {
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
      scan: {
        command: 'review-security --json',
        recommendation: 'PASS',
        reportPath: 'scratchpads/operation-audit.md',
      },
      coverage: auditCoverage(),
    },
  });
  const vacant = await verdictFor(canonicalOperationTask());
  assert.equal(vacant.ok, true, vacant.stderr.join('\n'));

  /** @type {Array<[string, Record<string, any>]>} */
  const emptyIdentities = [
    ['executor', {
      ...completed,
      agents: { ...completed.agents, executor_agent_id: '' },
      execution: { ...completed.execution, executor_agent_id: '' },
    }],
    ['verifier', {
      ...completed,
      agents: { ...completed.agents, verifier_agent_id: '' },
      verification: { ...completed.verification, verifier_agent_id: '' },
    }],
    ['auditor', {
      ...audited,
      agents: { ...audited.agents, audit_agent_id: '' },
      audit: { ...audited.audit, audit_agent_id: '' },
    }],
  ];
  for (const [name, task] of emptyIdentities) {
    await t.test(name, async () => {
      const result = await verdictFor(task);
      assertNamedFailure(result, '[operation-identity]');
    });
  }
});

test('issue 107 required operation audit accepts only the vacant na placeholder', async () => {
  const completed = completedOperationTask();
  const awaitingAudit = completedOperationTask({
    status: 'in_progress',
    stage: 'audit',
    audit: {
      required: true,
      verdict: 'na',
      audit_agent_id: null,
      findings: [],
      evidence: [],
    },
  });
  const vacant = await verdictFor(awaitingAudit);
  assert.equal(vacant.ok, true, vacant.stderr.join('\n'));

  const occupiedNa = {
    ...awaitingAudit,
    agents: {
      ...completed.agents,
      audit_agent_id: 'na-auditor',
    },
    audit: {
      required: true,
      verdict: 'na',
      audit_agent_id: 'na-auditor',
      findings: [],
      evidence: [{ command: 'review-security --json', output: 'no findings' }],
      scan: {
        command: 'review-security --json',
        recommendation: 'PASS',
        reportPath: 'scratchpads/operation-audit.md',
      },
      coverage: auditCoverage(),
    },
  };
  const result = await verdictFor(occupiedNa);
  assertNamedFailure(result, '[operation-audit]');
});

test('issue 107 pending approval state retains its requesting executor and immutable request', async () => {
  const completed = completedOperationTask();
  const approvalBoundary = 'Rewrite the shared release registry entry from source to destination.';
  const request = {
    id: 0,
    mutation: approvalBoundary,
    requestedBy: 'approval-requester',
    requestedAt: '2026-07-26T15:20:00Z',
    cycle: 0,
  };
  const pending = canonicalOperationTask({
    stage: 'execute',
    agents: {
      ...canonicalOperationTask().agents,
      executor_agent_id: request.requestedBy,
    },
    plan: {
      ...completed.plan,
      requiresApproval: true,
      approvalBoundary,
    },
    approvalRequests: [request],
    execution: {
      result: 'approval-required',
      executor_agent_id: request.requestedBy,
      cycle: request.cycle,
      recordedAt: request.requestedAt,
      approvalRequestId: request.id,
      actions: ['Captured the recoverable pre-mutation state.'],
      evidence: [{ command: 'inspect source state', output: 'recovery snapshot recorded' }],
      approvalRequired: approvalBoundary,
    },
  });
  const accepted = await verdictFor(pending);
  assert.equal(accepted.ok, true, accepted.stderr.join('\n'));

  const missingExecutor = structuredClone(pending);
  missingExecutor.agents.executor_agent_id = null;
  missingExecutor.execution.executor_agent_id = null;
  const result = await verdictFor(missingExecutor);
  assert.equal(result.ok, false, 'an approval request without a requesting executor must not validate');
  assert.match(result.stderr.join('\n'), /executor/i);
});

test('issue 105 recovery persisted operation judgments retain strict findings, refutes, and audit proof', async (t) => {
  const completed = completedOperationTask();
  const finding = operationFinding();
  const refute = operationRefute(finding);
  const judged = completedOperationTask({
    status: 'in_progress',
    stage: 'verify',
    verification: {
      ...completed.verification,
      verdict: 'needs-work',
      reportedVerdict: 'needs-work',
      findings: [{ ...finding, refute }],
    },
    refutes: [refute],
  });
  const judgedControl = await verdictFor(judged);
  assert.equal(judgedControl.ok, true, judgedControl.stderr.join('\n'));

  const wrongSourceRefute = operationRefute(finding, { source: 'review' });
  /** @type {Array<[string, Record<string, any>]>} */
  const malformedJudgments = [
    ['verification finding item', {
      ...judged,
      verification: { ...judged.verification, findings: [{}] },
      refutes: [],
    }],
    ['operation finding destination', {
      ...judged,
      verification: {
        ...judged.verification,
        findings: [{ ...finding, kickTo: 'implement', refute }],
      },
    }],
    ['source-bound finding refute', {
      ...judged,
      verification: {
        ...judged.verification,
        findings: [{ ...finding, refute: wrongSourceRefute }],
      },
      refutes: [wrongSourceRefute],
    }],
    ['retained refute item', { ...judged, refutes: [{}] }],
    ['retained attached refute', { ...judged, refutes: [] }],
  ];
  for (const [name, task] of malformedJudgments) {
    await t.test(`rejects malformed ${name}`, async () => {
      const result = await verdictFor(task);
      assert.equal(result.ok, false, `${name} must fail persisted validation`);
    });
  }

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
      scan: {
        command: 'review-security --json',
        recommendation: 'PASS',
        reportPath: 'scratchpads/operation-audit.md',
      },
      coverage: auditCoverage(),
    },
  });
  const auditedControl = await verdictFor(audited);
  assert.equal(auditedControl.ok, true, auditedControl.stderr.join('\n'));

  /** @param {string} field */
  const withoutAuditField = (field) => {
    const task = structuredClone(audited);
    delete task.audit[field];
    return task;
  };
  /** @type {Array<[string, Record<string, any>]>} */
  const malformedAudits = [
    ['nonempty evidence', {
      ...audited,
      audit: { ...audited.audit, evidence: [] },
    }],
    ['findings container', withoutAuditField('findings')],
    ['finding item', {
      ...audited,
      audit: { ...audited.audit, findings: [{}] },
    }],
    ['scan record', withoutAuditField('scan')],
    ['scan field', {
      ...audited,
      audit: { ...audited.audit, scan: { ...audited.audit.scan, command: '' } },
    }],
    ['coverage record', withoutAuditField('coverage')],
    ['complete coverage', {
      ...audited,
      audit: { ...audited.audit, coverage: auditCoverage().slice(1) },
    }],
    ['coverage item', {
      ...audited,
      audit: {
        ...audited.audit,
        coverage: [
          { ...auditCoverage()[0], status: 'unchecked' },
          ...auditCoverage().slice(1),
        ],
      },
    }],
    ['verifier/auditor separation', {
      ...audited,
      agents: { ...audited.agents, audit_agent_id: audited.agents.verifier_agent_id },
      audit: { ...audited.audit, audit_agent_id: audited.agents.verifier_agent_id },
    }],
  ];
  for (const [name, task] of malformedAudits) {
    await t.test(`rejects required audit without ${name}`, async () => {
      const result = await verdictFor(task);
      assert.equal(result.ok, false, `required audit without ${name} must not satisfy done`);
    });
  }
});

test('issue 107 persisted operation refutes differ from active and archived source judges', async (t) => {
  const completed = completedOperationTask();
  const activeFinding = operationFinding();
  const activeRefute = operationRefute(activeFinding);
  const active = completedOperationTask({
    status: 'in_progress',
    stage: 'verify',
    verification: {
      ...completed.verification,
      verdict: 'needs-work',
      reportedVerdict: 'needs-work',
      findings: [{ ...activeFinding, refute: activeRefute }],
    },
    refutes: [activeRefute],
  });
  const activeControl = await verdictFor(active);
  assert.equal(activeControl.ok, true, activeControl.stderr.join('\n'));

  const activeSelfRefute = {
    ...activeRefute,
    agent_id: active.verification.verifier_agent_id,
  };
  await t.test('active verifier cannot refute its own finding', async () => {
    const result = await verdictFor({
      ...active,
      verification: {
        ...active.verification,
        findings: [{ ...activeFinding, refute: activeSelfRefute }],
      },
      refutes: [activeSelfRefute],
    });
    assertNamedFailure(result, '[operation-refute-identity]');
  });

  const archivedFinding = operationFinding({
    line: 20,
    what: 'The recovery path broadens the approved mutation.',
    cwe: null,
  });
  const archivedRefute = operationRefute(archivedFinding, {
    agent_id: 'archived-audit-refuter',
    source: 'audit',
  });
  const archived = completedOperationTask({
    status: 'in_progress',
    stage: 'verify',
    agents: {
      executor_agent_id: 'executor',
      verifier_agent_id: null,
      audit_agent_id: null,
    },
    verification: {
      verdict: null,
      verifier_agent_id: null,
      postconditions: [],
      findings: [],
      evidence: [],
    },
    audit: {
      required: true,
      verdict: 'na',
      audit_agent_id: null,
      findings: [],
      evidence: [],
    },
    refutes: [archivedRefute],
    judgmentHistory: [{
      cycle: 0,
      at: '2026-07-12T01:00:00Z',
      verification: {
        ...completed.verification,
        verifier_agent_id: 'archived-verifier',
      },
      audit: {
        required: true,
        verdict: 'needs-work',
        reportedVerdict: 'needs-work',
        audit_agent_id: 'archived-auditor',
        findings: [{ ...archivedFinding, refute: archivedRefute }],
        evidence: [{ command: 'review-security --json', output: 'blocking finding retained' }],
        scan: {
          command: 'review-security --json',
          recommendation: 'BLOCK',
          reportPath: 'scratchpads/archived-operation-audit.md',
        },
        coverage: auditCoverage(),
      },
      agents: {
        verifier_agent_id: 'archived-verifier',
        audit_agent_id: 'archived-auditor',
      },
    }],
  });
  const archivedControl = await verdictFor(archived);
  assert.equal(archivedControl.ok, true, archivedControl.stderr.join('\n'));

  await t.test('archived auditor cannot refute its own finding', async () => {
    const selfRefute = {
      ...archivedRefute,
      agent_id: 'archived-auditor',
    };
    const task = structuredClone(archived);
    task.refutes = [selfRefute];
    task.judgmentHistory[0].audit.findings[0].refute = selfRefute;
    const result = await verdictFor(task);
    assertNamedFailure(result, '[operation-refute-identity]');
  });
});

test('issue 107 persisted councils bind the exact cap and prove one fresh scoped execution', async (t) => {
  const completed = completedOperationTask();
  const finding = operationFinding();
  const refute = operationRefute(finding);
  const members = [
    { agent_id: 'operation-integrity', lens: 'integrity', temperature: 0.3 },
    { agent_id: 'operation-security', lens: 'security', temperature: 0.7 },
    { agent_id: 'operation-pragmatist', lens: 'pragmatist', temperature: 1 },
  ];
  const stages = {
    verify: { blockingKickbacks: 2 },
    audit: { blockingKickbacks: 0 },
  };
  const initialShip = completedOperationTask({
    verification: {
      ...completed.verification,
      verdict: 'needs-work',
      reportedVerdict: 'needs-work',
      findings: [{ ...finding, refute }],
    },
    refutes: [refute],
    convergence: {
      cap: 2,
      stages,
      council: {
        convened: true,
        stage: 'verify',
        cycle: 0,
        executor_agent_id: 'executor',
        members,
        findings: [{
          id: 'F1',
          summary: finding.what,
          source: 'verify',
          blockingVotes: 1,
          survived: false,
          followupTaskId: '#28',
        }],
        verdict: 'ship',
        outcome: 'shipped',
      },
    },
  });
  const initialControl = await verdictFor(initialShip);
  assert.equal(initialControl.ok, true, initialControl.stderr.join('\n'));

  const withoutAttachedRefute = structuredClone(initialShip);
  delete withoutAttachedRefute.verification.findings[0].refute;
  const wrongSource = structuredClone(initialShip);
  wrongSource.verification.findings[0].refute.source = 'audit';
  wrongSource.refutes[0].source = 'audit';
  /** @type {Array<[string, Record<string, any>]>} */
  const invalidInitialShips = [
    ['an attached source-bound refute', withoutAttachedRefute],
    ['the retained top-level refute', { ...initialShip, refutes: [] }],
    ['a valid retained refute item', { ...initialShip, refutes: [{}] }],
    ['matching refute source provenance', wrongSource],
  ];
  for (const [name, task] of invalidInitialShips) {
    await t.test(`initial council ship rejects without ${name}`, async () => {
      const result = await verdictFor(task);
      assert.equal(result.ok, false, `initial council ship without ${name} must not validate`);
    });
  }

  const pendingCouncil = structuredClone(initialShip);
  pendingCouncil.status = 'in_progress';
  pendingCouncil.stage = 'execute';
  pendingCouncil.convergence.council.findings[0].blockingVotes = 2;
  pendingCouncil.convergence.council.findings[0].survived = true;
  pendingCouncil.convergence.council.findings[0].followupTaskId = null;
  pendingCouncil.convergence.council.verdict = 'block';
  pendingCouncil.convergence.council.outcome = null;
  pendingCouncil.kickbacks = [{
    from: 'verify',
    to: 'execute',
    reason: `Council block: ${finding.what}`,
    at: '2026-07-12T01:00:00Z',
  }];
  const pendingControl = await verdictFor(pendingCouncil);
  assert.equal(pendingControl.ok, true, pendingControl.stderr.join('\n'));

  const historicalVerification = {
    ...completed.verification,
    verdict: 'needs-work',
    reportedVerdict: 'needs-work',
    verifier_agent_id: 'initial-verifier',
    findings: [{ ...finding, refute }],
  };
  const scopedRecovery = completedOperationTask({
    agents: {
      executor_agent_id: 'scoped-executor',
      verifier_agent_id: 'fresh-verifier',
      audit_agent_id: null,
    },
    execution: {
      ...completed.execution,
      executor_agent_id: 'scoped-executor',
      cycle: 1,
      recordedAt: '2026-07-12T01:10:00Z',
    },
    verification: {
      ...completed.verification,
      verifier_agent_id: 'fresh-verifier',
    },
    refutes: [refute],
    judgmentHistory: [{
      cycle: 0,
      at: '2026-07-12T01:00:00Z',
      verification: historicalVerification,
      audit: {
        required: false,
        verdict: 'na',
        audit_agent_id: null,
        findings: [],
        evidence: [],
      },
      agents: {
        verifier_agent_id: 'initial-verifier',
        audit_agent_id: null,
      },
    }],
    kickbacks: [{
      from: 'verify',
      to: 'execute',
      reason: `Council block: ${finding.what}`,
      at: '2026-07-12T01:00:00Z',
    }],
    convergence: {
      cap: 2,
      stages,
      council: {
        convened: true,
        stage: 'verify',
        cycle: 0,
        executor_agent_id: 'executor',
        members,
        findings: [{
          id: 'F1',
          summary: finding.what,
          source: 'verify',
          blockingVotes: 2,
          survived: true,
          followupTaskId: null,
        }],
        verdict: 'block',
        outcome: 'scoped-fix-shipped',
      },
    },
  });
  const scopedControl = await verdictFor(scopedRecovery);
  assert.equal(scopedControl.ok, true, scopedControl.stderr.join('\n'));

  const auditFinding = operationFinding({
    line: 20,
    what: 'The audited recovery boundary remains too broad.',
    cwe: null,
  });
  const auditRefute = operationRefute(auditFinding, {
    agent_id: 'audit-refuter',
    source: 'audit',
  });
  const auditShip = completedOperationTask({
    agents: {
      ...completed.agents,
      audit_agent_id: 'operation-auditor',
    },
    audit: {
      required: true,
      verdict: 'needs-work',
      reportedVerdict: 'needs-work',
      audit_agent_id: 'operation-auditor',
      findings: [{ ...auditFinding, refute: auditRefute }],
      evidence: [{ command: 'review-security --json', output: 'blocking finding retained' }],
      scan: {
        command: 'review-security --json',
        recommendation: 'BLOCK',
        reportPath: 'scratchpads/operation-audit.md',
      },
      coverage: auditCoverage(),
    },
    refutes: [auditRefute],
    convergence: {
      cap: 2,
      stages: {
        verify: { blockingKickbacks: 0 },
        audit: { blockingKickbacks: 2 },
      },
      council: {
        convened: true,
        stage: 'audit',
        cycle: 0,
        executor_agent_id: 'executor',
        members,
        findings: [{
          id: 'F1',
          summary: auditFinding.what,
          source: 'audit',
          blockingVotes: 1,
          survived: false,
          followupTaskId: '#28',
        }],
        verdict: 'ship',
        outcome: 'shipped',
      },
    },
  });
  const auditControl = await verdictFor(auditShip);
  assert.equal(auditControl.ok, true, auditControl.stderr.join('\n'));

  const belowCapStates = [
    initialShip,
    pendingCouncil,
    scopedRecovery,
  ].map((task) => ({
    ...task,
    convergence: {
      ...task.convergence,
      stages: {
        verify: { blockingKickbacks: 1 },
        audit: { blockingKickbacks: 2 },
      },
    },
  }));
  belowCapStates.push({
    ...auditShip,
    convergence: {
      ...auditShip.convergence,
      stages: {
        verify: { blockingKickbacks: 2 },
        audit: { blockingKickbacks: 1 },
      },
    },
  });
  for (const [index, task] of belowCapStates.entries()) {
    await t.test(`council state ${index + 1} rejects another source reaching cap`, async () => {
      const result = await verdictFor(task);
      assertNamedFailure(result, '[operation-council]');
    });
  }

  const withoutHistory = structuredClone(scopedRecovery);
  delete withoutHistory.judgmentHistory;
  const malformedHistory = {
    ...scopedRecovery,
    judgmentHistory: [{}],
  };
  const staleVerifier = structuredClone(scopedRecovery);
  staleVerifier.agents.verifier_agent_id = 'initial-verifier';
  staleVerifier.verification.verifier_agent_id = 'initial-verifier';
  const historyWithoutRefute = structuredClone(scopedRecovery);
  delete historyWithoutRefute.judgmentHistory[0].verification.findings[0].refute;
  /** @type {Array<[string, Record<string, any>]>} */
  const invalidExistingProof = [
    ['judgment history', withoutHistory],
    ['valid judgment history', malformedHistory],
    ['the council-to-execute kickback', { ...scopedRecovery, kickbacks: [] }],
    ['fresh reassessment verifier', staleVerifier],
    ['historical source-bound refute', historyWithoutRefute],
  ];
  for (const [name, task] of invalidExistingProof) {
    await t.test(`scoped-fix-shipped rejects without ${name}`, async () => {
      const result = await verdictFor(task);
      assert.equal(result.ok, false, `scoped-fix-shipped without ${name} must not validate`);
    });
  }

  const zeroRecovery = structuredClone(scopedRecovery);
  zeroRecovery.execution.cycle = 0;
  const reusedExecutor = structuredClone(scopedRecovery);
  reusedExecutor.agents.executor_agent_id = 'executor';
  reusedExecutor.execution.executor_agent_id = 'executor';
  const multipleRecoveries = structuredClone(scopedRecovery);
  const secondHistory = structuredClone(scopedRecovery.judgmentHistory[0]);
  secondHistory.cycle = 1;
  secondHistory.at = '2026-07-12T01:05:00Z';
  secondHistory.agents.verifier_agent_id = 'second-archived-verifier';
  secondHistory.verification.verifier_agent_id = 'second-archived-verifier';
  multipleRecoveries.judgmentHistory.push(secondHistory);
  multipleRecoveries.execution.cycle = 2;
  multipleRecoveries.execution.recordedAt = '2026-07-12T01:20:00Z';
  const reusedEarlierVerifier = structuredClone(multipleRecoveries);
  reusedEarlierVerifier.agents.verifier_agent_id = 'initial-verifier';
  reusedEarlierVerifier.verification.verifier_agent_id = 'initial-verifier';
  const archivedCouncilMember = structuredClone(scopedRecovery);
  archivedCouncilMember.judgmentHistory[0].agents.verifier_agent_id = 'operation-integrity';
  archivedCouncilMember.judgmentHistory[0].verification.verifier_agent_id = 'operation-integrity';
  /** @type {Array<[string, Record<string, any>]>} */
  const invalidRecoveryProvenance = [
    ['zero post-council executions', zeroRecovery],
    ['the pre-council executor reused after recovery', reusedExecutor],
    ['multiple post-council executions', multipleRecoveries],
    ['a verifier reused from an earlier post-council cycle', reusedEarlierVerifier],
    ['a council member reused as an archived judge', archivedCouncilMember],
  ];
  for (const [name, task] of invalidRecoveryProvenance) {
    await t.test(name, async () => {
      const result = await verdictFor(task);
      assertNamedFailure(result, '[operation-recovery]');
    });
  }
});

test('issue 107 compatibility explicitly separates legacy ledgers from authoritative operation state', async (t) => {
  const completed = completedOperationTask();
  const legacyOperation = structuredClone(completed);
  delete legacyOperation.operationStateVersion;
  delete legacyOperation.execution.cycle;
  delete legacyOperation.execution.recordedAt;
  const mutation = 'Rewrite the shared release registry entry from source to destination.';
  const grant = {
    mutation,
    grantedBy: 'Chef',
    grantedAt: '2026-07-26T15:30:00Z',
  };
  const legacyApproval = completedOperationTask({
    plan: {
      ...completed.plan,
      requiresApproval: true,
      approvalBoundary: mutation,
    },
    approvals: [grant],
    execution: {
      ...completed.execution,
      approval: grant,
    },
  });
  delete legacyApproval.operationStateVersion;
  delete legacyApproval.execution.cycle;
  delete legacyApproval.execution.recordedAt;

  /** @type {Array<[string, Record<string, any>]>} */
  const compatibleLedgers = [
    ['historical code ledger', canonicalTask()],
    ['existing operation ledger', legacyOperation],
    ['existing approval-gated operation ledger', legacyApproval],
    ['authoritative operation ledger', completed],
  ];
  for (const [name, task] of compatibleLedgers) {
    await t.test(name, async () => {
      const result = await verdictFor(task);
      assert.equal(result.ok, true, result.stderr.join('\n'));
    });
  }

  const missingProvenance = structuredClone(completed);
  delete missingProvenance.execution.cycle;
  delete missingProvenance.execution.recordedAt;
  /** @type {Array<[string, Record<string, any>]>} */
  const invalidVersions = [
    ['unknown operation state version', { ...completed, operationStateVersion: 2 }],
    ['authoritative operation missing provenance', missingProvenance],
  ];
  for (const [name, task] of invalidVersions) {
    await t.test(name, async () => {
      const result = await verdictFor(task);
      assertNamedFailure(result, '[operation-version]');
    });
  }
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

test('issue 121 second recovery: code audit identities are durably bound and separated under INV-2', async (t) => {
  const terminal = canonicalTask({
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
      audit_agent_id: 'auditor',
    },
    review: {
      verdict: 'pass',
      reviewer_agent_id: 'reviewer-one',
      evidence: ['review one'],
    },
    review2: null,
    audit: {
      required: true,
      verdict: 'pass',
      audit_agent_id: 'auditor',
      evidence: ['audit'],
    },
  });
  /** @type {Array<[string, Record<string, any>]>} */
  const categories = [
    ['explicit code category', { category: 'code' }],
    ['historical category omission', {}],
  ];
  /** @type {Array<[string, Record<string, any>, Record<string, any>, boolean]>} */
  const cases = [
    [
      'a distinct agents-only auditor remains valid',
      { audit_agent_id: 'auditor' },
      { audit_agent_id: null },
      true,
    ],
    [
      'a distinct outcome-only auditor remains valid',
      { audit_agent_id: null },
      { audit_agent_id: 'auditor' },
      true,
    ],
    [
      'a passing audit requires at least one auditor identity',
      { audit_agent_id: null },
      { audit_agent_id: null },
      false,
    ],
    [
      'the agents-only auditor cannot be the implementer',
      { audit_agent_id: terminal.agents.implementer_agent_id },
      { audit_agent_id: null },
      false,
    ],
    [
      'the outcome-only auditor cannot be the implementer',
      { audit_agent_id: null },
      { audit_agent_id: terminal.agents.implementer_agent_id },
      false,
    ],
    [
      'matching dual auditor identities remain valid',
      { audit_agent_id: 'auditor' },
      { audit_agent_id: 'auditor' },
      true,
    ],
    [
      'contradictory dual auditor identities fail closed',
      { audit_agent_id: 'auditor' },
      { audit_agent_id: 'different-auditor' },
      false,
    ],
  ];

  for (const [name, agents, audit, accepted] of cases) {
    await t.test(`${name} for explicit and historical code ledgers`, async () => {
      const results = await Promise.all(categories.map(async ([categoryName, category]) => ({
        categoryName,
        result: await verdictFor({
          ...terminal,
          ...category,
          agents: { ...terminal.agents, ...agents },
          audit: { ...terminal.audit, ...audit },
        }),
      })));
      const summary = results
        .map(({ categoryName, result }) => `${categoryName}: ok=${result.ok}\n${result.stderr.join('\n')}`)
        .join('\n');
      assert.deepEqual(
        results.map(({ result }) => (
          accepted
            ? result.ok
            : !result.ok && result.stderr.some((line) => line.includes('[inv2]'))
        )),
        [true, true],
        summary,
      );
    });
  }

  await t.test('the required-audit na placeholder remains valid and vacant for explicit and historical code ledgers', async () => {
    const results = await Promise.all(categories.map(async ([categoryName, category]) => ({
      categoryName,
      result: await verdictFor({
        ...terminal,
        ...category,
        agents: { ...terminal.agents, audit_agent_id: null },
        audit: {
          ...terminal.audit,
          verdict: 'na',
          audit_agent_id: null,
          evidence: [],
        },
      }),
    })));
    assert.deepEqual(
      results.map(({ result }) => result.ok),
      [true, true],
      results
        .map(({ categoryName, result }) => `${categoryName}: ${result.stderr.join('\n')}`)
        .join('\n'),
    );
  });
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

test('issue 140 terminally pruned predecessor remains machine-readable and unblocks its successor', async () => {
  const root = await makeStore('full');
  const predecessorDir = join(root, '.jeff', 'tasks', '0001-predecessor');
  const successorDir = join(root, '.jeff', 'tasks', '0002-successor');
  const independentDir = join(root, '.jeff', 'tasks', '0003-independent');
  const predecessor = canonicalTask({
    id: 1,
    externalRef: undefined,
    slug: 'predecessor',
    status: 'abandoned',
    abandonReason: 'superseded',
  });
  const successor = canonicalTask({
    id: 2,
    externalRef: undefined,
    slug: 'successor',
    deps: [1],
  });
  const independent = canonicalTask({
    id: 3,
    externalRef: undefined,
    slug: 'independent',
  });

  try {
    await writeTask(root, predecessor, '0001-predecessor');
    await writeTask(root, successor, '0002-successor');
    await writeTask(root, independent, '0003-independent');
    assertNamedFailure(await validateStore(root), '[prune]');

    await writeFile(
      join(root, '.jeff', 'config.json'),
      JSON.stringify({ prunedTaskIds: [1] }),
      'utf8',
    );
    await rm(predecessorDir, { recursive: true });

    const afterPrune = await validateStore(root);
    assert.equal(afterPrune.ok, true, afterPrune.stderr.join('\n'));
    const persistedConfig = JSON.parse(await readFile(join(root, '.jeff', 'config.json'), 'utf8'));
    const persistedSuccessor = JSON.parse(await readFile(join(successorDir, 'task.json'), 'utf8'));
    const persistedIndependent = JSON.parse(await readFile(join(independentDir, 'task.json'), 'utf8'));
    assert.deepEqual(persistedConfig.prunedTaskIds, [1]);
    assert.deepEqual(persistedSuccessor.deps, [1]);
    assert.deepEqual(persistedIndependent.deps, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 140 only live or terminally pruned dependencies participate in the live DAG', async (t) => {
  await t.test('allocation provenance cannot bless a missing nonterminal predecessor', async () => {
    const root = await makeStore('full');
    const predecessorDir = join(root, '.jeff', 'tasks', '0001-predecessor');
    try {
      await writeTask(root, canonicalTask({
        id: 1,
        externalRef: undefined,
        slug: 'predecessor',
      }), '0001-predecessor');
      await writeTask(root, canonicalTask({
        id: 2,
        externalRef: undefined,
        slug: 'successor',
        deps: [1],
      }), '0002-successor');
      await writeFile(
        join(root, '.jeff', 'config.json'),
        JSON.stringify({}),
        'utf8',
      );
      await rm(predecessorDir, { recursive: true });

      assertNamedFailure(await validateStore(root), '[inv5]');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('never-issued predecessor', async () => {
    const root = await makeStore('full');
    try {
      await writeFile(
        join(root, '.jeff', 'config.json'),
        JSON.stringify({ prunedTaskIds: [1] }),
        'utf8',
      );
      await writeTask(root, canonicalTask({
        id: 2,
        externalRef: undefined,
        slug: 'successor',
        deps: [999],
      }), '0002-successor');

      assertNamedFailure(await validateStore(root), '[inv5]');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('cycle among live tasks', async () => {
    const root = await makeStore('full');
    try {
      await writeFile(
        join(root, '.jeff', 'config.json'),
        JSON.stringify({ prunedTaskIds: [9] }),
        'utf8',
      );
      await writeTask(root, canonicalTask({
        id: 1,
        externalRef: undefined,
        slug: 'first',
        deps: [2],
      }), '0001-first');
      await writeTask(root, canonicalTask({
        id: 2,
        externalRef: undefined,
        slug: 'second',
        deps: [1],
      }), '0002-second');

      const result = await validateStore(root);
      assertNamedFailure(result, '[inv5]');
      assert.ok(result.stderr.some((line) => line.includes('dependency cycle')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 140 terminal provenance rejects malformed and duplicate ids in nonempty and empty full stores', async (t) => {
  await t.test('malformed id in a nonempty store', async () => {
    const root = await makeStore('full');
    try {
      await writeFile(
        join(root, '.jeff', 'config.json'),
        JSON.stringify({ prunedTaskIds: ['1'] }),
        'utf8',
      );
      await writeTask(root, canonicalTask({ id: 1, externalRef: undefined }));

      assertNamedFailure(await validateStore(root), '[schema] prunedTaskIds');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('zero is not a positive task id', async () => {
    const root = await makeStore('full');
    try {
      await writeFile(
        join(root, '.jeff', 'config.json'),
        JSON.stringify({ prunedTaskIds: [0] }),
        'utf8',
      );
      await writeTask(root, canonicalTask({
        id: 1,
        externalRef: undefined,
        deps: [0],
      }));

      assertNamedFailure(await validateStore(root), '[schema] prunedTaskIds');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('live task id cannot also be terminal provenance', async () => {
    const root = await makeStore('full');
    try {
      await writeFile(
        join(root, '.jeff', 'config.json'),
        JSON.stringify({ prunedTaskIds: [1] }),
        'utf8',
      );
      await writeTask(root, canonicalTask({ id: 1, externalRef: undefined }));

      assertNamedFailure(
        await validateStore(root),
        'live task id 1 must not appear in config prunedTaskIds [inv5]',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('duplicate id in an empty store', async () => {
    const root = await makeStore('full');
    try {
      await writeFile(
        join(root, '.jeff', 'config.json'),
        JSON.stringify({ prunedTaskIds: [1, 1] }),
        'utf8',
      );

      assertNamedFailure(await validateStore(root), '[inv5]');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('valid terminal provenance in an empty store', async () => {
    const root = await makeStore('full');
    try {
      await writeFile(
        join(root, '.jeff', 'config.json'),
        JSON.stringify({ prunedTaskIds: [1] }),
        'utf8',
      );

      const result = await validateStore(root);
      assert.equal(result.ok, true, result.stderr.join('\n'));
      assert.ok(result.stdout.some((line) => line.includes('nothing to validate')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 140 lite validation ignores full-only terminal provenance', async (t) => {
  /** @type {Array<[string, unknown[]]>} */
  const cases = [
    ['malformed and duplicate provenance', ['invalid', 'invalid']],
    ['live-overlapping provenance', [1]],
  ];

  for (const [name, prunedTaskIds] of cases) {
    await t.test(name, async () => {
      const root = await makeStore('lite');
      try {
        await writeFile(
          join(root, '.jeff', 'config.json'),
          JSON.stringify({ mode: 'lite', prunedTaskIds }),
          'utf8',
        );
        await writeTask(root, canonicalTask({ id: 1, externalRef: undefined }));

        const result = await validateStore(root);
        assert.equal(
          result.ok,
          true,
          `lite validation must ignore full-only prunedTaskIds:\n${result.stderr.join('\n')}`,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 140 full validation fails closed for present invalid config and accepts truly missing config', async (t) => {
  /** @param {string} root */
  const writeValidTask = (root) => writeTask(
    root,
    canonicalTask({ id: 1, externalRef: undefined }),
  );

  await t.test('missing config', async () => {
    const root = await makeStore('full');
    try {
      await writeValidTask(root);
      const result = await validateStore(root);
      assert.equal(result.ok, true, result.stderr.join('\n'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  for (const [name, raw] of [
    ['malformed JSON', '{"prunedTaskIds":'],
    ['non-object JSON', '[]'],
  ]) {
    await t.test(name, async () => {
      const root = await makeStore('full');
      try {
        await writeValidTask(root);
        await writeFile(join(root, '.jeff', 'config.json'), raw, 'utf8');
        assert.equal((await validateStore(root)).ok, false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  await t.test('uncontained config symlink', async () => {
    const root = await makeStore('full');
    const outside = await mkdtemp(join(tmpdir(), 'jeff-task-schema-config-'));
    try {
      await writeValidTask(root);
      const target = join(outside, 'config.json');
      await writeFile(target, JSON.stringify({ prunedTaskIds: [] }), 'utf8');
      await symlink(target, join(root, '.jeff', 'config.json'));
      assert.equal((await validateStore(root)).ok, false);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('issue 140 migration records terminal-only provenance and leaves successor dependencies intact', async () => {
  const migration = await readFile(
    new URL('../../skills/cook/reference/migration.md', import.meta.url),
    'utf8',
  );
  const heading = '## Reconciling resting terminal tasks';
  const start = migration.indexOf(heading);
  assert.notEqual(start, -1, 'migration reconciliation section is missing');
  const nextHeading = migration.indexOf('\n## ', start + heading.length);
  const section = migration.slice(start, nextHeading === -1 ? undefined : nextHeading);

  assert.match(section, /prunedTaskIds/);
  assert.match(section, /(leave|retain|preserve)[\s\S]{0,80}(successor|surviv)[\s\S]{0,80}(deps|dependenc)/i);
  assert.doesNotMatch(section, /issuedTaskIds/);
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
