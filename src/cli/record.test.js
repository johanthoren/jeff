// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import * as recordCore from '../core/record.js';
import { runVerify } from '../core/verify.js';

const { recordSpecialistReturn: recordObservedSpecialistReturn } = recordCore;

const HERE = dirname(fileURLToPath(import.meta.url));
const COOK_JS = join(HERE, 'cook.js');
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

/** @param {Record<string, any>} [overrides] @returns {any} */
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
  if (task.tests?.green === true) {
    runGit(root, ['init', '-q']);
    runGit(root, ['config', 'user.email', 'tests@example.com']);
    runGit(root, ['config', 'user.name', 'Tests']);
    runGit(root, ['config', 'commit.gpgsign', 'false']);
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'baseline']);
    await recordCurrentGate(root, taskDir);
  }
  return { root, taskDir };
}

/** @param {string} root @param {string} taskDir */
async function recordCurrentGate(root, taskDir) {
  const task = await readTask(taskDir);
  const command = 'make test';
  task.tests = {
    ...task.tests,
    green: true,
    evidence: [
      ...task.tests.evidence,
      { command, output: `cook: verify green (${command})` },
    ],
    gate: {
      hash: runGit(root, ['rev-parse', 'HEAD']),
      clean: true,
      green: true,
      command,
      at: '2026-07-12T01:00:00Z',
    },
  };
  await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
}

/** @param {string} root @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function runCook(root, args, env = {}) {
  const result = spawnSync(process.execPath, [COOK_JS, ...args], {
    env: { ...process.env, ...env, COOK_ROOT: root },
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
const OBSERVED_AGENT_ID = Symbol('observedAgentId');
const COUNCIL_SYNTHESIZER_AGENT_ID = 'council-synthesizer';

/** @param {string} agentId @param {Record<string, any>} value */
function observedReturn(agentId, value) {
  Object.defineProperty(value, OBSERVED_AGENT_ID, { value: agentId });
  return value;
}

/** @param {Record<string, any>} value */
function observedAgentId(value) {
  return /** @type {any} */ (value)[OBSERVED_AGENT_ID];
}


/**
 * @param {string} root
 * @param {string} stage
 * @param {string} id
 * @param {Record<string, any>} value
 */
function recordSpecialistReturn(root, stage, id, value) {
  const observedIdentity = stage === 'council'
    ? {
        member_agent_ids: value.council.members.map((member) => member.agent_id),
        synthesizer_agent_id: COUNCIL_SYNTHESIZER_AGENT_ID,
      }
    : observedAgentId(value);
  return recordObservedSpecialistReturn(root, stage, id, value, observedIdentity);
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

function planReturn(overrides = {}, agentId = 'plan-agent') {
  const fields = overrides;
  return observedReturn(agentId, {
    stage: 'plan',
    result: 'red',
    complexity: 'simple',
    auditRequired: true,
    refactorOpportunity: null,
    slices: ['Add the recording boundary'],
    testFiles: ['src/cli/record.test.js'],
    redRun: { command: 'node --test src/cli/record.test.js', output: 'record is unavailable' },
    escalation: null,
    ...fields,
  });
}

/** @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function operationPlanReturn(overrides = {}, agentId = 'operation-plan-agent') {
  const fields = overrides;
  return observedReturn(agentId, {
    stage: 'plan',
    result: 'plan',
    complexity: 'complex',
    auditRequired: false,
    slices: ['Reconcile the bounded registry state.'],
    runbook: ['Confirm the source entry, then move it to the destination.'],
    preconditions: ['The source entry exists exactly once.'],
    recoveryBoundary: 'Before the shared registry write, restore the captured source entry.',
    approvalBoundary: 'Rewrite the shared release registry entry from source to destination.',
    requiresApproval: false,
    postconditions: ['The source is absent and the destination exists exactly once.'],
    verificationSeams: ['Read the source and destination entries independently.'],
    escalation: null,
    ...fields,
  });
}

/** @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function operationPlanState(overrides = {}) {
  const returned = operationPlanReturn(overrides);
  return {
    result: returned.result,
    slices: returned.slices,
    runbook: returned.runbook,
    preconditions: returned.preconditions,
    recoveryBoundary: returned.recoveryBoundary,
    approvalBoundary: returned.approvalBoundary,
    requiresApproval: returned.requiresApproval,
    postconditions: returned.postconditions,
    verificationSeams: returned.verificationSeams,
    escalation: returned.escalation,
  };
}

function executeReturn(agentId = 'executor', overrides = {}) {
  return observedReturn(agentId, {
    stage: 'execute',
    result: 'executed',
    actions: ['Moved the bounded registry entry.'],
    evidence: [{ command: 'inspect registry transition', output: 'source removed; destination created' }],
    kickback: null,
    approvalRequired: null,
    ...overrides,
  });
}

function verifyReturn(agentId = 'verifier', overrides = {}) {
  return observedReturn(agentId, {
    stage: 'verify',
    cycle: 0,
    verdict: 'pass',
    postconditions: [{
      postcondition: 'The source is absent and the destination exists exactly once.',
      ok: true,
      evidence: 'independent read found one destination and no source',
    }],
    findings: [],
    evidence: [{ command: 'inspect registry postconditions', output: 'all postconditions satisfied' }],
    ...overrides,
  });
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
    stage: 'plan',
    priority: 'p2',
    deps: [],
    complexity: 'simple',
    createdAt: '2026-07-12T00:00:00Z',
    updatedAt: '2026-07-12T00:00:00Z',
    agents: {
      executor_agent_id: null,
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

/** @param {boolean} [auditRequired] @param {Record<string, any>} [overrides] @returns {any} */
function readyOperation(auditRequired = false, overrides = {}) {
  return operationTask({
    stage: 'verify',
    complexity: 'complex',
    plan: operationPlanState(),
    agents: {
      ...operationTask().agents,
      executor_agent_id: 'executor',
    },
    execution: {
      result: 'executed',
      executor_agent_id: 'executor',
      cycle: 0,
      recordedAt: '2026-07-12T00:20:00Z',
      actions: ['Moved the bounded registry entry.'],
      evidence: [{ command: 'inspect registry transition', output: 'transition complete' }],
      approvalRequired: null,
    },
    verification: {
      verdict: null,
      verifier_agent_id: null,
      postconditions: [],
      findings: [],
      evidence: [],
    },
    audit: {
      required: auditRequired,
      verdict: 'na',
      audit_agent_id: null,
      findings: [],
      evidence: [],
    },
    ...overrides,
  });
}

function implementReturn(agentId = 'implementer', overrides = {}) {
  return observedReturn(agentId, {
    stage: 'implement',
    result: 'green',
    files: ['src/core/record.js'],
    greenRun: { command: 'node --test src/cli/record.test.js', output: 'pass' },
    kickback: null,
    ...overrides,
  });
}

function refactorReturn(agentId = 'refactorer') {
  return observedReturn(agentId, {
    stage: 'refactor',
    result: 'clean',
    files: [],
    outsideDiff: [],
    greenRun: { command: 'node --test src/cli/record.test.js', output: 'pass' },
    summary: ['No refactor needed.'],
  });
}

/** @param {string} agentId @param {Record<string, unknown>} [overrides] */
function reviewReturn(agentId, overrides = {}) {
  return observedReturn(agentId, {
    stage: 'review',
    cycle: 0,
    verdict: 'pass',
    acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: true }],
    findings: [],
    evidence: [{ command: 'git diff --check', output: 'clean' }],
    ...overrides,
  });
}

/** @param {string} [status] */
function auditCoverage(status = 'covered_no_hits') {
  return AUDIT_CATEGORIES.map((category) => ({ category, status }));
}

function auditReturn(agentId = 'auditor', overrides = {}) {
  return observedReturn(agentId, {
    stage: 'audit',
    cycle: 0,
    verdict: 'pass',
    scan: { command: 'review-security --json', recommendation: 'PASS', reportPath: '/tmp/report.md' },
    coverage: auditCoverage(),
    findings: [],
    evidence: [{ command: 'review-security --json', output: 'no findings' }],
    ...overrides,
  });
}

/** @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function blockingFinding(overrides = {}) {
  return {
    file: 'src/core/record.js',
    line: 10,
    severity: 'high',
    class: 'blocking',
    kickTo: 'implement',
    what: 'The recording path loses a result.',
    why: 'A supported completion order can overwrite durable evidence.',
    ...overrides,
  };
}

/** @param {string} agentId @param {Record<string, any>} finding @param {Record<string, unknown>} [overrides] */
function refuteReturn(agentId, finding, overrides = {}) {
  return observedReturn(agentId, {
    stage: 'refute',
    cycle: 0,
    finding: `${finding.file}:${finding.line} ${finding.what}`,
    verdict: 'survives',
    rationale: 'The supported input reaches the reported failure.',
    evidence: [{ command: 'node --test src/cli/record.test.js', output: 'failure reproduced' }],
    ...overrides,
  });
}

function auditStageTask(overrides = {}) {
  return canonicalTask({
    stage: 'audit',
    agents: { implementer_agent_id: 'implementer', reviewer_agent_id: 'reviewer', reviewer2_agent_id: null, audit_agent_id: null },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
    review: { verdict: 'pass', reviewer_agent_id: 'reviewer', findings: [], evidence: ['review evidence'] },
    audit: { required: true, verdict: 'na', audit_agent_id: null, findings: [], evidence: [] },
    ...overrides,
  });
}

function parallelJudgmentTask() {
  return canonicalTask({
    stage: 'review',
    complexity: 'complex',
    agents: { implementer_agent_id: 'implementer', reviewer_agent_id: null, reviewer2_agent_id: null, audit_agent_id: null },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
    audit: { required: true, verdict: 'na', audit_agent_id: null, findings: [], evidence: [] },
  });
}

function terminalReviewTask() {
  return canonicalTask({
    stage: 'review',
    agents: { implementer_agent_id: 'implementer', reviewer_agent_id: null, reviewer2_agent_id: null, audit_agent_id: null },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
  });
}

/** @param {Record<string, any>} [overrides] @returns {any} */
function councilTask(overrides = {}) {
  const finding = {
    ...blockingFinding(),
    refute: {
      agent_id: 'refuter',
      source: 'review',
      finding: 'src/core/record.js:10 The recording path loses a result.',
      verdict: 'survives',
      rationale: 'The failure is reachable.',
      evidence: [{ command: 'node --test src/cli/record.test.js', output: 'failure reproduced' }],
    },
  };
  return canonicalTask({
    stage: 'review',
    complexity: 'complex',
    agents: {
      implementer_agent_id: 'implementer',
      reviewer_agent_id: 'reviewer-one',
      reviewer2_agent_id: 'reviewer-two',
      audit_agent_id: 'auditor',
    },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
    plan: {
      result: 'red',
      slices: ['Implement the original council contract.'],
      testFiles: ['src/cli/record.test.js'],
      redRun: { command: 'node --test src/cli/record.test.js', output: 'original red' },
      escalation: null,
      refactorOpportunity: null,
    },
    implement: {
      agent_id: 'implementer',
      result: 'green',
      files: ['src/core/record.js'],
      greenRun: { command: 'node --test src/cli/record.test.js', output: 'original green' },
    },
    review: {
      verdict: 'needs-work',
      reportedVerdict: 'needs-work',
      reviewer_agent_id: 'reviewer-one',
      findings: [finding],
      evidence: [{ command: 'git diff --check', output: 'blocking finding' }],
      acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: false }],
    },
    review2: {
      verdict: 'pass',
      reportedVerdict: 'pass',
      reviewer_agent_id: 'reviewer-two',
      findings: [],
      evidence: [{ command: 'git diff --check', output: 'clean' }],
      acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: true }],
    },
    audit: {
      required: true,
      verdict: 'pass',
      reportedVerdict: 'pass',
      audit_agent_id: 'auditor',
      findings: [],
      evidence: [{ command: 'review-security --json', output: 'no findings' }],
      scan: { command: 'review-security --json', recommendation: 'PASS', reportPath: '/tmp/report.md' },
      coverage: auditCoverage(),
    },
    refutes: [finding.refute],
    convergence: {
      cap: 2,
      stages: { review: { blockingKickbacks: 2 }, audit: { blockingKickbacks: 0 } },
      council: { convened: false, stage: 'review', members: [], findings: [], verdict: null, outcome: null },
    },
    ...overrides,
  });
}
/** @param {Record<string, any>} [overrides] @returns {any} */
function confinedCouncilTask(overrides = {}) {
  return councilTask({
    plan: {
      result: 'red',
      slices: ['Implement without planned refactor'],
      testFiles: ['src/cli/record.test.js'],
      redRun: { command: 'node --test src/cli/record.test.js', output: 'missing behavior' },
      escalation: null,
      refactorOpportunity: null,
    },
    ...overrides,
  });
}


/** @param {string | null} [outcome] @param {Record<number, Record<string, any>>} [memberOverrides] @returns {any} */
function councilReturn(outcome = null, memberOverrides = {}) {
  const inquiryQuestion = 'Are these independent defects, or evidence that this part of the design should be reconstructed?';
  const inquiries = [
    {
      question: inquiryQuestion,
      problemRestatement: 'The recorder loses one accepted result under a supported completion order.',
      causalHypotheses: ['The write boundary replaces state instead of merging the active result.'],
      solutionStrategies: ['confined-repair', 'causal-subgraph-reconstruction'],
      findingVotes: [{ id: 'F1', blocking: true, rationale: 'The supported order loses durable evidence.' }],
      decisiveEvidence: ['The deterministic completion-order reproduction loses the first result.'],
    },
    {
      question: 'Which trust boundary owns preservation of concurrent specialist results?',
      problemRestatement: 'Accepted judgment evidence is not durable across all legal recorder orderings.',
      causalHypotheses: ['The atomic update contract does not cover the whole active judgment union.'],
      solutionStrategies: ['causal-subgraph-reconstruction', 'full-replan'],
      findingVotes: [{ id: 'F1', blocking: true, rationale: 'A durable evidence invariant is violated.' }],
      decisiveEvidence: ['The persisted task omits an already accepted judgment.'],
    },
    {
      question: 'What is the smallest recovery that restores the observable ledger contract?',
      problemRestatement: 'One completion order produces an incomplete task ledger.',
      causalHypotheses: ['A confined recorder correction may restore the same public contract.'],
      solutionStrategies: ['confined-repair', 'operator-escalation'],
      findingVotes: [{ id: 'F1', blocking: false, rationale: 'A bounded repair may be sufficient.' }],
      decisiveEvidence: ['The failure is isolated to one recorder transition.'],
    },
  ];
  return {
    stage: 'council',
    council: {
      convened: true,
      stage: 'review',
      members: [
        { agent_id: 'council-integrity', lens: 'integrity', temperature: 0.3 },
        { agent_id: 'council-security', lens: 'security', temperature: 0.7 },
        { agent_id: 'council-pragmatist', lens: 'pragmatist', temperature: 1.0 },
      ].map((member, index) => ({
        ...member,
        inquiry: inquiries[index],
        ...(memberOverrides[index] ?? {}),
      })),
      findings: [{
        id: 'F1',
        summary: 'The recording path loses a result.',
        source: 'review',
        blockingVotes: 2,
        survived: true,
        followupTaskId: null,
      }],
      synthesis: {
        problemRestatement: 'A supported completion order can discard accepted task evidence.',
        survivingBlockers: ['F1'],
        causalHypotheses: ['The recorder does not preserve the complete active judgment union.'],
        solutionStrategies: ['confined-repair', 'causal-subgraph-reconstruction'],
        rejectedAlternatives: ['causal-subgraph-reconstruction'],
        selectedStrategy: 'confined-repair',
        decisiveEvidence: ['Two independent inquiries reproduce a durable evidence loss.'],
      },
      verdict: 'block',
      outcome,
    },
  };
}

/** @returns {any} */
function mixedStageCouncilTask() {
  const task = councilTask();
  const auditFinding = {
    ...blockingFinding({
      line: 20,
      what: 'The audit recovery path can accept stale judgment evidence.',
      why: 'A scoped fix can ship while a parallel audit blocker remains current.',
    }),
    refute: {
      agent_id: 'audit-refuter',
      source: 'audit',
      finding: 'src/core/record.js:20 The audit recovery path can accept stale judgment evidence.',
      verdict: 'survives',
      rationale: 'The mixed-stage recovery path is reachable.',
      evidence: [{ command: 'node --test src/cli/record.test.js', output: 'failure reproduced' }],
    },
  };
  return councilTask({
    audit: {
      ...task.audit,
      verdict: 'needs-work',
      reportedVerdict: 'needs-work',
      findings: [auditFinding],
      evidence: [{ command: 'review-security --json', output: 'blocking finding' }],
    },
    refutes: [...task.refutes, auditFinding.refute],
    convergence: {
      ...task.convergence,
      stages: { review: { blockingKickbacks: 2 }, audit: { blockingKickbacks: 1 } },
    },
  });
}

/** @param {string | null} [outcome] @returns {any} */
function mixedStageCouncilReturn(outcome = null) {
  const result = councilReturn(outcome);
  return {
    ...result,
    council: {
      ...result.council,
      members: result.council.members.map((member) => ({
        ...member,
        inquiry: {
          ...member.inquiry,
          findingVotes: [
            ...member.inquiry.findingVotes,
            {
              id: 'F2',
              blocking: true,
              rationale: 'The stale audit evidence can authorize an invalid recovery completion.',
            },
          ],
        },
      })),
      findings: [
        ...result.council.findings,
        {
          id: 'F2',
          summary: 'The audit recovery path can accept stale judgment evidence.',
          source: 'audit',
          blockingVotes: 3,
          survived: true,
          followupTaskId: null,
        },
      ],
      synthesis: {
        ...result.council.synthesis,
        problemRestatement: 'The recovery boundary can lose recorder evidence and reuse stale audit proof.',
        survivingBlockers: ['F1', 'F2'],
        causalHypotheses: [
          'Recorder replacement and stale recovery proof may share one incomplete judgment-state boundary.',
        ],
        solutionStrategies: ['confined-repair', 'causal-subgraph-reconstruction', 'full-replan'],
        rejectedAlternatives: ['confined-repair', 'full-replan'],
        selectedStrategy: 'causal-subgraph-reconstruction',
        decisiveEvidence: ['Independent recorder and audit reproductions fail within the same recovery boundary.'],
      },
    },
  };
}

async function prepareScopedCouncilRecovery(task = confinedCouncilTask(), councilResult = councilReturn()) {
  const { root, taskDir } = await makeRoot(task);
  await writeFile(join(root, '.jeff', 'profile.md'), 'Test command: `true`\n', 'utf8');
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.email', 'tests@example.com']);
  runGit(root, ['config', 'user.name', 'Tests']);
  runGit(root, ['config', 'commit.gpgsign', 'false']);
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-qm', 'baseline']);

  await recordSpecialistReturn(root, 'council', '18', councilResult);
  let routed = await readTask(taskDir);
  if (routed.stage === 'plan') {
    await recordSpecialistReturn(
      root,
      'plan',
      '18',
      planReturn({ complexity: 'complex', auditRequired: true }, 'scoped-recovery-plan-agent'),
    );
    routed = await readTask(taskDir);
  }
  if (routed.stage === 'implement') {
    await recordSpecialistReturn(root, 'implement', '18', implementReturn('scoped-fix-implementer'));
  } else if (routed.stage === 'refactor') {
    await recordSpecialistReturn(root, 'refactor', '18', refactorReturn('scoped-fix-refactorer'));
  }
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-qm', 'record scoped recovery']);
  return { root, taskDir };
}

/** @param {string} root @param {Record<string, any>} [overrides] */
async function recordFreshCouncilJudgments(root, overrides = {}) {
  const taskDir = join(root, '.jeff', 'tasks', '018-record-specialists');
  const cycle = (await readTask(taskDir)).judgmentHistory?.length ?? 0;
  await recordSpecialistReturn(root, 'review', '18', reviewReturn('fresh-reviewer-one', {
    cycle,
    ...overrides.review,
  }));
  await recordSpecialistReturn(root, 'review', '18', reviewReturn('fresh-reviewer-two', {
    cycle,
    ...overrides.review2,
  }));
  if (overrides.includeAudit === true) {
    await recordSpecialistReturn(root, 'audit', '18', auditReturn('fresh-auditor', {
      cycle,
      ...overrides.audit,
    }));
  }
}

async function prepareMixedStageReassessment() {
  return prepareScopedCouncilRecovery(
    mixedStageCouncilTask(),
    mixedStageCouncilReturn(),
  );
}

async function prepareGatedMixedStageReassessment() {
  const prepared = await prepareMixedStageReassessment();
  const verification = await runVerify(prepared.root, '18');
  assert.equal(verification.code, 0, verification.stderr.join('\n'));
  return prepared;
}

async function prepareCompletedMixedStageReassessment() {
  const prepared = await prepareGatedMixedStageReassessment();
  await recordFreshCouncilJudgments(prepared.root, { includeAudit: true });
  return prepared;
}

