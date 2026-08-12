// @ts-check

/** @type {import('./types.js').TaskJson} */
const canonicalTask = {
  schemaVersion: 1,
  id: 27,
  slug: 'authoritative-schema',
  title: 'Authoritative schema',
  status: 'in_progress',
  stage: 'plan',
  priority: 'p2',
  deps: [],
  discoveredFrom: /** @type {number | string} */ ('#18'),
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
  complexity: 'complex',
  plan: {
    result: 'red',
    slices: ['Route conditional refactor'],
    testFiles: ['src/cli/record.test.js'],
    redRun: { command: 'node --test src/cli/record.test.js', output: 'missing routing' },
    escalation: null,
    refactorOpportunity: null,
  },
  agents: {
    implementer_agent_id: null,
    reviewer_agent_id: null,
    reviewer2_agent_id: null,
    audit_agent_id: null,
  },
  tests: { authored_by_agent_id: null, green: false, evidence: [] },
  review: { verdict: null, reviewer_agent_id: null, evidence: [] },
  review2: null,
  audit: { required: true, verdict: 'na', audit_agent_id: null, evidence: [] },
  commits: [],
  kickbacks: [],
  judgmentHistory: [{
    at: '2026-07-12T00:30:00.000Z',
    review: {
      verdict: 'pass',
      reviewer_agent_id: 'historical-reviewer',
      findings: [],
      evidence: [],
    },
    review2: {
      verdict: 'pass',
      reviewer_agent_id: 'historical-reviewer-two',
      findings: [],
      evidence: [],
    },
    audit: {
      required: true,
      verdict: 'pass',
      audit_agent_id: 'historical-auditor',
      findings: [],
      evidence: [],
    },
  }],
  blockedReason: null,
  abandonReason: null,
  convergence: {
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
  },
};
void canonicalTask;

/** @type {import('./types.js').CodeJudgmentHistory} */
const historicalNaCodeJudgment = {
  at: '2026-07-12T00:20:00.000Z',
  review: {
    verdict: 'na',
    reviewer_agent_id: null,
    findings: [],
    evidence: [],
  },
  review2: null,
  audit: {
    required: false,
    verdict: 'na',
    audit_agent_id: null,
    evidence: [],
  },
};
void historicalNaCodeJudgment;

/** @type {import('./types.js').CodeJudgmentHistory['review']} */
// @ts-expect-error - recorded historical reviews require findings
const historicalReviewWithoutFindings = {
  verdict: 'pass',
  reviewer_agent_id: 'historical-reviewer',
  evidence: [],
};
void historicalReviewWithoutFindings;

/** @type {NonNullable<import('./types.js').CodeJudgmentHistory['review2']>} */
// @ts-expect-error - recorded historical second reviews require findings
const historicalReview2WithoutFindings = {
  verdict: 'pass',
  reviewer_agent_id: 'historical-reviewer-two',
  evidence: [],
};
void historicalReview2WithoutFindings;

/** @type {import('./types.js').CodeJudgmentHistory['audit']} */
// @ts-expect-error - recorded historical audits require findings
const historicalAuditWithoutFindings = {
  required: true,
  verdict: 'pass',
  audit_agent_id: 'historical-auditor',
  evidence: [],
};
void historicalAuditWithoutFindings;

/** @type {import('./types.js').CodeJudgmentHistory['audit']} */
// @ts-expect-error - archived unaudited audits without findings have one exact compatibility shape
const historicalUnauditedAuditWithExtraState = {
  required: false,
  verdict: 'na',
  reportedVerdict: 'na',
  audit_agent_id: null,
  evidence: [],
};
void historicalUnauditedAuditWithExtraState;

