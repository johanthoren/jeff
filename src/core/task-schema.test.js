// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateStore } from './validate-store.js';
import { runInvariants } from './invariants.js';
import { taskSchemaViolations } from './task-schema.js';
import { hasCompletedApprovalProvenance } from './operation-state.js';
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

test('Item 3 pipelineVersion accepts legacy absence and a nonempty version, and rejects invalid values', async (t) => {
  await t.test('legacy absence remains valid', async () => {
    const result = await verdictFor(canonicalTask());
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  await t.test('nonempty string is valid', async () => {
    const result = await verdictFor(canonicalTask({ pipelineVersion: '6.0.0-alpha.2' }));
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  for (const pipelineVersion of ['', 0, null]) {
    await t.test(`rejects ${JSON.stringify(pipelineVersion)}`, async () => {
      const result = await verdictFor(canonicalTask({ pipelineVersion }));
      assertNamedFailure(result, 'pipelineVersion');
    });
  }
});

/** @param {'review' | 'review2' | 'audit'} source @param {Record<string, any>} [overrides] */
function item4KickbackFinding(source, overrides = {}) {
  return {
    source,
    file: 'src/core/record.js',
    line: source === 'audit' ? 22 : 11,
    what: `${source} found a confined blocker.`,
    kickTo: 'implement',
    ...overrides,
  };
}

/** @param {'review' | 'audit'} raisingSource */
function item4RetainedLedger(raisingSource) {
  const archivedReview = {
    verdict: raisingSource === 'review' ? 'needs-work' : 'pass',
    reviewer_agent_id: 'reviewer-old',
    findings: raisingSource === 'review' ? [{ file: 'src/core/record.js' }] : [],
    evidence: ['archived review'],
  };
  const archivedReview2 = {
    verdict: 'pass',
    reviewer_agent_id: 'reviewer-two-old',
    findings: [],
    evidence: ['archived review two'],
  };
  const archivedAudit = {
    required: true,
    verdict: raisingSource === 'audit' ? 'needs-work' : 'pass',
    audit_agent_id: 'auditor-old',
    findings: raisingSource === 'audit' ? [{ file: 'src/core/record.js' }] : [],
    evidence: ['archived audit'],
  };
  const review = raisingSource === 'audit'
    ? structuredClone(archivedReview)
    : {
      verdict: 'pass',
      reviewer_agent_id: 'reviewer-fresh',
      findings: [],
      evidence: ['fresh review'],
    };
  const review2 = raisingSource === 'audit'
    ? structuredClone(archivedReview2)
    : {
      verdict: 'pass',
      reviewer_agent_id: 'reviewer-two-fresh',
      findings: [],
      evidence: ['fresh review two'],
    };
  const audit = raisingSource === 'review'
    ? structuredClone(archivedAudit)
    : {
      required: true,
      verdict: 'pass',
      audit_agent_id: 'auditor-fresh',
      findings: [],
      evidence: ['fresh audit'],
    };
  return canonicalTask({
    stage: 'review',
    agents: {
      implementer_agent_id: 'implementer-fresh',
      reviewer_agent_id: review.reviewer_agent_id,
      reviewer2_agent_id: review2.reviewer_agent_id,
      audit_agent_id: audit.audit_agent_id,
    },
    tests: { authored_by_agent_id: 'plan', green: false, evidence: [] },
    implement: {
      agent_id: 'implementer-fresh',
      result: 'green',
      files: ['src/core/record.js'],
      greenRun: { command: 'node --test', output: 'pass' },
    },
    review,
    review2,
    audit,
    kickbacks: [{
      from: raisingSource,
      to: 'implement',
      reason: `${raisingSource} found a confined blocker.`,
      at: '2026-07-12T00:30:00Z',
      findings: [item4KickbackFinding(raisingSource)],
    }],
    judgmentHistory: [{
      at: '2026-07-12T00:40:00Z',
      review: archivedReview,
      review2: archivedReview2,
      audit: archivedAudit,
      agents: {
        reviewer_agent_id: archivedReview.reviewer_agent_id,
        reviewer2_agent_id: archivedReview2.reviewer_agent_id,
        audit_agent_id: archivedAudit.audit_agent_id,
      },
    }],
  });
}

test('Item 4 optional kickback findings schema accepts valid values and rejects every invalid member field', async (t) => {
  const kickback = {
    from: 'review',
    to: 'implement',
    reason: 'Confined blockers survived.',
    at: '2026-07-12T00:30:00Z',
  };

  for (const [name, findings] of [
    ['absence', undefined],
    ['empty array', []],
    ['all code judgment sources and destinations', [
      item4KickbackFinding('review', { kickTo: 'capture' }),
      item4KickbackFinding('review2', { kickTo: 'plan' }),
      item4KickbackFinding('audit'),
      item4KickbackFinding('audit', { kickTo: 'refactor' }),
    ]],
  ]) await t.test(`accepts ${name}`, async () => {
    const value = findings === undefined ? kickback : { ...kickback, findings };
    const result = await verdictFor(canonicalTask({ kickbacks: [value] }));
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  const invalid = [
    ['findings', null],
    ['source', [item4KickbackFinding('review', { source: 'verify' })]],
    ['file', [item4KickbackFinding('review', { file: '' })]],
    ['line zero', [item4KickbackFinding('review', { line: 0 })]],
    ['line fractional', [item4KickbackFinding('review', { line: 1.5 })]],
    ['what', [item4KickbackFinding('review', { what: '' })]],
    ['kickTo', [item4KickbackFinding('review', { kickTo: 'execute' })]],
  ];
  for (const [name, findings] of invalid) await t.test(`rejects ${name}`, async () => {
    const result = await verdictFor(canonicalTask({
      kickbacks: [{ ...kickback, findings }],
    }));
    assertNamedFailure(result, `kickbacks[0].${name === 'findings' ? 'findings' : `findings[0].${String(name).split(' ')[0]}`}`);
  });
});

test('Item 4 code judgmentHistory schema rejects malformed entries', async () => {
  const task = item4RetainedLedger('review');
  task.judgmentHistory = [{ at: '2026-07-12T00:40:00Z', garbage: true }];
  delete task.kickbacks[0].findings;
  const result = await verdictFor(task);
  assertNamedFailure(result, 'judgmentHistory[0]');
});

test('Item 4 code judgmentHistory accepts an empty historical ledger without typed retention proof', async () => {
  const task = item4RetainedLedger('review');
  task.judgmentHistory = [];
  delete task.kickbacks[0].findings;

  const result = await verdictFor(task);
  assert.equal(result.ok, true, result.stderr.join('\n'));
});

test('Item 4 code judgmentHistory preserves archived unaudited audits without findings', async () => {
  const task = item4RetainedLedger('review');
  task.kickbacks = [];
  task.judgmentHistory[0].audit = {
    required: false,
    verdict: 'na',
    audit_agent_id: null,
    evidence: [],
  };
  task.judgmentHistory[0].agents.audit_agent_id = null;

  const result = await verdictFor(task);
  assert.equal(result.ok, true, result.stderr.join('\n'));
});

test('Item 4 INV-12 accepts exact retention and historical ledgers without findings', async (t) => {
  for (const source of ['review', 'audit']) await t.test(`${source} raised exact retention`, async () => {
    const result = await verdictFor(item4RetainedLedger(/** @type {'review' | 'audit'} */ (source)));
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  await t.test('refactor repair can produce an exact retained INV-12 proof', async () => {
    const task = item4RetainedLedger('audit');
    task.kickbacks[0].to = 'refactor';
    task.kickbacks[0].findings[0].kickTo = 'refactor';
    delete task.implement;
    task.refactor = {
      agent_id: 'refactorer-fresh',
      result: 'clean',
      files: ['src/core/record.js'],
      outsideDiff: [],
      greenRun: { command: 'node --test', output: 'pass' },
      summary: ['Applied the confined repair.'],
    };
    const result = await verdictFor(task);
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  await t.test('historical category omission is treated as code by INV-12', async () => {
    const task = item4RetainedLedger('review');
    assert.equal(Object.hasOwn(task, 'category'), false);
    task.audit.evidence = ['mismatched retained audit'];
    const result = await verdictFor(task);
    assertNamedFailure(result, '[inv12]');
  });

  await t.test('fresh full-reset judge may reproduce archived output under a new identity', async () => {
    const task = item4RetainedLedger('review');
    task.implement.files = ['src/core/task-schema.js'];
    task.audit = {
      ...structuredClone(task.judgmentHistory[0].audit),
      audit_agent_id: 'auditor-fresh',
    };
    task.agents.audit_agent_id = 'auditor-fresh';
    const result = await verdictFor(task);
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  await t.test('completed review repair retains a valid INV-12 proof', async () => {
    const task = item4RetainedLedger('review');
    task.status = 'done';
    task.stage = 'done';
    task.tests = {
      authored_by_agent_id: 'plan',
      green: true,
      evidence: ['make test'],
    };
    const result = await verdictFor(task);
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  await t.test('historical kickback without findings remains valid', async () => {
    const task = item4RetainedLedger('review');
    delete task.kickbacks[0].findings;
    const result = await verdictFor(task);
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  await t.test('ledger without judgment history remains valid', async () => {
    const task = item4RetainedLedger('review');
    delete task.judgmentHistory;
    const result = await verdictFor(task);
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });
});

test('Item 4 INV-12 enforces agents-only retained sibling identity, pass verdict, and deep equality', async (t) => {
  /** @type {Array<[string, (task: Record<string, any>, source: 'review' | 'audit', agentIdentity: 'reviewer_agent_id' | 'audit_agent_id') => void]>} */
  const mutations = [
    ['identity', (task, source, agentIdentity) => {
      task.agents[agentIdentity] = `${source}-mutated`;
    }],
    ['pass verdict', (task, source) => {
      task[source].verdict = 'needs-work';
    }],
    ['deep equality', (task, source) => {
      task[source].evidence = [`changed ${source} evidence`];
    }],
  ];

  for (const raisingSource of /** @type {const} */ (['review', 'audit'])) {
    const retainedSource = raisingSource === 'review' ? 'audit' : 'review';
    const outcomeIdentity = retainedSource === 'audit' ? 'audit_agent_id' : 'reviewer_agent_id';
    const agentIdentity = retainedSource === 'audit' ? 'audit_agent_id' : 'reviewer_agent_id';
    for (const [name, mutate] of mutations) await t.test(`${retainedSource} ${name}`, async () => {
      const task = item4RetainedLedger(raisingSource);
      task[retainedSource][outcomeIdentity] = null;
      task.judgmentHistory[0][retainedSource][outcomeIdentity] = null;
      mutate(task, retainedSource, agentIdentity);

      const result = await verdictFor(task);
      assertNamedFailure(result, '[inv12]');
    });
  }
});

test('Item 4 INV-12 selects the actual latest judgment kickback', async (t) => {
  /**
   * @param {undefined | any[]} findings
   * @param {boolean} retained
   */
  const latestRoundTask = (findings, retained) => {
    const task = item4RetainedLedger('review');
    const latestHistory = structuredClone(task.judgmentHistory[0]);
    latestHistory.at = '2026-07-12T01:00:00Z';
    latestHistory.audit.audit_agent_id = 'auditor-latest';
    latestHistory.agents.audit_agent_id = 'auditor-latest';
    task.judgmentHistory.push(latestHistory);
    const latestKickback = /** @type {Record<string, any>} */ ({
      from: 'review',
      to: 'implement',
      reason: 'A later review round requires a full reset.',
      at: '2026-07-12T00:50:00Z',
    });
    if (findings !== undefined) latestKickback.findings = findings;
    task.kickbacks.push(latestKickback);
    task.implement = {
      ...task.implement,
      agent_id: 'implementer-latest',
      files: [retained ? 'src/core/record.js' : 'src/core/task-schema.js'],
    };
    task.audit = {
      ...structuredClone(latestHistory.audit),
      audit_agent_id: retained ? 'auditor-latest' : 'auditor-fresh',
    };
    task.agents.audit_agent_id = task.audit.audit_agent_id;
    return task;
  };

  for (const [name, findings] of /** @type {Array<[string, undefined | any[]]>} */ ([
    ['absent findings', undefined],
    ['empty findings', []],
  ])) {
    await t.test(`${name} skips INV-12 after a full reset with no retained identity`, async () => {
      const result = await verdictFor(latestRoundTask(findings, false));
      assert.equal(result.ok, true, result.stderr.join('\n'));
    });

    await t.test(`${name} cannot authorize a retained judgment from an older typed round`, async () => {
      const result = await verdictFor(latestRoundTask(findings, true));
      assertNamedFailure(result, '[inv12]');
    });
  }
});

test('Item 4 INV-12 rejects same-file prior-round repair records as latest-round proof', async (t) => {
  const cases = /** @type {Array<[string, Array<'implement' | 'refactor'>]>} */ ([
    ['latest implement-only contract', ['implement']],
    ['latest refactor-only contract', ['refactor']],
    ['fully populated latest mixed-stage contract', ['implement', 'refactor']],
  ]);

  for (const [name, owedStages] of cases) await t.test(name, async () => {
    const task = item4RetainedLedger('review');
    task.kickbacks[0].to = owedStages[0];
    task.kickbacks[0].findings = owedStages.map((stage) => (
      item4KickbackFinding('review', { kickTo: stage })
    ));
    task.kickbacks.unshift({
      ...structuredClone(task.kickbacks[0]),
      reason: 'Prior round used the same repair files.',
      at: '2026-07-12T00:10:00Z',
    });
    const priorHistory = structuredClone(task.judgmentHistory[0]);
    priorHistory.at = '2026-07-12T00:20:00Z';
    task.judgmentHistory.unshift(priorHistory);

    delete task.implement;
    delete task.refactor;
    if (owedStages.includes('implement')) {
      task.implement = {
        agent_id: 'prior-round-implementer',
        result: 'green',
        files: ['src/core/record.js'],
        greenRun: { command: 'node --test', output: 'pass' },
      };
    }
    if (owedStages.includes('refactor')) {
      task.refactor = {
        agent_id: 'prior-round-refactorer',
        result: 'clean',
        files: ['src/core/record.js'],
        outsideDiff: [],
        greenRun: { command: 'node --test', output: 'pass' },
        summary: ['Applied a prior-round refactor.'],
      };
    }

    const result = await verdictFor(task);
    assertNamedFailure(result, '[inv12]');
  });
});

test('Item 4 INV-12 rejects prior-round repair records as current-round proof', async (t) => {
  for (const staleStage of /** @type {const} */ (['implement', 'refactor'])) {
    await t.test(`stale ${staleStage}`, async () => {
      const task = item4RetainedLedger('review');
      const priorFinding = item4KickbackFinding('review', { kickTo: staleStage });
      const currentRefactorFinding = item4KickbackFinding('review', {
        file: 'src/core/invariants.js',
        line: 12,
        kickTo: 'refactor',
      });
      task.kickbacks.unshift({
        from: 'review',
        to: staleStage,
        reason: `Prior round required ${staleStage}.`,
        at: '2026-07-12T00:10:00Z',
        findings: [priorFinding],
      });
      task.kickbacks.at(-1).findings.push(currentRefactorFinding);
      const priorHistory = structuredClone(task.judgmentHistory[0]);
      priorHistory.at = '2026-07-12T00:20:00Z';
      task.judgmentHistory.unshift(priorHistory);
      delete task.implement;
      delete task.refactor;
      if (staleStage === 'implement') {
        task.implement = {
          agent_id: 'prior-round-implementer',
          result: 'green',
          files: ['src/core/record.js'],
          greenRun: { command: 'node --test', output: 'pass' },
        };
      } else {
        task.refactor = {
          agent_id: 'prior-round-refactorer',
          result: 'clean',
          files: ['src/core/record.js'],
          outsideDiff: [],
          greenRun: { command: 'node --test', output: 'pass' },
          summary: ['Applied a prior-round refactor.'],
        };
      }

      const result = await verdictFor(task);
      assertNamedFailure(result, '[inv12]');
    });
  }
});

test('Item 4 INV-12 rejects every incomplete or mismatched retention proof', async (t) => {
  /** @type {Array<[string, (task: Record<string, any>) => void]>} */
  const invalid = [
    ['missing post-kickback repair', (task) => { delete task.implement; }],
    ['non-pass retained outcome', (task) => {
      task.audit.verdict = 'needs-work';
      task.judgmentHistory[0].audit.verdict = 'needs-work';
    }],
    ['retained identity mismatch', (task) => {
      task.audit.audit_agent_id = 'auditor-other';
      task.agents.audit_agent_id = 'auditor-other';
    }],
    ['retained outcome mismatch', (task) => {
      task.audit.evidence = ['changed audit evidence'];
    }],
    ['repair file mismatch', (task) => {
      task.implement.files = ['src/core/task-schema.js'];
    }],
    ['latest history mismatch', (task) => {
      task.judgmentHistory.push({
        ...structuredClone(task.judgmentHistory[0]),
        at: '2026-07-12T00:50:00Z',
        audit: {
          ...structuredClone(task.judgmentHistory[0].audit),
          audit_agent_id: 'auditor-unrelated',
        },
        agents: {
          ...task.judgmentHistory[0].agents,
          audit_agent_id: 'auditor-unrelated',
        },
      });
    }],
    ['kickback source mismatch', (task) => {
      task.kickbacks[0].findings[0].source = 'audit';
    }],
  ];

  for (const [name, mutate] of invalid) await t.test(name, async () => {
    const task = item4RetainedLedger('review');
    mutate(task);
    const result = await verdictFor(task);
    assertNamedFailure(result, '[inv12]');
  });
});

test('Item 4 council recovery accepts positive single-owner scoped retention ledgers', async (t) => {
  const cases = /** @type {const} */ ([
    ['outcome-only retained audit', 'review', 'audit', 'audit_agent_id', 'outcome'],
    ['agents-only retained review', 'audit', 'review', 'reviewer_agent_id', 'agents'],
  ]);
  for (const [name, raisingSource, retainedSource, identityField, owner] of cases) {
    await t.test(name, async () => {
      const task = item4RetainedLedger(raisingSource);
      const history = task.judgmentHistory[0];
      if (owner === 'outcome') {
        task.agents[identityField] = null;
        history.agents[identityField] = null;
      } else {
        task[retainedSource][identityField] = null;
        history[retainedSource][identityField] = null;
      }

      const result = await verdictFor(task);
      assert.equal(result.ok, true, result.stderr.join('\n'));
    });
  }
});

/**
 * Item 5: one judgment kickback from `source`. `count` null records a
 * historical kickback that carries no typed findings contract.
 *
 * @param {{source?: 'review' | 'audit', count?: number | null, kickTo?: string, reason?: string}} [spec]
 * @returns {Record<string, any>}
 */
function item5JudgmentKickback({ source = 'review', count = null, kickTo = 'implement', reason } = {}) {
  const kickback = {
    from: source,
    to: 'implement',
    reason: reason ?? `Confined ${source} blockers survived.`,
    at: '2026-07-12T00:30:00Z',
  };
  if (count === null) return kickback;
  return {
    ...kickback,
    findings: Array.from({ length: count }, (_, index) => item4KickbackFinding(source, {
      line: 300 + index,
      what: `${source} blocker ${index}.`,
      kickTo,
    })),
  };
}

/**
 * @param {{
 *   kickbacks: Record<string, any>[],
 *   review?: Record<string, any>,
 *   audit?: Record<string, any>,
 *   cap?: number,
 *   council?: Record<string, any>,
 * }} spec
 * @returns {Record<string, any>}
 */
function item5CodeLedger({
  kickbacks,
  review = { blockingKickbacks: 2 },
  audit = { blockingKickbacks: 0 },
  cap = 2,
  council,
}) {
  return canonicalTask({
    kickbacks,
    convergence: convergence({
      cap,
      stages: { review, audit },
      ...(council === undefined ? {} : { council }),
    }),
  });
}

/**
 * @param {Record<string, any>[]} findings
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function item5ConvenedCouncil(findings, overrides = {}) {
  return {
    convened: true,
    stage: 'review',
    members: [
      { agent_id: 'council-integrity', lens: 'integrity', temperature: 0.3 },
      { agent_id: 'council-security', lens: 'security', temperature: 0.7 },
      { agent_id: 'council-pragmatist', lens: 'pragmatist', temperature: 1 },
    ],
    findings,
    verdict: findings.some((finding) => finding.survived === true) ? 'block' : 'ship',
    outcome: null,
    ...overrides,
  };
}

test('Item 5 INV-7 keeps every historical bound and accepts one evidenced bonus cycle', async (t) => {
  /** @type {Array<[string, Record<string, any>]>} */
  const accepted = [
    [
      'legacy untyped judgment kickbacks are outside the bound',
      item5CodeLedger({
        kickbacks: Array.from({ length: 4 }, () => item5JudgmentKickback()),
      }),
    ],
    [
      'a convened council block kickback is outside the bound',
      item5CodeLedger({
        kickbacks: [
          item5JudgmentKickback({ count: 3 }),
          item5JudgmentKickback({ count: 2 }),
          item5JudgmentKickback({ reason: 'Council block: the recorded outcome is unproven.' }),
        ],
        council: item5ConvenedCouncil([{
          id: 'F1',
          summary: 'The recorded outcome is unproven.',
          source: 'review',
          blockingVotes: 2,
          survived: true,
          followupTaskId: null,
        }]),
      }),
    ],
    [
      'typed kickbacks at exactly the cap need no bonus',
      item5CodeLedger({
        kickbacks: [item5JudgmentKickback({ count: 3 }), item5JudgmentKickback({ count: 2 })],
      }),
    ],
    [
      'one evidenced bonus cycle is bounded at cap plus one',
      item5CodeLedger({
        kickbacks: [
          item5JudgmentKickback({ count: 3 }),
          item5JudgmentKickback({ count: 2 }),
          item5JudgmentKickback({ count: 1 }),
        ],
        review: { blockingKickbacks: 2, bonusGranted: true },
      }),
    ],
    [
      'each source carries its own independent bonus',
      item5CodeLedger({
        kickbacks: [
          item5JudgmentKickback({ count: 3 }),
          item5JudgmentKickback({ count: 2 }),
          item5JudgmentKickback({ count: 1 }),
          item5JudgmentKickback({ source: 'audit', count: 2 }),
          item5JudgmentKickback({ source: 'audit', count: 1 }),
        ],
        review: { blockingKickbacks: 2, bonusGranted: true },
        audit: { blockingKickbacks: 2 },
      }),
    ],
  ];

  for (const [name, task] of accepted) await t.test(`accepts ${name}`, async () => {
    const result = await verdictFor(task);
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  await t.test('accepts an unbounded typed history when convergence is absent', async () => {
    const task = item5CodeLedger({
      kickbacks: Array.from({ length: 5 }, () => item5JudgmentKickback({ count: 1 })),
    });
    delete task.convergence;
    const result = await verdictFor(task);
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  /** @type {Array<[string, Record<string, any>]>} */
  const rejected = [
    [
      'an unspent bonus cannot exceed the cap',
      item5CodeLedger({
        kickbacks: [
          item5JudgmentKickback({ count: 3 }),
          item5JudgmentKickback({ count: 2 }),
          item5JudgmentKickback({ count: 1 }),
        ],
      }),
    ],
    [
      'a granted bonus without shrinking evidence',
      item5CodeLedger({
        kickbacks: [
          item5JudgmentKickback({ count: 3 }),
          item5JudgmentKickback({ count: 2 }),
          item5JudgmentKickback({ count: 2 }),
        ],
        review: { blockingKickbacks: 2, bonusGranted: true },
      }),
    ],
    [
      'a granted bonus whose last findings are unconfined',
      item5CodeLedger({
        kickbacks: [
          item5JudgmentKickback({ count: 3 }),
          item5JudgmentKickback({ count: 2 }),
          item5JudgmentKickback({ count: 1, kickTo: 'plan' }),
        ],
        review: { blockingKickbacks: 2, bonusGranted: true },
      }),
    ],
    [
      'a granted bonus with no prior kickback to shrink from',
      item5CodeLedger({
        kickbacks: [item5JudgmentKickback({ count: 1 })],
        review: { blockingKickbacks: 1, bonusGranted: true },
      }),
    ],
    [
      'a granted bonus with no recorded findings contract at all',
      item5CodeLedger({
        kickbacks: [item5JudgmentKickback(), item5JudgmentKickback()],
        review: { blockingKickbacks: 2, bonusGranted: true },
      }),
    ],
    [
      'a granted bonus cannot buy a second extra cycle',
      item5CodeLedger({
        kickbacks: [
          item5JudgmentKickback({ count: 4 }),
          item5JudgmentKickback({ count: 3 }),
          item5JudgmentKickback({ count: 2 }),
          item5JudgmentKickback({ count: 1 }),
        ],
        review: { blockingKickbacks: 2, bonusGranted: true },
      }),
    ],
    [
      'a bonus on one source does not license another source',
      item5CodeLedger({
        kickbacks: [
          item5JudgmentKickback({ count: 2 }),
          item5JudgmentKickback({ count: 1 }),
          item5JudgmentKickback({ source: 'audit', count: 3 }),
          item5JudgmentKickback({ source: 'audit', count: 2 }),
          item5JudgmentKickback({ source: 'audit', count: 1 }),
        ],
        review: { blockingKickbacks: 2, bonusGranted: true },
        audit: { blockingKickbacks: 2 },
      }),
    ],
  ];

  for (const [name, task] of rejected) await t.test(`rejects ${name}`, async () => {
    const result = await verdictFor(task);
    assertNamedFailure(result, '[inv7]');
  });
});

test('Item 5 INV-7 leaves operation kickback history unbounded', async () => {
  const task = canonicalOperationTask({
    kickbacks: [
      { from: 'verify', to: 'execute', reason: 'A verified postcondition survived.', at: '2026-07-12T00:30:00Z' },
      { from: 'verify', to: 'execute', reason: 'Verification reported a false postcondition.', at: '2026-07-12T00:40:00Z' },
      { from: 'verify', to: 'execute', reason: 'Verification reported a false postcondition.', at: '2026-07-12T00:50:00Z' },
    ],
    convergence: {
      cap: 2,
      stages: { verify: { blockingKickbacks: 1 }, audit: { blockingKickbacks: 0 } },
      council: { convened: false, stage: null, members: [], findings: [], verdict: null, outcome: null },
    },
  });

  const result = await verdictFor(task);
  assert.equal(result.ok, true, result.stderr.join('\n'));
});

test('Item 5 INV-10 accepts a ledger demotion beside the existing task-id path', async (t) => {
  /** @param {Record<string, any>} overrides */
  const demoted = (overrides) => ({
    id: 'F1',
    summary: 'The follow-up finding was demoted.',
    source: 'review',
    blockingVotes: 1,
    survived: false,
    ...overrides,
  });

  /** @type {Array<[string, Record<string, any>[]]>} */
  const accepted = [
    ['an existing task id', [demoted({ followupTaskId: '#27' })]],
    ['the literal ledger reference', [demoted({ followupTaskId: 'ledger' })]],
    ['both demotion targets together', [
      demoted({ followupTaskId: '#27' }),
      demoted({ id: 'F2', followupTaskId: 'ledger' }),
    ]],
  ];

  for (const [name, findings] of accepted) await t.test(`accepts ${name}`, async () => {
    const result = await verdictFor(item5CodeLedger({
      kickbacks: [],
      council: item5ConvenedCouncil(findings),
    }));
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  /** @type {Array<[string, Record<string, any>[]]>} */
  const rejected = [
    ['an unknown non-ledger string', [demoted({ followupTaskId: 'followups' })]],
    ['a surviving finding pointed at the ledger', [demoted({
      blockingVotes: 2,
      survived: true,
      followupTaskId: 'ledger',
    })]],
  ];

  for (const [name, findings] of rejected) await t.test(`rejects ${name}`, async () => {
    const result = await verdictFor(item5CodeLedger({
      kickbacks: [],
      council: item5ConvenedCouncil(findings),
    }));
    assertNamedFailure(result, '[inv10]');
  });
});

test('Item 5 bonusGranted is an optional boolean on each convergence counter', async (t) => {
  /** @type {Array<[string, Record<string, any>]>} */
  const accepted = [
    ['absence', { review: { blockingKickbacks: 0 }, audit: { blockingKickbacks: 0 } }],
    ['explicit false', { review: { blockingKickbacks: 0, bonusGranted: false }, audit: { blockingKickbacks: 0 } }],
    ['audit stage true', {
      review: { blockingKickbacks: 0 },
      audit: { blockingKickbacks: 2, bonusGranted: true },
    }],
  ];

  for (const [name, stages] of accepted) await t.test(`accepts ${name}`, async () => {
    const result = await verdictFor(canonicalTask({
      kickbacks: [
        item5JudgmentKickback({ source: 'audit', count: 2 }),
        item5JudgmentKickback({ source: 'audit', count: 1 }),
      ],
      convergence: convergence({ stages }),
    }));
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  /** @type {Array<[string, string, unknown]>} */
  const rejected = [
    ['review', 'a string', 'true'],
    ['review', 'a number', 1],
    ['review', 'null', null],
    ['audit', 'a string', 'false'],
  ];

  for (const [stage, name, value] of rejected) await t.test(`rejects ${name} on ${stage}`, async () => {
    /** @type {Record<string, any>} */
    const stages = {
      review: { blockingKickbacks: 0 },
      audit: { blockingKickbacks: 0 },
    };
    stages[stage] = { blockingKickbacks: 0, bonusGranted: value };
    const result = await verdictFor(canonicalTask({ convergence: convergence({ stages }) }));
    assertNamedFailure(result, `convergence.stages.${stage}.bonusGranted`);
  });
});

test('Item 6 discoveredFrom preserves historical ledgers and validates lite id shapes', async (t) => {
  for (const [name, task] of Object.entries({
    'historical absence': canonicalTask(),
    'string id': canonicalTask({ discoveredFrom: '#18' }),
    'number id': canonicalTask({ discoveredFrom: 18 }),
  })) {
    await t.test(`accepts ${name}`, async () => {
      const result = await verdictFor(task);
      assert.equal(result.ok, true, result.stderr.join('\n'));
    });
  }

  for (const discoveredFrom of [null, true, {}, []]) {
    await t.test(`rejects ${JSON.stringify(discoveredFrom)}`, async () => {
      const result = await verdictFor(canonicalTask({ discoveredFrom }));
      assertNamedFailure(result, '[schema] discoveredFrom');
    });
  }
});

test('Item 6 full mode requires discoveredFrom to name live or pruned provenance', async (t) => {
  await t.test('historical absence remains valid', async () => {
    const result = await verdictFor(
      canonicalTask({ id: 1, externalRef: undefined }),
      'full',
    );
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  await t.test('reciprocal live provenance is not a scheduling cycle', async () => {
    const root = await makeStore('full');
    try {
      await writeTask(root, canonicalTask({
        id: 1,
        externalRef: undefined,
        slug: 'first',
        discoveredFrom: 2,
      }), '0001-first');
      await writeTask(root, canonicalTask({
        id: 2,
        externalRef: undefined,
        slug: 'second',
        discoveredFrom: 1,
      }), '0002-second');

      const result = await validateStore(root);
      assert.equal(result.ok, true, result.stderr.join('\n'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('terminally pruned provenance remains valid', async () => {
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
        discoveredFrom: 1,
      }), '0002-task-two');

      const result = await validateStore(root);
      assert.equal(result.ok, true, result.stderr.join('\n'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  for (const discoveredFrom of [999, '#999']) {
    await t.test(`rejects unresolved provenance ${JSON.stringify(discoveredFrom)}`, async () => {
      const result = await verdictFor(
        canonicalTask({ id: 1, externalRef: undefined, discoveredFrom }),
        'full',
      );
      assertNamedFailure(result, 'discoveredFrom');
    });
  }

  for (const discoveredFrom of [null, true, {}, []]) {
    await t.test(`rejects malformed provenance ${JSON.stringify(discoveredFrom)}`, async () => {
      const result = await verdictFor(
        canonicalTask({ id: 1, externalRef: undefined, discoveredFrom }),
        'full',
      );
      assertNamedFailure(result, '[schema] discoveredFrom');
    });
  }
});

test('Item 6 lite dependency cycles use local edges and ignore unresolved refs', async (t) => {
  await t.test('rejects a cycle whose endpoints are both local', async () => {
    const root = await makeStore('lite');
    try {
      await writeTask(root, canonicalTask({
        id: '#first',
        externalRef: '#first',
        slug: 'first',
        deps: ['#second'],
      }), 'first');
      await writeTask(root, canonicalTask({
        id: '#second',
        externalRef: '#second',
        slug: 'second',
        deps: ['#first'],
      }), 'second');

      const result = await validateStore(root);
      assertNamedFailure(result, '[inv5]');
      assert.ok(result.stderr.some((line) => line.includes('dependency cycle')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('rejects a duplicate-id self-cycle beside an acyclic sibling', async () => {
    const root = await makeStore('lite');
    try {
      await writeTask(root, canonicalTask({
        id: '#duplicate',
        externalRef: '#duplicate',
        slug: 'acyclic-sibling',
      }), 'acyclic-sibling');
      await writeTask(root, canonicalTask({
        id: '#duplicate',
        externalRef: '#duplicate',
        slug: 'cyclic-sibling',
        deps: ['#duplicate'],
      }), 'cyclic-sibling');

      const result = await validateStore(root);
      assertNamedFailure(result, '[inv5]');
      assert.ok(result.stderr.some((line) => line.includes('dependency cycle')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('accepts an acyclic local edge beside unresolved external refs', async () => {
    const root = await makeStore('lite');
    try {
      await writeTask(root, canonicalTask({
        id: '#first',
        externalRef: '#first',
        slug: 'first',
        deps: ['github:team/repo#200'],
      }), 'first');
      await writeTask(root, canonicalTask({
        id: '#second',
        externalRef: '#second',
        slug: 'second',
        deps: ['#first', 999],
      }), 'second');

      const result = await validateStore(root);
      assert.equal(result.ok, true, result.stderr.join('\n'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function issue237PersistedCouncil() {
  const inquiries = [
    {
      question: 'Are these independent defects, or evidence that this part of the design should be reconstructed?',
      problemRestatement: 'A supported recorder order loses accepted evidence.',
      causalHypotheses: ['The active judgment union is replaced.'],
      solutionStrategies: ['confined-repair', 'full-replan'],
      findingVotes: [{ id: 'F1', blocking: true, rationale: 'Accepted evidence is lost.' }],
      decisiveEvidence: ['The persisted task omits one accepted result.'],
    },
    {
      question: 'Which state boundary permits the loss?',
      problemRestatement: 'The atomic recorder contract does not cover all accepted results.',
      causalHypotheses: ['The merge occurs outside the locked update.'],
      solutionStrategies: ['causal-subgraph-reconstruction', 'full-replan'],
      findingVotes: [{ id: 'F1', blocking: true, rationale: 'The loss crosses the durable boundary.' }],
      decisiveEvidence: ['The completion-order fixture is deterministic.'],
    },
    {
      question: 'What is the narrowest safe same-task response?',
      problemRestatement: 'One legal transition leaves an incomplete ledger.',
      causalHypotheses: ['A confined fix may restore the contract.'],
      solutionStrategies: ['confined-repair', 'operator-escalation'],
      findingVotes: [{ id: 'F1', blocking: false, rationale: 'A bounded repair remains plausible.' }],
      decisiveEvidence: ['The failure is isolated to one transition.'],
    },
  ];
  return {
    convened: true,
    stage: 'review',
    synthesizer_agent_id: 'council-synthesizer',
    members: [
      { agent_id: 'council-integrity', lens: 'integrity', temperature: 0.3 },
      { agent_id: 'council-security', lens: 'security', temperature: 0.7 },
      { agent_id: 'council-pragmatist', lens: 'pragmatist', temperature: 1 },
    ].map((member, index) => ({ ...member, inquiry: inquiries[index] })),
    findings: [{
      id: 'F1',
      source: 'review',
      summary: 'The recording path loses a result.',
      blockingVotes: 2,
      survived: true,
      followupTaskId: null,
    }],
    synthesis: {
      problemRestatement: 'A supported completion order can discard accepted task evidence.',
      survivingBlockers: ['F1'],
      causalHypotheses: ['The recorder does not preserve the complete active judgment union.'],
      solutionStrategies: ['confined-repair', 'full-replan'],
      rejectedAlternatives: ['confined-repair'],
      selectedStrategy: 'full-replan',
      decisiveEvidence: ['Two independent inquiries reproduce the durable evidence loss.'],
    },
    verdict: 'block',
    outcome: null,
  };
}

function issue237PersistedRecovery() {
  const task = item5CodeLedger({
    kickbacks: [{
      from: 'review',
      to: 'plan',
      reason: 'Council block: The recording path loses a result.',
      at: '2026-07-12T00:30:00Z',
    }],
    council: issue237PersistedCouncil(),
  });
  task.stage = 'plan';
  task.convergence.recovery = {
    episode: 1,
    route: 'full-replan',
    baselineGate: null,
    test_author_agent_id: null,
    builder_agent_id: null,
    original: {
      complexity: 'complex',
      audit_required: true,
      absentLineage: [],
      plan: {
        result: 'red',
        slices: ['Implement the original contract.'],
        testFiles: ['src/core/task-schema.test.js'],
        redRun: { command: 'node --test src/core/task-schema.test.js', output: 'red' },
        escalation: null,
        refactorOpportunity: null,
      },
      test_author_agent_id: 'plan',
      builder_agent_id: 'implementer',
      implement: {
        agent_id: 'implementer',
        result: 'green',
        files: ['src/core/record.js'],
        greenRun: { command: 'node --test src/core/task-schema.test.js', output: 'green' },
      },
    },
  };
  return task;
}

test('issue 237 persisted recovery is optional for history and fail-closed when present', async (t) => {
  const historical = item5CodeLedger({
    kickbacks: [],
    council: item5ConvenedCouncil([{
      id: 'F1',
      source: 'review',
      summary: 'Historical finding',
      blockingVotes: 2,
      survived: true,
      followupTaskId: null,
    }]),
  });
  assert.equal((await verdictFor(historical)).ok, true);

  const canonical = issue237PersistedRecovery();
  assert.equal((await verdictFor(canonical)).ok, true);

  const historicallyAbsent = structuredClone(canonical);
  historicallyAbsent.convergence.recovery.original.absentLineage = [
    'plan',
    'test_author_agent_id',
    'builder_agent_id',
    'implement',
  ];
  historicallyAbsent.convergence.recovery.original.plan = null;
  historicallyAbsent.convergence.recovery.original.test_author_agent_id = null;
  historicallyAbsent.convergence.recovery.original.builder_agent_id = null;
  historicallyAbsent.convergence.recovery.original.implement = null;
  assert.equal(
    (await verdictFor(historicallyAbsent)).ok,
    true,
    'lineage that was absent at council entry remains compatible',
  );

  for (const field of ['plan', 'test_author_agent_id', 'builder_agent_id', 'implement']) {
    await t.test(`present original ${field} cannot be nulled or deleted after capture`, async () => {
      const nulled = structuredClone(canonical);
      nulled.convergence.recovery.original[field] = null;
      const nulledResult = await verdictFor(nulled);
      assert.equal(nulledResult.ok, false, `present original ${field} must not become null`);
      assert.match(nulledResult.stderr.join('\n'), /recovery|original|lineage|inv/i);

      const deleted = structuredClone(canonical);
      delete deleted.convergence.recovery.original[field];
      const deletedResult = await verdictFor(deleted);
      assert.equal(deletedResult.ok, false, `present original ${field} must not be deleted`);
      assert.match(deletedResult.stderr.join('\n'), /recovery|original|lineage|inv/i);
    });
  }

  /** @type {Array<[string, (task: any) => void]>} */
  const invalidStates = [
    ['second episode', (task) => {
      task.convergence.recovery.episode = 2;
    }],
    ['unknown route', (task) => {
      task.convergence.recovery.route = 'workflow-node';
    }],
    ['route disagrees with synthesis', (task) => {
      task.convergence.recovery.route = 'confined-repair';
    }],
    ['missing host-observed synthesizer identity', (task) => {
      delete task.convergence.council.synthesizer_agent_id;
    }],
    ['missing original delivery lineage', (task) => {
      delete task.convergence.recovery.original;
    }],
    ['missing original lineage presence snapshot', (task) => {
      delete task.convergence.recovery.original.absentLineage;
    }],
    ['recovery lowers original complexity', (task) => {
      task.complexity = 'simple';
    }],
    ['recovery lowers original audit floor', (task) => {
      task.audit.required = false;
    }],
    ['identical inquiry packets', (task) => {
      task.convergence.council.members[1].inquiry =
        structuredClone(task.convergence.council.members[0].inquiry);
      task.convergence.council.members[2].inquiry =
        structuredClone(task.convergence.council.members[0].inquiry);
    }],
    ['object key order is the only inquiry difference', (task) => {
      task.convergence.council.findings[0].blockingVotes = 3;
      const entries = Object.entries(task.convergence.council.members[0].inquiry);
      task.convergence.council.members[1].inquiry = Object.fromEntries([...entries].reverse());
      task.convergence.council.members[2].inquiry =
        Object.fromEntries([...entries.slice(1), entries[0]]);
    }],
    ['punctuation is the only inquiry difference', (task) => {
      task.convergence.council.findings[0].blockingVotes = 3;
      for (const [index, suffix] of [[1, '.'], [2, '!']]) {
        const inquiry = structuredClone(task.convergence.council.members[0].inquiry);
        inquiry.question += suffix;
        inquiry.problemRestatement += suffix;
        inquiry.causalHypotheses = inquiry.causalHypotheses.map((/** @type {any} */ item) => `${item}${suffix}`);
        inquiry.decisiveEvidence = inquiry.decisiveEvidence.map((/** @type {any} */ item) => `${item}${suffix}`);
        inquiry.findingVotes = inquiry.findingVotes.map((/** @type {any} */ vote) => ({
          ...vote,
          rationale: `${vote.rationale}${suffix}`,
        }));
        task.convergence.council.members[index].inquiry = inquiry;
      }
    }],
    ['findingVotes order is the only inquiry difference', (task) => {
      const council = task.convergence.council;
      const findingIds = ['F1', 'F2', 'F3'];
      council.findings = findingIds.map((id) => ({
        id,
        source: 'review',
        summary: `Persisted blocker ${id}.`,
        blockingVotes: 3,
        survived: true,
        followupTaskId: null,
      }));
      const inquiry = {
        ...structuredClone(council.members[0].inquiry),
        findingVotes: findingIds.map((id) => ({
          id,
          blocking: true,
          rationale: `Persisted evidence for ${id}.`,
        })),
      };
      council.members[0].inquiry = structuredClone(inquiry);
      council.members[1].inquiry = {
        ...structuredClone(inquiry),
        findingVotes: [inquiry.findingVotes[1], inquiry.findingVotes[2], inquiry.findingVotes[0]],
      };
      council.members[2].inquiry = {
        ...structuredClone(inquiry),
        findingVotes: [inquiry.findingVotes[2], inquiry.findingVotes[0], inquiry.findingVotes[1]],
      };
      council.synthesis.survivingBlockers = findingIds;
    }],
    ['vote tally is not derived from inquiries', (task) => {
      task.convergence.council.findings[0].blockingVotes = 1;
      task.convergence.council.findings[0].survived = false;
      task.convergence.council.findings[0].followupTaskId = 'ledger';
      task.convergence.council.verdict = 'ship';
      task.convergence.council.outcome = 'shipped';
    }],
    ['recovery test author reuses the builder', (task) => {
      task.convergence.recovery.test_author_agent_id = task.agents.implementer_agent_id;
    }],
  ];

  for (const [name, mutate] of invalidStates) {
    await t.test(name, async () => {
      const invalid = structuredClone(canonical);
      mutate(invalid);
      const result = await verdictFor(invalid);
      assert.equal(result.ok, false, `${name} must not validate`);
      assert.match(result.stderr.join('\n'), /council|recovery|identity|complexity|audit|lineage|inv/i);
    });
  }

  const production = structuredClone(canonical);
  production.stage = 'review';
  production.tests.authored_by_agent_id = 'recovery-test-author';
  production.agents.implementer_agent_id = 'recovery-builder';
  production.implement = {
    agent_id: 'recovery-builder',
    result: 'green',
    files: ['src/core/record.js'],
    greenRun: { command: 'node --test src/core/task-schema.test.js', output: 'green' },
  };
  production.convergence.recovery.test_author_agent_id = 'recovery-test-author';
  production.convergence.recovery.builder_agent_id = 'recovery-builder';
  assert.equal((await verdictFor(production)).ok, true);

  for (const [name, builder] of [['missing', null], ['spoofed', 'other-builder']]) {
    await t.test(`${name} production recovery builder`, async () => {
      const invalid = structuredClone(production);
      invalid.convergence.recovery.builder_agent_id = builder;
      const result = await verdictFor(invalid);
      assert.equal(result.ok, false, `${name} builder must not validate`);
      assert.match(result.stderr.join('\n'), /builder|identity|recovery|inv/i);
    });
  }

  const refactorProduction = structuredClone(canonical);
  refactorProduction.stage = 'review';
  refactorProduction.convergence.council.synthesis.solutionStrategies.push('refactor');
  refactorProduction.convergence.council.synthesis.selectedStrategy = 'refactor';
  refactorProduction.convergence.council.synthesis.rejectedAlternatives =
    ['confined-repair', 'full-replan'];
  refactorProduction.convergence.recovery.route = 'refactor';
  refactorProduction.convergence.recovery.builder_agent_id = 'recovery-refactorer';
  refactorProduction.refactor = {
    agent_id: 'recovery-refactorer',
    result: 'refactored',
    files: ['src/core/record.js'],
    outsideDiff: [],
    greenRun: { command: 'node --test src/core/task-schema.test.js', output: 'green' },
    summary: ['Changed the selected recovery boundary.'],
  };
  assert.equal((await verdictFor(refactorProduction)).ok, true);

  const unboundRefactor = structuredClone(refactorProduction);
  unboundRefactor.convergence.recovery.builder_agent_id = 'other-refactorer';
  const refactorResult = await verdictFor(unboundRefactor);
  assert.equal(refactorResult.ok, false, 'refactor builder must match the recorded refactorer');
  assert.match(refactorResult.stderr.join('\n'), /builder|identity|recovery|inv/i);

  const plannedRecovery = structuredClone(canonical);
  plannedRecovery.stage = 'implement';
  plannedRecovery.tests.authored_by_agent_id = 'recovery-test-author';
  plannedRecovery.convergence.recovery.test_author_agent_id = 'recovery-test-author';
  assert.equal((await verdictFor(plannedRecovery)).ok, true);

  const testOnlyRecovery = structuredClone(plannedRecovery);
  testOnlyRecovery.stage = 'review';
  testOnlyRecovery.convergence.council.synthesis.solutionStrategies =
    ['confined-repair', 'test-contract-repair'];
  testOnlyRecovery.convergence.council.synthesis.rejectedAlternatives = ['confined-repair'];
  testOnlyRecovery.convergence.council.synthesis.selectedStrategy = 'test-contract-repair';
  testOnlyRecovery.convergence.recovery.route = 'test-contract-repair';
  assert.equal((await verdictFor(testOnlyRecovery)).ok, true);

  /** @type {Array<[string, Record<string, any>, string, (task: any, agentId: string) => void]>} */
  const forbiddenRecoveryIdentityCases = [
    [
      'recovery test author reuses the council synthesizer',
      testOnlyRecovery,
      canonical.convergence.council.synthesizer_agent_id,
      (task, agentId) => {
        task.tests.authored_by_agent_id = agentId;
        task.convergence.recovery.test_author_agent_id = agentId;
      },
    ],
    [
      'recovery test author reuses the captured original test author',
      plannedRecovery,
      canonical.convergence.recovery.original.test_author_agent_id,
      (task, agentId) => {
        task.tests.authored_by_agent_id = agentId;
        task.convergence.recovery.test_author_agent_id = agentId;
      },
    ],
    [
      'implementation recovery builder reuses the captured original builder',
      production,
      canonical.convergence.recovery.original.builder_agent_id,
      (task, agentId) => {
        task.agents.implementer_agent_id = agentId;
        task.implement.agent_id = agentId;
        task.convergence.recovery.builder_agent_id = agentId;
      },
    ],
    [
      'refactor recovery builder reuses the council synthesizer',
      refactorProduction,
      canonical.convergence.council.synthesizer_agent_id,
      (task, agentId) => {
        task.refactor.agent_id = agentId;
        task.convergence.recovery.builder_agent_id = agentId;
      },
    ],
  ];

  for (const [name, base, agentId, bind] of forbiddenRecoveryIdentityCases) {
    await t.test(name, async () => {
      const invalid = structuredClone(base);
      bind(invalid, agentId);
      const result = await verdictFor(invalid);
      assert.equal(result.ok, false, `${name} must not validate`);
      assert.match(result.stderr.join('\n'), /recovery|identity|inv/i);
    });
  }
});

const ISSUE_238_UNORDERED_INQUIRY_FIELDS = [
  'causalHypotheses',
  'solutionStrategies',
  'findingVotes',
  'decisiveEvidence',
];

/**
 * @param {string} field
 * @param {'order' | 'repetition'} variant
 */
function issue238PersistedResearchVariant(field, variant) {
  const task = issue237PersistedRecovery();
  const council = task.convergence.council;
  const findingIds = field === 'findingVotes' ? ['F1', 'F2', 'F3'] : ['F1'];

  if (findingIds.length > 1) {
    council.findings = findingIds.map((id) => ({
      id,
      source: 'review',
      summary: `Persisted blocker ${id}.`,
      blockingVotes: 3,
      survived: true,
      followupTaskId: null,
    }));
    council.synthesis.survivingBlockers = findingIds;
  } else {
    council.findings[0].blockingVotes = 3;
  }

  const values = field === 'findingVotes'
    ? findingIds.map((id) => ({ id, blocking: true, rationale: `Evidence for ${id}.` }))
    : field === 'solutionStrategies'
      ? ['confined-repair', 'causal-subgraph-reconstruction', 'full-replan']
      : [`${field} alpha`, `${field} beta`, `${field} gamma`];
  const collections = variant === 'order'
    ? [values, [values[1], values[2], values[0]], [values[2], values[0], values[1]]]
    : [values, [values[0], ...values], [...values, values[2]]];
  const inquiry = structuredClone(council.members[0].inquiry);
  council.members = council.members.map((/** @type {any} */ member, /** @type {number} */ index) => ({
    ...member,
    inquiry: {
      ...structuredClone(inquiry),
      [field]: structuredClone(collections[index]),
    },
  }));
  return task;
}

test('issue 238 persisted unordered inquiry research rejects order and repetition', async (t) => {
  for (const field of ISSUE_238_UNORDERED_INQUIRY_FIELDS) {
    for (const variant of /** @type {Array<'order' | 'repetition'>} */ (['order', 'repetition'])) {
      await t.test(`${field} ${variant}-only difference`, async () => {
        const result = await verdictFor(issue238PersistedResearchVariant(field, variant));
        assert.equal(result.ok, false, `${field} ${variant} must not validate`);
        assert.match(result.stderr.join('\n'), /council|inquiry|research|inv/i);
      });
    }
  }
});

test('issue 238 persisted original delivery snapshots are strict and builder-bound', async (t) => {
  /** @type {Array<[string, (task: any) => void]>} */
  const cases = [
    ['empty original plan snapshot', (task) => {
      task.convergence.recovery.original.plan = {};
    }],
    ['empty original implementation snapshot', (task) => {
      task.convergence.recovery.original.implement = {};
    }],
    ['original builder differs from captured implementation agent', (task) => {
      task.convergence.recovery.original.builder_agent_id = 'different-original-builder';
    }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const invalid = issue237PersistedRecovery();
      mutate(invalid);
      const result = await verdictFor(invalid);
      assert.equal(result.ok, false, `${name} must not validate`);
      assert.match(result.stderr.join('\n'), /plan|implement|builder|original|lineage|recovery|inv/i);
    });
  }

  const historical = issue237PersistedRecovery();
  historical.convergence.recovery.original.absentLineage = [
    'plan',
    'test_author_agent_id',
    'builder_agent_id',
    'implement',
  ];
  historical.convergence.recovery.original.plan = null;
  historical.convergence.recovery.original.test_author_agent_id = null;
  historical.convergence.recovery.original.builder_agent_id = null;
  historical.convergence.recovery.original.implement = null;
  assert.equal((await verdictFor(historical)).ok, true);
});

test('issue 239 persisted canonical synthesis requires causal hypotheses and decisive evidence', async (t) => {
  for (const field of ['causalHypotheses', 'decisiveEvidence']) {
    await t.test(`rejects empty ${field} at schema and invariant boundaries`, (boundary) => {
      const invalid = issue237PersistedRecovery();
      invalid.convergence.council.synthesis[field] = [];

      boundary.test('schema', () => {
        const schemaViolations = taskSchemaViolations(invalid, { lite: true });
        assert.ok(
          schemaViolations.some((violation) => violation.includes(`synthesis.${field}`)),
          `persisted schema must reject empty synthesis ${field}:\n${schemaViolations.join('\n')}`,
        );
      });

      boundary.test('invariant', () => {
        const invariantViolations = runInvariants([invalid], { lite: true });
        assert.ok(
          invariantViolations.some((violation) => (
            violation.includes(`council.synthesis.${field}`)
            && violation.includes('[inv8]')
          )),
          `persisted invariants must reject empty synthesis ${field}:\n${invariantViolations.join('\n')}`,
        );
      });
    });
  }
});

test('issue 238 persisted council research provenance fails closed and keeps history readable', async (t) => {
  await t.test('current-version unconvened council placeholder omits research', async () => {
    const placeholder = canonicalTask({
      pipelineVersion: '6.1.0',
      convergence: convergence(),
    });
    const result = await verdictFor(placeholder);
    assert.equal(result.ok, true, result.stderr.join('\n'));
  });

  const canonical = item5CodeLedger({
    kickbacks: [],
    council: {
      ...issue237PersistedCouncil(),
      researchProvenance: 'canonical',
    },
  });
  canonical.pipelineVersion = '6.1.0';
  assert.equal((await verdictFor(canonical)).ok, true);

  await t.test('canonical marker and research cannot be stripped into historical omission', async () => {
    const stripped = structuredClone(canonical);
    for (const member of stripped.convergence.council.members) delete member.inquiry;
    delete stripped.convergence.council.synthesis;
    delete stripped.convergence.council.synthesizer_agent_id;
    delete stripped.convergence.council.researchProvenance;
    const result = await verdictFor(stripped);
    assert.equal(result.ok, false, 'canonical research stripping must not validate');
    assert.match(result.stderr.join('\n'), /council|research|provenance|inv/i);
  });

  await t.test('current-version canonical marker cannot be substituted with historical omission', async () => {
    const substituted = structuredClone(canonical);
    substituted.convergence.council.researchProvenance = 'historical-omitted';
    for (const member of substituted.convergence.council.members) delete member.inquiry;
    delete substituted.convergence.council.synthesis;
    delete substituted.convergence.council.synthesizer_agent_id;
    const result = await verdictFor(substituted);
    assert.equal(result.ok, false, 'current canonical research substitution must not validate');
    assert.match(result.stderr.join('\n'), /council|research|provenance|inv/i);
  });

  await t.test('historical provenance accepts only complete research omission', async () => {
    const historical = item5CodeLedger({
      kickbacks: [],
      council: item5ConvenedCouncil([{
        id: 'F1',
        source: 'review',
        summary: 'Historical finding',
        blockingVotes: 2,
        survived: true,
        followupTaskId: null,
      }], {
        researchProvenance: 'historical-omitted',
      }),
    });
    assert.equal((await verdictFor(historical)).ok, true);

    const explicitPre61 = structuredClone(historical);
    explicitPre61.pipelineVersion = '6.0.1';
    const pre61Result = await verdictFor(explicitPre61);
    assert.equal(
      pre61Result.ok,
      true,
      `explicit 6.0.x historical omission must remain readable:\n${pre61Result.stderr.join('\n')}`,
    );

    const mislabeled = structuredClone(canonical);
    mislabeled.convergence.council.researchProvenance = 'historical-omitted';
    const result = await verdictFor(mislabeled);
    assert.equal(result.ok, false, 'historical provenance cannot label canonical research');
    assert.match(result.stderr.join('\n'), /council|research|provenance|inv/i);
  });
});

/**
 * Authoritative approval-gated ledger with a present-but-null grant and one
 * well-formed request. Used by the #108 degenerate-input contract.
 *
 * @returns {Record<string, any>}
 */
function issue108NullGrantTask() {
  const mutation = 'Rewrite the shared release registry entry from source to destination.';
  const request = {
    id: 0,
    mutation,
    requestedBy: 'approval-requester',
    requestedAt: '2026-07-26T15:20:00Z',
    cycle: 0,
  };
  const completed = completedOperationTask();
  return completedOperationTask({
    plan: {
      ...completed.plan,
      approvalBoundary: mutation,
      requiresApproval: true,
    },
    approvalRequests: [request],
    execution: {
      ...completed.execution,
      recordedAt: '2026-07-26T15:40:00Z',
      approvalRequestId: request.id,
      approval: null,
    },
  });
}

test('issue 108: taskSchemaViolations names a null authoritative grant instead of throwing', () => {
  const completed = completedOperationTask();
  const mutation = 'Rewrite the shared release registry entry from source to destination.';
  const request = {
    id: 0,
    mutation,
    requestedBy: 'approval-requester',
    requestedAt: '2026-07-26T15:20:00Z',
    cycle: 0,
  };
  const task = canonicalOperationTask({
    stage: 'execute',
    agents: {
      ...canonicalOperationTask().agents,
      executor_agent_id: request.requestedBy,
    },
    plan: {
      ...completed.plan,
      requiresApproval: true,
      approvalBoundary: mutation,
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
      approvalRequired: mutation,
      approval: null,
    },
  });
  /** @type {string[]} */
  let violations = [];
  assert.doesNotThrow(() => {
    violations = taskSchemaViolations(task, { lite: true });
  });
  assert.ok(
    violations.some((line) => line.includes('[schema] execution.approval')),
    `expected a named [schema] execution.approval violation, got:\n${violations.join('\n')}`,
  );
});

test('issue 108: hasCompletedApprovalProvenance returns false for a null grant', () => {
  const task = issue108NullGrantTask();
  /** @type {boolean} */
  let completed = true;
  assert.doesNotThrow(() => {
    completed = hasCompletedApprovalProvenance(task);
  });
  assert.equal(completed, false);
});

test('issue 108: taskSchemaViolations names a null approvalRequests predecessor instead of throwing', () => {
  const completed = completedOperationTask();
  const mutation = completed.plan.approvalBoundary;
  const task = completedOperationTask({
    plan: {
      ...completed.plan,
      requiresApproval: true,
    },
    approvalRequests: [null, {
      id: 1,
      mutation,
      requestedBy: 'approval-requester',
      requestedAt: '2026-07-26T15:20:00Z',
      cycle: 0,
    }],
    execution: {
      ...completed.execution,
      recordedAt: '2026-07-26T15:40:00Z',
    },
  });
  /** @type {string[]} */
  let violations = [];
  assert.doesNotThrow(() => {
    violations = taskSchemaViolations(task, { lite: true });
  });
  assert.ok(
    violations.some((line) => line.includes('[schema] approvalRequests')),
    `expected a named [schema] approvalRequests violation, got:\n${violations.join('\n')}`,
  );
});

test('issue 108: a null grant plus one valid request yields a named schema violation and a normal nonzero verdict', async () => {
  const result = await verdictFor(issue108NullGrantTask());
  assert.equal(result.ok, false);
  assert.equal(result.code, 1);
  assertNamedFailure(result, '[schema] execution.approval');
  assert.ok(
    result.stderr.some((line) => /cook: validation FAILED \(\d+ issue\(s\)\)/.test(line)),
    `expected a normal nonzero verdict line, got:\n${result.stderr.join('\n')}`,
  );
  assert.ok(
    !result.stderr.some((line) => line.includes('TypeError') || line.includes('    at ')),
    `expected no stack-trace path, got:\n${result.stderr.join('\n')}`,
  );
});

/**
 * Completed approval-gated ledger used by the #110 request-id contract.
 *
 * @param {Record<string, any>} [grantOverrides]
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function issue110ApprovedTask(grantOverrides = {}, overrides = {}) {
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
    ...grantOverrides,
  };
  const completed = completedOperationTask();
  return completedOperationTask({
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
    ...overrides,
  });
}

/**
 * Two-request completed approval ledger whose latest request is id 1.
 * Historical re-stop grants omit `requestId`; a forge names request 0.
 *
 * @param {Record<string, any>} [grantOverrides]
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function issue110TwoRequestApprovedTask(grantOverrides = {}, overrides = {}) {
  const mutation = 'Rewrite the shared release registry entry from source to destination.';
  const earlier = {
    id: 0,
    mutation,
    requestedBy: 'approval-requester',
    requestedAt: '2026-07-26T15:20:00Z',
    cycle: 0,
  };
  const later = {
    id: 1,
    mutation,
    requestedBy: 'later-requester',
    requestedAt: '2026-07-26T15:35:00Z',
    cycle: 1,
  };
  const approval = {
    mutation,
    grantedBy: 'Chef',
    grantedAt: '2026-07-26T15:36:00Z',
    ...grantOverrides,
  };
  const completed = completedOperationTask();
  return completedOperationTask({
    plan: {
      ...completed.plan,
      approvalBoundary: mutation,
      requiresApproval: true,
    },
    approvalRequests: [earlier, later],
    approvals: [approval],
    execution: {
      ...completed.execution,
      cycle: later.cycle,
      recordedAt: '2026-07-26T15:40:00Z',
      approvalRequestId: later.id,
      approval,
    },
    ...overrides,
  });
}

test('issue 110: hasCompletedApprovalProvenance requires grant.requestId to match the latest request and execution', () => {
  const mismatched = issue110ApprovedTask({ requestId: 1 });
  /** @type {boolean} */
  let completed = true;
  completed = hasCompletedApprovalProvenance(mismatched);
  assert.equal(completed, false);
});

test('issue 110: a forged older-grant-to-later-request ledger fails with a named violation', async () => {
  const forged = issue110TwoRequestApprovedTask({ requestId: 0 });
  assert.equal(forged.execution.approval.requestId, 0);
  assert.equal(forged.execution.approvalRequestId, 1);
  const result = await verdictFor(forged);
  assertNamedFailure(result, '[approval-provenance]');
});

test('issue 110: existing ledgers without requestId keep working', async () => {
  const historical = issue110ApprovedTask();
  assert.equal(Object.hasOwn(historical.execution.approval, 'requestId'), false);
  /** @type {boolean} */
  let completed = false;
  completed = hasCompletedApprovalProvenance(historical);
  assert.equal(completed, true);
  const result = await verdictFor(historical);
  assert.equal(result.ok, true, result.stderr.join('\n'));
});

test('issue 110: existing two-request omitted-requestId ledgers keep working', async () => {
  const historical = issue110TwoRequestApprovedTask();
  assert.equal(Object.hasOwn(historical.execution.approval, 'requestId'), false);
  /** @type {boolean} */
  let completed = false;
  completed = hasCompletedApprovalProvenance(historical);
  assert.equal(completed, true);
  const result = await verdictFor(historical);
  assert.equal(result.ok, true, result.stderr.join('\n'));
});