test('issue 121 CLI records a code return without agent_id from the separate observed identity', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const file = await writeReturn(root, planReturn());
    assert.equal((await readFile(file, 'utf8')).includes('"agent_id"'), false);

    const result = runCook(root, ['record', 'plan', '18', 'plan-agent', file]);
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
test('issue 121 CLI records operation returns from separate observed identities', async () => {
  const { root, taskDir } = await makeRoot(operationTask());
  try {
    let file = await writeReturn(root, operationPlanReturn());
    let result = runCook(root, ['record', 'plan', '18', 'operation-plan-agent', file]);
    let recorded = await readTask(taskDir);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(recorded.stage, 'execute');
    assert.equal(Object.hasOwn(recorded.agents, 'implementer_agent_id'), false);
    assert.equal(Object.hasOwn(recorded.agents, 'reviewer_agent_id'), false);
    assert.equal(Object.hasOwn(recorded, 'tests'), false);
    assert.equal(Object.hasOwn(recorded, 'review'), false);
    assert.equal(Object.hasOwn(recorded, 'review2'), false);
    assert.equal(recorded.plan.redRun, undefined);
    assert.equal(recorded.plan.testFiles, undefined);
    assert.equal(recorded.plan.refactorOpportunity, undefined);
    assert.deepEqual(recorded.plan.runbook, operationPlanReturn().runbook);
    assert.deepEqual(recorded.plan.verificationSeams, operationPlanReturn().verificationSeams);

    file = await writeReturn(root, executeReturn());
    result = runCook(root, ['record', 'execute', '18', 'executor', file]);
    recorded = await readTask(taskDir);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(recorded.stage, 'verify');
    assert.equal(recorded.agents.executor_agent_id, 'executor');
    assert.deepEqual(recorded.execution.evidence, executeReturn().evidence);

    file = await writeReturn(root, verifyReturn());
    result = runCook(root, ['record', 'verify', '18', 'verifier', file]);
    recorded = await readTask(taskDir);

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual([recorded.status, recorded.stage], ['done', 'done']);
    assert.equal(recorded.agents.verifier_agent_id, 'verifier');
    assert.equal(Object.hasOwn(recorded, 'tests'), false);
    assert.equal(Object.hasOwn(recorded, 'review'), false);
    assert.equal(Object.hasOwn(recorded, 'review2'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('builder returns require the active stage and preserve the legacy test-stage resume', async (t) => {
  await t.test('execute at verify rejects atomically', async () => {
    const approval = {
      mutation: 'Rewrite the shared release registry entry from source to destination.',
      grantedBy: 'Chef',
      grantedAt: '2026-07-26T15:30:00Z',
    };
    const task = readyOperation(false, {
      approvals: [approval],
      execution: {
        ...readyOperation().execution,
        approval,
      },
    });
    const { root, taskDir } = await makeRoot(task);
    try {
      const taskFile = join(taskDir, 'task.json');
      const beforeBytes = await readFile(taskFile, 'utf8');
      const before = JSON.parse(beforeBytes);

      await assert.rejects(
        recordSpecialistReturn(root, 'execute', '18', executeReturn('late-executor')),
        /\[record-transition\] task is at verify, not execute/,
      );

      const afterBytes = await readFile(taskFile, 'utf8');
      const after = JSON.parse(afterBytes);
      assert.equal(afterBytes, beforeBytes);
      assert.deepEqual(after.approvals, before.approvals);
      assert.deepEqual(after.execution, before.execution);
      assert.equal(after.stage, 'verify');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('legacy test stage resumes through plan', async () => {
    const task = canonicalTask({
      stage: 'test',
      brains: { plan: { model: 'opus', effort: 'xhigh' } },
      agents: {
        plan_agent_id: 'legacy-plan',
        test_author_agent_id: 'legacy-test-author',
        implementer_agent_id: null,
        reviewer_agent_id: null,
        audit_agent_id: null,
      },
      review: { verdict: 'na', reviewer_agent_id: null, evidence: [] },
    });
    const { root, taskDir } = await makeRoot(task);
    try {
      await recordSpecialistReturn(
        root,
        'plan',
        '18',
        planReturn({}, 'Plan101Ordering'),
      );

      const recorded = await readTask(taskDir);
      assert.equal(recorded.stage, 'implement');
      assert.equal(recorded.tests.authored_by_agent_id, 'Plan101Ordering');
      assert.equal(recorded.agents.plan_agent_id, 'legacy-plan');
      assert.equal(recorded.agents.test_author_agent_id, 'legacy-test-author');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 101 operation plan requires operational boundaries and rejects code-plan obligations atomically', async (t) => {
  for (const field of [
    'runbook',
    'preconditions',
    'recoveryBoundary',
    'approvalBoundary',
    'requiresApproval',
    'postconditions',
    'verificationSeams',
  ]) {
    await t.test(`missing ${field}`, async () => {
      const { root, taskDir } = await makeRoot(operationTask());
      try {
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        const returned = operationPlanReturn();
        delete returned[field];
        const file = await writeReturn(root, returned);

        const result = runCook(root, ['record', 'plan', '18', 'operation-plan-agent', file]);

        assert.notEqual(result.code, 0);
        assert.match(result.stderr, new RegExp(`\\[record-schema\\].*${field}`));
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  const wrongContracts = [
    ['operation plan with code-test fields', operationTask(), {
      ...operationPlanReturn(),
      refactorOpportunity: null,
      testFiles: ['src/cli/record.test.js'],
      redRun: { command: 'node --test', output: 'red' },
    }, 'operation-plan-agent'],
    ['code task with operation plan', canonicalTask(), operationPlanReturn(), 'operation-plan-agent'],
    ['operation task with code plan', operationTask(), planReturn(), 'plan-agent'],
  ];
  for (const [name, task, returned, agentId] of wrongContracts) {
    await t.test(name, async () => {
      const { root, taskDir } = await makeRoot(task);
      try {
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        const file = await writeReturn(root, returned);
        const result = runCook(root, ['record', 'plan', '18', agentId, file]);

        assert.notEqual(result.code, 0);
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 101 cycle 2: operation plans durably escalate without advancing execution', async () => {
  const { root, taskDir } = await makeRoot(operationTask());
  try {
    const escalation = observedReturn('operation-plan-agent', {
      stage: 'plan',
      result: 'escalation',
      complexity: 'complex',
      auditRequired: true,
      slices: ['Resolve the registry ownership fork before choosing a runbook.'],
      escalation: {
        fork: 'The repository does not establish which registry is authoritative.',
        options: ['Treat the local registry as authoritative.', 'Treat the remote registry as authoritative.'],
      },
    });

    let recorded;
    try {
      recorded = await recordSpecialistReturn(root, 'plan', '18', escalation);
    } catch (error) {
      assert.fail(`[operation-plan-escalation] strict operation escalation was rejected: ${String(error)}`);
    }

    assert.deepEqual([recorded.status, recorded.stage], ['in_progress', 'plan']);
    assert.deepEqual(recorded.plan, {
      result: 'escalation',
      slices: escalation.slices,
      escalation: escalation.escalation,
    });
    assert.equal(recorded.execution, undefined);
    assert.equal(recorded.agents.executor_agent_id, null);

    const resumed = await recordSpecialistReturn(root, 'plan', '18', operationPlanReturn());
    assert.deepEqual([resumed.status, resumed.stage, resumed.plan.result], ['in_progress', 'execute', 'plan']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 107 cooperative approval retains request, grant, and re-fire ordering', async (t) => {
  const approvalBoundary = operationPlanReturn().approvalBoundary;
  const priorApproval = {
    mutation: 'Publish the preceding release registry entry.',
    grantedBy: 'Chef',
    grantedAt: '2026-07-26T15:00:00Z',
  };
  const priorRequest = {
    id: 0,
    mutation: priorApproval.mutation,
    requestedBy: 'prior-requester',
    requestedAt: '2026-07-26T14:50:00Z',
    cycle: 0,
  };

  /** @param {Record<string, any>} [overrides] */
  async function requestedOperation(overrides = {}) {
    const fixture = await makeRoot(operationTask({
      stage: 'execute',
      plan: operationPlanState({ requiresApproval: true, approvalBoundary }),
      ...overrides,
    }));
    await recordSpecialistReturn(fixture.root, 'execute', '18', executeReturn('executor', {
      result: 'approval-required',
      actions: ['Captured the recoverable pre-mutation state.'],
      evidence: [{ command: 'inspect source state', output: 'recovery snapshot recorded' }],
      approvalRequired: approvalBoundary,
    }));
    return fixture;
  }

  await t.test('approval-gated plans cannot execute before a parent grant', async () => {
    const { root, taskDir } = await makeRoot(operationTask({
      stage: 'execute',
      plan: operationPlanState({ requiresApproval: true, approvalBoundary }),
    }));
    try {
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordSpecialistReturn(root, 'execute', '18', executeReturn()),
        /\[record-approval\].*(?:approval|grant)/,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('approval request must equal the planned operator-facing boundary', async () => {
    const { root, taskDir } = await makeRoot(operationTask({
      stage: 'execute',
      plan: operationPlanState({ requiresApproval: true, approvalBoundary }),
    }));
    try {
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordSpecialistReturn(root, 'execute', '18', executeReturn('executor', {
          result: 'approval-required',
          approvalRequired: 'Delete the shared release registry entry.',
        })),
        /\[record-approval\].*match.*plan/,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('approved re-fire requires an executor fresh from the requester', async () => {
    const { root, taskDir } = await requestedOperation();
    try {
      await recordCore.recordApproval(root, '18', 'Chef');
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordSpecialistReturn(root, 'execute', '18', executeReturn('executor')),
        /\[record-identity\].*(?:fresh|reuse|previous)/i,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('parent grant copies the pending boundary and remains append-only across re-fire', async () => {
    const { root, taskDir } = await requestedOperation({
      approvalRequests: [priorRequest],
      approvals: [priorApproval],
    });
    try {
      await recordCore.recordApproval(root, '18', 'Chef');

      const approved = await readTask(taskDir);
      const grant = approved.approvals.at(-1);
      assert.deepEqual(approved.approvals.slice(0, -1), [priorApproval]);
      assert.equal(grant.mutation, approvalBoundary);
      assert.equal(grant.grantedBy, 'Chef');
      assert.match(grant.grantedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      assert.equal(approved.approvalRequests.length, 2);
      assert.deepEqual(approved.approvalRequests[0], priorRequest);
      const request = approved.approvalRequests.at(-1);
      assert.equal(request.id, 1);
      assert.equal(request.mutation, approvalBoundary);
      assert.equal(request.requestedBy, 'executor');
      assert.equal(request.cycle, 0);
      assert.equal(approved.execution.approvalRequestId, request.id);
      assert.ok(Date.parse(request.requestedAt) <= Date.parse(grant.grantedAt));

      await recordSpecialistReturn(root, 'execute', '18', executeReturn('executor-fresh'));
      const recorded = await readTask(taskDir);
      assert.deepEqual([recorded.status, recorded.stage], ['in_progress', 'verify']);
      assert.deepEqual(recorded.execution.approval, grant);
      assert.deepEqual(recorded.approvals, [priorApproval, grant]);
      assert.deepEqual(recorded.approvalRequests, [priorRequest, request]);
      assert.equal(recorded.execution.approvalRequestId, request.id);
      assert.equal(recorded.execution.cycle, request.cycle);
      assert.ok(Date.parse(grant.grantedAt) <= Date.parse(recorded.execution.recordedAt));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('stale duplicate grant rejects atomically', async () => {
    const { root, taskDir } = await requestedOperation();
    try {
      await recordCore.recordApproval(root, '18', 'Chef');
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordCore.recordApproval(root, '18', 'Chef'),
        /\[record-approval\].*(?:already|stale).*grant/,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('executor cannot self-attest grant identity or time', async () => {
    const { root, taskDir } = await requestedOperation();
    try {
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordSpecialistReturn(root, 'execute', '18', executeReturn('executor-fresh', {
          approval: {
            mutation: approvalBoundary,
            grantedBy: 'Chef',
            grantedAt: '2026-07-26T15:30:00Z',
          },
        })),
        /\[record-schema\].*approval/,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('pending request without a parent grant rejects atomically', async () => {
    const { root, taskDir } = await requestedOperation();
    try {
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordSpecialistReturn(root, 'execute', '18', executeReturn('executor-fresh')),
        /\[record-approval\].*grant.*required/,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('parent grant without a pending exact request rejects atomically', async () => {
    const { root, taskDir } = await makeRoot(operationTask({
      stage: 'execute',
      plan: operationPlanState({ requiresApproval: true, approvalBoundary }),
    }));
    try {
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordCore.recordApproval(root, '18', 'Chef'),
        /\[record-approval\].*pending.*request/,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('parent cannot grant a persisted request without executor provenance', async () => {
    const { root, taskDir } = await makeRoot(operationTask({
      stage: 'execute',
      plan: operationPlanState({ requiresApproval: true, approvalBoundary }),
      execution: {
        result: 'approval-required',
        executor_agent_id: null,
        actions: ['Captured the recoverable pre-mutation state.'],
        evidence: [{ command: 'inspect source state', output: 'recovery snapshot recorded' }],
        approvalRequired: approvalBoundary,
      },
    }));
    try {
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordCore.recordApproval(root, '18', 'Chef'),
        /executor.*(?:identity|provenance)/i,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('host-neutral CLI records the cooperative parent grant', async () => {
    const { root, taskDir } = await requestedOperation();
    try {
      const result = runCook(root, ['approve', '18', 'Chef']);
      assert.equal(result.code, 0, result.stderr);

      const approved = await readTask(taskDir);
      assert.equal(approved.execution.approval.mutation, approvalBoundary);
      assert.equal(approved.execution.approval.grantedBy, 'Chef');
      assert.deepEqual(approved.approvals, [approved.execution.approval]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 101 execute can kick an operation back to capture or plan', async (t) => {
  for (const destination of ['capture', 'plan']) {
    await t.test(destination, async () => {
      const { root, taskDir } = await makeRoot(operationTask({ stage: 'execute' }));
      try {
        await recordSpecialistReturn(root, 'execute', '18', executeReturn('executor', {
          result: 'kickback',
          actions: ['Inspected the bounded source state.'],
          evidence: [{ command: 'inspect source state', output: 'precondition failed' }],
          kickback: { to: destination, reason: 'The captured boundary is incomplete.' },
        }));
        const recorded = await readTask(taskDir);

        assert.equal(recorded.stage, destination);
        assert.deepEqual(
          [recorded.kickbacks.at(-1).from, recorded.kickbacks.at(-1).to],
          ['execute', destination],
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 157 scoped operation council recovery accepts divergent execution and judgment history cycles', async () => {
  const { root, taskDir } = await makeRoot(operationTask({
    stage: 'execute',
    convergence: {
      cap: 1,
      stages: { verify: { blockingKickbacks: 0 }, audit: { blockingKickbacks: 0 } },
      council: { convened: false, stage: null, members: [], findings: [], verdict: null, outcome: null },
    },
  }));
  try {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await recordSpecialistReturn(root, 'execute', '18', executeReturn(`executor-${cycle}`, {
        result: 'kickback',
        actions: ['Inspected the bounded source state.'],
        evidence: [{ command: 'inspect source state', output: 'the operation plan needs revision' }],
        kickback: { to: 'plan', reason: 'The bounded operation plan needs revision.' },
      }));
      await recordSpecialistReturn(
        root,
        'plan',
        '18',
        operationPlanReturn({}, `operation-plan-${cycle}`),
      );
    }

    await recordSpecialistReturn(root, 'execute', '18', executeReturn('executor-3'));
    const finding = blockingFinding({
      kickTo: 'execute',
      what: 'The destination registry contains two entries.',
    });
    await recordSpecialistReturn(root, 'verify', '18', verifyReturn('verifier-3', {
      cycle: 3,
      verdict: 'needs-work',
      postconditions: [{
        postcondition: 'The source is absent and the destination exists exactly once.',
        ok: false,
        evidence: 'independent read found two destination entries',
      }],
      findings: [finding],
    }));
    await recordSpecialistReturn(
      root,
      'refute',
      '18',
      refuteReturn('verify-refuter-3', finding, { source: 'verify', cycle: 3 }),
    );

    const beforeFix = await readTask(taskDir);
    assert.equal(beforeFix.execution.cycle, 3);
    assert.equal(beforeFix.judgmentHistory, undefined);
    assert.equal(beforeFix.convergence.stages.verify.blockingKickbacks, 1);

    await recordSpecialistReturn(root, 'execute', '18', executeReturn('executor-4'));
    await recordSpecialistReturn(root, 'verify', '18', verifyReturn('verifier-4', {
      cycle: 4,
      verdict: 'needs-work',
      postconditions: beforeFix.verification.postconditions,
      findings: [finding],
    }));
    await recordSpecialistReturn(
      root,
      'refute',
      '18',
      refuteReturn('verify-refuter-4', finding, { source: 'verify', cycle: 4 }),
    );

    await recordSpecialistReturn(root, 'council', '18', operationCouncilReturn());
    await recordSpecialistReturn(root, 'execute', '18', executeReturn('executor-5'));
    await recordSpecialistReturn(root, 'verify', '18', verifyReturn('verifier-5', { cycle: 5 }));

    const beforeRecovery = await readTask(taskDir);
    assert.deepEqual(
      beforeRecovery.judgmentHistory.map((/** @type {any} */ entry) => entry.cycle),
      [0, 1],
    );
    assert.equal(beforeRecovery.convergence.council.cycle, 4);
    assert.equal(beforeRecovery.execution.cycle, 5);

    const recovered = await recordSpecialistReturn(
      root,
      'council',
      '18',
      operationCouncilReturn('scoped-fix-shipped'),
    );
    assert.deepEqual([recovered.status, recovered.stage], ['done', 'done']);
    assert.equal(recovered.convergence.council.outcome, 'scoped-fix-shipped');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 176 explicit operation reverify preserves execution and fails closed', async (t) => {
  const nonOperationFinding = () => blockingFinding({
    file: 'agents/cook-verify.md',
    line: 17,
    kickTo: 'plan',
    what: 'The verifier cannot run the plan verification command.',
    why: 'The verification station lacks the command capability required by the recorded seam.',
  });

  /** @param {string} root @param {any} finding */
  const recordFailure = (
    root,
    finding,
    { agentId = 'verifier-old', cycle = 0 } = {},
  ) => recordSpecialistReturn(root, 'verify', '18', verifyReturn(agentId, {
    cycle,
    verdict: 'needs-work',
    postconditions: [{
      postcondition: 'The source is absent and the destination exists exactly once.',
      ok: false,
      evidence: 'the verification command was unavailable',
    }],
    findings: [finding],
    evidence: [{
      command: 'inspect registry postconditions',
      output: 'command unavailable in the verification station',
    }],
  }));

  const prepareFailure = async ({
    auditRequired = false,
    finding = nonOperationFinding(),
    taskOverrides = {},
  } = {}) => {
    const prepared = await makeRoot(readyOperation(auditRequired, taskOverrides));
    if (auditRequired) {
      await recordSpecialistReturn(prepared.root, 'audit', '18', auditReturn('auditor-old'));
    }
    await recordFailure(prepared.root, finding);
    return { ...prepared, finding };
  };

  const prepareApprovalFailure = async () => {
    const approvalBoundary = operationPlanReturn().approvalBoundary;
    const prepared = await makeRoot(operationTask());
    await recordSpecialistReturn(
      prepared.root,
      'plan',
      '18',
      operationPlanReturn({ auditRequired: true, requiresApproval: true, approvalBoundary }),
    );
    await recordSpecialistReturn(prepared.root, 'execute', '18', executeReturn('requester', {
      result: 'approval-required',
      actions: ['Captured the recoverable pre-mutation state.'],
      evidence: [{ command: 'inspect source state', output: 'recovery snapshot recorded' }],
      approvalRequired: approvalBoundary,
    }));
    await recordCore.recordApproval(prepared.root, '18', 'Chef');
    await recordSpecialistReturn(prepared.root, 'execute', '18', executeReturn('executor-approved'));
    await recordSpecialistReturn(prepared.root, 'audit', '18', auditReturn('auditor-old'));
    const finding = nonOperationFinding();
    await recordFailure(prepared.root, finding);
    return { ...prepared, finding };
  };

  const preparePendingCouncil = async () => {
    const prepared = await prepareFailure({
      taskOverrides: {
        convergence: {
          cap: 1,
          stages: { verify: { blockingKickbacks: 0 }, audit: { blockingKickbacks: 0 } },
          council: {
            convened: false,
            stage: null,
            members: [],
            findings: [],
            verdict: null,
            outcome: null,
          },
        },
      },
    });
    await recordSpecialistReturn(
      prepared.root,
      'refute',
      '18',
      refuteReturn('refuter-0', prepared.finding, { source: 'verify' }),
    );
    await recordSpecialistReturn(
      prepared.root,
      'plan',
      '18',
      operationPlanReturn({}, 'recovery-plan'),
    );
    await recordSpecialistReturn(prepared.root, 'execute', '18', executeReturn('executor-1'));
    await recordFailure(prepared.root, prepared.finding, { agentId: 'verifier-1', cycle: 1 });
    await recordSpecialistReturn(
      prepared.root,
      'refute',
      '18',
      refuteReturn('refuter-1', prepared.finding, { source: 'verify', cycle: 1 }),
    );
    return prepared;
  };

  /** @param {any} finding */
  const blockingCouncilReturn = (finding) => {
    const result = operationCouncilReturn();
    return {
      ...result,
      council: {
        ...result.council,
        findings: result.council.findings.map((councilFinding) => ({
          ...councilFinding,
          summary: finding.what,
        })),
      },
    };
  };

  await t.test('preserves approval-gated provenance through reverify and fresh completion', async () => {
    const { root, taskDir } = await prepareApprovalFailure();
    try {
      const before = await readTask(taskDir);
      const result = runCook(root, ['reverify', '18']);
      const reset = await readTask(taskDir);

      assert.equal(result.code, 0, result.stderr);
      for (const field of ['execution', 'approvalRequests', 'approvals', 'audit']) {
        assert.deepEqual(reset[field], before[field], `${field} changed during reverify`);
      }
      assert.equal(reset.agents.executor_agent_id, before.agents.executor_agent_id);
      assert.equal(reset.agents.audit_agent_id, before.agents.audit_agent_id);
      assert.equal(reset.agents.verifier_agent_id, null);
      assert.deepEqual(reset.verification, {
        verdict: null,
        verifier_agent_id: null,
        postconditions: [],
        findings: [],
        evidence: [],
      });
      assert.deepEqual([reset.status, reset.stage], ['in_progress', 'verify']);
      assert.equal(reset.judgmentHistory.length, 1);
      assert.equal(reset.judgmentHistory[0].cycle, 0);
      assert.deepEqual(reset.judgmentHistory[0].verification, before.verification);
      assert.deepEqual(reset.judgmentHistory[0].audit, before.audit);
      assert.deepEqual(reset.judgmentHistory[0].agents, {
        verifier_agent_id: 'verifier-old',
        audit_agent_id: 'auditor-old',
      });

      const returnFile = await writeReturn(root, verifyReturn(), 'approval-reverify.json');
      const verified = runCook(root, ['record', 'verify', '18', 'verifier-fresh', returnFile]);
      const completed = await readTask(taskDir);
      assert.equal(verified.code, 0, verified.stderr);
      assert.deepEqual([completed.status, completed.stage], ['done', 'done']);
      for (const field of ['execution', 'approvalRequests', 'approvals', 'audit']) {
        assert.deepEqual(completed[field], before[field], `${field} changed during fresh completion`);
      }
      assert.deepEqual(completed.judgmentHistory, reset.judgmentHistory);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('requires the next verifier to differ from the executor and archived verifier', async () => {
    const { root, taskDir } = await prepareFailure();
    try {
      assert.equal(runCook(root, ['reverify', '18']).code, 0);
      const returnFile = await writeReturn(root, verifyReturn(), 'fresh-verify.json');

      for (const [agentId, error] of /** @type {[string, RegExp][]} */ ([
        ['verifier-old', /\[record-identity\].*(?:archived|fresh|previous)/i],
        ['executor', /\[inv2\]/],
      ])) {
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        const rejected = runCook(root, ['record', 'verify', '18', agentId, returnFile]);
        assert.notEqual(rejected.code, 0);
        assert.match(rejected.stderr, error);
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      }

      const accepted = runCook(root, ['record', 'verify', '18', 'verifier-fresh', returnFile]);
      const completed = await readTask(taskDir);
      assert.equal(accepted.code, 0, accepted.stderr);
      assert.deepEqual([completed.status, completed.stage], ['done', 'done']);
      assert.equal(completed.execution.executor_agent_id, 'executor');
      assert.equal(completed.verification.verifier_agent_id, 'verifier-fresh');
      assert.equal(completed.judgmentHistory[0].verification.verifier_agent_id, 'verifier-old');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('keeps the occupied-slot and false-postcondition guards intact', async () => {
    const { root, taskDir, finding } = await prepareFailure();
    try {
      const occupied = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordSpecialistReturn(root, 'verify', '18', verifyReturn('verifier-fresh')),
        /verification slot is already occupied/,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), occupied);

      await recordSpecialistReturn(root, 'refute', '18', refuteReturn('refuter', finding, {
        source: 'verify',
        verdict: 'refuted',
      }));
      const kicked = await readTask(taskDir);
      assert.deepEqual([kicked.status, kicked.stage], ['in_progress', 'execute']);
      assert.equal(kicked.verification.verdict, 'pass');
      assert.equal(kicked.verification.postconditions[0].ok, false);
      assert.match(kicked.kickbacks.at(-1).reason, /postcondition/i);

      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      const rejected = runCook(root, ['reverify', '18']);
      assert.notEqual(rejected.code, 0);
      assert.match(rejected.stderr, /\[record-reverify\].*(?:passing|needs-work)/i);
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('rejects invalid task states atomically', async (invalid) => {
    const operationDefect = blockingFinding({
      kickTo: 'execute',
      what: 'The operation produced two destination entries.',
      why: 'The independently observed duplicate requires execute recovery.',
    });
    const scenarios = [
      {
        name: 'code task',
        prepare: () => makeRoot(canonicalTask()),
        error: /\[record-reverify\].*operation/i,
      },
      {
        name: 'operation without a recorded verification',
        prepare: () => makeRoot(readyOperation()),
        error: /\[record-reverify\].*(?:absent|missing|needs-work)/i,
      },
      {
        name: 'operation with passing verification',
        prepare: async () => {
          const prepared = await makeRoot(readyOperation(true));
          await recordSpecialistReturn(prepared.root, 'verify', '18', verifyReturn('verifier-old'));
          return prepared;
        },
        error: /\[record-reverify\].*(?:passing|needs-work)/i,
      },
      {
        name: 'operation defect requiring execute recovery',
        prepare: () => prepareFailure({ finding: operationDefect }),
        error: /\[record-reverify\].*(?:execute|operation defect|recovery)/i,
      },
    ];

    for (const scenario of scenarios) {
      await invalid.test(scenario.name, async () => {
        const { root, taskDir } = await scenario.prepare();
        try {
          const before = await readFile(join(taskDir, 'task.json'), 'utf8');
          const rejected = runCook(root, ['reverify', '18']);
          assert.notEqual(rejected.code, 0);
          assert.match(rejected.stderr, scenario.error);
          assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  });

  await t.test('rejects post-refute and council recovery states atomically', async (recovery) => {
    const scenarios = [
      {
        name: 'surviving refute routed to plan',
        prepare: async () => {
          const prepared = await prepareFailure();
          await recordSpecialistReturn(
            prepared.root,
            'refute',
            '18',
            refuteReturn('refuter-plan', prepared.finding, { source: 'verify' }),
          );
          return prepared;
        },
        /** @param {any} task */
        assertState: (task) => {
          assert.equal(task.stage, 'plan');
          assert.equal(task.verification.findings[0].refute.verdict, 'survives');
          assert.deepEqual(
            [task.kickbacks.at(-1).from, task.kickbacks.at(-1).to],
            ['verify', 'plan'],
          );
        },
      },
      {
        name: 'awaiting pending council',
        prepare: preparePendingCouncil,
        /** @param {any} task */
        assertState: (task) => {
          assert.equal(task.stage, 'verify');
          assert.deepEqual(
            [task.convergence.council.convened, task.convergence.council.stage],
            [false, 'verify'],
          );
        },
      },
      {
        name: 'convened blocking council',
        prepare: async () => {
          const prepared = await preparePendingCouncil();
          await recordSpecialistReturn(
            prepared.root,
            'council',
            '18',
            blockingCouncilReturn(prepared.finding),
          );
          return prepared;
        },
        /** @param {any} task */
        assertState: (task) => {
          assert.equal(task.stage, 'execute');
          assert.deepEqual(
            [
              task.convergence.council.convened,
              task.convergence.council.verdict,
              task.convergence.council.outcome,
            ],
            [true, 'block', null],
          );
        },
      },
    ];

    for (const scenario of scenarios) {
      await recovery.test(scenario.name, async () => {
        const { root, taskDir } = await scenario.prepare();
        try {
          scenario.assertState(await readTask(taskDir));
          const before = await readFile(join(taskDir, 'task.json'), 'utf8');
          const rejected = runCook(root, ['reverify', '18']);
          assert.notEqual(rejected.code, 0);
          assert.match(rejected.stderr, /\[record-reverify\].*(?:refute|kickback|council)/i);
          assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  });

  await t.test('publishes one host-neutral CLI and workflow contract', async (workflow) => {
    const { root } = await makeRoot();
    try {
      const help = runCook(root, ['help']);
      assert.equal(help.code, 0, help.stderr);
      assert.match(help.stdout, /reverify <id>/);

      const missingId = runCook(root, ['reverify']);
      assert.notEqual(missingId.code, 0);
      assert.match(missingId.stderr, /usage: cook reverify <id>/i);

      const extraArgument = runCook(root, ['reverify', '18', 'extra']);
      assert.notEqual(extraArgument.code, 0);
      assert.match(extraArgument.stderr, /reverify: unexpected argument 'extra'/i);

      const documents = [
        ['skills/cook/SKILL.md', join(HERE, '..', '..', 'skills', 'cook', 'SKILL.md')],
        [
          'skills/cook/reference/operations.md',
          join(HERE, '..', '..', 'skills', 'cook', 'reference', 'operations.md'),
        ],
        [
          'skills/cook/reference/jeff-state-schema.md',
          join(HERE, '..', '..', 'skills', 'cook', 'reference', 'jeff-state-schema.md'),
        ],
      ];
      for (const [name, path] of documents) {
        await workflow.test(name, async () => {
          const text = await readFile(path, 'utf8');
          const contract = text
            .split(/\n\s*\n/)
            .filter((paragraph) => paragraph.includes('cook reverify <id>'))
            .join('\n');
          assert.notEqual(contract, '', `${name} has no cook reverify contract`);
          assert.match(contract, /needs-work/i, `${name} does not constrain the failed verdict`);
          assert.match(contract, /judgmentHistory/, `${name} does not retain the superseded judgment`);
          assert.match(contract, /verification/i, `${name} does not identify the cleared slot`);
          assert.match(contract, /execution/i, `${name} does not preserve execution`);
          assert.match(contract, /fresh/i, `${name} does not require a fresh verifier`);
          assert.match(contract, /untouched/i, `${name} does not require untouched recovery state`);
          assert.match(
            contract,
            /(?:before[^.\n]*refute[^.\n]*kickback[^.\n]*council|pre-refute[^.\n]*pre-kickback[^.\n]*pre-council)/i,
            `${name} does not state pre-refute, pre-kickback, pre-council timing`,
          );
        });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  await t.test('validator rejects a live verifier identity retained in judgment history', async () => {
    const { root, taskDir } = await prepareFailure({ auditRequired: true });
    try {
      const task = await readTask(taskDir);
      task.judgmentHistory = [{
        cycle: 0,
        at: '2026-07-12T00:30:00Z',
        verification: structuredClone(task.verification),
        audit: structuredClone(task.audit),
        agents: {
          verifier_agent_id: task.agents.verifier_agent_id,
          audit_agent_id: task.agents.audit_agent_id,
        },
      }];
      task.verification = {
        verdict: 'pass',
        reportedVerdict: 'pass',
        verifier_agent_id: 'verifier-old',
        postconditions: [{
          postcondition: 'The source is absent and the destination exists exactly once.',
          ok: true,
          evidence: 'independent read found one destination and no source',
        }],
        findings: [],
        evidence: [{
          command: 'inspect registry postconditions',
          output: 'all postconditions satisfied',
        }],
      };
      task.status = 'done';
      task.stage = 'done';
      await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');

      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      const result = runCook(root, ['validate']);
      assert.notEqual(result.code, 0);
      assert.match(
        result.stderr,
        /\[operation-reverify-identity\]|(?:archived|historical) verifier.*fresh|fresh verifier.*(?:archived|historical)/i,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('supports a schema-valid failed operation without convergence state', async () => {
    const { root, taskDir } = await prepareFailure();
    try {
      const before = await readTask(taskDir);
      delete before.convergence;
      await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(before, null, 2)}\n`, 'utf8');

      const result = runCook(root, ['reverify', '18']);
      const reset = await readTask(taskDir);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(reset.execution, before.execution);
      assert.equal(reset.judgmentHistory.length, 1);
      assert.deepEqual(reset.judgmentHistory[0].verification, before.verification);
      assert.equal(reset.verification.verifier_agent_id, null);

      const returnFile = await writeReturn(root, verifyReturn(), 'no-convergence-verify.json');
      const verified = runCook(root, ['record', 'verify', '18', 'verifier-fresh', returnFile]);
      const completed = await readTask(taskDir);
      assert.equal(verified.code, 0, verified.stderr);
      assert.deepEqual([completed.status, completed.stage], ['done', 'done']);
      assert.equal(completed.verification.verifier_agent_id, 'verifier-fresh');
      assert.deepEqual(completed.execution, before.execution);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

});

test('issue 101 surviving blocker: complex operation completes without code-review identities in either judgment order', async (t) => {
  for (const order of [['verify', 'audit'], ['audit', 'verify']]) {
    await t.test(order.join(' then '), async () => {
      const { root, taskDir } = await makeRoot(readyOperation(true));
      try {
        for (const stage of order) {
          await recordSpecialistReturn(
            root,
            stage,
            '18',
            stage === 'verify' ? verifyReturn() : auditReturn(),
          );
        }
        const recorded = await readTask(taskDir);
        assert.deepEqual([recorded.status, recorded.stage], ['done', 'done']);
        assert.equal(recorded.verification.verifier_agent_id, 'verifier');
        assert.equal(recorded.audit.audit_agent_id, 'auditor');
        assert.equal(Object.hasOwn(recorded.agents, 'reviewer_agent_id'), false);
        assert.equal(Object.hasOwn(recorded.agents, 'reviewer2_agent_id'), false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 121 operation verifier remains separated from the observed executor identity', async () => {
  const task = readyOperation(false, {
    agents: {
      ...operationTask().agents,
      executor_agent_id: 'same-agent',
    },
    execution: {
      ...readyOperation().execution,
      executor_agent_id: 'same-agent',
    },
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'verify', '18', verifyReturn('same-agent')),
      /\[inv2\]/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 101 surviving blocker: verification exactly covers planned postconditions atomically', async (t) => {
  const planned = [
    'AC1: The source is absent.',
    'AC2: The destination exists exactly once.',
  ];
  const exact = planned.map((postcondition, index) => ({
    postcondition,
    ok: true,
    evidence: `independent check ${index + 1} passed`,
  }));
  const task = readyOperation(false, {
    plan: operationPlanState({ postconditions: planned }),
  });

  await t.test('one result per planned postcondition in plan order completes', async () => {
    const { root } = await makeRoot(task);
    try {
      const recorded = await recordSpecialistReturn(
        root,
        'verify',
        '18',
        verifyReturn('verifier', { postconditions: exact }),
      );
      assert.deepEqual([recorded.status, recorded.stage], ['done', 'done']);
      assert.deepEqual(recorded.verification.postconditions, exact);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  const mismatches = [
    ['omitted', [exact[0]]],
    ['duplicate', [exact[0], exact[0]]],
    ['extra', [...exact, {
      postcondition: 'AC3: The registry audit log is unchanged.',
      ok: true,
      evidence: 'independent check passed',
    }]],
    ['renamed', [exact[0], {
      ...exact[1],
      postcondition: 'AC2: A destination exists.',
    }]],
    ['reordered', [exact[1], exact[0]]],
  ];
  for (const [name, postconditions] of mismatches) {
    await t.test(`${name} result rejects without recording`, async () => {
      const { root, taskDir } = await makeRoot(task);
      try {
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        await assert.rejects(
          recordSpecialistReturn(
            root,
            'verify',
            '18',
            verifyReturn('verifier', { postconditions }),
          ),
          /\[record-transition\].*postconditions.*plan/,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 101 operation judgments retain refute and all category-valid kickbacks', async (t) => {
  const cases = [
    ['verify', 'capture'],
    ['verify', 'plan'],
    ['verify', 'execute'],
    ['audit', 'execute'],
  ];
  for (const [source, destination] of cases) {
    await t.test(`${source} to ${destination}`, async () => {
      const finding = blockingFinding({
        ...(source === 'audit' ? { cwe: 'CWE-20' } : {}),
        kickTo: destination,
        what: `${source} found an invalid ${destination} boundary.`,
      });
      const { root, taskDir } = await makeRoot(readyOperation(source === 'audit'));
      try {
        if (source === 'verify') {
          await recordSpecialistReturn(root, source, '18', verifyReturn('verifier', {
            verdict: 'needs-work',
            postconditions: [{
              postcondition: 'The source is absent and the destination exists exactly once.',
              ok: false,
              evidence: 'independent read found an invalid boundary',
            }],
            findings: [finding],
          }));
        } else {
          await recordSpecialistReturn(root, source, '18', auditReturn('auditor', {
            verdict: 'needs-work',
            scan: { command: 'review-security --json', recommendation: 'BLOCK', reportPath: '/tmp/report.md' },
            findings: [finding],
          }));
        }
        await recordSpecialistReturn(
          root,
          'refute',
          '18',
          refuteReturn(`${source}-${destination}-refuter`, finding, { source }),
        );
        const recorded = await readTask(taskDir);

        assert.equal(recorded.stage, destination);
        assert.deepEqual(
          [recorded.kickbacks.at(-1).from, recorded.kickbacks.at(-1).to],
          [source, destination],
        );
        assert.equal(recorded.convergence.stages[source].blockingKickbacks, 1);
        const outcome = source === 'verify' ? recorded.verification : recorded.audit;
        assert.equal(outcome.findings[0].refute.verdict, 'survives');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

/** @returns {any} */
function operationCouncilTask() {
  const base = readyOperation();
  const finding = {
    ...blockingFinding({
      kickTo: 'execute',
      what: 'The destination registry contains two entries.',
      why: 'The independently observed duplicate violates the planned postcondition.',
    }),
    refute: {
      agent_id: 'verify-refuter',
      source: 'verify',
      finding: 'src/core/record.js:10 The destination registry contains two entries.',
      verdict: 'survives',
      rationale: 'The duplicate is independently observable.',
      evidence: [{ command: 'inspect registry', output: 'two entries' }],
    },
  };
  return readyOperation(false, {
    agents: {
      ...base.agents,
      verifier_agent_id: 'verifier',
    },
    verification: {
      verdict: 'needs-work',
      reportedVerdict: 'needs-work',
      verifier_agent_id: 'verifier',
      postconditions: verifyReturn().postconditions,
      findings: [finding],
      evidence: [{ command: 'inspect registry', output: 'two entries' }],
    },
    refutes: [finding.refute],
    convergence: {
      cap: 2,
      stages: { verify: { blockingKickbacks: 2 }, audit: { blockingKickbacks: 0 } },
      council: { convened: false, stage: 'verify', members: [], findings: [], verdict: null, outcome: null },
    },
  });
}

/**
 * @param {string | null} [outcome]
 * @param {boolean} [survived]
 * @returns {any}
 */
function operationCouncilReturn(outcome = null, survived = true) {
  const question = 'Are these independent defects, or evidence that this part of the design should be reconstructed?';
  const votes = survived ? [true, true, false] : [true, false, false];
  const inquiries = [
    {
      question,
      problemRestatement: 'The destination registry violates the independently observed postcondition.',
      causalHypotheses: ['The scoped execution did not remove the source entry.'],
      solutionStrategies: ['scoped-execute', 'operator-escalation'],
      findingVotes: [{ id: 'F1', blocking: votes[0], rationale: 'The duplicate is directly observable.' }],
      decisiveEvidence: ['The verifier reads two destination entries.'],
    },
    {
      question: 'Which bounded operation can restore the planned postcondition?',
      problemRestatement: 'The completed operation left a duplicate registry entry.',
      causalHypotheses: ['The destination write completed before source cleanup.'],
      solutionStrategies: ['operator-escalation', 'scoped-execute'],
      findingVotes: [{ id: 'F1', blocking: votes[1], rationale: 'The recorded state differs from the plan.' }],
      decisiveEvidence: ['Independent inspection reports the source and destination together.'],
    },
    {
      question: 'Is one scoped execution sufficient without changing the locked operation plan?',
      problemRestatement: 'The operation requires one bounded correction to satisfy its existing plan.',
      causalHypotheses: ['The retained rollback boundary permits a confined retry.'],
      solutionStrategies: ['scoped-execute', 'operator-escalation'],
      findingVotes: [{ id: 'F1', blocking: votes[2], rationale: 'The recovery remains bounded and reversible.' }],
      decisiveEvidence: ['The original approval and recovery boundaries remain available.'],
    },
  ];
  return {
    stage: 'council',
    council: {
      convened: true,
      stage: 'verify',
      members: [
        { agent_id: 'operation-integrity', lens: 'integrity', temperature: 0.3 },
        { agent_id: 'operation-security', lens: 'security', temperature: 0.7 },
        { agent_id: 'operation-pragmatist', lens: 'pragmatist', temperature: 1 },
      ].map((member, index) => ({ ...member, inquiry: inquiries[index] })),
      findings: [{
        id: 'F1',
        summary: 'The destination registry contains two entries.',
        source: 'verify',
        blockingVotes: survived ? 2 : 1,
        survived,
        followupTaskId: survived ? null : 18,
      }],
      synthesis: {
        problemRestatement: 'The operation left a duplicate registry entry after bounded execution.',
        survivingBlockers: survived ? ['F1'] : [],
        causalHypotheses: ['The scoped execution did not complete source cleanup.'],
        solutionStrategies: ['scoped-execute', 'operator-escalation'],
        rejectedAlternatives: ['operator-escalation'],
        selectedStrategy: 'scoped-execute',
        decisiveEvidence: ['Independent inspection observes the duplicate deterministically.'],
      },
      verdict: survived ? 'block' : 'ship',
      outcome,
    },
  };
}

test('issue 107 operation council records its trigger cycle and baseline executor', async () => {
  const { root, taskDir } = await makeRoot(operationCouncilTask());
  try {
    await recordSpecialistReturn(root, 'council', '18', operationCouncilReturn());
    const recorded = await readTask(taskDir);

    assert.deepEqual([recorded.status, recorded.stage], ['in_progress', 'execute']);
    assert.equal(recorded.implement, undefined);
    assert.deepEqual(
      [recorded.kickbacks.at(-1).from, recorded.kickbacks.at(-1).to],
      ['verify', 'execute'],
    );
    assert.equal(recorded.convergence.council.cycle, 0);
    assert.equal(recorded.convergence.council.executor_agent_id, 'executor');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 107 council recovery requires fresh execution and verification identities', async (t) => {
  await t.test('scoped executor differs from the initial executor', async () => {
    const { root, taskDir } = await makeRoot(operationCouncilTask());
    try {
      await recordSpecialistReturn(root, 'council', '18', operationCouncilReturn());
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordSpecialistReturn(root, 'execute', '18', executeReturn('executor')),
        /\[record-identity\].*(?:fresh|reuse|previous)/i,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  for (const resumeAgent of ['executor', 'scoped-requester']) {
    await t.test(`approval-mediated recovery rejects ${resumeAgent}`, async () => {
      const mutation = 'Rewrite the exact council-scoped registry entry.';
      const task = operationCouncilTask();
      task.plan.requiresApproval = true;
      task.plan.approvalBoundary = mutation;
      const { root, taskDir } = await makeRoot(task);
      try {
        await recordSpecialistReturn(root, 'council', '18', operationCouncilReturn());
        await recordSpecialistReturn(root, 'execute', '18', executeReturn('scoped-requester', {
          result: 'approval-required',
          actions: ['Captured the scoped rollback state.'],
          evidence: [{ command: 'inspect recovery boundary', output: 'rollback state captured' }],
          approvalRequired: mutation,
        }));
        await recordCore.recordApproval(root, '18', 'Chef');
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        await assert.rejects(
          recordSpecialistReturn(root, 'execute', '18', executeReturn(resumeAgent)),
          /\[record-identity\].*(?:fresh|reuse|previous|requester)/i,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  await t.test('one scoped execution records adjacent cycle provenance', async () => {
    const { root } = await makeRoot(operationCouncilTask());
    try {
      await recordSpecialistReturn(root, 'council', '18', operationCouncilReturn());
      const recorded = await recordSpecialistReturn(
        root,
        'execute',
        '18',
        executeReturn('scoped-executor'),
      );
      assert.equal(recorded.convergence.council.cycle, 0);
      assert.equal(recorded.convergence.council.executor_agent_id, 'executor');
      assert.equal(recorded.judgmentHistory.length, 1);
      assert.equal(recorded.judgmentHistory[0].cycle, 0);
      assert.equal(recorded.execution.cycle, 1);
      assert.match(recorded.execution.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('scoped verifier differs from the initial verifier', async () => {
    const { root, taskDir } = await makeRoot(operationCouncilTask());
    try {
      await recordSpecialistReturn(root, 'council', '18', operationCouncilReturn());
      await recordSpecialistReturn(root, 'execute', '18', executeReturn('scoped-executor'));
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordSpecialistReturn(root, 'verify', '18', verifyReturn('verifier', { cycle: 1 })),
        /\[record-identity\].*(?:fresh|reuse|previous)/i,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 107 operation recording establishes authoritative operationStateVersion', async () => {
  const unmarked = operationTask();
  delete unmarked.operationStateVersion;
  const { root, taskDir } = await makeRoot(unmarked);
  try {
    assert.equal(Object.hasOwn(await readTask(taskDir), 'operationStateVersion'), false);

    const planned = await recordSpecialistReturn(root, 'plan', '18', operationPlanReturn());
    assert.equal(planned.operationStateVersion, 1);
    assert.equal(planned.stage, 'execute');

    const executed = await recordSpecialistReturn(root, 'execute', '18', executeReturn());
    assert.equal(executed.operationStateVersion, 1);
    assert.equal(executed.execution.cycle, 0);
    assert.match(executed.execution.recordedAt, /^\d{4}-\d{2}-\d{2}T/);

    const persisted = await readTask(taskDir);
    assert.equal(persisted.operationStateVersion, 1);

    // Authoritative execution provenance engages only after the marker is set:
    // strip cycle/recordedAt from a marked ledger and the write must fail closed.
    await writeFile(
      join(taskDir, 'task.json'),
      `${JSON.stringify({
        ...persisted,
        execution: {
          result: 'executed',
          executor_agent_id: 'executor',
          actions: ['Moved the bounded registry entry.'],
          evidence: [{ command: 'inspect registry transition', output: 'transition complete' }],
          approvalRequired: null,
        },
        stage: 'verify',
        verification: {
          verdict: null,
          verifier_agent_id: null,
          postconditions: [],
          findings: [],
          evidence: [],
        },
      }, null, 2)}\n`,
      'utf8',
    );
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'verify', '18', verifyReturn()),
      /\[operation-version\].*cycle.*recordedAt|authoritative execution requires cycle and recordedAt/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 105 recovery refuting a failed scoped postcondition does not open another execute cycle', async () => {
  const { root, taskDir } = await makeRoot(operationCouncilTask());
  const finding = blockingFinding({
    kickTo: 'execute',
    what: 'The destination registry still contains two entries.',
    why: 'The scoped correction did not satisfy the planned exact-once postcondition.',
  });
  try {
    await recordSpecialistReturn(root, 'council', '18', operationCouncilReturn());
    await recordSpecialistReturn(root, 'execute', '18', executeReturn('scoped-executor'));
    await recordSpecialistReturn(root, 'verify', '18', verifyReturn('fresh-verifier', {
      cycle: 1,
      verdict: 'needs-work',
      postconditions: [{
        ...verifyReturn().postconditions[0],
        ok: false,
        evidence: 'independent read still found two destination entries',
      }],
      findings: [finding],
    }));
    await recordSpecialistReturn(
      root,
      'refute',
      '18',
      refuteReturn('fresh-refuter', finding, {
        cycle: 1,
        source: 'verify',
        verdict: 'refuted',
      }),
    );
    const recorded = await readTask(taskDir);

    assert.deepEqual(
      [recorded.status, recorded.stage],
      ['blocked', 'verify'],
      'a false planned postcondition is terminal for the one scoped correction',
    );
    assert.match(recorded.blockedReason, /postcondition/i);
    assert.equal(recorded.judgmentHistory.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 101 surviving blocker: operation convergence ships resolved verifier findings', async (t) => {
  await t.test('follow-up-only verification reaches done with evidence retained', async () => {
    const finding = blockingFinding({
      class: 'follow-up',
      kickTo: 'plan',
      what: 'The operator guide could name the verification command.',
    });
    const { root } = await makeRoot(readyOperation());
    try {
      const recorded = await recordSpecialistReturn(root, 'verify', '18', verifyReturn('followup-verifier', {
        verdict: 'needs-work',
        findings: [finding],
      }));
      assert.deepEqual([recorded.status, recorded.stage], ['done', 'done']);
      assert.equal(recorded.verification.verdict, 'pass');
      assert.deepEqual(recorded.verification.findings, [finding]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('refuted verifier blocker reaches done with refute retained', async () => {
    const finding = blockingFinding({
      kickTo: 'execute',
      what: 'The verifier evidence may be stale.',
    });
    const { root } = await makeRoot(readyOperation());
    try {
      await recordSpecialistReturn(root, 'verify', '18', verifyReturn('verifier', {
        verdict: 'needs-work',
        findings: [finding],
      }));
      const recorded = await recordSpecialistReturn(
        root,
        'refute',
        '18',
        refuteReturn('verify-refuter', finding, { source: 'verify', verdict: 'refuted' }),
      );
      assert.deepEqual([recorded.status, recorded.stage], ['done', 'done']);
      assert.equal(recorded.verification.findings[0].class, 'follow-up');
      assert.equal(recorded.verification.findings[0].refute.verdict, 'refuted');
      assert.deepEqual(recorded.refutes.at(-1), recorded.verification.findings[0].refute);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('initial council ship reaches done with originating evidence retained', async () => {
    const original = operationCouncilTask();
    const { root } = await makeRoot(original);
    try {
      const recorded = await recordSpecialistReturn(
        root,
        'council',
        '18',
        operationCouncilReturn('shipped', false),
      );
      assert.deepEqual([recorded.status, recorded.stage], ['done', 'done']);
      assert.equal(recorded.convergence.council.outcome, 'shipped');
      assert.deepEqual(recorded.verification, original.verification);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('scoped execute plus fresh verification reaches scoped-fix-shipped', async () => {
    const { root } = await makeRoot(operationCouncilTask());
    try {
      await recordSpecialistReturn(root, 'council', '18', operationCouncilReturn());
      await recordSpecialistReturn(root, 'execute', '18', executeReturn('scoped-executor'));
      await recordSpecialistReturn(root, 'verify', '18', verifyReturn('fresh-verifier', { cycle: 1 }));
      const recorded = await recordSpecialistReturn(
        root,
        'council',
        '18',
        operationCouncilReturn('scoped-fix-shipped'),
      );
      assert.deepEqual(
        [recorded.status, recorded.stage, recorded.convergence.council.outcome],
        ['done', 'done', 'scoped-fix-shipped'],
      );
      assert.equal(recorded.judgmentHistory.length, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 101 cycle 2: either capped operation source triggers one council without an ordinary kickback', async () => {
  const verifyFinding = blockingFinding({
    kickTo: 'execute',
    what: 'The destination Git ref resolves to the wrong object.',
    why: 'The independently queried ref violates the planned postcondition.',
  });
  /** @type {Record<string, any>} */
  const auditFinding = {
    ...blockingFinding({
      kickTo: 'execute',
      what: 'The external registry still exposes the source entry.',
      why: 'The independent registry query found the pre-operation state.',
    }),
    cwe: 'CWE-670',
  };
  const { root, taskDir } = await makeRoot(readyOperation(true, {
    convergence: {
      cap: 2,
      stages: { verify: { blockingKickbacks: 2 }, audit: { blockingKickbacks: 0 } },
      council: { convened: false, stage: null, members: [], findings: [], verdict: null, outcome: null },
    },
  }));
  try {
    await recordSpecialistReturn(root, 'verify', '18', verifyReturn('mixed-verifier', {
      verdict: 'needs-work',
      findings: [verifyFinding],
    }));
    await recordSpecialistReturn(root, 'audit', '18', auditReturn('mixed-auditor', {
      verdict: 'needs-work',
      findings: [auditFinding],
    }));
    await recordSpecialistReturn(
      root,
      'refute',
      '18',
      refuteReturn('mixed-verify-refuter', verifyFinding, { source: 'verify' }),
    );
    const beforeFinalRefute = await readTask(taskDir);
    const triggered = await recordSpecialistReturn(
      root,
      'refute',
      '18',
      refuteReturn('mixed-audit-refuter', auditFinding, { source: 'audit' }),
    );

    assert.equal(triggered.convergence.council.stage, 'verify');
    assert.equal(triggered.convergence.stages.audit.blockingKickbacks, 0);
    assert.equal(triggered.kickbacks.length, beforeFinalRefute.kickbacks.length);

    const baseCouncil = operationCouncilReturn('shipped', false);
    const shipped = await recordSpecialistReturn(root, 'council', '18', {
      ...baseCouncil,
      council: {
        ...baseCouncil.council,
        members: baseCouncil.council.members.map((member, index) => ({
          ...member,
          inquiry: {
            ...member.inquiry,
            findingVotes: [
              ...member.inquiry.findingVotes,
              {
                id: 'F2',
                blocking: index === 1,
                rationale: 'The registry observation is an independent planned postcondition.',
              },
            ],
          },
        })),
        findings: [
          {
            id: 'F1',
            summary: verifyFinding.what,
            source: 'verify',
            blockingVotes: 1,
            survived: false,
            followupTaskId: 18,
          },
          {
            id: 'F2',
            summary: auditFinding.what,
            source: 'audit',
            blockingVotes: 1,
            survived: false,
            followupTaskId: 18,
          },
        ],
        synthesis: {
          ...baseCouncil.council.synthesis,
          problemRestatement: 'Independent verification and audit observations each report a bounded operation defect.',
          survivingBlockers: [],
          causalHypotheses: ['Neither reported defect receives the two independent blocking votes required to survive.'],
          decisiveEvidence: ['Each source-bound finding receives one blocking inquiry vote.'],
        },
      },
    });
    assert.deepEqual([shipped.status, shipped.stage, shipped.convergence.council.outcome], ['done', 'done', 'shipped']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 101 cycle 2: scoped execute kickbacks terminate but an exact approval stop remains resumable', async (t) => {
  for (const destination of ['capture', 'plan']) {
    await t.test(`scoped kickback to ${destination} blocks to the operator`, async () => {
      const { root } = await makeRoot(operationCouncilTask());
      try {
        await recordSpecialistReturn(root, 'council', '18', operationCouncilReturn());
        const before = await recordSpecialistReturn(root, 'execute', '18', executeReturn('scoped-executor', {
          result: 'kickback',
          actions: ['Inspected the scoped recovery precondition.'],
          evidence: [{ command: 'inspect recovery boundary', output: 'the scoped runbook is insufficient' }],
          kickback: { to: destination, reason: 'The council-scoped recovery cannot proceed safely.' },
        }));

        assert.deepEqual(
          [before.status, before.stage, before.convergence.council.outcome],
          ['blocked', 'execute', 'blocked-to-operator'],
        );
        assert.match(before.blockedReason, /destination registry contains two entries/i);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  await t.test('scoped exact approval stop can resume the same execute cycle', async () => {
    const mutation = 'Rewrite the exact council-scoped registry entry.';
    const task = operationCouncilTask();
    task.plan.requiresApproval = true;
    task.plan.approvalBoundary = mutation;
    const { root } = await makeRoot(task);
    try {
      await recordSpecialistReturn(root, 'council', '18', operationCouncilReturn());
      const stopped = await recordSpecialistReturn(root, 'execute', '18', executeReturn('scoped-executor-stop', {
        result: 'approval-required',
        actions: ['Captured the scoped rollback state.'],
        evidence: [{ command: 'inspect recovery boundary', output: 'rollback state captured' }],
        approvalRequired: mutation,
      }));
      assert.deepEqual(
        [stopped.status, stopped.stage, stopped.convergence.council.outcome],
        ['in_progress', 'execute', null],
      );

      await recordCore.recordApproval(root, '18', 'Chef');
      const resumed = await recordSpecialistReturn(root, 'execute', '18', executeReturn('scoped-executor-resume'));
      assert.deepEqual([resumed.status, resumed.stage], ['in_progress', 'verify']);
      assert.equal(resumed.execution.approval.mutation, mutation);
      assert.equal(resumed.execution.approval.grantedBy, 'Chef');
      assert.equal(resumed.judgmentHistory.length, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 101 cycle 2: required audit na rejects atomically before or after verification', async (t) => {
  for (const verificationFirst of [false, true]) {
    await t.test(verificationFirst ? 'after verification' : 'before verification', async () => {
      const { root, taskDir } = await makeRoot(readyOperation(true));
      try {
        if (verificationFirst) {
          await recordSpecialistReturn(root, 'verify', '18', verifyReturn('ordered-verifier'));
        }
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        await assert.rejects(
          recordSpecialistReturn(root, 'audit', '18', auditReturn('na-auditor', { verdict: 'na' })),
          /\[record-transition\].*required audit.*na/i,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);

        await recordSpecialistReturn(root, 'audit', '18', auditReturn('passing-auditor'));
        if (!verificationFirst) {
          await recordSpecialistReturn(root, 'verify', '18', verifyReturn('ordered-verifier'));
        }
        const recorded = await readTask(taskDir);
        assert.deepEqual([recorded.status, recorded.stage], ['done', 'done']);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  for (const [name, category] of [['explicit', 'code'], ['historical omission', undefined]]) {
    const task = auditStageTask(category === undefined ? {} : { category });
    const { root } = await makeRoot(task);
    try {
      const recorded = await recordSpecialistReturn(
        root,
        'audit',
        '18',
        auditReturn(`${name}-code-auditor`, { verdict: 'na' }),
      );
      assert.deepEqual([recorded.status, recorded.stage], ['done', 'done']);
      assert.equal(recorded.audit.verdict, 'na');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('issue 121 code auditor remains separated from the observed implementer identity atomically', async () => {
  const { root, taskDir } = await makeRoot(auditStageTask({ category: 'code' }));
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'audit', '18', auditReturn('implementer')),
      /\[inv2\].*(?:implementer.*auditor|auditor.*implementer)/i,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 121 operation auditor remains separated from the observed executor identity', async () => {
  const { root, taskDir } = await makeRoot(readyOperation(true));
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'audit', '18', auditReturn('executor')),
      /\[inv2\].*(?:executor.*auditor|auditor.*executor)/i,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 95 strict plan return requires an explicit non-empty refactor decision atomically', async (t) => {
  /** @type {Array<[string, (value: any) => void]>} */
  const invalidDecisions = [
    ['omitted', (value) => { delete value.refactorOpportunity; }],
    ['empty', (value) => { value.refactorOpportunity = ''; }],
    ['whitespace', (value) => { value.refactorOpportunity = '   '; }],
  ];
  for (const [name, mutate] of invalidDecisions) {
    await t.test(name, async () => {
      const { root, taskDir } = await makeRoot();
      try {
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        const returned = planReturn();
        mutate(returned);
        const file = await writeReturn(root, returned);

        const result = runCook(root, ['record', 'plan', '18', 'plan-agent', file]);

        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /\[record-schema\].*refactorOpportunity/);
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 95 named plan opportunity runs refactor before review without judgment history', async () => {
  const { root, taskDir } = await makeRoot(canonicalTask({
    tests: { authored_by_agent_id: null, green: true, evidence: [] },
  }));
  try {
    const opportunity = 'Harmonize verification-gate invalidation across code-changing stages.';
    const file = await writeReturn(root, planReturn({ refactorOpportunity: opportunity }));

    const result = runCook(root, ['record', 'plan', '18', 'plan-agent', file]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal((await readTask(taskDir)).plan.refactorOpportunity, opportunity);

    await recordSpecialistReturn(root, 'implement', '18', implementReturn());
    const implemented = await readTask(taskDir);
    assert.equal(implemented.stage, 'refactor');
    assert.deepEqual(implemented.implement, {
      agent_id: 'implementer',
      result: 'green',
      files: ['src/core/record.js'],
      greenRun: { command: 'node --test src/cli/record.test.js', output: 'pass' },
    });

    await recordSpecialistReturn(root, 'refactor', '18', refactorReturn());
    const refactored = await readTask(taskDir);
    assert.equal(refactored.stage, 'review');
    assert.equal(refactored.judgmentHistory, undefined);
    assert.deepEqual(refactored.refactor, {
      agent_id: 'refactorer',
      result: 'clean',
      files: [],
      outsideDiff: [],
      greenRun: { command: 'node --test src/cli/record.test.js', output: 'pass' },
      summary: ['No refactor needed.'],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 95 explicit null skips planned refactor while historical omission remains mandatory', async (t) => {
  await t.test('explicit null', async () => {
    const { root, taskDir } = await makeRoot(canonicalTask({
      tests: { authored_by_agent_id: null, green: true, evidence: [] },
    }));
    try {
      const file = await writeReturn(root, planReturn({ refactorOpportunity: null }));
      const result = runCook(root, ['record', 'plan', '18', 'plan-agent', file]);
      assert.equal(result.code, 0, result.stderr);

      await recordSpecialistReturn(root, 'implement', '18', implementReturn());
      const implemented = await readTask(taskDir);
      assert.equal(implemented.stage, 'review');
      assert.equal(implemented.tests.green, false);
      assert.equal(implemented.tests.gate, undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('historical omission', async () => {
    const { root, taskDir } = await makeRoot(canonicalTask({
      stage: 'implement',
      plan: {
        result: 'red',
        slices: ['Implement the requested behavior'],
        testFiles: ['src/cli/record.test.js'],
        redRun: { command: 'node --test src/cli/record.test.js', output: 'missing behavior' },
        escalation: null,
      },
      tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: [] },
    }));
    try {
      await recordSpecialistReturn(root, 'implement', '18', implementReturn());
      const implemented = await readTask(taskDir);
      assert.equal(implemented.stage, 'refactor');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 95 mixed implement and refactor survivors preserve refactor after implementation', async () => {
  const implementFinding = blockingFinding({
    line: 20,
    what: 'The implementation path loses a surviving correction.',
  });
  const refactorFinding = blockingFinding({
    line: 21,
    kickTo: 'refactor',
    what: 'The behavior-preserving cleanup remains necessary after implementation.',
  });
  const { root, taskDir } = await makeRoot(canonicalTask({
    stage: 'review',
    plan: {
      result: 'red',
      slices: ['Implement without planned refactor'],
      testFiles: ['src/cli/record.test.js'],
      redRun: { command: 'node --test src/cli/record.test.js', output: 'missing behavior' },
      escalation: null,
      refactorOpportunity: null,
    },
    agents: {
      implementer_agent_id: 'initial-implementer',
      reviewer_agent_id: null,
      reviewer2_agent_id: null,
      audit_agent_id: null,
    },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: [] },
  }));
  try {
    await recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer', {
      verdict: 'needs-work',
      findings: [implementFinding, refactorFinding],
    }));
    await recordSpecialistReturn(root, 'refute', '18', refuteReturn('implement-refuter', implementFinding, {
      source: 'review',
    }));
    await recordSpecialistReturn(root, 'refute', '18', refuteReturn('refactor-refuter', refactorFinding, {
      source: 'review',
    }));
    assert.equal((await readTask(taskDir)).stage, 'implement');

    await recordSpecialistReturn(root, 'implement', '18', implementReturn('correcting-implementer'));
    assert.equal((await readTask(taskDir)).stage, 'refactor');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 95 council-demoted refactor finding is not revived after scoped implementation', async () => {
  const task = councilTask();
  task.plan = {
    result: 'red',
    slices: ['Implement without planned refactor'],
    testFiles: ['src/cli/record.test.js'],
    redRun: { command: 'node --test src/cli/record.test.js', output: 'missing behavior' },
    escalation: null,
    refactorOpportunity: null,
  };
  const refactorFinding = blockingFinding({
    line: 22,
    kickTo: 'refactor',
    what: 'Harmonize duplicate recovery routing.',
  });
  refactorFinding.refute = {
    agent_id: 'refactor-refuter',
    source: 'review',
    finding: `${refactorFinding.file}:${refactorFinding.line} ${refactorFinding.what}`,
    verdict: 'survives',
    rationale: 'The duplicate path is reachable.',
    evidence: [{ command: 'node --test src/cli/record.test.js', output: 'failure reproduced' }],
  };
  task.review.findings.push(refactorFinding);
  task.refutes.push(refactorFinding.refute);
  const returned = councilReturn();
  for (let index = 0; index < returned.council.members.length; index += 1) {
    returned.council.members[index].inquiry.findingVotes.push({
      id: 'F2',
      blocking: index === 0,
      rationale: 'The duplicate refactor path is a bounded follow-up, not a surviving blocker.',
    });
  }
  returned.council.findings.push({
    id: 'F2',
    summary: refactorFinding.what,
    source: 'review',
    blockingVotes: 1,
    survived: false,
    followupTaskId: 18,
  });

  const { root, taskDir } = await makeRoot(task);
  try {
    await recordSpecialistReturn(root, 'council', '18', returned);
    assert.equal((await readTask(taskDir)).stage, 'implement');

    await recordSpecialistReturn(root, 'implement', '18', implementReturn('scoped-fix-implementer'));
    const implemented = await readTask(taskDir);

    assert.equal(implemented.stage, 'review');
    assert.equal(implemented.tests.green, false);
    assert.equal(implemented.tests.gate, undefined);
    assert.equal(implemented.judgmentHistory.length, 1);
    assert.equal(implemented.review.verdict, null);
    assert.equal(implemented.convergence.council.findings[1].survived, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 95 direct review-to-refactor archives once and accepts a fresh separated review', async () => {
  const blocker = blockingFinding({
    kickTo: 'refactor',
    what: 'Harmonize duplicate verification-gate invalidation.',
  });
  const { root, taskDir } = await makeRoot(canonicalTask({
    stage: 'review',
    plan: {
      result: 'red',
      slices: ['Implement without planned refactor'],
      testFiles: ['src/cli/record.test.js'],
      redRun: { command: 'node --test src/cli/record.test.js', output: 'missing behavior' },
      escalation: null,
      refactorOpportunity: null,
    },
    agents: {
      implementer_agent_id: 'implementer',
      reviewer_agent_id: null,
      reviewer2_agent_id: null,
      audit_agent_id: null,
    },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: [] },
  }));
  try {
    await recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer', {
      verdict: 'needs-work',
      findings: [blocker],
    }));
    await recordSpecialistReturn(root, 'refute', '18', refuteReturn('refuter', blocker));
    assert.equal((await readTask(taskDir)).stage, 'refactor');

    await recordSpecialistReturn(root, 'refactor', '18', refactorReturn());
    const refactored = await readTask(taskDir);
    assert.equal(refactored.stage, 'review');
    assert.equal(refactored.judgmentHistory?.length, 1);
    assert.equal(refactored.judgmentHistory[0].review.reviewer_agent_id, 'reviewer');
    assert.equal(refactored.review.reviewer_agent_id, null);
    assert.equal(refactored.agents.reviewer_agent_id, null);

    await recordCurrentGate(root, taskDir);
    await recordSpecialistReturn(root, 'review', '18', reviewReturn('fresh-reviewer', { cycle: 1 }));
    const completed = await readTask(taskDir);
    assert.equal(completed.judgmentHistory.length, 1);
    assert.equal(completed.review.reviewer_agent_id, 'fresh-reviewer');
    assert.equal(completed.status, 'done');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('record rejects malformed JSON with a named error and preserves the task byte-for-byte', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const file = await writeReturn(root, '{');

    const result = runCook(root, ['record', 'plan', '18', 'plan-agent', file]);

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

    const result = runCook(root, ['record', 'plan', '18', 'plan-agent', file]);

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
    const file = await writeReturn(root, reviewReturn('reviewer', {
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
    }));

    const result = runCook(root, ['record', 'review', '18', 'reviewer', file]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /\[record-schema\].*findings\[0\]\.class/);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 121 observed plan author cannot implement their own tests', async () => {
  const task = canonicalTask({
    stage: 'implement',
    tests: { authored_by_agent_id: 'same-agent', green: false, evidence: [] },
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const file = await writeReturn(root, implementReturn('same-agent'));

    const result = runCook(root, ['record', 'implement', '18', 'same-agent', file]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /\[inv1\]/);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 121 observed implementer cannot review their own work', async () => {
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
    const file = await writeReturn(root, reviewReturn('same-agent', {
      evidence: [{ command: 'git diff', output: 'No findings.' }],
    }), '.jeff/return.json');

    const result = runCook(root, ['record', 'review', '18', 'same-agent', file]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /\[inv2\]/);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 70 record accepts a terminal review at the current clean verified HEAD', async () => {
  const { root, taskDir } = await makeRoot(terminalReviewTask());
  try {
    const specialistReturn = reviewReturn('reviewer');
    const file = await writeReturn(root, specialistReturn, '.jeff/return.json');

    const result = runCook(root, ['record', 'review', '18', 'reviewer', file]);
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

test('issue 70 terminal recording rejects absent and null verification gates atomically', async (t) => {
  for (const gateState of ['absent', 'null']) {
    await t.test(gateState, async () => {
      const { root, taskDir } = await makeRoot(terminalReviewTask());
      try {
        const task = await readTask(taskDir);
        if (gateState === 'absent') delete task.tests.gate;
        else task.tests.gate = null;
        await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');

        await assert.rejects(
          recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer')),
          /\[record-transition\]/,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 122 explicit task verification binds the complete gate record to the named task', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    await writeFile(join(root, '.jeff', 'profile.md'), 'Test command: `true`\n', 'utf8');
    runGit(root, ['init', '-q']);
    runGit(root, ['config', 'user.email', 'tests@example.com']);
    runGit(root, ['config', 'user.name', 'Tests']);
    runGit(root, ['config', 'commit.gpgsign', 'false']);
    const peerTaskDir = join(root, '.jeff', 'tasks', '019-peer-task');
    await mkdir(peerTaskDir, { recursive: true });
    await writeFile(
      join(peerTaskDir, 'task.json'),
      `${JSON.stringify(canonicalTask({ id: 19, slug: 'peer-task', title: 'Peer task' }), null, 2)}\n`,
      'utf8',
    );
    const earlierBefore = await readFile(join(taskDir, 'task.json'), 'utf8');
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'baseline']);
    const gatedHash = runGit(root, ['rev-parse', 'HEAD']);


    const result = runCook(root, ['verify', '--task', '19']);
    const selectedTask = await readTask(peerTaskDir);

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual({
      selectedGreen: selectedTask.tests.green,
      selectedEvidence: selectedTask.tests.evidence,
      selectedGate: selectedTask.tests.gate && {
        hash: selectedTask.tests.gate.hash,
        clean: selectedTask.tests.gate.clean,
        green: selectedTask.tests.gate.green,
        command: selectedTask.tests.gate.command,
        atIsNonempty: typeof selectedTask.tests.gate.at === 'string' && selectedTask.tests.gate.at.length > 0,
      },
      earlierUnchanged: await readFile(join(taskDir, 'task.json'), 'utf8') === earlierBefore,
    }, {
      selectedGreen: true,
      selectedEvidence: [{
        command: 'true',
        output: 'cook: verify green (true)',
      }],
      selectedGate: {
        hash: gatedHash,
        clean: true,
        green: true,
        command: 'true',
        atIsNonempty: true,
      },
      earlierUnchanged: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 122 explicit task verification fails atomically when Git has no HEAD', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    await writeFile(join(root, '.jeff', 'profile.md'), 'Test command: `true`\n', 'utf8');
    runGit(root, ['init', '-q']);
    await writeFile(join(root, '.git', 'info', 'exclude'), '.jeff/\n', 'utf8');
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    const result = runCook(root, ['verify', '--task', '18']);
    const after = await readFile(join(taskDir, 'task.json'), 'utf8');

    assert.deepEqual({
      exitedNonzero: result.code !== 0,
      ledgerUnchanged: after === before,
    }, {
      exitedNonzero: true,
      ledgerUnchanged: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('record validates every finding and audit coverage enum at the shared boundary', async (t) => {
  const reviewFields = {
    severity: ['critical', 'high', 'medium', 'low'],
    class: ['blocking', 'follow-up'],
    kickTo: ['capture', 'plan', 'implement', 'refactor'],
  };
  for (const [field, values] of Object.entries(reviewFields)) {
    for (const value of values) {
      await t.test(`${field} accepts ${value}`, async () => {
        const task = canonicalTask({
          stage: 'review',
          agents: { implementer_agent_id: 'implementer', reviewer_agent_id: null, reviewer2_agent_id: null, audit_agent_id: null },
          tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
        });
        const { root } = await makeRoot(task);
        try {
          const finding = blockingFinding({ [field]: value });
          await recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer', {
            verdict: 'needs-work',
            findings: [finding],
          }));
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }

  for (const status of ['covered_with_hits', 'covered_no_hits', 'not_covered']) {
    await t.test(`audit coverage accepts ${status}`, async () => {
      const task = auditStageTask();
      const { root } = await makeRoot(task);
      try {
        await recordSpecialistReturn(root, 'audit', '18', auditReturn('auditor', {
          coverage: auditCoverage(status),
        }));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  for (const kickTo of ['plan', 'implement', 'refactor']) {
    await t.test(`audit finding destination accepts ${kickTo}`, async () => {
      const { root } = await makeRoot(auditStageTask());
      try {
        await recordSpecialistReturn(root, 'audit', '18', auditReturn('auditor', {
          verdict: 'needs-work',
          findings: [{ ...blockingFinding({ kickTo }), cwe: 'CWE-22' }],
        }));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('record rejects final audit outcomes without coverage or evidence', async (t) => {
  for (const verdict of ['pass', 'na']) {
    for (const missing of ['coverage', 'evidence']) {
      await t.test(`${verdict} requires ${missing}`, async () => {
        const task = auditStageTask();
        const { root, taskDir } = await makeRoot(task);
        try {
          const before = await readFile(join(taskDir, 'task.json'), 'utf8');
          const result = auditReturn('auditor', { verdict, [missing]: [] });

          await assert.rejects(
            recordSpecialistReturn(root, 'audit', '18', result),
            new RegExp(`\\[record-schema\\].*${missing}`),
          );
          assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
});

test('issue 70 public recorder rejects invalid specialist evidence and coverage atomically', async (t) => {
  const blocker = blockingFinding();
  const refuteTask = canonicalTask({
    stage: 'review',
    agents: { implementer_agent_id: 'implementer', reviewer_agent_id: 'reviewer', reviewer2_agent_id: null, audit_agent_id: null },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
    review: { verdict: 'needs-work', reviewer_agent_id: 'reviewer', findings: [blocker], evidence: ['review evidence'] },
  });
  const cases = [
    ['empty review evidence', 'review', terminalReviewTask(), reviewReturn('reviewer', { evidence: [] }), /\[record-schema\] evidence is invalid/],
    ['empty audit evidence', 'audit', auditStageTask(), auditReturn('auditor', { evidence: [] }), /\[record-schema\] evidence is invalid/],
    ['empty refute evidence', 'refute', refuteTask, refuteReturn('refuter', blocker, { evidence: [] }), /\[record-schema\] evidence is invalid/],
    ['missing audit coverage', 'audit', auditStageTask(), auditReturn('auditor', { coverage: auditCoverage().slice(1) }), /\[record-schema\] coverage is invalid/],
    ['unknown audit coverage', 'audit', auditStageTask(), auditReturn('auditor', {
      coverage: [{ category: 'identity_spoofing', status: 'covered_no_hits' }, ...auditCoverage().slice(1)],
    }), /\[record-schema\] coverage\[0\]\.category is invalid/],
    ['duplicate audit coverage', 'audit', auditStageTask(), auditReturn('auditor', {
      coverage: [...auditCoverage().slice(0, -1), auditCoverage()[0]],
    }), /\[record-schema\] coverage is invalid/],
  ];

  for (const [name, stage, task, result, rejection] of cases) {
    await t.test(name, async () => {
      const { root, taskDir } = await makeRoot(task);
      try {
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        await assert.rejects(
          recordSpecialistReturn(root, stage, '18', result),
          rejection,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('full-mode recording validates dependencies against the complete task store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jeff-record-full-'));
  const firstDir = join(root, '.jeff', 'tasks', '001-first');
  const secondDir = join(root, '.jeff', 'tasks', '002-second');
  try {
    await mkdir(firstDir, { recursive: true });
    await mkdir(secondDir, { recursive: true });
    await writeFile(join(root, '.jeff', 'config.json'), JSON.stringify({ active: true }), 'utf8');
    await writeFile(join(firstDir, 'task.json'), `${JSON.stringify(canonicalTask({ id: 1, slug: 'first', deps: [2] }), null, 2)}\n`, 'utf8');
    await writeFile(join(secondDir, 'task.json'), `${JSON.stringify(canonicalTask({ id: 2, slug: 'second', stage: 'capture' }), null, 2)}\n`, 'utf8');

    await recordSpecialistReturn(root, 'plan', '1', planReturn({ auditRequired: false }));

    assert.equal((await readTask(firstDir)).stage, 'implement');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 140 public recorder updates a successor retaining a terminal-pruned dependency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jeff-record-pruned-'));
  const taskDir = join(root, '.jeff', 'tasks', '002-successor');
  try {
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      join(root, '.jeff', 'config.json'),
      JSON.stringify({ active: true, prunedTaskIds: [1] }),
      'utf8',
    );
    await writeFile(
      join(taskDir, 'task.json'),
      `${JSON.stringify(canonicalTask({ id: 2, slug: 'successor', deps: [1] }), null, 2)}\n`,
      'utf8',
    );

    await recordSpecialistReturn(root, 'plan', '2', planReturn());

    const recorded = await readTask(taskDir);
    assert.equal(recorded.stage, 'implement');
    assert.deepEqual(recorded.deps, [1]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 140 lite public recorder ignores full-only terminal provenance', async (t) => {
  /** @type {Array<[string, unknown[]]>} */
  const cases = [
    ['malformed and duplicate provenance', ['invalid', 'invalid']],
    ['live-overlapping provenance', [18]],
  ];

  for (const [name, prunedTaskIds] of cases) {
    await t.test(name, async () => {
      const { root, taskDir } = await makeRoot();
      try {
        await writeFile(
          join(root, '.jeff', 'config.json'),
          JSON.stringify({ mode: 'lite', prunedTaskIds }),
          'utf8',
        );

        await assert.doesNotReject(
          () => recordSpecialistReturn(root, 'plan', '18', planReturn()),
          'lite recorder must ignore full-only prunedTaskIds',
        );
        assert.equal(
          (await readTask(taskDir)).stage,
          'implement',
          'lite recorder must persist the specialist return',
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 140 public recorder rejects malformed or incomplete terminal provenance atomically', async (t) => {
  /** @type {Array<[string, unknown[], RegExp]>} */
  const cases = [
    ['malformed', ['1'], /prunedTaskIds/],
    ['incomplete', [], /\[inv5\]/],
  ];

  for (const [name, prunedTaskIds, rejection] of cases) {
    await t.test(name, async () => {
      const root = await mkdtemp(join(tmpdir(), 'jeff-record-pruned-invalid-'));
      const taskDir = join(root, '.jeff', 'tasks', '002-successor');
      try {
        await mkdir(taskDir, { recursive: true });
        await writeFile(
          join(root, '.jeff', 'config.json'),
          JSON.stringify({ active: true, prunedTaskIds }),
          'utf8',
        );
        await writeFile(
          join(taskDir, 'task.json'),
          `${JSON.stringify(canonicalTask({ id: 2, slug: 'successor', deps: [1] }), null, 2)}\n`,
          'utf8',
        );
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');

        await assert.rejects(
          recordSpecialistReturn(root, 'plan', '2', planReturn()),
          rejection,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 140 updateTask fails closed for present invalid config and accepts truly missing config', async (t) => {
  /** @param {string} root */
  const writeTask = async (root) => {
    const taskDir = join(root, '.jeff', 'tasks', '018-record-specialists');
    await mkdir(taskDir, { recursive: true });
    await writeFile(
      join(taskDir, 'task.json'),
      `${JSON.stringify(canonicalTask(), null, 2)}\n`,
      'utf8',
    );
    return taskDir;
  };
  /** @param {any} task */
  const updateTitle = (task) => ({ ...task, title: 'Updated title' });

  await t.test('missing config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jeff-record-config-missing-'));
    try {
      const taskDir = await writeTask(root);
      await recordCore.updateTask(root, '18', updateTitle);
      assert.equal((await readTask(taskDir)).title, 'Updated title');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  for (const [name, raw] of [
    ['malformed JSON', '{"prunedTaskIds":'],
    ['non-object JSON', '[]'],
  ]) {
    await t.test(name, async () => {
      const root = await mkdtemp(join(tmpdir(), 'jeff-record-config-invalid-'));
      try {
        const taskDir = await writeTask(root);
        await writeFile(join(root, '.jeff', 'config.json'), raw, 'utf8');
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');

        await assert.rejects(
          recordCore.updateTask(root, '18', updateTitle),
          /config/i,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  await t.test('uncontained config symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jeff-record-config-link-'));
    const outside = await mkdtemp(join(tmpdir(), 'jeff-record-config-outside-'));
    try {
      const taskDir = await writeTask(root);
      const target = join(outside, 'config.json');
      await writeFile(target, JSON.stringify({ prunedTaskIds: [] }), 'utf8');
      await symlink(target, join(root, '.jeff', 'config.json'));
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');

      await assert.rejects(
        recordCore.updateTask(root, '18', updateTitle),
        /config/i,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('record rejects a repository whose .jeff parent redirects task writes outside the root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jeff-record-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'jeff-record-outside-'));
  const taskDir = join(outside, '.jeff', 'tasks', '018-record-specialists');
  try {
    await mkdir(taskDir, { recursive: true });
    await writeFile(join(outside, '.jeff', 'config.json'), JSON.stringify({ mode: 'lite' }), 'utf8');
    await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(canonicalTask(), null, 2)}\n`, 'utf8');
    await symlink(join(outside, '.jeff'), join(root, '.jeff'));
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    await assert.rejects(
      recordSpecialistReturn(root, 'plan', '18', planReturn()),
      /\[record-task\].*(escape|symlink|outside)/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('implement kickback persists its evidence and returns the task to plan', async () => {
  const task = canonicalTask({ stage: 'implement', tests: { authored_by_agent_id: 'plan-agent', green: false, evidence: [] } });
  const { root, taskDir } = await makeRoot(task);
  try {
    await recordSpecialistReturn(root, 'implement', '18', implementReturn('implementer', {
      result: 'kickback',
      greenRun: { command: null, output: 'The test contract is over-specified.' },
      kickback: { to: 'plan', reason: 'The plan must revise the behavior seam.' },
    }));
    const recorded = await readTask(taskDir);

    assert.equal(recorded.stage, 'plan');
    assert.equal(recorded.implement.result, 'kickback');
    assert.equal(recorded.kickbacks.at(-1).reason, 'The plan must revise the behavior seam.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parallel review and audit judgments are all retained for every completion order', async () => {
  /** @type {Array<[string, Record<string, unknown>]>} */
  const judgments = [
    ['review', reviewReturn('reviewer-one')],
    ['review', reviewReturn('reviewer-two')],
    ['audit', auditReturn('auditor')],
  ];
  const orders = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];

  for (const order of orders) {
    const task = parallelJudgmentTask();
    const { root, taskDir } = await makeRoot(task);
    try {
      for (const index of order) {
        const [stage, result] = judgments[index];
        await recordSpecialistReturn(root, stage, '18', result);
      }
      const recorded = await readTask(taskDir);

      assert.deepEqual(
        new Set([recorded.review.reviewer_agent_id, recorded.review2.reviewer_agent_id]),
        new Set(['reviewer-one', 'reviewer-two']),
      );
      assert.equal(recorded.audit.audit_agent_id, 'auditor');
      assert.equal(recorded.status, 'done');
      assert.equal(recorded.stage, 'done');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

});

test('simultaneous review and audit writes do not lose any judgment', async () => {
  /** @type {Array<[string, Record<string, unknown>]>} */
  const judgments = [
    ['review', reviewReturn('reviewer-one')],
    ['review', reviewReturn('reviewer-two')],
    ['audit', auditReturn('auditor')],
  ];
  const concurrent = await makeRoot(parallelJudgmentTask());
  try {
    await Promise.all(judgments.map(([stage, result]) => recordSpecialistReturn(concurrent.root, stage, '18', result)));
    const recorded = await readTask(concurrent.taskDir);
    assert.deepEqual(
      new Set([recorded.review.reviewer_agent_id, recorded.review2.reviewer_agent_id]),
      new Set(['reviewer-one', 'reviewer-two']),
    );
    assert.equal(recorded.audit.audit_agent_id, 'auditor');
    assert.equal(recorded.status, 'done');
  } finally {
    await rm(concurrent.root, { recursive: true, force: true });
  }
});

test('issue 72 agents-only review re-entry archives once and requires two fresh reviews', async () => {
  const finding = /** @type {any} */ (blockingFinding());
  const refute = { ...refuteReturn('refuter', finding), agent_id: 'refuter', source: 'review' };
  finding.refute = refute;
  const task = canonicalTask({
    stage: 'implement',
    complexity: 'complex',
    agents: { implementer_agent_id: 'implementer-old', reviewer_agent_id: 'reviewer-old', reviewer2_agent_id: null, audit_agent_id: null },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
    review: { verdict: 'needs-work', reviewer_agent_id: null, findings: [finding], evidence: ['review evidence'] },
    refutes: [refute],
    convergence: {
      ...canonicalTask().convergence,
      stages: { review: { blockingKickbacks: 1 }, audit: { blockingKickbacks: 0 } },
    },
    kickbacks: [{ from: 'review', to: 'implement', reason: finding.what, at: '2026-07-12T00:30:00Z' }],
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    await recordSpecialistReturn(root, 'implement', '18', implementReturn('implementer-fresh'));
    await recordSpecialistReturn(root, 'refactor', '18', refactorReturn());
    await recordCurrentGate(root, taskDir);

    const reset = await readTask(taskDir);
    assert.equal(reset.judgmentHistory.length, 1);
    assert.equal(reset.judgmentHistory[0].agents.reviewer_agent_id, 'reviewer-old');
    assert.equal(reset.agents.reviewer_agent_id, null);
    assert.equal(reset.agents.reviewer2_agent_id, null);
    assert.equal(reset.review.verdict, null);
    assert.equal(reset.review2 ?? null, null);

    await recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer-fresh-one', { cycle: 1 }));
    assert.equal((await readTask(taskDir)).status, 'in_progress');
    await recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer-fresh-two', { cycle: 1 }));
    const recorded = await readTask(taskDir);
    assert.equal(recorded.review.reviewer_agent_id, 'reviewer-fresh-one');
    assert.equal(recorded.review2.reviewer_agent_id, 'reviewer-fresh-two');
    assert.equal(recorded.status, 'done');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Item 4 public recorder resets judgments despite a later builder kickback', async (t) => {
  for (const source of /** @type {const} */ (['review', 'audit'])) {
    await t.test(source, async (t) => {
      const now = '2026-07-12T02:00:00Z';
      t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
      const finding = source === 'review'
        ? blockingFinding({ what: 'Review requires implementation repair.' })
        : { ...blockingFinding({ what: 'Audit requires implementation repair.' }), cwe: 'CWE-20' };
      const { root, taskDir } = await makeRoot(canonicalTask({
        stage: 'review',
        complexity: 'complex',
        plan: { refactorOpportunity: null },
        agents: {
          implementer_agent_id: 'implementer-old',
          reviewer_agent_id: null,
          reviewer2_agent_id: null,
          audit_agent_id: null,
        },
        tests: {
          authored_by_agent_id: 'plan-agent-old',
          green: true,
          evidence: [{ command: 'make test', output: 'prior gate pass' }],
        },
        audit: {
          required: true,
          verdict: 'na',
          audit_agent_id: null,
          findings: [],
          evidence: [],
        },
      }));
      try {
        await recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer-current', {
          verdict: source === 'review' ? 'needs-work' : 'pass',
          findings: source === 'review' ? [finding] : [],
        }));
        await recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer-two-current'));
        await recordSpecialistReturn(root, 'audit', '18', auditReturn('auditor-current', {
          verdict: source === 'audit' ? 'needs-work' : 'pass',
          findings: source === 'audit' ? [finding] : [],
        }));
        await recordSpecialistReturn(root, 'refute', '18', refuteReturn(`${source}-refuter`, finding, {
          source,
        }));

        await recordSpecialistReturn(root, 'implement', '18', implementReturn('implementer-kickback', {
          result: 'kickback',
          greenRun: { command: null, output: 'The plan contract needs revision.' },
          kickback: { to: 'plan', reason: 'Revise the plan contract.' },
        }));
        await recordSpecialistReturn(root, 'plan', '18', planReturn({
          complexity: 'complex',
          auditRequired: true,
        }, 'plan-agent-fresh'));

        const beforeRepair = await readTask(taskDir);
        assert.deepEqual(
          beforeRepair.kickbacks.map((/** @type {any} */ kickback) => [kickback.from, kickback.to]),
          [[source, 'implement'], ['implement', 'plan']],
        );
        const returned = implementReturn('implementer-fresh', { files: ['src/core/task-schema.js'] });
        const expectedImplement = {
          agent_id: 'implementer-fresh',
          result: returned.result,
          files: returned.files,
          greenRun: returned.greenRun,
        };
        const expectedTests = { ...beforeRepair.tests, green: false };
        delete expectedTests.gate;

        await recordSpecialistReturn(root, 'implement', '18', returned);
        const repaired = await readTask(taskDir);
        const archived = {
          at: now,
          review: beforeRepair.review,
          review2: beforeRepair.review2,
          audit: beforeRepair.audit,
          agents: {
            reviewer_agent_id: 'reviewer-current',
            reviewer2_agent_id: 'reviewer-two-current',
            audit_agent_id: 'auditor-current',
          },
        };

        assert.deepEqual(repaired.judgmentHistory, [archived]);
        assert.deepEqual(repaired.review, {
          verdict: null,
          reviewer_agent_id: null,
          findings: [],
          evidence: [],
        });
        assert.equal(repaired.review2, null);
        assert.deepEqual(repaired.audit, {
          required: true,
          verdict: 'na',
          audit_agent_id: null,
          findings: [],
          evidence: [],
        });
        assert.deepEqual(repaired.agents, {
          implementer_agent_id: 'implementer-fresh',
          reviewer_agent_id: null,
          reviewer2_agent_id: null,
          audit_agent_id: null,
        });
        assert.deepEqual(repaired.tests, expectedTests);
        assert.equal(JSON.stringify(repaired.implement), JSON.stringify(expectedImplement));
        assert.equal(repaired.stage, 'review');

        const freshAgent = `${source}-fresh`;
        await recordSpecialistReturn(
          root,
          source,
          '18',
          source === 'review'
            ? reviewReturn(freshAgent, { cycle: 1 })
            : auditReturn(freshAgent, { cycle: 1 }),
        );
        const rerecorded = await readTask(taskDir);
        assert.deepEqual(rerecorded.judgmentHistory, [archived]);
        assert.equal(
          source === 'review'
            ? rerecorded.review.reviewer_agent_id
            : rerecorded.audit.audit_agent_id,
          freshAgent,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('implementation full-resets an equal-instant active untyped judgment round', async (t) => {
  const sources = ['review', 'audit'];
  /** @type {Array<[string, Record<string, any>]>} */
  const encodings = [
    ['omitted findings', {}],
    ['empty findings', { findings: [] }],
  ];

  for (const source of sources) {
    for (const [encoding, contract] of encodings) {
      await t.test(`${source}, ${encoding}`, async (t) => {
        t.mock.timers.enable({
          apis: ['Date'],
          now: new Date('2026-07-12T02:00:00Z'),
        });
        const currentReview = {
          verdict: source === 'review' ? 'needs-work' : 'pass',
          reviewer_agent_id: 'reviewer-current',
          findings: source === 'review' ? [blockingFinding()] : [],
          evidence: [{ command: 'node --test', output: 'review evidence' }],
        };
        const currentReview2 = {
          verdict: 'pass',
          reviewer_agent_id: 'reviewer-two-current',
          findings: [],
          evidence: [{ command: 'node --test', output: 'review two evidence' }],
        };
        const currentAudit = {
          required: true,
          verdict: source === 'audit' ? 'needs-work' : 'pass',
          audit_agent_id: 'auditor-current',
          findings: source === 'audit' ? [{ ...blockingFinding(), cwe: 'CWE-20' }] : [],
          evidence: [{ command: 'review-security --json', output: 'audit evidence' }],
        };
        const priorCycle = {
          at: '2026-07-12T01:00:00+01:00',
          review: source === 'review'
            ? { ...currentReview, verdict: 'pass', reviewer_agent_id: 'reviewer-archived', findings: [] }
            : currentReview,
          review2: currentReview2,
          audit: source === 'audit'
            ? { ...currentAudit, verdict: 'pass', audit_agent_id: 'auditor-archived', findings: [] }
            : currentAudit,
        };
        const task = canonicalTask({
          stage: 'implement',
          complexity: 'complex',
          plan: { refactorOpportunity: null },
          agents: {
            implementer_agent_id: 'implementer-old',
            reviewer_agent_id: 'reviewer-current',
            reviewer2_agent_id: 'reviewer-two-current',
            audit_agent_id: 'auditor-current',
          },
          tests: {
            authored_by_agent_id: 'plan-agent',
            green: true,
            evidence: [{ command: 'make test', output: 'prior gate pass' }],
          },
          review: currentReview,
          review2: currentReview2,
          audit: currentAudit,
          judgmentHistory: [priorCycle],
          kickbacks: [{
            from: source,
            to: 'implement',
            reason: `Fresh equal-instant ${source} blocker.`,
            at: '2026-07-12T00:00:00Z',
            ...contract,
          }],
        });
        const returned = implementReturn('implementer-fresh');
        const expectedImplement = {
          agent_id: 'implementer-fresh',
          result: returned.result,
          files: returned.files,
          greenRun: returned.greenRun,
        };
        const { root, taskDir } = await makeRoot(task);
        try {
          const before = await readTask(taskDir);
          await recordSpecialistReturn(root, 'implement', '18', returned);
          const repaired = await readTask(taskDir);
          const expectedTests = { ...before.tests, green: false };
          delete expectedTests.gate;

          assert.deepEqual(repaired.judgmentHistory, [
            priorCycle,
            {
              at: '2026-07-12T02:00:00Z',
              review: currentReview,
              review2: currentReview2,
              audit: currentAudit,
              agents: {
                reviewer_agent_id: 'reviewer-current',
                reviewer2_agent_id: 'reviewer-two-current',
                audit_agent_id: 'auditor-current',
              },
            },
          ]);
          assert.deepEqual(repaired.review, {
            verdict: null,
            reviewer_agent_id: null,
            findings: [],
            evidence: [],
          });
          assert.equal(repaired.review2, null);
          assert.deepEqual(repaired.audit, {
            required: true,
            verdict: 'na',
            audit_agent_id: null,
            findings: [],
            evidence: [],
          });
          assert.deepEqual(repaired.agents, {
            implementer_agent_id: 'implementer-fresh',
            reviewer_agent_id: null,
            reviewer2_agent_id: null,
            audit_agent_id: null,
          });
          assert.deepEqual(repaired.tests, expectedTests);
          assert.equal(JSON.stringify(repaired.implement), JSON.stringify(expectedImplement));
          assert.equal(repaired.stage, 'review');

          const freshAgent = source === 'review' ? 'reviewer-rerun' : 'auditor-rerun';
          const freshReturn = source === 'review'
            ? reviewReturn(freshAgent, { cycle: 2 })
            : auditReturn(freshAgent, { cycle: 2 });
          await recordSpecialistReturn(root, source, '18', freshReturn);
          const rerecorded = await readTask(taskDir);

          assert.deepEqual(rerecorded.judgmentHistory, repaired.judgmentHistory);
          assert.deepEqual(rerecorded.agents, {
            implementer_agent_id: 'implementer-fresh',
            reviewer_agent_id: source === 'review' ? freshAgent : null,
            reviewer2_agent_id: null,
            audit_agent_id: source === 'audit' ? freshAgent : null,
          });
          assert.equal(rerecorded.review.reviewer_agent_id, source === 'review' ? freshAgent : null);
          assert.equal(rerecorded.review2, null);
          assert.equal(rerecorded.audit.audit_agent_id, source === 'audit' ? freshAgent : null);
          assert.deepEqual(rerecorded.tests, expectedTests);
          assert.equal(JSON.stringify(rerecorded.implement), JSON.stringify(expectedImplement));
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
});

test('implementation preserves judgments when history consumed the latest judgment kickback', async (t) => {
  const instants = [
    ['older with offset', '2026-07-12T00:30:00-01:00', '2026-07-12T01:00:00Z'],
    ['equal instant', '2026-07-12T01:00:00+01:00', '2026-07-12T00:00:00Z'],
  ];
  /** @type {Array<[string, Record<string, any>]>} */
  const encodings = [
    ['omitted findings', {}],
    ['empty findings', { findings: [] }],
  ];

  for (const [encoding, contract] of encodings) {
    for (const [instant, boundary, kickbackAt] of instants) {
      await t.test(`${encoding}, ${instant}`, async (t) => {
        t.mock.timers.enable({
          apis: ['Date'],
          now: new Date('2026-07-12T02:00:00Z'),
        });
        const currentReview = {
          verdict: 'pass',
          reviewer_agent_id: 'reviewer-current',
          findings: [],
          evidence: [{ command: 'git diff --check', output: 'clean' }],
        };
        const currentReview2 = {
          verdict: 'pass',
          reviewer_agent_id: 'reviewer-two-current',
          findings: [],
          evidence: [{ command: 'git diff --check', output: 'second review clean' }],
        };
        const currentAudit = {
          required: true,
          verdict: 'pass',
          audit_agent_id: 'auditor-current',
          findings: [],
          evidence: [{ command: 'review-security --json', output: 'no findings' }],
        };
        const history = [{
          at: boundary,
          review: {
            verdict: 'needs-work',
            reviewer_agent_id: 'reviewer-archived',
            findings: [blockingFinding()],
            evidence: [{ command: 'node --test', output: 'archived review blocker' }],
          },
          review2: currentReview2,
          audit: currentAudit,
        }];
        const legacyImplement = {
          agent_id: 'implementer-old',
          result: 'green',
          files: ['src/core/record.js'],
          greenRun: { command: 'node --test', output: 'prior implementation pass' },
        };
        const legacyRefactor = {
          agent_id: 'refactorer-old',
          result: 'clean',
          files: [],
          outsideDiff: [],
          greenRun: { command: 'node --test', output: 'prior refactor pass' },
          summary: ['No prior refactor needed.'],
        };
        const task = canonicalTask({
          stage: 'implement',
          plan: { refactorOpportunity: null },
          agents: {
            implementer_agent_id: 'implementer-old',
            reviewer_agent_id: 'reviewer-current',
            reviewer2_agent_id: 'reviewer-two-current',
            audit_agent_id: 'auditor-current',
          },
          tests: {
            authored_by_agent_id: 'plan-agent',
            green: true,
            evidence: [{ command: 'make test', output: 'prior gate pass' }],
          },
          review: currentReview,
          review2: currentReview2,
          audit: currentAudit,
          implement: legacyImplement,
          refactor: legacyRefactor,
          judgmentHistory: history,
          kickbacks: [{
            from: 'review',
            to: 'implement',
            reason: 'Consumed review blocker.',
            at: kickbackAt,
            ...contract,
          }],
        });
        const returned = implementReturn('implementer-fresh');
        const expectedImplement = {
          agent_id: 'implementer-fresh',
          result: returned.result,
          files: returned.files,
          greenRun: returned.greenRun,
        };
        const { root, taskDir } = await makeRoot(task);
        try {
          const before = await readTask(taskDir);
          await recordSpecialistReturn(root, 'implement', '18', returned);
          const recorded = await readTask(taskDir);
          const expectedTests = { ...before.tests, green: false };
          delete expectedTests.gate;

          assert.deepEqual(recorded.judgmentHistory, before.judgmentHistory);
          assert.deepEqual(recorded.review, before.review);
          assert.deepEqual(recorded.review2, before.review2);
          assert.deepEqual(recorded.audit, before.audit);
          assert.deepEqual(recorded.agents, {
            ...before.agents,
            implementer_agent_id: 'implementer-fresh',
          });
          assert.deepEqual(recorded.tests, expectedTests);
          assert.equal(JSON.stringify(recorded.implement), JSON.stringify(expectedImplement));
          assert.equal(JSON.stringify(recorded.refactor), JSON.stringify(before.refactor));
          assert.deepEqual(recorded, {
            ...before,
            updatedAt: '2026-07-12T02:00:00Z',
            stage: 'review',
            agents: {
              ...before.agents,
              implementer_agent_id: 'implementer-fresh',
            },
            tests: expectedTests,
            implement: expectedImplement,
          });
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
});

test('implementation rejects malformed judgment history without changing task bytes', async () => {
  const currentReview = {
    verdict: 'pass',
    reviewer_agent_id: 'reviewer-current',
    findings: [],
    evidence: [{ command: 'git diff --check', output: 'clean' }],
  };
  const currentAudit = {
    required: true,
    verdict: 'pass',
    audit_agent_id: 'auditor-current',
    findings: [],
    evidence: [{ command: 'review-security --json', output: 'no findings' }],
  };
  const task = canonicalTask({
    stage: 'implement',
    agents: {
      implementer_agent_id: 'implementer-old',
      reviewer_agent_id: 'reviewer-current',
      reviewer2_agent_id: null,
      audit_agent_id: 'auditor-current',
    },
    review: currentReview,
    audit: currentAudit,
    judgmentHistory: [{ at: 'not-an-instant', review: {}, review2: null, audit: {} }],
    kickbacks: [
      { from: 'review', to: 'implement', reason: 'Possibly consumed blocker.', at: '2026-07-12T00:30:00Z' },
    ],
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    const taskPath = join(taskDir, 'task.json');
    const before = await readFile(taskPath, 'utf8');

    await assert.rejects(
      recordSpecialistReturn(root, 'implement', '18', implementReturn('implementer-fresh')),
      /judgmentHistory.*at.*invalid/,
    );
    assert.equal(await readFile(taskPath, 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('follow-up-only review progresses while retaining its judgment evidence', async () => {
  const followup = blockingFinding({ class: 'follow-up', severity: 'low' });
  const first = await makeRoot(canonicalTask({
    stage: 'review',
    agents: { implementer_agent_id: 'implementer', reviewer_agent_id: null, reviewer2_agent_id: null, audit_agent_id: null },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
  }));
  try {
    await recordSpecialistReturn(first.root, 'review', '18', reviewReturn('reviewer', {
      verdict: 'needs-work',
      findings: [followup],
    }));
    const recorded = await readTask(first.taskDir);
    assert.equal(recorded.status, 'done');
    assert.deepEqual(recorded.review.findings, [followup]);
    assert.deepEqual(recorded.review.evidence, [{ command: 'git diff --check', output: 'clean' }]);
  } finally {
    await rm(first.root, { recursive: true, force: true });
  }

});

test('a refuted blocker progresses while retaining the finding and refute evidence', async () => {
  const blocker = blockingFinding();
  const second = await makeRoot(canonicalTask({
    stage: 'review',
    agents: { implementer_agent_id: 'implementer', reviewer_agent_id: null, reviewer2_agent_id: null, audit_agent_id: null },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
  }));
  try {
    await recordSpecialistReturn(second.root, 'review', '18', reviewReturn('reviewer', {
      verdict: 'needs-work',
      findings: [blocker],
    }));
    await recordSpecialistReturn(second.root, 'refute', '18', refuteReturn('refuter', blocker, {
      verdict: 'refuted',
      rationale: 'The upstream guard prevents the failure.',
      evidence: [{ command: 'sed -n 1,20p src/core/record.js', output: 'guard present' }],
    }));
    const recorded = await readTask(second.taskDir);
    assert.equal(recorded.status, 'done');
    assert.equal(recorded.review.findings[0].class, 'follow-up');
    assert.equal(recorded.refutes[0].verdict, 'refuted');
  } finally {
    await rm(second.root, { recursive: true, force: true });
  }
});

test('parallel refutes cover every blocking finding and settle each stage union once', async () => {
  const reviewOne = blockingFinding({ line: 101, what: 'Review one blocks.' });
  const reviewTwo = blockingFinding({ line: 102, what: 'Review two blocks.' });
  const reviewThree = blockingFinding({ line: 103, what: 'Review three blocks.' });
  const auditFinding = { ...blockingFinding({ line: 104, what: 'Audit blocks.' }), cwe: 'CWE-400' };
  const { root, taskDir } = await makeRoot(parallelJudgmentTask());
  try {
    await recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer-one', {
      verdict: 'needs-work',
      findings: [reviewOne, reviewTwo],
    }));
    await recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer-two', {
      verdict: 'needs-work',
      findings: [reviewThree],
    }));
    await recordSpecialistReturn(root, 'audit', '18', auditReturn('auditor', {
      verdict: 'needs-work',
      findings: [auditFinding],
    }));

    const refutes = [reviewOne, reviewTwo, reviewThree, auditFinding].map((finding, index) => (
      refuteReturn(`refuter-${index}`, finding)
    ));
    await Promise.all(refutes.map((result) => recordSpecialistReturn(root, 'refute', '18', result)));

    const recorded = await readTask(taskDir);
    assert.equal(recorded.refutes.length, 4);
    assert.equal(new Set(recorded.refutes.map((/** @type {any} */ refute) => refute.finding)).size, 4);
    assert.equal(recorded.review.findings.every((/** @type {any} */ finding) => finding.refute?.verdict === 'survives'), true);
    assert.equal(recorded.review2.findings.every((/** @type {any} */ finding) => finding.refute?.verdict === 'survives'), true);
    assert.equal(recorded.audit.findings.every((/** @type {any} */ finding) => finding.refute?.verdict === 'survives'), true);
    assert.equal(recorded.convergence.stages.review.blockingKickbacks, 1);
    assert.equal(recorded.convergence.stages.audit.blockingKickbacks, 1);
    assert.deepEqual(recorded.kickbacks.map((/** @type {any} */ kickback) => kickback.from).sort(), ['audit', 'review']);

    const beforeReplay = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'refute', '18', refutes[0]),
      /\[record-identity\] refute agent refuter-0 violates specialist separation/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), beforeReplay);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 153 refute recording has the same outcome for every completion order', async () => {
  const blockers = [
    blockingFinding({ line: 151, kickTo: 'refactor', what: 'The first blocker survives.' }),
    blockingFinding({ line: 152, what: 'The second blocker is refuted.' }),
    blockingFinding({ line: 153, what: 'The third blocker survives.' }),
  ];
  const refutes = blockers.map((finding, index) => refuteReturn(
    `refuter-${index}`,
    finding,
    index === 1
      ? { verdict: 'refuted', rationale: 'The boundary rejects this input.' }
      : {},
  ));
  const orders = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];
  const outcomes = [];

  for (const order of orders) {
    const task = canonicalTask({
      stage: 'review',
      agents: {
        implementer_agent_id: 'implementer',
        reviewer_agent_id: 'reviewer',
        reviewer2_agent_id: null,
        audit_agent_id: null,
      },
      tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
      review: {
        verdict: 'needs-work',
        reviewer_agent_id: 'reviewer',
        findings: structuredClone(blockers),
        evidence: ['review evidence'],
      },
    });
    const { root, taskDir } = await makeRoot(task);
    try {
      for (const index of order) {
        await recordSpecialistReturn(root, 'refute', '18', refutes[index]);
      }
      const recorded = await readTask(taskDir);
      outcomes.push({
        status: recorded.status,
        stage: recorded.stage,
        findings: recorded.review.findings,
        refutes: [...recorded.refutes].sort((left, right) => left.finding.localeCompare(right.finding)),
        kickbacks: recorded.kickbacks.map((/** @type {any} */ { from, to, reason }) => ({ from, to, reason })),
        convergence: recorded.convergence,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  for (const outcome of outcomes.slice(1)) assert.deepEqual(outcome, outcomes[0]);
  assert.equal(outcomes[0].refutes.length, blockers.length);
  assert.deepEqual(outcomes[0].kickbacks, [{
    from: 'review',
    to: 'implement',
    reason: 'The first blocker survives.; The third blocker survives.',
  }]);
  assert.equal(outcomes[0].convergence.stages.review.blockingKickbacks, 1);
});

test('issue 72 refutes bind blockers by exact file-line-what identity', async (t) => {
  const short = blockingFinding({ what: 'The recording path loses a result' });
  const long = blockingFinding({ what: 'The recording path loses a result during reassessment.' });

  await t.test('overlapping same-line text binds the exact finding', async () => {
    const task = canonicalTask({
      stage: 'review',
      agents: { implementer_agent_id: 'implementer', reviewer_agent_id: 'reviewer', reviewer2_agent_id: null, audit_agent_id: null },
      review: { verdict: 'needs-work', reviewer_agent_id: 'reviewer', findings: [short, long], evidence: ['review evidence'] },
    });
    const { root, taskDir } = await makeRoot(task);
    try {
      await recordSpecialistReturn(root, 'refute', '18', refuteReturn('refuter', long));
      const recorded = await readTask(taskDir);

      assert.equal(recorded.review.findings[0].refute, undefined);
      assert.equal(recorded.review.findings[1].refute.finding, `${long.file}:${long.line} ${long.what}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  /** @type {Array<[string, string, Record<string, any> | null, RegExp]>} */
  const invalid = [
    ['zero exact matches', `${short.file}:${short.line} A different finding.`, null, /\[record-transition\] refute finding is not an active blocker/],
    ['multiple exact matches', `${short.file}:${short.line} ${short.what}`, { verdict: 'needs-work', reviewer_agent_id: 'reviewer-two', findings: [{ ...short }], evidence: ['review two evidence'] }, /\[record-transition\] refute finding identity is ambiguous/],
  ];
  for (const [name, identity, review2, error] of invalid) await t.test(`${name} reject atomically`, async () => {
    const task = canonicalTask({
      stage: 'review',
      complexity: review2 ? 'complex' : 'simple',
      agents: { implementer_agent_id: 'implementer', reviewer_agent_id: 'reviewer-one', reviewer2_agent_id: review2 ? 'reviewer-two' : null, audit_agent_id: null },
      review: { verdict: 'needs-work', reviewer_agent_id: 'reviewer-one', findings: [short], evidence: ['review evidence'] },
      ...(review2 ? { review2 } : {}),
    });
    const { root, taskDir } = await makeRoot(task);
    try {
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordSpecialistReturn(root, 'refute', '18', refuteReturn('refuter', short, { finding: identity })),
        error,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('judgment contracts require a nonnegative active cycle identity', async (t) => {
  const finding = blockingFinding();
  /** @type {Array<[string, Record<string, any>]>} */
  const returns = [
    ['review', reviewReturn('reviewer')],
    ['audit', auditReturn()],
    ['refute', refuteReturn('refuter', finding)],
  ];
  for (const [stage, result] of returns) {
    await t.test(`${stage} requires cycle`, async () => {
      const { root } = await makeRoot();
      try {
        delete result.cycle;
        await assert.rejects(
          recordSpecialistReturn(root, stage, '18', result),
          /\[record-schema\].*cycle/,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('judgment cycle rejects stale and replayed returns without changing current evidence', async () => {
  const task = /** @type {any} */ (parallelJudgmentTask());
  task.judgmentHistory = [{
    at: '2026-07-12T00:00:01Z',
    review: { verdict: 'na', reviewer_agent_id: null, findings: [], evidence: [] },
    review2: null,
    audit: { required: false, verdict: 'na', audit_agent_id: null, findings: [], evidence: [] },
  }];
  const { root, taskDir } = await makeRoot(task);
  try {
    const stale = reviewReturn('reviewer-stale', { cycle: 0 });
    const beforeStale = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'review', '18', stale),
      /\[record-transition\].*cycle/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), beforeStale);

    const first = reviewReturn('reviewer-current-one', { cycle: 1 });
    await recordSpecialistReturn(root, 'review', '18', first);
    const beforeReplay = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'review', '18', first),
      /\[record-transition\].*(already|replay|duplicate)/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), beforeReplay);

    await recordSpecialistReturn(root, 'audit', '18', auditReturn('auditor-current', { cycle: 1 }));
    await recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer-current-two', { cycle: 1 }));
    const done = await readTask(taskDir);
    assert.equal(done.status, 'done');
    assert.equal(done.review.reviewer_agent_id, 'reviewer-current-one');
    assert.equal(done.review2.reviewer_agent_id, 'reviewer-current-two');
    assert.equal(done.audit.audit_agent_id, 'auditor-current');

    const beforeDoneReplay = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'audit', '18', auditReturn('auditor-current', { cycle: 1 })),
      /\[record-transition\].*(done|already|replay)/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), beforeDoneReplay);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('full-mode recording persists transient done state before the prune gate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jeff-record-full-done-'));
  const taskDir = join(root, '.jeff', 'tasks', '018-record-specialists');
  try {
    await mkdir(taskDir, { recursive: true });
    await writeFile(join(root, '.jeff', 'config.json'), JSON.stringify({ active: true }), 'utf8');
    await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(canonicalTask({
      stage: 'review',
      agents: { implementer_agent_id: 'implementer', reviewer_agent_id: null, reviewer2_agent_id: null, audit_agent_id: null },
      tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['full gate'] },
    }), null, 2)}\n`, 'utf8');
    runGit(root, ['init', '-q']);
    runGit(root, ['config', 'user.email', 'tests@example.com']);
    runGit(root, ['config', 'user.name', 'Tests']);
    runGit(root, ['config', 'commit.gpgsign', 'false']);
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'baseline']);
    await recordCurrentGate(root, taskDir);

    await recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer'));
    const recorded = await readTask(taskDir);
    const validation = runCook(root, ['validate']);

    assert.equal(recorded.status, 'done');
    assert.equal(recorded.stage, 'done');
    assert.notEqual(validation.code, 0);
    assert.match(validation.stderr, /\[prune\]/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('follow-up-only audit reaches an INV-4-compatible terminal outcome with evidence retained', async () => {
  const followup = { ...blockingFinding({ class: 'follow-up', line: 105, severity: 'low' }), cwe: null };
  const { root, taskDir } = await makeRoot(auditStageTask());
  try {
    await recordSpecialistReturn(root, 'audit', '18', auditReturn('auditor', {
      verdict: 'needs-work',
      findings: [followup],
    }));

    const recorded = await readTask(taskDir);
    assert.equal(recorded.status, 'done');
    assert.equal(recorded.audit.verdict, 'pass');
    assert.equal(recorded.audit.reportedVerdict, 'needs-work');
    assert.deepEqual(recorded.audit.findings, [followup]);
    assert.deepEqual(recorded.audit.evidence, [{ command: 'review-security --json', output: 'no findings' }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 121 shared recorder persists the observed identity for a return without agent_id', async () => {
  const { root } = await makeRoot();
  try {
    const recorded = await recordObservedSpecialistReturn(
      root,
      'plan',
      '18',
      planReturn(),
      'observed-plan-agent',
    );

    assert.equal(recorded.tests.authored_by_agent_id, 'observed-plan-agent');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 121 CLI rejects the retired specialist-authored agent_id field atomically', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const file = await writeReturn(root, { ...planReturn(), agent_id: 'observed-agent' });

    const result = runCook(root, ['record', 'plan', '18', 'observed-agent', file]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /\[record-schema\].*agent_id/);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 121 observed refuter identity cannot reuse the implementer', async () => {
  const blocker = blockingFinding();
  const task = canonicalTask({
    stage: 'review',
    agents: { implementer_agent_id: 'implementer', reviewer_agent_id: null, reviewer2_agent_id: null, audit_agent_id: null },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    await recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer', {
      verdict: 'needs-work',
      findings: [blocker],
    }));
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    await assert.rejects(
      recordSpecialistReturn(root, 'refute', '18', refuteReturn('implementer', blocker)),
      /\[(?:record-identity|record-transition)\]/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 65 cycle 1 refute rejects every current-finder identity representation atomically', async (t) => {
  /** @type {Array<[string, string | null, string | null]>} */
  const representations = [
    ['outcome-only', null, 'current-finder'],
    ['agents-only', 'current-finder', null],
  ];

  for (const [name, agentsIdentity, outcomeIdentity] of representations) {
    await t.test(name, async () => {
      const blocker = blockingFinding();
      const task = canonicalTask({
        stage: 'review',
        agents: {
          implementer_agent_id: 'implementer',
          reviewer_agent_id: agentsIdentity,
          reviewer2_agent_id: null,
          audit_agent_id: null,
        },
        tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
        review: {
          verdict: 'needs-work',
          reviewer_agent_id: outcomeIdentity,
          findings: [blocker],
          evidence: ['review evidence'],
        },
      });
      const { root, taskDir } = await makeRoot(task);
      try {
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');

        await assert.rejects(
          recordSpecialistReturn(root, 'refute', '18', refuteReturn('current-finder', blocker)),
          /\[record-identity\] refute agent current-finder violates specialist separation/,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 65 cycle 1 refute rejects prior-refuter reuse atomically with the identity error', async () => {
  const first = blockingFinding({ line: 10, what: 'The first recording path loses a result.' });
  const second = blockingFinding({ line: 11, what: 'The second recording path loses a result.' });
  const task = canonicalTask({
    stage: 'review',
    agents: { implementer_agent_id: 'implementer', reviewer_agent_id: 'reviewer', reviewer2_agent_id: null, audit_agent_id: null },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
    review: {
      verdict: 'needs-work',
      reviewer_agent_id: 'reviewer',
      findings: [first, second],
      evidence: ['review evidence'],
    },
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    await recordSpecialistReturn(root, 'refute', '18', refuteReturn('prior-refuter', first));
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    await assert.rejects(
      recordSpecialistReturn(root, 'refute', '18', refuteReturn('prior-refuter', second)),
      /\[record-identity\] refute agent prior-refuter violates specialist separation/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 237 code council members and synthesizer cannot reuse archived judge identities', async (t) => {
  const archivedTask = () => councilTask({
    judgmentHistory: [{
      at: '2026-07-12T00:00:01Z',
      review: { verdict: 'pass', reviewer_agent_id: 'historical-reviewer', findings: [], evidence: ['prior'] },
      review2: null,
      audit: { required: true, verdict: 'pass', audit_agent_id: 'historical-auditor', findings: [], evidence: ['prior'] },
    }],
  });
  const cases = [
    ['member', councilReturn(null, { 0: { agent_id: 'historical-reviewer' } }), {
      member_agent_ids: ['historical-reviewer', 'council-security', 'council-pragmatist'],
      synthesizer_agent_id: 'council-synthesizer',
    }],
    ['synthesizer', councilReturn(), {
      member_agent_ids: ['council-integrity', 'council-security', 'council-pragmatist'],
      synthesizer_agent_id: 'historical-auditor',
    }],
  ];

  for (const [name, returned, observed] of cases) {
    await t.test(name, async () => {
      const { root, taskDir } = await makeRoot(archivedTask());
      try {
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        await assert.rejects(
          recordObservedSpecialistReturn(root, 'council', '18', returned, observed),
          /record-identity.*(?:archived|prior judge|fresh|council)/i,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 74 council waits for every required judgment atomically', async (t) => {
  /** @type {Array<[string, () => any]>} */
  const incomplete = [
    ['second review pending', () => {
      const task = councilTask();
      task.agents.reviewer2_agent_id = null;
      task.review2 = null;
      return task;
    }],
    ['required audit pending', () => {
      const task = councilTask();
      task.agents.audit_agent_id = null;
      task.audit = { required: true, verdict: 'na', audit_agent_id: null, findings: [], evidence: [] };
      return task;
    }],
  ];

  for (const [name, taskFactory] of incomplete) await t.test(name, async () => {
    const { root, taskDir } = await makeRoot(taskFactory());
    try {
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');

      await assert.rejects(
        recordSpecialistReturn(root, 'council', '18', councilReturn()),
        /\[record-transition\]/,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 74 council requires the exact source-bound blocker union atomically', async (t) => {
  /** @param {any} result @param {any} finding @param {number} blockingVoteCount */
  function addCanonicalFinding(result, finding, blockingVoteCount) {
    for (let index = 0; index < result.council.members.length; index += 1) {
      result.council.members[index].inquiry.findingVotes.push({
        id: finding.id,
        blocking: index < blockingVoteCount,
        rationale: 'The independent inquiry classified this candidate against the active blocker union.',
      });
    }
    result.council.findings.push(finding);
    result.council.synthesis.survivingBlockers = result.council.findings
      .filter((/** @type {any} */ candidate) => candidate.survived)
      .map((/** @type {any} */ candidate) => candidate.id);
  }
  const extra = {
    id: 'F2',
    summary: 'An invented blocker that no active judgment returned.',
    source: 'audit',
    blockingVotes: 2,
    survived: true,
    followupTaskId: null,
  };
  /** @type {Array<[string, () => [any, any]]>} */
  const invalid = [
    ['omitted blocker', () => [mixedStageCouncilTask(), councilReturn()]],
    ['invented blocker', () => {
      const result = councilReturn();
      addCanonicalFinding(result, extra, 2);
      return [councilTask(), result];
    }],
    ['duplicate blocker', () => {
      const result = councilReturn();
      addCanonicalFinding(result, { ...result.council.findings[0], id: 'F2' }, 2);
      return [councilTask(), result];
    }],
    ['duplicate active blocker identity', () => {
      const task = councilTask();
      const finding = structuredClone(task.review.findings[0]);
      finding.line = 11;
      finding.refute = {
        ...finding.refute,
        agent_id: 'refuter-two',
        finding: 'src/core/record.js:11 The recording path loses a result.',
      };
      task.review.findings.push(finding);
      task.refutes.push(finding.refute);
      return [task, councilReturn()];
    }],
    ['missing surviving refute', () => {
      const task = councilTask();
      delete task.review.findings[0].refute;
      task.refutes = [];
      return [task, councilReturn()];
    }],
    ['wrong council source', () => {
      const result = councilReturn();
      result.council.findings[0].source = 'audit';
      return [councilTask(), result];
    }],
    ['wrong refute source', () => {
      const task = councilTask();
      task.review.findings[0].refute.source = 'audit';
      task.refutes[0].source = 'audit';
      return [task, councilReturn()];
    }],
  ];

  for (const [name, fixture] of invalid) await t.test(name, async () => {
    const [task, result] = fixture();
    const { root, taskDir } = await makeRoot(task);
    try {
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');

      await assert.rejects(
        recordSpecialistReturn(root, 'council', '18', result),
        /\[record-transition\]/,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 74 one mixed-source council can ship the complete blocker union', async () => {
  const returned = mixedStageCouncilReturn('shipped');
  returned.council.findings = returned.council.findings.map((/** @type {any} */ finding) => ({
    ...finding,
    blockingVotes: 1,
    survived: false,
    followupTaskId: 18,
  }));
  for (let index = 0; index < returned.council.members.length; index += 1) {
    for (const vote of returned.council.members[index].inquiry.findingVotes) {
      vote.blocking = index === 0;
    }
  }
  returned.council.synthesis.survivingBlockers = [];
  returned.council.verdict = 'ship';
  const { root, taskDir } = await makeRoot(mixedStageCouncilTask());
  try {
    const recorded = await recordSpecialistReturn(root, 'council', '18', returned);

    assert.equal(recorded.status, 'done');
    assert.equal(recorded.convergence.council.outcome, 'shipped');
    assert.deepEqual(
      recorded.convergence.council.findings.map((/** @type {any} */ finding) => finding.source),
      ['review', 'audit'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 70 council ship terminates while preserving originating needs-work evidence', async () => {
  const original = councilTask();
  const { root } = await makeRoot(original);
  try {
    const returned = councilReturn('shipped');
    Object.assign(returned.council.findings[0], { blockingVotes: 1, survived: false, followupTaskId: 18 });
    for (let index = 0; index < returned.council.members.length; index += 1) {
      returned.council.members[index].inquiry.findingVotes[0].blocking = index === 0;
    }
    returned.council.synthesis.survivingBlockers = [];
    returned.council.verdict = 'ship';
    const recorded = await recordSpecialistReturn(root, 'council', '18', returned);

    assert.equal(recorded.status, 'done');
    assert.equal(recorded.convergence.council.verdict, 'ship');
    assert.equal(recorded.convergence.council.outcome, 'shipped');
    assert.deepEqual(recorded.review, original.review);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 65 initial council block cannot claim scoped-fix-shipped', async () => {
  const { root, taskDir } = await makeRoot(councilTask());
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    await assert.rejects(
      recordSpecialistReturn(root, 'council', '18', councilReturn('scoped-fix-shipped')),
      /\[record-transition\]/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 238 scoped completion rejects changed canonical council research atomically', async () => {
  const { root, taskDir } = await prepareCompletedMixedStageReassessment();
  try {
    const changed = mixedStageCouncilReturn('scoped-fix-shipped');
    changed.council.members[0].inquiry.causalHypotheses = ['A different causal account.'];
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'council', '18', changed),
      /\[record-transition\].*preserve the recorded block/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 65 scoped council completion requires fresh verification after the recorded fix', async () => {
  const { root, taskDir } = await prepareScopedCouncilRecovery();
  try {
    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    await recordFreshCouncilJudgments(root, { includeAudit: true });
    const stale = await readTask(taskDir);
    stale.tests.gate = structuredClone(stale.convergence.recovery.baselineGate);
    await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(stale, null, 2)}\n`, 'utf8');
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'council', '18', councilReturn('scoped-fix-shipped')),
      /\[record-transition\].*(?:fresh|stale|verification)/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 65 council fix failed scoped implementation blocks atomically and cannot re-run', async () => {
  const priorGate = {
    hash: 'prior-gate',
    clean: true,
    green: true,
    command: 'make test',
    at: '2026-07-12T00:00:01Z',
  };
  const task = confinedCouncilTask({
    tests: {
      authored_by_agent_id: 'plan-agent',
      green: true,
      evidence: ['prior gate'],
      gate: priorGate,
    },
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    await recordSpecialistReturn(root, 'council', '18', councilReturn());

    const blocked = await recordSpecialistReturn(
      root,
      'implement',
      '18',
      implementReturn('scoped-fix-implementer', {
        result: 'kickback',
        files: ['src/core/record.js'],
        greenRun: {
          command: 'node --test src/cli/record.test.js',
          output: '1 test failed',
        },
        kickback: { to: 'plan', reason: 'The scoped council fix still fails.' },
      }),
    );

    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.convergence.council.outcome, 'blocked-to-operator');
    assert.equal(blocked.implement.result, 'kickback');
    assert.equal(blocked.tests.green, false);
    assert.equal(blocked.tests.gate, undefined);
    assert.equal(blocked.kickbacks.length, task.kickbacks.length + 1);
    assert.equal(blocked.kickbacks.at(-1).from, 'review');
    assert.equal(blocked.kickbacks.at(-1).to, 'implement');

    const beforeSecondCycle = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'implement', '18', implementReturn('second-scoped-fix-implementer')),
      /\[record-transition\].*(?:blocked|terminal|council)/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), beforeSecondCycle);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 65 scoped council completion accepts a recorded fix followed by a fresh clean gate', async () => {
  const { root, taskDir } = await makeRoot(confinedCouncilTask());
  try {
    await writeFile(join(root, '.jeff', 'profile.md'), 'Test command: `true`\n', 'utf8');
    runGit(root, ['init', '-q']);
    runGit(root, ['config', 'user.email', 'tests@example.com']);
    runGit(root, ['config', 'user.name', 'Tests']);
    runGit(root, ['config', 'commit.gpgsign', 'false']);
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'baseline']);

    await recordSpecialistReturn(root, 'council', '18', councilReturn());
    await recordSpecialistReturn(root, 'implement', '18', implementReturn('scoped-fix-implementer'));
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'record scoped fix']);
    const scopedFixHash = runGit(root, ['rev-parse', 'HEAD']);

    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    const gated = await readTask(taskDir);
    assert.equal(gated.tests.gate.hash, scopedFixHash);
    assert.equal(gated.tests.gate.clean, true);
    assert.equal(gated.tests.gate.green, true);

    await recordFreshCouncilJudgments(root, { includeAudit: true });
    await recordSpecialistReturn(root, 'council', '18', councilReturn('scoped-fix-shipped'));
    const recorded = await readTask(taskDir);
    assert.equal(recorded.convergence.council.outcome, 'scoped-fix-shipped');
    assert.equal(recorded.stage, 'done');
    assert.equal(recorded.status, 'done');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 65 recovery rejects a gate made stale by committed HEAD drift', async () => {
  const { root, taskDir } = await prepareScopedCouncilRecovery();
  try {
    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    await recordFreshCouncilJudgments(root, { includeAudit: true });
    await writeFile(join(root, 'refactor-marker.txt'), 'later code-changing transition\n', 'utf8');
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'record post-gate HEAD drift']);
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    await assert.rejects(
      recordSpecialistReturn(root, 'council', '18', councilReturn('scoped-fix-shipped')),
      /\[record-transition\].*(?:fresh|stale|verification)/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 68 scoped recovery archives every judgment and reruns all slots fresh', async () => {
  const original = mixedStageCouncilTask();
  const { root, taskDir } = await prepareMixedStageReassessment();
  try {
    const afterFix = await readTask(taskDir);
    assert.equal(afterFix.judgmentHistory.length, 2);
    assert.deepEqual(afterFix.judgmentHistory[0].review, original.review);
    assert.deepEqual(afterFix.judgmentHistory[0].review2, original.review2);
    assert.deepEqual(afterFix.judgmentHistory[0].audit, original.audit);
    assert.equal(afterFix.review.reviewer_agent_id, null);
    assert.equal(afterFix.review2, null);
    assert.equal(afterFix.audit.audit_agent_id, null);

    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    await recordFreshCouncilJudgments(root, { includeAudit: true });

    const reassessed = await readTask(taskDir);
    assert.equal(reassessed.status, 'in_progress');
    assert.equal(reassessed.review.verdict, 'pass');
    assert.equal(reassessed.review2.verdict, 'pass');
    assert.equal(reassessed.audit.verdict, 'pass');
    assert.deepEqual(reassessed.judgmentHistory[0].review, original.review);
    assert.deepEqual(reassessed.judgmentHistory[0].review2, original.review2);
    assert.deepEqual(reassessed.judgmentHistory[0].audit, original.audit);

    const recorded = await recordSpecialistReturn(
      root,
      'council',
      '18',
      mixedStageCouncilReturn('scoped-fix-shipped'),
    );
    assert.deepEqual(
      [recorded.stage, recorded.status, recorded.convergence.council.outcome],
      ['done', 'done', 'scoped-fix-shipped'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 67 scoped completion rejects a fresh gate without passing current judgments atomically', async () => {
  const { root, taskDir } = await prepareMixedStageReassessment();
  try {
    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    await assert.rejects(
      recordSpecialistReturn(root, 'council', '18', mixedStageCouncilReturn('scoped-fix-shipped')),
      /\[record-transition\].*(?:current|fresh).*judgment.*pass/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 68 reassessment rejects old judges and the scoped implementer atomically', async () => {
  const { root, taskDir } = await prepareGatedMixedStageReassessment();
  try {
    assert.equal((await readTask(taskDir)).judgmentHistory.length, 2);
    const cycle = (await readTask(taskDir)).judgmentHistory.length;
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer-one', { cycle })),
      /\[record-identity\]/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);

    await assert.rejects(
      recordSpecialistReturn(root, 'review', '18', reviewReturn('scoped-fix-implementer', { cycle })),
      /\[record-identity\]/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 68 reassessment permits a prior-cycle refuter as a fresh reviewer', async () => {
  const { root, taskDir } = await prepareGatedMixedStageReassessment();
  try {
    const cycle = (await readTask(taskDir)).judgmentHistory.length;
    const recorded = await recordSpecialistReturn(
      root,
      'review',
      '18',
      reviewReturn('refuter', { cycle }),
    );

    assert.equal(recorded.review.reviewer_agent_id, 'refuter');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 68 failed reassessment requires refute and permits no second implementation', async () => {
  const { root, taskDir } = await prepareGatedMixedStageReassessment();
  try {
    const blocker = blockingFinding({
      line: 30,
      what: 'The scoped recovery still fails reassessment.',
      why: 'The original mixed-stage defect remains reachable after the scoped fix.',
    });
    const cycle = (await readTask(taskDir)).judgmentHistory.length;
    await recordSpecialistReturn(root, 'review', '18', reviewReturn('fresh-failing-reviewer', {
      cycle,
      verdict: 'needs-work',
      findings: [blocker],
    }));
    const beforeRefute = await readFile(join(taskDir, 'task.json'), 'utf8');

    await assert.rejects(
      recordSpecialistReturn(root, 'council', '18', mixedStageCouncilReturn('blocked-to-operator')),
      /\[record-transition\].*(?:blocking|refute)/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), beforeRefute);

    const blocked = await recordSpecialistReturn(
      root,
      'refute',
      '18',
      refuteReturn('fresh-review-refuter', blocker, { cycle, source: 'review' }),
    );
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.convergence.council.outcome, 'blocked-to-operator');

    const beforeSecondCycle = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'implement', '18', implementReturn('second-scoped-fix-implementer')),
      /\[record-transition\].*(?:blocked|terminal|council)/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), beforeSecondCycle);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 67 recovery completion rejects post-verify HEAD drift atomically', async () => {
  const { root, taskDir } = await prepareMixedStageReassessment();
  try {
    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    await recordFreshCouncilJudgments(root, { includeAudit: true });
    await writeFile(join(root, 'post-verify-change.txt'), 'content committed after verification\n', 'utf8');
    runGit(root, ['add', 'post-verify-change.txt']);
    runGit(root, ['commit', '-qm', 'post verify content change']);
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    await assert.rejects(
      recordSpecialistReturn(root, 'council', '18', mixedStageCouncilReturn('scoped-fix-shipped')),
      /\[record-transition\].*(?:HEAD|current).*verification/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 68 scoped completion rejects a dirty working tree atomically', async () => {
  const { root, taskDir } = await prepareMixedStageReassessment();
  try {
    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    await recordFreshCouncilJudgments(root, { includeAudit: true });
    await writeFile(join(root, 'untracked.txt'), 'content not covered by the gate\n', 'utf8');
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    await assert.rejects(
      recordSpecialistReturn(root, 'council', '18', mixedStageCouncilReturn('scoped-fix-shipped')),
      /\[record-transition\].*(?:clean|dirty|worktree|verification)/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 67 council scoped completion fails closed when git status probe fails', async () => {
  const { root, taskDir } = await prepareCompletedMixedStageReassessment();
  try {
    const corruptIndex = join(root, '.jeff', 'corrupt-index');
    await writeFile(corruptIndex, 'invalid index\n', 'utf8');
    const env = { GIT_INDEX_FILE: corruptIndex };
    const head = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    const status = spawnSync('git', ['-C', root, 'status', '--porcelain', '--', ':(exclude).jeff'], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    assert.equal(head.status, 0, head.stderr);
    assert.notEqual(status.status, 0);

    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const councilResult = mixedStageCouncilReturn('scoped-fix-shipped');
    const file = await writeReturn(root, councilResult);
    const observedIdentity = {
      member_agent_ids: councilResult.council.members.map((member) => member.agent_id),
      synthesizer_agent_id: COUNCIL_SYNTHESIZER_AGENT_ID,
    };
    const recorded = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `import { recordSpecialistFile } from ${JSON.stringify(new URL('../core/record.js', import.meta.url).href)};
await recordSpecialistFile(process.argv[1], 'council', '18', process.argv[2], JSON.parse(process.argv[3]));`,
      root,
      file,
      JSON.stringify(observedIdentity),
    ], {
      env: { ...process.env, ...env, COOK_ROOT: root },
      encoding: 'utf8',
    });
    assert.notEqual(recorded.status, 0);
    assert.match(recorded.stderr, /\[record-transition\].*(?:git status|cleanliness|probe|working tree)/);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 67 recovery completion rejects persisted pass labels with blockers atomically', async () => {
  const { root, taskDir } = await prepareMixedStageReassessment();
  try {
    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    await recordFreshCouncilJudgments(root, { includeAudit: true });
    const inconsistent = await readTask(taskDir);
    inconsistent.review.findings = [blockingFinding({
      line: 40,
      what: 'A persisted pass still contains a blocking review finding.',
      why: 'Terminal recovery must derive pass consistency from current findings.',
    })];
    await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(inconsistent, null, 2)}\n`, 'utf8');
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    await assert.rejects(
      recordSpecialistReturn(root, 'council', '18', mixedStageCouncilReturn('scoped-fix-shipped')),
      /\[record-transition\].*(?:current|persisted).*judgment.*(?:block|consistent|pass)/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recording against abandoned lock state returns a bounded named outcome without changing the task', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    await mkdir(join(root, '.jeff', '.record-lock'));
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    await assert.rejects(
      recordSpecialistReturn(root, 'plan', '18', planReturn()),
      /\[record-lock\].*(busy|unavailable)/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** @param {string} root @param {string[]} args */
function runCookAsync(root, args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [COOK_JS, ...args], {
      env: { ...process.env, COOK_ROOT: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolveRun({ code: code ?? -1, stdout, stderr }));
  });
}

/** @param {string} taskDir */
async function readJournal(taskDir) {
  const raw = await readFile(join(taskDir, 'journal.jsonl'), 'utf8');
  return raw.trimEnd().split('\n').map((line) => JSON.parse(line));
}

test('Item 3 journal contract', async (t) => {
  await t.test('automatic record rejection leaves task bytes unchanged when the journal cannot be written', async () => {
    const { root, taskDir } = await makeRoot();
    const taskPath = join(taskDir, 'task.json');
    const journalPath = join(taskDir, 'journal.jsonl');
    try {
      const before = await readFile(taskPath);
      await mkdir(journalPath);
      let rejection;
      try {
        await recordSpecialistReturn(root, 'plan', '18', planReturn());
      } catch (error) {
        rejection = /** @type {Error} */ (error);
      }
      assert.ok(rejection, 'automatic record must reject when its journal append fails');
      assert.deepEqual(await readFile(taskPath), before);
      assert.match(rejection.message, /\[journal(?:[-\w]*)?\]/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('concurrent CLI appends allocate monotonic sequence numbers under the store lock', async () => {
    const { root, taskDir } = await makeRoot();
    try {
      const notes = Array.from({ length: 6 }, (_, index) => `dispatch-${index}`);
      const results = await Promise.all(notes.map((note) => (
        runCookAsync(root, ['journal', '18', 'intent', '--stage', 'plan', '--note', note])
      )));
      for (const result of results) assert.equal(result.code, 0, result.stderr);

      const events = await readJournal(taskDir);
      assert.deepEqual(events.map(({ seq }) => seq), [0, 1, 2, 3, 4, 5]);
      assert.deepEqual(
        events.map(({ note }) => note).sort(),
        notes.sort(),
      );
      assert.ok(events.every(({ event, stage, at }) => (
        event === 'intent'
        && stage === 'plan'
        && typeof at === 'string'
        && Number.isFinite(Date.parse(at))
      )));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('append warns and skips malformed, blank, and unsafe-sequence records without changing prior bytes', async () => {
    const { root, taskDir } = await makeRoot();
    const journal = join(taskDir, 'journal.jsonl');
    try {
      const prior = [
        JSON.stringify({ seq: 0, at: '2026-08-01T00:00:00Z', event: 'intent', stage: 'plan' }),
        '',
        '{ malformed journal line',
        JSON.stringify({
          seq: 1e308,
          at: '2026-08-01T00:00:01Z',
          event: 'record',
          stage: 'plan',
          agent: 'unsafe-sequence-agent',
        }),
        JSON.stringify({
          seq: 3,
          at: '2026-08-01T00:00:02Z',
          event: 'record',
          stage: 'plan',
          agent: 'prior-agent',
        }),
        '',
      ].join('\n');
      await writeFile(journal, prior, 'utf8');
      const result = runCook(root, ['journal', '18', 'intent', '--stage', 'plan']);
      assert.equal(result.code, 0, result.stderr);
      const after = await readFile(journal, 'utf8');
      assert.equal(after.slice(0, prior.length), prior);
      assert.deepEqual(
        result.stderr.trim().split('\n'),
        [
          'cook: journal: malformed line 2; skipped',
          'cook: journal: malformed line 3; skipped',
          'cook: journal: malformed line 4; skipped',
        ],
      );
      const appendedLine = after.slice(prior.length).trimEnd();
      assert.ok(appendedLine);
      const appended = JSON.parse(appendedLine);
      assert.deepEqual(
        { seq: appended.seq, event: appended.event, stage: appended.stage },
        { seq: 4, event: 'intent', stage: 'plan' },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('successful specialist record appends the observed stage and agent', async () => {
    const { root, taskDir } = await makeRoot();
    try {
      await recordSpecialistReturn(root, 'plan', '18', planReturn());
      const events = await readJournal(taskDir);
      assert.equal(events.length, 1);
      assert.deepEqual(
        { seq: events[0].seq, event: events[0].event, stage: events[0].stage, agent: events[0].agent },
        { seq: 0, event: 'record', stage: 'plan', agent: 'plan-agent' },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('successful council record appends one ordered real-agent event per member', async () => {
    const councilResult = councilReturn();
    const councilAgents = [
      ...councilResult.council.members.map(({ agent_id }) => agent_id),
      COUNCIL_SYNTHESIZER_AGENT_ID,
    ];
    const { root, taskDir } = await makeRoot(councilTask());
    try {
      await recordSpecialistReturn(root, 'council', '18', councilResult);
      const events = await readJournal(taskDir);
      assert.deepEqual(
        events.map(({ seq, event, stage, agent }) => ({ seq, event, stage, agent })),
        councilAgents.map((agent, seq) => ({
          seq,
          event: 'record',
          stage: 'council',
          agent,
        })),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('successful approval appends a record after the approval request record', async () => {
    const approvalBoundary = 'Rewrite the shared release registry entry from source to destination.';
    const grantedBy = 'Chef';
    const { root, taskDir } = await makeRoot(operationTask({
      stage: 'execute',
      plan: operationPlanState({
        requiresApproval: true,
        approvalBoundary,
      }),
    }));
    try {
      await recordSpecialistReturn(root, 'execute', '18', executeReturn('executor', {
        result: 'approval-required',
        approvalRequired: approvalBoundary,
      }));
      await recordCore.recordApproval(root, '18', grantedBy);

      const events = await readJournal(taskDir);
      assert.deepEqual(events.map(({ seq, event }) => ({ seq, event })), [
        { seq: 0, event: 'record' },
        { seq: 1, event: 'record' },
      ]);
      assert.deepEqual(
        {
          event: events[1].event,
          stage: events[1].stage,
          agent: events[1].agent,
        },
        { event: 'record', stage: 'execute', agent: grantedBy },
      );
      assert.equal(typeof events[1].at, 'string');
      assert.ok(Number.isFinite(Date.parse(events[1].at)));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('tracked verification appends the observed gate result', async () => {
    const { root, taskDir } = await makeRoot();
    try {
      await writeFile(join(root, '.jeff', 'profile.md'), 'Test command: `true`\n', 'utf8');
      runGit(root, ['init', '-q']);
      runGit(root, ['config', 'user.email', 'tests@example.com']);
      runGit(root, ['config', 'user.name', 'Tests']);
      runGit(root, ['config', 'commit.gpgsign', 'false']);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-qm', 'journal gate fixture']);
      const hash = runGit(root, ['rev-parse', 'HEAD']);

      const result = await runVerify(root, '18');
      assert.equal(result.code, 0, result.stderr.join('\n'));
      const events = await readJournal(taskDir);
      assert.equal(events.length, 1);
      assert.deepEqual(
        {
          seq: events[0].seq,
          event: events[0].event,
          hash: events[0].hash,
          green: events[0].green,
          clean: events[0].clean,
        },
        { seq: 0, event: 'gate', hash, green: true, clean: true },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('canonical lite adoption stamps the package pipeline version', async () => {
    const { root } = await makeRoot();
    try {
      const ref = 'plan.md';
      await writeFile(join(root, ref), '# Journal plan\n', 'utf8');
      const result = runCook(root, ['on', ref]);
      assert.equal(result.code, 0, result.stderr);

      const entries = await readdir(join(root, '.jeff', 'tasks'));
      let adopted;
      for (const entry of entries) {
        const task = JSON.parse(await readFile(join(root, '.jeff', 'tasks', entry, 'task.json'), 'utf8'));
        if (task.externalRef === ref) adopted = task;
      }
      assert.ok(adopted, 'expected the canonical lite writer to create a ledger');
      const packageJson = JSON.parse(await readFile(join(HERE, '..', '..', 'package.json'), 'utf8'));
      assert.equal(adopted.pipelineVersion, packageJson.version);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

/**
 * @typedef {import('../core/types.js').CanonicalTaskJson & {
 *   review: import('../core/types.js').Review,
 *   tests: import('../core/types.js').TaskTests,
 *   convergence: import('../core/types.js').CodeConvergence
 * }} Item4CodeTask
 * @typedef {import('../core/types.js').CanonicalTaskJson & {
 *   verification: import('../core/types.js').OperationVerification
 * }} Item4OperationTask
 */

/** @param {'review' | 'review2' | 'audit'} source @param {Record<string, any>} [overrides] */
function item4TypedFinding(source, overrides = {}) {
  return {
    source,
    file: 'src/core/record.js',
    line: source === 'audit' ? 22 : 11,
    what: `${source} found a confined blocker.`,
    kickTo: 'implement',
    ...overrides,
  };
}

/**
 * One completed typed review repair round: a single `from: "review"` kickback
 * carrying a findings contract. `recordRefute` increments the source counter
 * whenever it appends such a kickback, so the review counter is 1, not the
 * canonical 0; a 0 here describes a ledger the recorder cannot produce.
 *
 * @param {Record<string, any>} [overrides]
 */
function item4RepairTask(overrides = {}) {
  const reviewFinding = blockingFinding({
    line: 11,
    what: 'review found a confined blocker.',
  });
  const review2Finding = blockingFinding({
    line: 12,
    what: 'review2 found a confined blocker.',
  });
  const auditFinding = {
    ...blockingFinding({
      line: 22,
      what: 'audit found a confined blocker.',
    }),
    cwe: 'CWE-20',
  };
  const defaults = canonicalTask();
  return canonicalTask({
    stage: 'implement',
    complexity: 'complex',
    convergence: {
      ...defaults.convergence,
      stages: {
        ...defaults.convergence.stages,
        review: { blockingKickbacks: 1 },
      },
    },
    plan: {
      result: 'red',
      slices: ['Implement the original contract.'],
      testFiles: ['src/cli/record.test.js'],
      redRun: { command: 'node --test src/cli/record.test.js', output: 'original red' },
      escalation: null,
      refactorOpportunity: null,
    },
    agents: {
      implementer_agent_id: 'implementer-old',
      reviewer_agent_id: 'reviewer-old',
      reviewer2_agent_id: 'reviewer-two-old',
      audit_agent_id: 'auditor-old',
    },
    tests: {
      authored_by_agent_id: 'plan-agent',
      green: true,
      evidence: ['make test'],
      gate: {
        hash: 'abc123',
        clean: true,
        green: true,
        command: 'make test',
        at: '2026-07-12T00:20:00Z',
      },
    },
    review: {
      verdict: 'needs-work',
      reviewer_agent_id: 'reviewer-old',
      findings: [reviewFinding],
      evidence: ['review blocker'],
    },
    review2: {
      verdict: 'pass',
      reviewer_agent_id: 'reviewer-two-old',
      findings: [],
      evidence: ['review two pass'],
    },
    audit: {
      required: true,
      verdict: 'pass',
      audit_agent_id: 'auditor-old',
      findings: [],
      evidence: ['audit pass'],
    },
    kickbacks: [{
      from: 'review',
      to: 'implement',
      reason: reviewFinding.what,
      at: '2026-07-12T00:30:00Z',
      findings: [item4TypedFinding('review')],
    }],
    ...overrides,
  });
}

function item4MixedRepairTask() {
  const base = item4RepairTask();
  const refactorFinding = blockingFinding({
    file: 'src/core/invariants.js',
    line: 12,
    kickTo: 'refactor',
    what: 'review requires a confined refactor.',
  });
  const refute = {
    agent_id: 'review-refuter',
    source: 'review',
    finding: `${refactorFinding.file}:${refactorFinding.line} ${refactorFinding.what}`,
    verdict: 'survives',
    rationale: 'The confined refactor remains necessary.',
    evidence: [{ command: 'node --test', output: 'failure reproduced' }],
  };
  refactorFinding.refute = refute;
  return item4RepairTask({
    review: {
      ...base.review,
      findings: [...base.review.findings, refactorFinding],
    },
    refutes: [refute],
    kickbacks: [{
      ...base.kickbacks[0],
      findings: [
        item4TypedFinding('review'),
        item4TypedFinding('review', {
          file: 'src/core/invariants.js',
          line: 12,
          kickTo: 'refactor',
        }),
      ],
    }],
  });
}

/** @param {string[]} files */
function item4ImplementReturn(files) {
  return {
    agent_id: 'implementer-fresh',
    stage: 'implement',
    result: 'green',
    files,
    greenRun: { command: 'node --test', output: 'pass' },
    kickback: null,
  };
}

/** @param {string[]} files */
function item4RefactorReturn(files) {
  return {
    agent_id: 'refactorer-fresh',
    stage: 'refactor',
    result: 'clean',
    files,
    outsideDiff: [],
    greenRun: { command: 'node --test', output: 'pass' },
    summary: ['Applied the confined cleanup.'],
  };
}

/** @param {string} agentId @param {number} cycle */
function item4ReviewReturn(agentId, cycle) {
  return {
    agent_id: agentId,
    stage: 'review',
    cycle,
    verdict: 'pass',
    acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: true }],
    findings: [],
    evidence: [{ command: 'git diff --check', output: 'clean' }],
  };
}

/** @param {string} agentId @param {number} cycle */
function item4AuditReturn(agentId, cycle) {
  return {
    agent_id: agentId,
    stage: 'audit',
    cycle,
    verdict: 'pass',
    scan: { command: 'review-security --json', recommendation: 'PASS', reportPath: '/tmp/report.md' },
    coverage: auditCoverage(),
    findings: [],
    evidence: [{ command: 'review-security --json', output: 'no findings' }],
  };
}

/** @param {Record<string, any> & {agent_id: string}} value */
function item4ObservedReturn(value) {
  const { agent_id: agentId, ...result } = value;
  return observedReturn(agentId, result);
}

test('Item 4 targeted repair retains only independently passing judgments', async (t) => {
  await t.test('review-confined implement retains audit, resets both reviews, and completes after fresh reviews', () => {
    const task = item4RepairTask();
    const priorAudit = structuredClone(task.audit);
    const priorConvergence = structuredClone(task.convergence);

    const repaired = /** @type {Item4CodeTask} */ (recordCore.transitionTask(
      task,
      'implement',
      item4ImplementReturn(['src/core/record.js']),
    ));

    assert.equal(repaired.stage, 'review');
    assert.equal(repaired.review.verdict, null);
    assert.equal(repaired.review2, null);
    assert.equal(repaired.agents.reviewer_agent_id, null);
    assert.equal(repaired.agents.reviewer2_agent_id, null);
    assert.deepEqual(repaired.audit, priorAudit);
    assert.equal(repaired.agents.audit_agent_id, 'auditor-old');
    assert.deepEqual(repaired.convergence, priorConvergence);
    assert.equal(repaired.tests.green, false);
    assert.equal(Object.hasOwn(repaired.tests, 'gate'), false);

    assert.throws(
      () => recordCore.transitionTask(repaired, 'audit', item4AuditReturn('auditor-replay', 1)),
      /audit slot is already occupied/,
    );

    const firstReview = recordCore.transitionTask(
      repaired,
      'review',
      item4ReviewReturn('reviewer-fresh', 1),
    );
    const completed = recordCore.transitionTask(
      firstReview,
      'review',
      item4ReviewReturn('reviewer-two-fresh', 1),
    );
    assert.equal(completed.status, 'done');
    assert.equal(completed.stage, 'done');
    assert.deepEqual(completed.audit, priorAudit);
  });

  await t.test('audit-confined refactor retains both reviews, resets audit, and completes after a fresh audit', () => {
    const base = item4RepairTask();
    const task = item4RepairTask({
      stage: 'refactor',
      review: { ...base.review, verdict: 'pass', findings: [] },
      audit: {
        ...base.audit,
        verdict: 'needs-work',
        findings: [{ ...blockingFinding({ line: 22, what: 'audit found a confined blocker.' }), cwe: 'CWE-20' }],
      },
      kickbacks: [{
        from: 'audit',
        to: 'refactor',
        reason: 'audit found a confined blocker.',
        at: '2026-07-12T00:30:00Z',
        findings: [item4TypedFinding('audit', { kickTo: 'refactor' })],
      }],
    });
    const priorReview = structuredClone(task.review);
    const priorReview2 = structuredClone(task.review2);
    const priorConvergence = structuredClone(task.convergence);

    const repaired = /** @type {Item4CodeTask} */ (recordCore.transitionTask(
      task,
      'refactor',
      item4RefactorReturn(['src/core/record.js']),
    ));

    assert.equal(repaired.stage, 'audit');
    assert.deepEqual(repaired.review, priorReview);
    assert.deepEqual(repaired.review2, priorReview2);
    assert.equal(repaired.agents.reviewer_agent_id, 'reviewer-old');
    assert.equal(repaired.agents.reviewer2_agent_id, 'reviewer-two-old');
    assert.equal(repaired.audit.verdict, 'na');
    assert.equal(repaired.audit.audit_agent_id, null);
    assert.equal(repaired.agents.audit_agent_id, null);
    assert.deepEqual(repaired.convergence, priorConvergence);
    assert.equal(repaired.tests.green, false);
    assert.equal(Object.hasOwn(repaired.tests, 'gate'), false);

    assert.throws(
      () => recordCore.transitionTask(repaired, 'review', item4ReviewReturn('reviewer-replay', 1)),
      /both review slots are already occupied/,
    );

    const completed = recordCore.transitionTask(
      repaired,
      'audit',
      item4AuditReturn('auditor-fresh', 1),
    );
    assert.equal(completed.status, 'done');
    assert.equal(completed.stage, 'done');
    assert.deepEqual(completed.review, priorReview);
    assert.deepEqual(completed.review2, priorReview2);
  });

  await t.test('review and audit kickbacks in one round reset every raised source without changing counters', () => {
    const base = item4RepairTask();
    const task = item4RepairTask({
      audit: {
        ...base.audit,
        verdict: 'needs-work',
        findings: [{ ...blockingFinding({ line: 22, what: 'audit found a confined blocker.' }), cwe: 'CWE-20' }],
      },
      kickbacks: [
        ...base.kickbacks,
        {
          from: 'audit',
          to: 'implement',
          reason: 'audit found a confined blocker.',
          at: '2026-07-12T00:30:00Z',
          findings: [item4TypedFinding('audit')],
        },
      ],
    });
    const counters = structuredClone(task.convergence.stages);

    const repaired = /** @type {Item4CodeTask} */ (recordCore.transitionTask(
      task,
      'implement',
      item4ImplementReturn(['src/core/record.js']),
    ));

    assert.equal(repaired.review.verdict, null);
    assert.equal(repaired.review2, null);
    assert.equal(repaired.audit.verdict, 'na');
    assert.equal(repaired.audit.audit_agent_id, null);
    assert.deepEqual(repaired.convergence.stages, counters);
  });

  await t.test('mixed implement and refactor full-resets when the second stage exceeds the contract', () => {
    const task = item4MixedRepairTask();

    const implemented = /** @type {Item4CodeTask} */ (recordCore.transitionTask(
      task,
      'implement',
      item4ImplementReturn(['src/core/record.js']),
    ));
    assert.equal(implemented.stage, 'refactor');
    assert.equal(implemented.agents.audit_agent_id, 'auditor-old');

    const refactored = /** @type {Item4CodeTask} */ (recordCore.transitionTask(
      implemented,
      'refactor',
      item4RefactorReturn(['src/core/task-schema.js']),
    ));
    assert.equal(refactored.stage, 'review');
    assert.equal(refactored.review.verdict, null);
    assert.equal(refactored.review2, null);
    assert.equal(refactored.agents.reviewer_agent_id, null);
    assert.equal(refactored.agents.reviewer2_agent_id, null);
    assert.equal(refactored.audit.verdict, 'na');
    assert.equal(refactored.audit.audit_agent_id, null);
    assert.equal(refactored.agents.audit_agent_id, null);
  });
});

test('Item 4 authoritative full reset archives outcome-only code judgment identities', async () => {
  const base = item4RepairTask();
  const task = item4RepairTask({
    agents: {
      ...base.agents,
      reviewer_agent_id: null,
      audit_agent_id: null,
    },
    kickbacks: /** @type {any[]} */ (base.kickbacks).map(({ findings: _findings, ...kickback }) => kickback),
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    await recordSpecialistReturn(
      root,
      'implement',
      '18',
      item4ObservedReturn(item4ImplementReturn(['src/core/record.js'])),
    );
    const recorded = /** @type {Item4CodeTask} */ (await readTask(taskDir));
    const history = /** @type {any[]} */ (recorded.judgmentHistory);

    assert.equal(Object.hasOwn(recorded.kickbacks[0], 'findings'), false);
    assert.equal(history.length, 1);
    assert.equal(history[0].review.reviewer_agent_id, 'reviewer-old');
    assert.equal(history[0].agents.reviewer_agent_id, null);
    assert.equal(history[0].audit.audit_agent_id, 'auditor-old');
    assert.equal(history[0].agents.audit_agent_id, null);
    assert.equal(recorded.review.reviewer_agent_id, null);
    assert.equal(recorded.audit.audit_agent_id, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Item 4 authoritative mixed repair full-resets an unscoped owed refactor and completes fresh judgments', async (t) => {
  for (const [name, files] of /** @type {Array<[string, string[]]>} */ ([
    ['out-of-contract files', ['src/core/task-schema.js']],
    ['empty files', []],
  ])) await t.test(name, async () => {
    const { root, taskDir } = await makeRoot(item4MixedRepairTask());
    try {
      await recordSpecialistReturn(
        root,
        'implement',
        '18',
        item4ObservedReturn(item4ImplementReturn(['src/core/record.js'])),
      );
      const implemented = /** @type {Item4CodeTask} */ (await readTask(taskDir));
      assert.equal(implemented.stage, 'refactor');
      assert.equal(implemented.agents.audit_agent_id, 'auditor-old');

      await recordSpecialistReturn(
        root,
        'refactor',
        '18',
        item4ObservedReturn(item4RefactorReturn(files)),
      );
      const { stage: _stage, ...legacyRefactor } = item4RefactorReturn(files);
      const reset = /** @type {Item4CodeTask} */ (await readTask(taskDir));
      assert.equal(reset.stage, 'review');
      assert.equal(reset.judgmentHistory?.length, 2);
      assert.equal(reset.review.reviewer_agent_id, null);
      assert.equal(reset.audit.audit_agent_id, null);
      assert.equal(reset.agents.audit_agent_id, null);
      assert.deepEqual((/** @type {any} */ (reset)).refactor, legacyRefactor);

      await recordCurrentGate(root, taskDir);
      await recordSpecialistReturn(
        root,
        'review',
        '18',
        item4ObservedReturn(item4ReviewReturn('reviewer-fresh', 2)),
      );
      await recordSpecialistReturn(
        root,
        'review',
        '18',
        item4ObservedReturn(item4ReviewReturn('reviewer-two-fresh', 2)),
      );
      await recordSpecialistReturn(
        root,
        'audit',
        '18',
        item4ObservedReturn(item4AuditReturn('auditor-fresh', 2)),
      );
      const completed = await readTask(taskDir);
      assert.equal(completed.status, 'done');
      assert.equal(completed.stage, 'done');
      assert.equal(completed.judgmentHistory.length, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('Item 4 active kickback round survives a generated equal-second collision', (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-07-12T00:40:00Z'),
  });
  const firstRepair = /** @type {Item4CodeTask} */ (recordCore.transitionTask(
    item4RepairTask(),
    'implement',
    item4ImplementReturn(['src/core/record.js']),
  ));
  const finding = blockingFinding({
    line: 61,
    what: 'The second review found another confined blocker.',
  });
  const firstReview = recordCore.transitionTask(firstRepair, 'review', {
    ...item4ReviewReturn('reviewer-fresh', 1),
    verdict: 'needs-work',
    findings: [finding],
  });
  const secondReview = recordCore.transitionTask(
    firstReview,
    'review',
    item4ReviewReturn('reviewer-two-fresh', 1),
  );
  const refuted = recordCore.transitionTask(
    secondReview,
    'refute',
    {
      agent_id: 'review-refuter-fresh',
      stage: 'refute',
      cycle: 1,
      source: 'review',
      finding: `${finding.file}:${finding.line} ${finding.what}`,
      verdict: 'survives',
      rationale: 'The confined blocker remains observable.',
      evidence: [{ command: 'node --test', output: 'failure reproduced' }],
    },
  );

  const generatedKickback = refuted.kickbacks.at(-1);
  const generatedHistory = firstRepair.judgmentHistory?.at(-1);
  assert.ok(generatedKickback);
  assert.ok(generatedHistory);
  assert.equal(generatedKickback.at, generatedHistory.at);
  const secondRepair = /** @type {Item4CodeTask} */ (recordCore.transitionTask(
    refuted,
    'implement',
    item4ImplementReturn(['src/core/record.js']),
  ));
  assert.ok(secondRepair.judgmentHistory);
  assert.equal(secondRepair.judgmentHistory.length, 2);
  assert.equal(secondRepair.stage, 'review');
  assert.equal(secondRepair.review.verdict, null);
  assert.equal(secondRepair.review2, null);
  assert.equal(secondRepair.agents.reviewer_agent_id, null);
  assert.equal(secondRepair.agents.reviewer2_agent_id, null);
  assert.equal(secondRepair.agents.audit_agent_id, 'auditor-old');
});

test('Item 4 non-scoped repairs preserve full reset and unconditional gate invalidation', async (t) => {
  const base = item4RepairTask();
  const codeCases = [
    ['missing findings', /** @type {import('../core/types.js').Kickback[]} */ (base.kickbacks).map(({ findings: _findings, ...kickback }) => kickback), ['src/core/record.js']],
    ['empty findings', [{ ...base.kickbacks[0], findings: [] }], ['src/core/record.js']],
    ['file outside findings', base.kickbacks, ['src/core/task-schema.js']],
    ['empty repair files', base.kickbacks, []],
    ['capture destination', [{ ...base.kickbacks[0], findings: [item4TypedFinding('review', { kickTo: 'capture' })] }], ['src/core/record.js']],
    ['plan destination', [{ ...base.kickbacks[0], findings: [item4TypedFinding('review', { kickTo: 'plan' })] }], ['src/core/record.js']],
  ];

  for (const [name, kickbacks, files] of codeCases) await t.test(String(name), async () => {
    const result = item4ImplementReturn(/** @type {string[]} */ (files));
    const { stage: _stage, kickback: _kickback, ...legacyImplement } = result;
    const { root, taskDir } = await makeRoot(item4RepairTask({ kickbacks }));
    try {
      await recordSpecialistReturn(root, 'implement', '18', item4ObservedReturn(result));
      const repaired = /** @type {Item4CodeTask} */ (await readTask(taskDir));

      assert.deepEqual((/** @type {any} */ (repaired)).implement, legacyImplement);
      assert.equal(repaired.review.verdict, null);
      assert.equal(repaired.review2, null);
      assert.equal(repaired.audit.verdict, 'na');
      assert.equal(repaired.agents.audit_agent_id, null);
      assert.equal(repaired.tests.green, false);
      assert.equal(Object.hasOwn(repaired.tests, 'gate'), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  for (const [name, council] of [
    ['pending council', { ...base.convergence.council, stage: 'review' }],
    ['convened council', {
      ...base.convergence.council,
      convened: true,
      stage: 'review',
      verdict: 'block',
      outcome: null,
    }],
  ]) await t.test(name, () => {
    const task = item4RepairTask({
      convergence: {
        ...base.convergence,
        council,
      },
    });
    const repaired = /** @type {Item4CodeTask} */ (recordCore.transitionTask(
      task,
      'implement',
      item4ImplementReturn(['src/core/record.js']),
    ));
    assert.equal(repaired.review.verdict, null);
    assert.equal(repaired.review2, null);
    assert.equal(repaired.audit.verdict, 'na');
    assert.equal(repaired.agents.audit_agent_id, null);
  });

  await t.test('public council recovery preserves the legacy implement record', async (t) => {
    t.mock.timers.enable({
      apis: ['Date'],
      now: new Date('2026-07-12T02:00:00Z'),
    });
    const { root, taskDir } = await makeRoot(councilTask());
    const result = item4ImplementReturn(['src/core/record.js']);
    const { stage: _stage, kickback: _kickback, ...legacyImplement } = result;
    try {
      await recordSpecialistReturn(root, 'council', '18', councilReturn());
      await recordSpecialistReturn(root, 'implement', '18', item4ObservedReturn(result));
      const recorded = await readTask(taskDir);

      assert.deepEqual(recorded.implement, legacyImplement);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('refactor invalidates the full-suite gate even for a scoped candidate', () => {
    const task = item4RepairTask({
      stage: 'refactor',
      kickbacks: [{
        from: 'audit',
        to: 'refactor',
        reason: 'audit found a confined blocker.',
        at: '2026-07-12T00:30:00Z',
        findings: [item4TypedFinding('audit', { kickTo: 'refactor' })],
      }],
    });
    const repaired = /** @type {Item4CodeTask} */ (recordCore.transitionTask(
      task,
      'refactor',
      item4RefactorReturn(['src/core/record.js']),
    ));
    assert.equal(repaired.tests.green, false);
    assert.equal(Object.hasOwn(repaired.tests, 'gate'), false);
  });

  await t.test('operation category keeps its prior full judgment reset', () => {
    const task = operationTask({
      stage: 'execute',
      plan: operationPlanState(),
      agents: {
        executor_agent_id: 'executor-old',
        verifier_agent_id: 'verifier-old',
        audit_agent_id: 'auditor-old',
      },
      execution: {
        result: 'executed',
        executor_agent_id: 'executor-old',
        cycle: 0,
        recordedAt: '2026-07-12T00:20:00Z',
        actions: ['Applied the first operation.'],
        evidence: [{ command: 'inspect', output: 'changed' }],
        approvalRequired: null,
      },
      verification: {
        verdict: 'needs-work',
        verifier_agent_id: 'verifier-old',
        postconditions: [],
        findings: [],
        evidence: ['verification blocker'],
      },
      audit: {
        required: true,
        verdict: 'pass',
        audit_agent_id: 'auditor-old',
        findings: [],
        evidence: ['audit pass'],
      },
      kickbacks: [{
        from: 'verify',
        to: 'execute',
        reason: 'Operation verification failed.',
        at: '2026-07-12T00:30:00Z',
        findings: [item4TypedFinding('review')],
      }],
    });
    const repaired = /** @type {Item4OperationTask} */ (recordCore.transitionTask(task, 'execute', {
      agent_id: 'executor-fresh',
      stage: 'execute',
      result: 'executed',
      actions: ['Applied the operation repair.'],
      evidence: [{ command: 'inspect', output: 'repaired' }],
      kickback: null,
      approvalRequired: null,
    }));
    assert.equal(repaired.verification.verdict, null);
    assert.equal(repaired.verification.verifier_agent_id, null);
    assert.equal(repaired.audit.verdict, 'na');
    assert.equal(repaired.audit.audit_agent_id, null);
  });
});

test('Item 4 refute records exact typed blocker contracts and leaves council kickbacks unchanged', async (t) => {
  await t.test('ordinary review and audit kickbacks carry only the surviving typed blockers', () => {
    const reviewFinding = blockingFinding({ line: 31, what: 'Review blocker survives.' });
    const auditFinding = /** @type {Record<string, any>} */ ({
      ...blockingFinding({ line: 41, kickTo: 'refactor', what: 'Audit blocker survives.' }),
      cwe: 'CWE-400',
    });
    const task = canonicalTask({
      stage: 'review',
      agents: {
        implementer_agent_id: 'implementer',
        reviewer_agent_id: 'reviewer',
        reviewer2_agent_id: null,
        audit_agent_id: 'auditor',
      },
      review: {
        verdict: 'needs-work',
        reviewer_agent_id: 'reviewer',
        findings: [reviewFinding],
        evidence: ['review blocker'],
      },
      audit: {
        required: true,
        verdict: 'needs-work',
        audit_agent_id: 'auditor',
        findings: [auditFinding],
        evidence: ['audit blocker'],
      },
    });
    const afterReview = recordCore.transitionTask(task, 'refute', {
      agent_id: 'review-refuter',
      stage: 'refute',
      cycle: 0,
      finding: `${reviewFinding.file}:${reviewFinding.line} ${reviewFinding.what}`,
      verdict: 'survives',
      rationale: 'The review blocker is observable.',
      evidence: [{ command: 'node --test', output: 'review failure' }],
    });
    const recorded = /** @type {Item4CodeTask} */ (recordCore.transitionTask(afterReview, 'refute', {
      agent_id: 'audit-refuter',
      stage: 'refute',
      cycle: 0,
      finding: `${auditFinding.file}:${auditFinding.line} ${auditFinding.what}`,
      verdict: 'survives',
      rationale: 'The audit blocker is observable.',
      evidence: [{ command: 'node --test', output: 'audit failure' }],
    }));

    assert.deepEqual(
      recorded.kickbacks.map(({ from, to, findings }) => ({ from, to, findings })),
      [
        {
          from: 'review',
          to: 'implement',
          findings: [{
            source: 'review',
            file: reviewFinding.file,
            line: reviewFinding.line,
            what: reviewFinding.what,
            kickTo: reviewFinding.kickTo,
          }],
        },
        {
          from: 'audit',
          to: 'refactor',
          findings: [{
            source: 'audit',
            file: auditFinding.file,
            line: auditFinding.line,
            what: auditFinding.what,
            kickTo: auditFinding.kickTo,
          }],
        },
      ],
    );
    assert.equal(recorded.convergence.stages.review.blockingKickbacks, 1);
    assert.equal(recorded.convergence.stages.audit.blockingKickbacks, 1);
  });

  await t.test('source-bound review2 plan blocker persists the first typed kickback with an empty historical ledger', async () => {
    const finding = blockingFinding({
      line: 51,
      kickTo: 'plan',
      what: 'The Item 4 test contract excludes a code destination.',
    });
    const { root, taskDir } = await makeRoot(canonicalTask({
      stage: 'review',
      agents: {
        implementer_agent_id: 'implementer',
        reviewer_agent_id: 'reviewer',
        reviewer2_agent_id: 'reviewer-two',
        audit_agent_id: null,
      },
      tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
      judgmentHistory: [],
      review: {
        verdict: 'pass',
        reviewer_agent_id: 'reviewer',
        findings: [],
        evidence: ['review passed'],
      },
      review2: {
        verdict: 'needs-work',
        reviewer_agent_id: 'reviewer-two',
        findings: [finding],
        evidence: ['review two blocker'],
      },
    }));
    try {
      await recordSpecialistReturn(
        root,
        'refute',
        '18',
        refuteReturn('review-two-refuter', finding, { source: 'review2' }),
      );
      const recorded = /** @type {Item4CodeTask} */ (await readTask(taskDir));

      assert.equal(recorded.stage, 'plan');
      assert.deepEqual(
        recorded.kickbacks.map(({ from, to, findings }) => ({ from, to, findings })),
        [{
          from: 'review',
          to: 'plan',
          findings: [{
            source: 'review2',
            file: finding.file,
            line: finding.line,
            what: finding.what,
            kickTo: finding.kickTo,
          }],
        }],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('council block kickback has the unchanged untyped shape', () => {
    const councilResult = councilReturn();
    const recorded = /** @type {Item4CodeTask} */ (recordCore.transitionTask(councilTask(), 'council', {
      ...councilResult,
      council: {
        ...councilResult.council,
        synthesizer_agent_id: COUNCIL_SYNTHESIZER_AGENT_ID,
      },
    }));
    const kickback = /** @type {import('../core/types.js').Kickback} */ (recorded.kickbacks.at(-1));
    assert.deepEqual(Object.keys(kickback).sort(), ['at', 'from', 'reason', 'to']);
    assert.deepEqual(
      { from: kickback.from, to: kickback.to, reason: kickback.reason },
      {
        from: 'review',
        to: 'implement',
        reason: 'Council block: The recording path loses a result.',
      },
    );
  });
});


test('Item 4 council recovery preserves builder outcomes for non-scoped public refutes', async (t) => {
  for (const destination of /** @type {const} */ (['capture', 'plan'])) {
    await t.test(destination, async () => {
      const finding = blockingFinding({
        line: destination === 'capture' ? 71 : 72,
        kickTo: destination,
        what: `${destination} requires non-scoped recovery.`,
      });
      const implement = {
        agent_id: 'implementer-old',
        result: 'green',
        files: ['src/core/record.js'],
        greenRun: { command: 'node --test', output: 'pass' },
      };
      const refactor = {
        agent_id: 'refactorer-old',
        result: 'clean',
        files: [],
        outsideDiff: [],
        greenRun: { command: 'node --test', output: 'pass' },
        summary: ['Kept behavior unchanged.'],
      };
      const task = canonicalTask({
        stage: 'review',
        agents: {
          implementer_agent_id: implement.agent_id,
          reviewer_agent_id: 'reviewer-old',
          reviewer2_agent_id: null,
          audit_agent_id: null,
        },
        implement,
        refactor,
        review: {
          verdict: 'needs-work',
          reviewer_agent_id: 'reviewer-old',
          findings: [finding],
          evidence: ['non-scoped blocker'],
        },
      });
      const { root, taskDir } = await makeRoot(task);
      try {
        const recorded = await recordSpecialistReturn(
          root,
          'refute',
          '18',
          refuteReturn(`${destination}-refuter`, finding, { source: 'review' }),
        );
        const persisted = await readTask(taskDir);

        assert.deepEqual(
          {
            returned: { implement: recorded.implement, refactor: recorded.refactor },
            persisted: { implement: persisted.implement, refactor: persisted.refactor },
          },
          {
            returned: { implement, refactor },
            persisted: { implement, refactor },
          },
        );
        assert.equal(recorded.stage, destination);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('Item 4 council recovery completes scoped retained audit through the public recorder', async () => {
  const task = item4RepairTask();
  const priorAudit = structuredClone(task.audit);
  const { root, taskDir } = await makeRoot(task);
  try {
    await recordSpecialistReturn(
      root,
      'implement',
      '18',
      item4ObservedReturn(item4ImplementReturn(['src/core/record.js'])),
    );
    const repaired = await readTask(taskDir);
    assert.equal(repaired.stage, 'review');
    assert.equal(repaired.judgmentHistory.length, 1);
    assert.deepEqual(repaired.audit, priorAudit);

    await recordCurrentGate(root, taskDir);
    await recordSpecialistReturn(
      root,
      'review',
      '18',
      item4ObservedReturn(item4ReviewReturn('reviewer-fresh', 1)),
    );
    await recordSpecialistReturn(
      root,
      'review',
      '18',
      item4ObservedReturn(item4ReviewReturn('reviewer-two-fresh', 1)),
    );
    const completed = await readTask(taskDir);

    assert.equal(completed.status, 'done');
    assert.equal(completed.stage, 'done');
    assert.deepEqual(completed.audit, priorAudit);
    assert.equal(completed.tests.gate.clean, true);
    assert.equal(completed.tests.gate.green, true);
    assert.equal(completed.tests.gate.hash, runGit(root, ['rev-parse', 'HEAD']));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Item 4 scoped retention survives fresh capture and plan kickbacks until the later full reset', async (t) => {
  for (const destination of /** @type {const} */ (['capture', 'plan'])) {
    await t.test(destination, async (t) => {
      t.mock.timers.enable({
        apis: ['Date'],
        now: new Date('2026-07-12T02:00:00Z'),
      });
      const finding = blockingFinding({
        line: destination === 'capture' ? 81 : 82,
        kickTo: destination,
        what: `Fresh review requires ${destination}.`,
      });
      const { root, taskDir } = await makeRoot(item4RepairTask());
      try {
        await recordSpecialistReturn(
          root,
          'implement',
          '18',
          item4ObservedReturn(item4ImplementReturn(['src/core/record.js'])),
        );
        await recordSpecialistReturn(
          root,
          'review',
          '18',
          item4ObservedReturn({
            ...item4ReviewReturn('reviewer-fresh', 1),
            verdict: 'needs-work',
            findings: [finding],
          }),
        );
        await recordSpecialistReturn(
          root,
          'review',
          '18',
          item4ObservedReturn(item4ReviewReturn('reviewer-two-fresh', 1)),
        );
        await recordSpecialistReturn(
          root,
          'refute',
          '18',
          refuteReturn(`${destination}-refuter`, finding, {
            cycle: 1,
            source: 'review',
          }),
        );

        const kicked = await readTask(taskDir);
        assert.equal(kicked.stage, destination);
        assert.equal(kicked.agents.audit_agent_id, 'auditor-old');
        assert.deepEqual(kicked.kickbacks.at(-1).findings, [{
          source: 'review',
          file: finding.file,
          line: finding.line,
          what: finding.what,
          kickTo: destination,
        }]);

        if (destination === 'capture') {
          kicked.stage = 'plan';
          await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(kicked, null, 2)}\n`, 'utf8');
        }
        await recordSpecialistReturn(root, 'plan', '18', planReturn({}, `${destination}-planner`));
        await recordSpecialistReturn(
          root,
          'implement',
          '18',
          item4ObservedReturn(item4ImplementReturn(['src/core/record.js'])),
        );
        const reset = await readTask(taskDir);

        assert.equal(reset.stage, 'review');
        assert.equal(reset.judgmentHistory.length, 2);
        assert.equal(reset.review.reviewer_agent_id, null);
        assert.equal(reset.review2, null);
        assert.equal(reset.audit.audit_agent_id, null);
        assert.equal(reset.agents.audit_agent_id, null);
        assert.deepEqual(reset.kickbacks.at(-1).findings, kicked.kickbacks.at(-1).findings);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('Item 4 public mixed repair retains the passing sibling when both stages stay confined', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-07-12T02:00:00Z'),
  });
  const { root, taskDir } = await makeRoot(item4MixedRepairTask());
  try {
    await recordSpecialistReturn(
      root,
      'implement',
      '18',
      item4ObservedReturn(item4ImplementReturn(['src/core/record.js'])),
    );
    const implemented = await readTask(taskDir);
    assert.equal(implemented.stage, 'refactor');
    assert.equal(implemented.judgmentHistory.length, 1);
    assert.equal(implemented.agents.audit_agent_id, 'auditor-old');

    await recordSpecialistReturn(
      root,
      'refactor',
      '18',
      item4ObservedReturn(item4RefactorReturn(['src/core/invariants.js'])),
    );
    const refactored = await readTask(taskDir);

    assert.equal(refactored.stage, 'review');
    assert.equal(refactored.judgmentHistory.length, 1);
    assert.equal(refactored.audit.verdict, 'pass');
    assert.equal(refactored.audit.audit_agent_id, 'auditor-old');
    assert.equal(refactored.agents.audit_agent_id, 'auditor-old');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Item 4 fresh typed repair round accepts fresh judgment identities after a prior full reset', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-07-12T03:00:00Z'),
  });
  const base = item4RepairTask();
  const firstRound = item4RepairTask({
    kickbacks: /** @type {any[]} */ (base.kickbacks).map(({ findings: _findings, ...kickback }) => kickback),
  });
  const finding = blockingFinding({
    line: 91,
    what: 'Fresh review found a new confined blocker.',
  });
  const { root, taskDir } = await makeRoot(firstRound);
  try {
    await recordSpecialistReturn(
      root,
      'implement',
      '18',
      item4ObservedReturn(item4ImplementReturn(['src/core/record.js'])),
    );
    await recordCurrentGate(root, taskDir);
    await recordSpecialistReturn(
      root,
      'review',
      '18',
      item4ObservedReturn({
        ...item4ReviewReturn('reviewer-fresh', 1),
        verdict: 'needs-work',
        findings: [finding],
      }),
    );
    await recordSpecialistReturn(
      root,
      'review',
      '18',
      item4ObservedReturn(item4ReviewReturn('reviewer-two-fresh', 1)),
    );
    await recordSpecialistReturn(
      root,
      'audit',
      '18',
      item4ObservedReturn(item4AuditReturn('auditor-fresh', 1)),
    );
    await recordSpecialistReturn(
      root,
      'refute',
      '18',
      refuteReturn('review-refuter-fresh', finding, {
        cycle: 1,
        source: 'review',
      }),
    );
    const recorded = await readTask(taskDir);

    assert.equal(recorded.stage, 'implement');
    assert.equal(recorded.judgmentHistory.length, 1);
    assert.equal(recorded.judgmentHistory[0].audit.audit_agent_id, 'auditor-old');
    assert.equal(recorded.review.reviewer_agent_id, 'reviewer-fresh');
    assert.equal(recorded.review2.reviewer_agent_id, 'reviewer-two-fresh');
    assert.equal(recorded.audit.audit_agent_id, 'auditor-fresh');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Item 4 council recovery permits second scoped repair before council at equal and later clocks', async (t) => {
  for (const [name, later] of /** @type {Array<[string, boolean]>} */ ([
    ['equal-second', false],
    ['later-second', true],
  ])) {
    await t.test(name, async (t) => {
      const base = item4RepairTask();
      // The fixture's seeded round already spent one of the two allowed
      // kickbacks, so exactly one more scoped repair fits before the cap and
      // the round after it arms the council.
      const task = item4RepairTask({
        convergence: {
          ...base.convergence,
          cap: 2,
        },
      });
      const { root, taskDir } = await makeRoot(task);
      t.mock.timers.enable({
        apis: ['Date'],
        now: new Date('2026-07-12T02:00:00Z'),
      });
      try {
        await recordSpecialistReturn(
          root,
          'implement',
          '18',
          item4ObservedReturn({
            ...item4ImplementReturn(['src/core/record.js']),
            agent_id: 'implementer-first',
          }),
        );
        const firstRepair = await readTask(taskDir);
        assert.equal(firstRepair.agents.audit_agent_id, 'auditor-old');
        assert.equal(firstRepair.judgmentHistory.length, 1);

        const secondBlocker = blockingFinding({
          line: 61,
          what: 'The second review found another confined blocker.',
        });
        await recordSpecialistReturn(
          root,
          'review',
          '18',
          item4ObservedReturn({
            ...item4ReviewReturn('reviewer-fresh', 1),
            verdict: 'needs-work',
            findings: [secondBlocker],
          }),
        );
        await recordSpecialistReturn(
          root,
          'review',
          '18',
          item4ObservedReturn(item4ReviewReturn('reviewer-two-fresh', 1)),
        );
        if (later) t.mock.timers.tick(1_000);

        await recordSpecialistReturn(
          root,
          'refute',
          '18',
          refuteReturn('review-refuter-second', secondBlocker, {
            cycle: 1,
            source: 'review',
          }),
        );
        const secondKickback = await readTask(taskDir);
        assert.equal(secondKickback.stage, 'implement');
        assert.equal(secondKickback.kickbacks.length, 2);
        assert.equal(secondKickback.agents.audit_agent_id, 'auditor-old');

        await recordSpecialistReturn(
          root,
          'implement',
          '18',
          item4ObservedReturn({
            ...item4ImplementReturn(['src/core/record.js']),
            agent_id: 'implementer-second',
          }),
        );
        const secondRepair = await readTask(taskDir);
        assert.equal(secondRepair.stage, 'review');
        assert.equal(secondRepair.judgmentHistory.length, 2);
        assert.equal(secondRepair.agents.audit_agent_id, 'auditor-old');

        const councilBlocker = blockingFinding();
        await recordSpecialistReturn(
          root,
          'review',
          '18',
          item4ObservedReturn({
            ...item4ReviewReturn('reviewer-third', 2),
            verdict: 'needs-work',
            findings: [councilBlocker],
          }),
        );
        await recordSpecialistReturn(
          root,
          'review',
          '18',
          item4ObservedReturn(item4ReviewReturn('reviewer-fourth', 2)),
        );
        await recordSpecialistReturn(
          root,
          'refute',
          '18',
          refuteReturn('review-refuter-third', councilBlocker, {
            cycle: 2,
            source: 'review',
          }),
        );
        const awaitingCouncil = await readTask(taskDir);
        assert.equal(awaitingCouncil.stage, 'review');
        assert.equal(awaitingCouncil.convergence.council.stage, 'review');

        await recordSpecialistReturn(root, 'council', '18', councilReturn());
        const escalated = await readTask(taskDir);
        assert.equal(escalated.stage, 'implement');
        assert.equal(escalated.convergence.council.convened, true);
        assert.equal(escalated.convergence.council.verdict, 'block');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

/**
 * Item 5: a source that has reached the cap buys one convergent bonus cycle
 * before the council arms, and only on recorded evidence: an unspent bonus, a
 * fully confined surviving round, and a strictly smaller surviving-blocker
 * count than the last recorded kickback from that source.
 *
 * @param {number | null} count - null records a historical kickback with no findings
 * @returns {Record<string, any>}
 */
function item5PriorReviewKickback(count) {
  const kickback = {
    from: 'review',
    to: 'implement',
    reason: 'Confined review blockers survived.',
    at: '2026-07-12T00:30:00Z',
  };
  if (count === null) return kickback;
  return {
    ...kickback,
    findings: Array.from({ length: count }, (_, index) => (
      item4TypedFinding('review', { line: 200 + index, what: `review blocker ${index}.` })
    )),
  };
}

/**
 * @param {Record<string, any>[]} kickbacks
 * @param {Record<string, any>[]} findings
 * @param {Record<string, any>} [reviewCounter]
 * @returns {any}
 */
function item5CappedReviewTask(kickbacks, findings, reviewCounter = {}) {
  return canonicalTask({
    stage: 'review',
    agents: {
      implementer_agent_id: 'implementer',
      reviewer_agent_id: 'reviewer',
      reviewer2_agent_id: null,
      audit_agent_id: null,
    },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
    review: {
      verdict: 'needs-work',
      reviewer_agent_id: 'reviewer',
      findings,
      evidence: [{ command: 'git diff --check', output: 'review blockers' }],
    },
    kickbacks,
    convergence: {
      cap: 2,
      stages: {
        review: { blockingKickbacks: 2, ...reviewCounter },
        audit: { blockingKickbacks: 0 },
      },
      council: { convened: false, stage: null, members: [], findings: [], verdict: null, outcome: null },
    },
  });
}

/** @param {any} task @param {Record<string, any>[]} findings @returns {any} */
function item5RefuteRound(task, findings) {
  return findings.reduce((/** @type {any} */ current, finding, index) => recordCore.transitionTask(current, 'refute', {
    agent_id: `item5-refuter-${index}`,
    stage: 'refute',
    cycle: 0,
    finding: `${finding.file}:${finding.line} ${finding.what}`,
    verdict: 'survives',
    rationale: 'The blocker is reachable on a supported input.',
    evidence: [{ command: 'node --test src/cli/record.test.js', output: 'failure reproduced' }],
  }), task);
}

test('Item 5 a capped source spends one bonus cycle on shrinking confined evidence', async (t) => {
  await t.test('eligible round appends the ordinary kickback and leaves the council unarmed', () => {
    const survivor = blockingFinding({ line: 210, what: 'The last confined blocker survives.' });
    const recorded = item5RefuteRound(
      item5CappedReviewTask(
        [item5PriorReviewKickback(3), item5PriorReviewKickback(2)],
        [survivor],
      ),
      [survivor],
    );

    assert.equal(recorded.convergence.stages.review.bonusGranted, true);
    assert.equal(recorded.convergence.stages.review.blockingKickbacks, 2);
    assert.equal(recorded.convergence.stages.audit.blockingKickbacks, 0);
    assert.equal(recorded.convergence.council.stage, null);
    assert.equal(recorded.convergence.council.convened, false);
    assert.equal(recorded.kickbacks.length, 3);
    const { from, to, findings } = recorded.kickbacks.at(-1);
    assert.deepEqual({ from, to, findings }, {
      from: 'review',
      to: 'implement',
      findings: [{
        source: 'review',
        file: survivor.file,
        line: survivor.line,
        what: survivor.what,
        kickTo: survivor.kickTo,
      }],
    });
    assert.equal(recorded.stage, 'implement');
    assert.equal(recorded.status, 'in_progress');
  });

  /** @type {Array<[string, any, Record<string, any>[]]>} */
  const councilCases = [
    [
      'a spent bonus convenes the council unconditionally',
      item5CappedReviewTask(
        [item5PriorReviewKickback(3), item5PriorReviewKickback(2)],
        [blockingFinding({ line: 211, what: 'The next confined blocker survives.' })],
        { bonusGranted: true },
      ),
      [blockingFinding({ line: 211, what: 'The next confined blocker survives.' })],
    ],
    [
      'a non-shrinking surviving round convenes the council',
      item5CappedReviewTask(
        [item5PriorReviewKickback(3), item5PriorReviewKickback(1)],
        [blockingFinding({ line: 212, what: 'The same-size blocker survives.' })],
      ),
      [blockingFinding({ line: 212, what: 'The same-size blocker survives.' })],
    ],
    [
      'an unconfined surviving blocker convenes the council',
      item5CappedReviewTask(
        [item5PriorReviewKickback(3), item5PriorReviewKickback(3)],
        [
          blockingFinding({ line: 213, what: 'The confined blocker survives.' }),
          blockingFinding({ line: 214, kickTo: 'plan', what: 'The unconfined blocker survives.' }),
        ],
      ),
      [
        blockingFinding({ line: 213, what: 'The confined blocker survives.' }),
        blockingFinding({ line: 214, kickTo: 'plan', what: 'The unconfined blocker survives.' }),
      ],
    ],
    [
      'a historical kickback without findings convenes the council',
      item5CappedReviewTask(
        [item5PriorReviewKickback(3), item5PriorReviewKickback(null)],
        [blockingFinding({ line: 215, what: 'The untyped predecessor blocker survives.' })],
      ),
      [blockingFinding({ line: 215, what: 'The untyped predecessor blocker survives.' })],
    ],
  ];

  for (const [name, task, findings] of councilCases) await t.test(name, () => {
    const before = task.kickbacks.length;
    const recorded = item5RefuteRound(task, findings);

    assert.equal(recorded.convergence.council.stage, 'review');
    assert.equal(recorded.convergence.council.convened, false);
    assert.equal(recorded.convergence.stages.review.blockingKickbacks, 2);
    assert.equal(recorded.kickbacks.length, before);
    assert.equal(
      recorded.convergence.stages.review.bonusGranted,
      task.convergence.stages.review.bonusGranted,
    );
  });
});

test('required vacant legacy audit is canonicalized when a plan repair archives judgments', async (t) => {
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-08-05T15:00:00Z'),
  });
  const finding = blockingFinding({
    kickTo: 'plan',
    what: 'The plan-owned checked-JS contract remains invalid.',
  });
  const task = canonicalTask({
    stage: 'review',
    agents: {
      implementer_agent_id: 'implementer-old',
      reviewer_agent_id: 'reviewer-old',
      reviewer2_agent_id: null,
      audit_agent_id: null,
    },
    tests: { authored_by_agent_id: 'plan-agent-old', green: true, evidence: ['gate'] },
    review: {
      verdict: 'needs-work',
      reviewer_agent_id: 'reviewer-old',
      findings: [finding],
      evidence: ['checked-JS failure'],
    },
    audit: { required: true, verdict: 'na', audit_agent_id: null, evidence: [] },
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    const refuted = await recordSpecialistReturn(
      root,
      'refute',
      '18',
      refuteReturn('review-refuter', finding, { source: 'review' }),
    );
    assert.equal(refuted.stage, 'plan');
    await recordSpecialistReturn(root, 'plan', '18', planReturn({}, 'repair-plan-agent'));

    const repaired = await recordSpecialistReturn(
      root,
      'implement',
      '18',
      implementReturn('repair-implementer'),
    );

    assert.equal(repaired.stage, 'review');
    assert.deepEqual(repaired.judgmentHistory[0].audit, {
      required: true,
      verdict: 'na',
      audit_agent_id: null,
      findings: [],
      evidence: [],
    });
    assert.equal((await readTask(taskDir)).stage, 'review');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** @param {string} strategy @param {any} [result] */
function issue237CouncilReturn(strategy, result = councilReturn()) {
  const selected = structuredClone(result);
  selected.council.synthesis.selectedStrategy = strategy;
  if (!selected.council.synthesis.solutionStrategies.includes(strategy)) {
    selected.council.synthesis.solutionStrategies.push(strategy);
  }
  selected.council.synthesis.rejectedAlternatives =
    selected.council.synthesis.solutionStrategies.filter((route) => route !== strategy);
  return selected;
}

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
function issue238ResearchCollectionVariant(field, variant) {
  const task = councilTask();
  const result = councilReturn();
  const findingIds = field === 'findingVotes' ? ['F1', 'F2', 'F3'] : ['F1'];

  if (findingIds.length > 1) {
    const originalFinding = task.review.findings[0];
    const findings = [
      originalFinding,
      ...findingIds.slice(1).map((id, index) => {
        const line = 11 + index;
        const what = `The recorder loses accepted result ${id}.`;
        return {
          ...structuredClone(originalFinding),
          line,
          what,
          why: 'The same recorder boundary loses independently accepted evidence.',
          refute: {
            ...structuredClone(originalFinding.refute),
            agent_id: `${id.toLowerCase()}-refuter`,
            finding: `src/core/record.js:${line} ${what}`,
          },
        };
      }),
    ];
    task.review.findings = findings;
    task.refutes = findings.map((finding) => finding.refute);
    result.council.findings = findings.map((finding, index) => ({
      id: findingIds[index],
      summary: finding.what,
      source: 'review',
      blockingVotes: 3,
      survived: true,
      followupTaskId: null,
    }));
    result.council.synthesis.survivingBlockers = findingIds;
  } else {
    result.council.findings[0].blockingVotes = 3;
  }

  const values = field === 'findingVotes'
    ? findingIds.map((id) => ({ id, blocking: true, rationale: `Evidence for ${id}.` }))
    : field === 'solutionStrategies'
      ? ['confined-repair', 'causal-subgraph-reconstruction', 'full-replan']
      : [`${field} alpha`, `${field} beta`, `${field} gamma`];
  const collections = variant === 'order'
    ? [values, [values[1], values[2], values[0]], [values[2], values[0], values[1]]]
    : [values, [values[0], ...values], [...values, values[2]]];
  const inquiry = structuredClone(result.council.members[0].inquiry);
  result.council.members = result.council.members.map((member, index) => ({
    ...member,
    inquiry: {
      ...structuredClone(inquiry),
      [field]: structuredClone(collections[index]),
    },
  }));
  return { task, result };
}

const ISSUE_237_BASELINE_GATE = {
  hash: 'pre-council-checkpoint',
  clean: true,
  green: true,
  command: 'node --test',
  at: '2026-07-12T00:30:00Z',
};

test('issue 237 council selects every bounded code recovery route without leaving the stage machine', async (t) => {
  const cases = [
    ['confined-repair', 'implement', 'in_progress', null],
    ['test-contract-repair', 'plan', 'in_progress', null],
    ['refactor', 'refactor', 'in_progress', null],
    ['causal-subgraph-reconstruction', 'plan', 'in_progress', null],
    ['full-replan', 'plan', 'in_progress', null],
    ['operator-escalation', 'review', 'blocked', 'blocked-to-operator'],
  ];

  for (const [strategy, expectedStage, expectedStatus, expectedOutcome] of cases) {
    await t.test(strategy, async () => {
      const { root, taskDir } = await makeRoot(councilTask({
        tests: {
          authored_by_agent_id: 'original-test-author',
          green: true,
          evidence: [{ command: 'node --test', output: 'green' }],
          gate: ISSUE_237_BASELINE_GATE,
        },
      }));
      const baselineGate = (await readTask(taskDir)).tests.gate;
      try {
        await recordSpecialistReturn(root, 'council', '18', issue237CouncilReturn(strategy));
        const recorded = await readTask(taskDir);
        assert.equal(recorded.stage, expectedStage);
        assert.equal(recorded.status, expectedStatus);
        assert.equal(recorded.convergence.council.outcome, expectedOutcome);
        assert.equal(recorded.convergence.council.synthesizer_agent_id, 'council-synthesizer');
        assert.equal(recorded.convergence.recovery.episode, 1);
        assert.equal(recorded.convergence.recovery.route, strategy);
        assert.deepEqual(recorded.convergence.recovery.baselineGate, baselineGate);
        assert.equal(recorded.convergence.recovery.test_author_agent_id, null);
        assert.equal(recorded.convergence.recovery.builder_agent_id, null);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  await t.test('mixed proof and production findings can select causal reconstruction', async () => {
    const task = mixedStageCouncilTask();
    task.audit.findings[0].kickTo = 'plan';
    task.tests = {
      authored_by_agent_id: 'original-test-author',
      green: true,
      evidence: [{ command: 'node --test', output: 'green' }],
      gate: ISSUE_237_BASELINE_GATE,
    };
    const { root, taskDir } = await makeRoot(task);
    try {
      await recordSpecialistReturn(root, 'council', '18', mixedStageCouncilReturn());
      const recorded = await readTask(taskDir);
      assert.equal(recorded.stage, 'plan');
      assert.equal(recorded.convergence.recovery.route, 'causal-subgraph-reconstruction');
      assert.deepEqual(recorded.convergence.council.synthesis.survivingBlockers, ['F1', 'F2']);
      assert.equal(recorded.review.findings[0].kickTo, 'implement');
      assert.equal(recorded.audit.findings[0].kickTo, 'plan');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 237 test-only and refactor recovery keep author builder and judge identities distinct', async (t) => {
  await t.test('test-contract repair proceeds from fresh authorship directly to the gate-facing review stage', async () => {
    const { root, taskDir } = await makeRoot(councilTask());
    try {
      await writeFile(join(root, '.jeff', 'profile.md'), 'Test command: `true`\n', 'utf8');
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-qm', 'add test profile']);
      await recordSpecialistReturn(
        root,
        'council',
        '18',
        issue237CouncilReturn('test-contract-repair'),
      );
      await recordSpecialistReturn(
        root,
        'plan',
        '18',
        planReturn({ complexity: 'complex', auditRequired: true }, 'recovery-test-author'),
      );

      const planned = await readTask(taskDir);
      assert.equal(planned.stage, 'review');
      assert.equal(planned.agents.implementer_agent_id, 'implementer');
      assert.equal(planned.implement.agent_id, 'implementer');
      assert.equal(planned.convergence.recovery.test_author_agent_id, 'recovery-test-author');
      assert.equal(planned.convergence.recovery.builder_agent_id, null);
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-qm', 'record test-only recovery']);
      const verification = await runVerify(root, '18');
      assert.equal(verification.code, 0, verification.stderr.join('\n'));

      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordSpecialistReturn(
          root,
          'review',
          '18',
          reviewReturn('recovery-test-author', { cycle: 1 }),
        ),
        /record-identity.*test author/i,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('direct refactor recovery records its builder and rejects that identity as a judge', async () => {
    const { root, taskDir } = await makeRoot(councilTask());
    try {
      await writeFile(join(root, '.jeff', 'profile.md'), 'Test command: `true`\n', 'utf8');
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-qm', 'add test profile']);
      await recordSpecialistReturn(root, 'council', '18', issue237CouncilReturn('refactor'));
      await recordSpecialistReturn(root, 'refactor', '18', observedReturn('recovery-refactorer', {
        stage: 'refactor',
        result: 'refactored',
        files: ['src/core/record.js'],
        outsideDiff: [],
        greenRun: { command: 'node --test src/cli/record.test.js', output: 'pass' },
        summary: ['Harmonized the recovery transition.'],
      }));

      const refactored = await readTask(taskDir);
      assert.equal(refactored.stage, 'review');
      assert.equal(refactored.convergence.recovery.builder_agent_id, 'recovery-refactorer');
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-qm', 'record refactor recovery']);
      const verification = await runVerify(root, '18');
      assert.equal(verification.code, 0, verification.stderr.join('\n'));

      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordSpecialistReturn(
          root,
          'review',
          '18',
          reviewReturn('recovery-refactorer', { cycle: 1 }),
        ),
        /record-identity.*recovery builder/i,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 237 recovery survives resume and exhausts exactly once after a fresh failed judgment', async () => {
  const { root, taskDir } = await makeRoot(councilTask({
    tests: {
      authored_by_agent_id: 'original-test-author',
      green: true,
      evidence: [{ command: 'node --test', output: 'green' }],
      gate: ISSUE_237_BASELINE_GATE,
    },
  }));
  const baselineGate = (await readTask(taskDir)).tests.gate;
  try {
    await writeFile(join(root, '.jeff', 'profile.md'), 'Test command: `true`\n', 'utf8');
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'add test profile']);
    await recordSpecialistReturn(root, 'council', '18', issue237CouncilReturn('full-replan'));
    assert.equal((await readTask(taskDir)).stage, 'plan');

    await recordSpecialistReturn(
      root,
      'plan',
      '18',
      planReturn({ complexity: 'complex', auditRequired: true }, 'recovery-plan-author'),
    );
    await recordSpecialistReturn(root, 'implement', '18', implementReturn('recovery-implementer'));
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'record recovery']);
    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    const recoveryCycle = (await readTask(taskDir)).judgmentHistory.length;

    const finding = blockingFinding({
      what: 'The replanned recovery still loses accepted evidence.',
      why: 'The fresh implementation reproduces the same consumer-visible loss.',
    });
    await recordSpecialistReturn(root, 'review', '18', reviewReturn('recovery-reviewer-one', {
      cycle: recoveryCycle,
      verdict: 'needs-work',
      acLedger: [{ ac: 'AC recovery', claimed: 'write', rederived: 'write', ok: false }],
      findings: [finding],
      evidence: [{ command: 'node --test', output: 'recovery failure reproduced' }],
    }));
    await recordSpecialistReturn(
      root,
      'review',
      '18',
      reviewReturn('recovery-reviewer-two', { cycle: recoveryCycle }),
    );
    await recordSpecialistReturn(root, 'audit', '18', auditReturn('recovery-auditor', { cycle: recoveryCycle }));
    await recordSpecialistReturn(
      root,
      'refute',
      '18',
      refuteReturn('recovery-refuter', finding, { cycle: recoveryCycle, source: 'review' }),
    );

    const exhausted = await readTask(taskDir);
    assert.equal(exhausted.status, 'blocked');
    assert.equal(exhausted.convergence.council.outcome, 'blocked-to-operator');
    assert.equal(exhausted.convergence.recovery.episode, 1);
    assert.equal(exhausted.convergence.recovery.route, 'full-replan');
    assert.equal(exhausted.convergence.recovery.test_author_agent_id, 'recovery-plan-author');
    assert.equal(exhausted.convergence.recovery.builder_agent_id, 'recovery-implementer');
    assert.deepEqual(exhausted.convergence.recovery.baselineGate, baselineGate);
    assert.equal(exhausted.judgmentHistory.length, recoveryCycle);

    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'implement', '18', implementReturn('second-recovery-builder')),
      /blocked after failed council recovery|recovery.*exhausted/i,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    await assert.rejects(
      recordSpecialistReturn(
        root,
        'council',
        '18',
        issue237CouncilReturn('confined-repair'),
      ),
      /recovery.*(terminate|exhausted)|recorded block/i,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 238 valid recovery plan escalation exhausts the sole episode', async () => {
  const { root, taskDir } = await makeRoot(councilTask());
  const taskPath = join(taskDir, 'task.json');
  try {
    await recordSpecialistReturn(
      root,
      'council',
      '18',
      issue237CouncilReturn('causal-subgraph-reconstruction'),
    );
    const exhausted = await recordSpecialistReturn(
      root,
      'plan',
      '18',
      planReturn({
        result: 'escalation',
        complexity: 'complex',
        escalation: {
          fork: 'The locked recovery has two incompatible valid interpretations.',
          options: ['Ask the operator to select the intended contract.'],
        },
      }, 'fresh-recovery-plan-author'),
    );

    assert.equal(exhausted.stage, 'plan');
    assert.equal(exhausted.status, 'blocked');
    assert.equal(exhausted.convergence.council.outcome, 'blocked-to-operator');
    assert.equal(exhausted.convergence.recovery.episode, 1);
    assert.equal(exhausted.convergence.recovery.route, 'causal-subgraph-reconstruction');
    assert.equal(exhausted.blockedReason, 'The recording path loses a result.');

    const beforeRetry = await readFile(taskPath);
    await assert.rejects(
      recordSpecialistReturn(
        root,
        'plan',
        '18',
        planReturn({ complexity: 'complex' }, 'second-recovery-plan-author'),
      ),
      /blocked|exhausted|council recovery/i,
    );
    assert.deepEqual(await readFile(taskPath), beforeRetry);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 237 malformed research or synthesis is rejected atomically', async (t) => {
  const invalidReturns = [
    ['missing one independent inquiry', (value) => {
      delete value.council.members[2].inquiry;
    }],
    ['all live research omitted as if this were a historical ledger', (value) => {
      for (const member of value.council.members) delete member.inquiry;
      delete value.council.synthesis;
    }],
    ['identical inquiry packets', (value) => {
      value.council.members[1].inquiry = structuredClone(value.council.members[0].inquiry);
      value.council.members[2].inquiry = structuredClone(value.council.members[0].inquiry);
    }],
    ['object key order is the only inquiry difference', (value) => {
      const entries = Object.entries(value.council.members[0].inquiry);
      value.council.findings[0].blockingVotes = 3;
      value.council.members[1].inquiry = Object.fromEntries([...entries].reverse());
      value.council.members[2].inquiry = Object.fromEntries([...entries.slice(1), entries[0]]);
    }],
    ['punctuation is the only inquiry difference', (value) => {
      value.council.findings[0].blockingVotes = 3;
      for (const [index, suffix] of [[1, '.'], [2, '!']]) {
        const inquiry = structuredClone(value.council.members[0].inquiry);
        inquiry.question += suffix;
        inquiry.problemRestatement += suffix;
        inquiry.causalHypotheses = inquiry.causalHypotheses.map((item) => `${item}${suffix}`);
        inquiry.decisiveEvidence = inquiry.decisiveEvidence.map((item) => `${item}${suffix}`);
        inquiry.findingVotes = inquiry.findingVotes.map((vote) => ({
          ...vote,
          rationale: `${vote.rationale}${suffix}`,
        }));
        value.council.members[index].inquiry = inquiry;
      }
    }],
    ['missing reconstruction question', (value) => {
      value.council.members[0].inquiry.question = 'Is this finding blocking?';
    }],
    ['inquiry repeats one strategy instead of comparing material alternatives', (value) => {
      value.council.members[0].inquiry.solutionStrategies = ['confined-repair', 'confined-repair'];
    }],
    ['code inquiry offers an operation-only strategy', (value) => {
      value.council.members[0].inquiry.solutionStrategies = ['scoped-execute', 'operator-escalation'];
    }],
    ['vote tally inconsistent with independent inquiries', (value) => {
      value.council.findings[0].blockingVotes = 1;
      value.council.findings[0].survived = false;
    }],
    ['ship verdict contradicts the inquiry-derived majority', (value) => {
      value.council.findings[0].blockingVotes = 0;
      value.council.findings[0].survived = false;
      value.council.findings[0].followupTaskId = 'ledger';
      value.council.synthesis.survivingBlockers = [];
      value.council.verdict = 'ship';
      value.council.outcome = 'shipped';
    }],
    ['synthesis omits a surviving blocker', (value) => {
      value.council.synthesis.survivingBlockers = [];
    }],
    ['selected repair is absent from materially different strategies', (value) => {
      value.council.synthesis.selectedStrategy = 'full-replan';
    }],
    ['synthesis rejects no offered alternative', (value) => {
      value.council.synthesis.rejectedAlternatives = [];
    }],
    ['synthesis rejects its selected route', (value) => {
      value.council.synthesis.rejectedAlternatives = ['confined-repair'];
    }],
    ['synthesis rejects a route that was not offered', (value) => {
      value.council.synthesis.rejectedAlternatives = ['workflow-node'];
    }],
    ['synthesis omits one nonselected material strategy', (value) => {
      value.council.synthesis.solutionStrategies.push('full-replan');
    }],
  ];

  for (const [name, mutate] of invalidReturns) {
    await t.test(name, async () => {
      const { root, taskDir } = await makeRoot(councilTask());
      try {
        const invalid = councilReturn();
        mutate(invalid);
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        await assert.rejects(
          recordSpecialistReturn(root, 'council', '18', invalid),
          /record-(schema|transition).*council|inquiry|synthesis|strategy/i,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }

  await t.test('findingVotes order is the only inquiry difference', async () => {
    const task = councilTask();
    const originalFinding = task.review.findings[0];
    const findings = [
      originalFinding,
      ...[
        ['A second accepted result is lost.', 'second-refuter'],
        ['A third accepted result is lost.', 'third-refuter'],
      ].map(([what, agentId], index) => {
        const line = 11 + index;
        return {
          ...structuredClone(originalFinding),
          line,
          what,
          why: 'The same recorder boundary loses independently accepted evidence.',
          refute: {
            ...structuredClone(originalFinding.refute),
            agent_id: agentId,
            finding: `src/core/record.js:${line} ${what}`,
          },
        };
      }),
    ];
    task.review.findings = findings;
    task.refutes = findings.map((finding) => finding.refute);

    const invalid = councilReturn();
    const findingIds = ['F1', 'F2', 'F3'];
    invalid.council.findings = findings.map((finding, index) => ({
      id: findingIds[index],
      summary: finding.what,
      source: 'review',
      blockingVotes: 3,
      survived: true,
      followupTaskId: null,
    }));
    const inquiry = {
      ...structuredClone(invalid.council.members[0].inquiry),
      findingVotes: findingIds.map((id) => ({
        id,
        blocking: true,
        rationale: `Live evidence for ${id}.`,
      })),
    };
    invalid.council.members[0].inquiry = structuredClone(inquiry);
    invalid.council.members[1].inquiry = {
      ...structuredClone(inquiry),
      findingVotes: [inquiry.findingVotes[1], inquiry.findingVotes[2], inquiry.findingVotes[0]],
    };
    invalid.council.members[2].inquiry = {
      ...structuredClone(inquiry),
      findingVotes: [inquiry.findingVotes[2], inquiry.findingVotes[0], inquiry.findingVotes[1]],
    };
    invalid.council.synthesis.survivingBlockers = findingIds;

    const { root, taskDir } = await makeRoot(task);
    const taskPath = join(taskDir, 'task.json');
    const journalPath = join(taskDir, 'journal.jsonl');
    try {
      await writeFile(
        journalPath,
        `${JSON.stringify({
          seq: 0,
          at: '2026-07-12T00:00:00Z',
          event: 'intent',
          stage: 'council',
        })}\n`,
        'utf8',
      );
      const beforeTask = await readFile(taskPath);
      const beforeJournal = await readFile(journalPath);
      await assert.rejects(
        recordSpecialistReturn(root, 'council', '18', invalid),
        /record-(schema|transition).*council|inquiry|semantic/i,
      );
      assert.deepEqual(await readFile(taskPath), beforeTask);
      assert.deepEqual(await readFile(journalPath), beforeJournal);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  const { root, taskDir } = await makeRoot(councilTask());
  try {
    await recordSpecialistReturn(root, 'council', '18', councilReturn());
    const recorded = await readTask(taskDir);
    assert.equal(recorded.convergence.recovery.route, 'confined-repair');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 238 unordered inquiry research rejects order and repetition atomically', async (t) => {
  for (const field of ISSUE_238_UNORDERED_INQUIRY_FIELDS) {
    for (const variant of ['order', 'repetition']) {
      await t.test(`${field} ${variant}-only difference`, async () => {
        const { task, result } = issue238ResearchCollectionVariant(field, variant);
        const { root, taskDir } = await makeRoot(task);
        const taskPath = join(taskDir, 'task.json');
        const journalPath = join(taskDir, 'journal.jsonl');
        try {
          await writeFile(
            journalPath,
            `${JSON.stringify({
              seq: 0,
              at: '2026-07-12T00:00:00Z',
              event: 'intent',
              stage: 'council',
            })}\n`,
            'utf8',
          );
          const beforeTask = await readFile(taskPath);
          const beforeJournal = await readFile(journalPath);
          await assert.rejects(
            recordSpecialistReturn(root, 'council', '18', result),
            /record-(schema|transition).*council|inquiry|semantic/i,
          );
          assert.deepEqual(await readFile(taskPath), beforeTask);
          assert.deepEqual(await readFile(journalPath), beforeJournal);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
});

test('issue 238 live council records canonical research provenance', async () => {
  const { root, taskDir } = await makeRoot(councilTask());
  try {
    await recordSpecialistReturn(root, 'council', '18', councilReturn());
    const recorded = await readTask(taskDir);
    assert.equal(recorded.convergence.council.researchProvenance, 'canonical');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 237 live council binds member and synthesizer identities to host observations', async (t) => {
  const cases = [
    ['member', {
      member_agent_ids: ['spoofed-member', 'council-security', 'council-pragmatist'],
      synthesizer_agent_id: 'council-synthesizer',
    }],
    ['synthesizer', {
      member_agent_ids: ['council-integrity', 'council-security', 'council-pragmatist'],
      synthesizer_agent_id: 'implementer',
    }],
  ];

  for (const [name, observed] of cases) {
    await t.test(name, async () => {
      const { root, taskDir } = await makeRoot(councilTask());
      try {
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        await assert.rejects(
          recordObservedSpecialistReturn(root, 'council', '18', councilReturn(), observed),
          /record-identity.*council|observed.*identity|synthesizer/i,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 237 cook record council accepts four exact host observations and rejects malformed observations atomically', async () => {
  const validObservations = [
    'council-integrity',
    'council-security',
    'council-pragmatist',
    'council-synthesizer',
  ];
  const validRoot = await makeRoot(councilTask());
  try {
    const file = await writeReturn(validRoot.root, councilReturn(), 'council-return.json');
    const result = runCook(validRoot.root, ['record', 'council', '18', ...validObservations, file]);
    assert.equal(result.code, 0, result.stderr);
    const recorded = await readTask(validRoot.taskDir);
    assert.deepEqual(
      recorded.convergence.council.members.map((member) => member.agent_id),
      validObservations.slice(0, 3),
    );
    assert.equal(recorded.convergence.council.synthesizer_agent_id, validObservations[3]);
  } finally {
    await rm(validRoot.root, { recursive: true, force: true });
  }

  const invalidObservations = [
    ['too few', validObservations.slice(0, 3)],
    ['too many', [...validObservations, 'fifth-observation']],
    ['malformed synthesizer', [...validObservations.slice(0, 3), '']],
    ['mismatched member', ['other-member', ...validObservations.slice(1)]],
  ];
  for (const [name, observations] of invalidObservations) {
    const { root, taskDir } = await makeRoot(councilTask());
    try {
      const file = await writeReturn(root, councilReturn(), `${name}.json`);
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      const result = runCook(root, ['record', 'council', '18', ...observations, file]);
      assert.notEqual(result.code, 0, `${name} observations must be rejected`);
      assert.match(result.stderr, /usage|identity|observed|council/i);
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('issue 237 recovery judgments require a current clean green post-recovery gate', async () => {
  const { root, taskDir } = await prepareScopedCouncilRecovery();
  try {
    const cycle = (await readTask(taskDir)).judgmentHistory.length;
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'review', '18', reviewReturn('fresh-reviewer-one', { cycle })),
      /recovery.*gate|clean green.*before.*judgment|current.*checkpoint/i,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);

    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    await recordSpecialistReturn(
      root,
      'review',
      '18',
      reviewReturn('fresh-reviewer-one', { cycle }),
    );
    assert.equal((await readTask(taskDir)).agents.reviewer_agent_id, 'fresh-reviewer-one');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 237 implement-backed recovery routes cannot enter a route-incompatible refactor stage', async (t) => {
  for (const route of ['confined-repair', 'causal-subgraph-reconstruction', 'full-replan']) {
    await t.test(route, async () => {
      const task = councilTask();
      task.plan = {
        result: 'red',
        slices: ['Repair the selected production defect.'],
        testFiles: ['src/cli/record.test.js'],
        redRun: { command: 'node --test src/cli/record.test.js', output: 'failure reproduced' },
        escalation: null,
        refactorOpportunity: 'Harmonize the recorder after behavior is restored.',
      };
      const { root, taskDir } = await makeRoot(task);
      try {
        await recordSpecialistReturn(root, 'council', '18', issue237CouncilReturn(route));
        if (route !== 'confined-repair') {
          await recordSpecialistReturn(
            root,
            'plan',
            '18',
            planReturn({
              complexity: 'complex',
              refactorOpportunity: 'Harmonize the recorder after behavior is restored.',
            }, 'recovery-test-author'),
          );
        }
        await recordSpecialistReturn(root, 'implement', '18', implementReturn('recovery-builder'));
        assert.equal((await readTask(taskDir)).stage, 'review');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 237 recovery cannot lower complexity audit or the fresh reviewer floor', async (t) => {
  await t.test('recovery plan preserves the complex classification and required audit', async () => {
    const { root, taskDir } = await makeRoot(councilTask());
    try {
      await recordSpecialistReturn(root, 'council', '18', issue237CouncilReturn('full-replan'));
      await recordSpecialistReturn(
        root,
        'plan',
        '18',
        planReturn({ complexity: 'simple', auditRequired: false }, 'recovery-test-author'),
      );
      const planned = await readTask(taskDir);
      assert.equal(planned.complexity, 'complex');
      assert.equal(planned.audit.required, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('one fresh review cannot satisfy the original complex reviewer floor', async () => {
    const { root, taskDir } = await makeRoot(councilTask());
    try {
      await writeFile(join(root, '.jeff', 'profile.md'), 'Test command: `true`\n', 'utf8');
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-qm', 'add test profile']);
      await recordSpecialistReturn(root, 'council', '18', issue237CouncilReturn('full-replan'));
      await recordSpecialistReturn(
        root,
        'plan',
        '18',
        planReturn({ complexity: 'simple', auditRequired: false }, 'recovery-test-author'),
      );
      await recordSpecialistReturn(root, 'implement', '18', implementReturn('recovery-builder'));
      runGit(root, ['add', '.']);
      runGit(root, ['commit', '-qm', 'record recovery']);
      const verification = await runVerify(root, '18');
      assert.equal(verification.code, 0, verification.stderr.join('\n'));
      const cycle = (await readTask(taskDir)).judgmentHistory.length;
      await recordSpecialistReturn(
        root,
        'review',
        '18',
        reviewReturn('fresh-reviewer-one', { cycle }),
      );
      assert.equal((await readTask(taskDir)).stage, 'review');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 237 recovery retains original plan test author builder and implementation lineage', async () => {
  const originalPlan = {
    result: 'red',
    slices: ['Implement the original contract.'],
    testFiles: ['src/cli/record.test.js'],
    redRun: { command: 'node --test src/cli/record.test.js', output: 'original red' },
    escalation: null,
    refactorOpportunity: null,
  };
  const originalImplement = {
    agent_id: 'implementer',
    result: 'green',
    files: ['src/core/record.js'],
    greenRun: { command: 'node --test src/cli/record.test.js', output: 'original green' },
  };
  const { root, taskDir } = await makeRoot(councilTask({
    plan: originalPlan,
    implement: originalImplement,
    tests: {
      authored_by_agent_id: 'original-test-author',
      green: true,
      evidence: [{ command: 'node --test', output: 'green' }],
      gate: ISSUE_237_BASELINE_GATE,
    },
  }));
  try {
    await recordSpecialistReturn(root, 'council', '18', issue237CouncilReturn('full-replan'));
    await recordSpecialistReturn(
      root,
      'plan',
      '18',
      planReturn({ complexity: 'complex', auditRequired: true }, 'recovery-test-author'),
    );
    await recordSpecialistReturn(root, 'implement', '18', implementReturn('recovery-builder'));
    const recovered = await readTask(taskDir);
    assert.deepEqual(recovered.convergence.recovery.original, {
      complexity: 'complex',
      audit_required: true,
      absentLineage: [],
      plan: originalPlan,
      test_author_agent_id: 'original-test-author',
      builder_agent_id: 'implementer',
      implement: originalImplement,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 237 recovery marks lineage that was legitimately absent at council entry', async () => {
  const task = councilTask();
  delete task.plan;
  delete task.implement;
  task.tests.authored_by_agent_id = null;
  task.agents.implementer_agent_id = null;
  const { root, taskDir } = await makeRoot(task);
  try {
    await recordSpecialistReturn(root, 'council', '18', councilReturn());
    assert.deepEqual((await readTask(taskDir)).convergence.recovery.original, {
      complexity: 'complex',
      audit_required: true,
      absentLineage: ['plan', 'test_author_agent_id', 'builder_agent_id', 'implement'],
      plan: null,
      test_author_agent_id: null,
      builder_agent_id: null,
      implement: null,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 238 direct refactor clean return exhausts the sole episode', async () => {
  const { root, taskDir } = await makeRoot(councilTask());
  const taskPath = join(taskDir, 'task.json');
  try {
    await recordSpecialistReturn(root, 'council', '18', issue237CouncilReturn('refactor'));
    const exhausted = await recordSpecialistReturn(
      root,
      'refactor',
      '18',
      refactorReturn('recovery-refactorer'),
    );

    assert.equal(exhausted.stage, 'refactor');
    assert.equal(exhausted.status, 'blocked');
    assert.equal(exhausted.convergence.council.outcome, 'blocked-to-operator');
    assert.equal(exhausted.convergence.recovery.episode, 1);
    assert.equal(exhausted.convergence.recovery.route, 'refactor');
    assert.equal(exhausted.blockedReason, 'The recording path loses a result.');

    const beforeRetry = await readFile(taskPath);
    await assert.rejects(
      recordSpecialistReturn(root, 'refactor', '18', refactorReturn('second-recovery-refactorer')),
      /blocked|exhausted|council recovery/i,
    );
    assert.deepEqual(await readFile(taskPath), beforeRetry);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 237 operation council honors its scoped-execute synthesis route', async (t) => {
  await t.test('operation-specific route reaches execute and remains recorded', async () => {
    const { root, taskDir } = await makeRoot(operationCouncilTask());
    try {
      await recordSpecialistReturn(root, 'council', '18', operationCouncilReturn());
      const recorded = await readTask(taskDir);
      assert.equal(recorded.stage, 'execute');
      assert.equal(recorded.convergence.council.synthesis.selectedStrategy, 'scoped-execute');
      assert.equal(recorded.convergence.council.synthesizer_agent_id, 'council-synthesizer');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('code-only route is rejected rather than ignored for an operation', async () => {
    const { root, taskDir } = await makeRoot(operationCouncilTask());
    try {
      const invalid = operationCouncilReturn();
      invalid.council.synthesis.solutionStrategies = ['confined-repair', 'operator-escalation'];
      invalid.council.synthesis.selectedStrategy = 'confined-repair';
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordSpecialistReturn(root, 'council', '18', invalid),
        /operation.*route|selectedStrategy|scoped-execute/i,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  for (const [name, strategies] of [
    ['operation inquiry rejects code-only strategies', ['confined-repair', 'operator-escalation']],
    ['operation inquiry requires materially different strategies', ['scoped-execute', 'scoped-execute']],
  ]) {
    await t.test(name, async () => {
      const { root, taskDir } = await makeRoot(operationCouncilTask());
      try {
        const invalid = operationCouncilReturn();
        invalid.council.members[0].inquiry.solutionStrategies = strategies;
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        await assert.rejects(
          recordSpecialistReturn(root, 'council', '18', invalid),
          /inquiry.*strateg|operation.*strateg|solutionStrategies/i,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});