/** @type {import('./types.js').TaskJson} */
const operationTask = {
  schemaVersion: 1,
  operationStateVersion: 1,
  id: 'op-28',
  slug: 'bounded-registry-transition',
  title: 'Bounded registry transition',
  status: 'done',
  category: 'operation',
  stage: 'done',
  priority: 'p1',
  deps: [],
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T01:00:00.000Z',
  complexity: 'complex',
  plan: {
    result: 'plan',
    slices: ['Move the bounded registry entry.'],
    runbook: ['Confirm the source entry, then move it to the destination.'],
    preconditions: ['The source entry exists exactly once.'],
    recoveryBoundary: 'Restore the captured source entry before the shared write.',
    approvalBoundary: 'Rewrite the shared registry entry from source to destination.',
    requiresApproval: true,
    postconditions: ['The source is absent and the destination exists exactly once.'],
    verificationSeams: ['Read the source and destination independently.'],
    escalation: null,
  },
  agents: {
    executor_agent_id: 'scoped-executor',
    verifier_agent_id: 'fresh-verifier',
    audit_agent_id: 'fresh-auditor',
  },
  execution: {
    result: 'executed',
    executor_agent_id: 'scoped-executor',
    cycle: 1,
    recordedAt: '2026-07-12T01:00:00.000Z',
    approvalRequestId: 0,
    actions: ['Moved the bounded registry entry.'],
    evidence: [{ command: 'inspect registry transition', output: 'transition complete' }],
    approvalRequired: null,
    approval: {
      mutation: 'Rewrite the shared registry entry from source to destination.',
      grantedBy: 'Chef',
      grantedAt: '2026-07-12T00:55:00.000Z',
    },
  },
  approvalRequests: [{
    id: 0,
    mutation: 'Rewrite the shared registry entry from source to destination.',
    requestedBy: 'approval-requester',
    requestedAt: '2026-07-12T00:50:00.000Z',
    cycle: 1,
  }],
  approvals: [{
    mutation: 'Rewrite the shared registry entry from source to destination.',
    grantedBy: 'Chef',
    grantedAt: '2026-07-12T00:55:00.000Z',
  }],
  verification: {
    verdict: 'pass',
    verifier_agent_id: 'fresh-verifier',
    postconditions: [{
      postcondition: 'The source is absent and the destination exists exactly once.',
      ok: true,
      evidence: 'Independent read found one destination and no source.',
    }],
    findings: [],
    evidence: [{ command: 'inspect registry postconditions', output: 'all postconditions satisfied' }],
  },
  audit: {
    required: true,
    verdict: 'pass',
    audit_agent_id: 'fresh-auditor',
    findings: [],
    evidence: [{ command: 'review-security --json', output: 'no findings' }],
    scan: {
      command: 'review-security --json',
      recommendation: 'PASS',
      reportPath: 'scratchpads/operation-audit.md',
    },
    coverage: [
      { category: 'secrets', status: 'covered_no_hits' },
      { category: 'injection_sql', status: 'covered_no_hits' },
      { category: 'injection_command', status: 'covered_no_hits' },
      { category: 'path_traversal', status: 'covered_no_hits' },
      { category: 'insecure_deserialization', status: 'covered_no_hits' },
      { category: 'weak_crypto', status: 'covered_no_hits' },
      { category: 'dynamic_execution', status: 'covered_no_hits' },
      { category: 'tls_transport', status: 'covered_no_hits' },
      { category: 'xss', status: 'covered_no_hits' },
      { category: 'sensitive_logging', status: 'covered_no_hits' },
      { category: 'insecure_permissions', status: 'covered_no_hits' },
    ],
  },
  refutes: [{
    agent_id: 'initial-refuter',
    source: 'verify',
    finding: 'src/core/record.js:10 The destination registry contains two entries.',
    verdict: 'survives',
    rationale: 'The duplicate is independently observable.',
    evidence: [{ command: 'inspect registry', output: 'two entries' }],
  }],
  judgmentHistory: [{
    cycle: 0,
    at: '2026-07-12T00:45:00.000Z',
    verification: {
      verdict: 'needs-work',
      verifier_agent_id: 'initial-verifier',
      postconditions: [{
        postcondition: 'The source is absent and the destination exists exactly once.',
        ok: false,
        evidence: 'Independent read found two destination entries.',
      }],
      findings: [{
        file: 'src/core/record.js',
        line: 10,
        severity: 'high',
        class: 'blocking',
        kickTo: 'execute',
        what: 'The destination registry contains two entries.',
        why: 'The observed duplicate violates the planned postcondition.',
        refute: {
          agent_id: 'initial-refuter',
          source: 'verify',
          finding: 'src/core/record.js:10 The destination registry contains two entries.',
          verdict: 'survives',
          rationale: 'The duplicate is independently observable.',
          evidence: [{ command: 'inspect registry', output: 'two entries' }],
        },
      }],
      evidence: [{ command: 'inspect registry postconditions', output: 'duplicate found' }],
    },
    audit: {
      required: true,
      verdict: 'pass',
      audit_agent_id: 'initial-auditor',
      findings: [],
      evidence: [{ command: 'review-security --json', output: 'no findings' }],
      scan: {
        command: 'review-security --json',
        recommendation: 'PASS',
        reportPath: 'scratchpads/initial-operation-audit.md',
      },
      coverage: [
        { category: 'secrets', status: 'covered_no_hits' },
        { category: 'injection_sql', status: 'covered_no_hits' },
        { category: 'injection_command', status: 'covered_no_hits' },
        { category: 'path_traversal', status: 'covered_no_hits' },
        { category: 'insecure_deserialization', status: 'covered_no_hits' },
        { category: 'weak_crypto', status: 'covered_no_hits' },
        { category: 'dynamic_execution', status: 'covered_no_hits' },
        { category: 'tls_transport', status: 'covered_no_hits' },
        { category: 'xss', status: 'covered_no_hits' },
        { category: 'sensitive_logging', status: 'covered_no_hits' },
        { category: 'insecure_permissions', status: 'covered_no_hits' },
      ],
    },
    agents: {
      verifier_agent_id: 'initial-verifier',
      audit_agent_id: 'initial-auditor',
    },
  }],
  commits: [],
  kickbacks: [{
    from: 'verify',
    to: 'execute',
    reason: 'Council authorized one scoped correction.',
    at: '2026-07-12T00:45:00.000Z',
  }],
  blockedReason: null,
  abandonReason: null,
  convergence: {
    cap: 2,
    stages: {
      verify: { blockingKickbacks: 2 },
      audit: { blockingKickbacks: 0 },
    },
    council: {
      convened: true,
      stage: 'verify',
      cycle: 0,
      executor_agent_id: 'initial-executor',
      members: [
        { agent_id: 'operation-integrity', lens: 'integrity', temperature: 0.3 },
        { agent_id: 'operation-security', lens: 'security', temperature: 0.7 },
        { agent_id: 'operation-pragmatist', lens: 'pragmatist', temperature: 1 },
      ],
      findings: [{
        id: 'F1',
        summary: 'The destination registry contains two entries.',
        source: 'verify',
        blockingVotes: 2,
        survived: true,
        followupTaskId: null,
      }],
      verdict: 'block',
      outcome: 'scoped-fix-shipped',
    },
  },
};
void operationTask;

/** @type {import('./types.js').OperationJudgmentHistory} */
// @ts-expect-error - operation history rows keep mandatory verifier and auditor ownership
const operationHistoryWithoutAgents = {
  at: '2026-07-12T00:45:00.000Z',
  verification: {
    verdict: 'pass',
    verifier_agent_id: 'historical-verifier',
    postconditions: [],
    findings: [],
    evidence: [],
  },
  audit: {
    required: true,
    verdict: 'pass',
    audit_agent_id: 'historical-auditor',
    findings: [],
    evidence: [],
  },
};
void operationHistoryWithoutAgents;

/** @type {import('./types.js').TaskJson} */
const historicalTaskWithoutRefactorOpportunity = {
  ...canonicalTask,
  plan: {
    result: 'red',
    slices: ['Retain historical mandatory refactor'],
    testFiles: ['src/cli/record.test.js'],
    redRun: { command: 'node --test src/cli/record.test.js', output: 'missing routing' },
    escalation: null,
  },
};
void historicalTaskWithoutRefactorOpportunity;

/** @type {import('./types.js').TaskJson['review']} */
const badReview = {
  // @ts-expect-error - verdict must be ReviewVerdict ('pass' | 'needs-work' | null)
  verdict: 'bogus',
  reviewer_agent_id: null,
  evidence: [],
};
void badReview;

/** @type {import('./types.js').TaskJson['audit']} */
const badAudit = {
  required: false,
  // @ts-expect-error - verdict must be AuditVerdict ('pass' | 'needs-work' | 'na')
  verdict: 'bogus',
  audit_agent_id: null,
  evidence: [],
};
void badAudit;

/** @type {import('./types.js').TaskJson} */
const taskWithRemovedBrains = {
  ...canonicalTask,
  // @ts-expect-error - brains are accepted only by the runtime compatibility reader, not canonical writers
  brains: { plan: { model: 'opus', effort: 'xhigh' } },
};
void taskWithRemovedBrains;

/** @type {import('./types.js').TaskJson} */
const taskWithRemovedPlanIdentity = {
  ...canonicalTask,
  agents: {
    implementer_agent_id: null,
    reviewer_agent_id: null,
    reviewer2_agent_id: null,
    audit_agent_id: null,
    // @ts-expect-error - the combined plan/test identity lives only at tests.authored_by_agent_id
    plan_agent_id: 'legacy-plan-agent',
  },
};
void taskWithRemovedPlanIdentity;

/** @type {import('./types.js').Kickback} */
const currentVerifyKickback = {
  from: 'verify',
  to: 'implement',
  reason: 'full verification gate failed',
  at: '2026-07-12T01:00:00.000Z',
};
void currentVerifyKickback;

/** @type {import('./types.js').LegacyKickback} */
const historicalTestKickback = {
  from: 'review',
  to: 'test',
  reason: 'historical test-author kickback',
  at: '2026-07-12T02:00:00.000Z',
};
void historicalTestKickback;

/** @type {import('./types.js').CodeConvergence} */
const convergenceWithSpentBonus = {
  cap: 2,
  stages: {
    review: { blockingKickbacks: 2, bonusGranted: true },
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
};
void convergenceWithSpentBonus;


/** @typedef {NonNullable<import('./types.js').CodeConvergence['council']['synthesis']>['selectedStrategy']} CodeCouncilRoute */
/** @typedef {NonNullable<import('./types.js').CodeConvergence['recovery']>['route']} CodeRecoveryRoute */
/** @typedef {NonNullable<import('./types.js').OperationConvergence['council']['synthesis']>['selectedStrategy']} OperationCouncilRoute */

/** @type {CodeCouncilRoute[]} */
const codeCouncilRoutes = [
  'confined-repair',
  'test-contract-repair',
  'refactor',
  'causal-subgraph-reconstruction',
  'full-replan',
  'operator-escalation',
];
void codeCouncilRoutes;

/** @type {CodeRecoveryRoute[]} */
const codeRecoveryRoutes = [
  'confined-repair',
  'test-contract-repair',
  'refactor',
  'causal-subgraph-reconstruction',
  'full-replan',
  'operator-escalation',
];
void codeRecoveryRoutes;

/** @type {OperationCouncilRoute[]} */
const operationCouncilRoutes = ['scoped-execute', 'operator-escalation'];
void operationCouncilRoutes;

/** @type {CodeCouncilRoute} */
// @ts-expect-error - code councils cannot select operation execution
const codeCouncilCannotScopeExecute = 'scoped-execute';
void codeCouncilCannotScopeExecute;

/** @type {CodeRecoveryRoute} */
// @ts-expect-error - code recovery cannot route through operation execution
const codeRecoveryCannotScopeExecute = 'scoped-execute';
void codeRecoveryCannotScopeExecute;

/** @type {OperationCouncilRoute} */
// @ts-expect-error - operation councils cannot select code repair
const operationCouncilCannotConfineRepair = 'confined-repair';
void operationCouncilCannotConfineRepair;