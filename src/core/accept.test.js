// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as recordCore from './record.js';
import { validateStore } from './validate-store.js';
import { buildSnapshot } from './snapshot.js';
import { claimReport, readyReport } from './drain.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const COOK_JS = join(HERE, '../cli/cook.js');
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
const OBSERVED_AGENT_ID = Symbol('observedAgentId');
const COUNCIL_SYNTHESIZER_AGENT_ID = 'council-synthesizer';
const ISSUE_237_BASELINE_GATE = {
  hash: 'pre-council-checkpoint',
  clean: true,
  green: true,
  command: 'node --test',
  at: '2026-07-12T00:30:00Z',
};
const ISSUE_283_REASON = 'Later independent proof accepted this exact checkpoint.';
const ISSUE_283_EVIDENCE = [{
  command: 'git cat-file -t GATE',
  output: 'commit',
}];
const FIXED_NOW = new Date('2026-08-25T12:00:00.000Z');

/** @type {any} */
const acceptApi = recordCore;

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
        member_agent_ids: value.council.members.map((/** @type {any} */ member) => member.agent_id),
        synthesizer_agent_id: COUNCIL_SYNTHESIZER_AGENT_ID,
      }
    : observedAgentId(value);
  return recordCore.recordSpecialistReturn(root, stage, id, value, observedIdentity);
}

/** @param {string} [status] */
function auditCoverage(status = 'covered_no_hits') {
  return AUDIT_CATEGORIES.map((category) => ({ category, status }));
}

/** @param {Record<string, any>} [overrides] @returns {any} */
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

/** @param {string | null} [outcome] @returns {any} */
function councilReturn(outcome = null) {
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

/** @param {string} strategy */
function issue237CouncilReturn(strategy) {
  const selected = structuredClone(councilReturn());
  selected.council.synthesis.selectedStrategy = strategy;
  if (!selected.council.synthesis.solutionStrategies.includes(strategy)) {
    selected.council.synthesis.solutionStrategies.push(strategy);
  }
  selected.council.synthesis.rejectedAlternatives =
    selected.council.synthesis.solutionStrategies.filter((/** @type {string} */ route) => route !== strategy);
  return selected;
}

/** @param {Record<string, any>} [overrides] @returns {any} */
function operationTask(overrides = {}) {
  return {
    schemaVersion: 1,
    operationStateVersion: 1,
    id: 18,
    slug: 'record-specialists',
    title: 'Record specialists',
    category: 'operation',
    status: 'in_progress',
    stage: 'execute',
    priority: 'p2',
    deps: [],
    complexity: 'complex',
    createdAt: '2026-07-12T00:00:00Z',
    updatedAt: '2026-07-12T00:00:00Z',
    agents: {
      executor_agent_id: 'executor',
      verifier_agent_id: null,
      audit_agent_id: null,
    },
    tests: { authored_by_agent_id: null, green: 'na', evidence: [] },
    review: { verdict: null, reviewer_agent_id: null, findings: [], evidence: [] },
    audit: { required: false, verdict: 'na', audit_agent_id: null, findings: [], evidence: [] },
    commits: [],
    kickbacks: [],
    blockedReason: null,
    abandonReason: null,
    ...overrides,
  };
}

async function makeRoot(task = canonicalTask()) {
  const root = await mkdtemp(join(tmpdir(), 'jeff-accept-'));
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

/** @param {string} root @param {string[]} args */
function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/** @param {string} root @param {string[]} args */
function runCook(root, args) {
  const result = spawnSync(process.execPath, [COOK_JS, ...args], {
    env: { ...process.env, COOK_ROOT: root },
    encoding: 'utf8',
  });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

/** @param {string} taskDir */
async function readTask(taskDir) {
  return JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf8'));
}

/** @param {string} hash @param {Record<string, unknown>} [overrides] */
function acceptanceInput(hash, overrides = {}) {
  return {
    operator: 'Chef',
    hash,
    reason: ISSUE_283_REASON,
    evidence: ISSUE_283_EVIDENCE,
    ...overrides,
  };
}

/** @param {string} hash @param {Record<string, unknown>} [overrides] */
function acceptanceRecord(hash, overrides = {}) {
  return {
    hash,
    acceptedBy: 'Chef',
    acceptedAt: '2026-08-25T12:00:00Z',
    reason: ISSUE_283_REASON,
    evidence: ISSUE_283_EVIDENCE,
    ...overrides,
  };
}

/** @param {Record<string, any>} [overrides] */
async function exhaustedCouncilBlock(overrides = {}) {
  const { root, taskDir } = await makeRoot(councilTask({
    tests: {
      authored_by_agent_id: 'original-test-author',
      green: true,
      evidence: [{ command: 'node --test', output: 'green' }],
      gate: ISSUE_237_BASELINE_GATE,
    },
    ...overrides,
  }));
  await recordSpecialistReturn(root, 'council', '18', issue237CouncilReturn('operator-escalation'));
  const blocked = await readTask(taskDir);
  return { root, taskDir, blocked, hash: blocked.tests.gate.hash };
}

/** @param {string} root @param {Record<string, any>} overrides */
async function writeExtraTask(root, overrides) {
  const task = {
    schemaVersion: 1,
    id: 19,
    slug: 'downstream',
    title: 'Downstream',
    status: 'pending',
    stage: 'capture',
    priority: 'p2',
    deps: [18],
    createdAt: '2026-08-25T00:00:00Z',
    updatedAt: '2026-08-25T00:00:00Z',
    agents: {
      implementer_agent_id: null,
      reviewer_agent_id: null,
      reviewer2_agent_id: null,
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
  const dir = join(root, '.jeff', 'tasks', `${String(task.id).padStart(3, '0')}-${task.slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  return dir;
}

async function makeDrainRoot() {
  const root = await mkdtemp(join(tmpdir(), 'jeff-accept-drain-'));
  await mkdir(join(root, '.jeff', 'tasks'), { recursive: true });
  await writeFile(
    join(root, '.jeff', 'config.json'),
    `${JSON.stringify({ schemaVersion: 1, system: 'jeff', active: true })}\n`,
    'utf8',
  );
  return root;
}

/** @param {string} root @param {Record<string, any>} overrides */
async function writeDrainTask(root, overrides) {
  const task = {
    schemaVersion: 1,
    id: 1,
    slug: 'task-1',
    title: 'Task 1',
    status: 'pending',
    stage: 'capture',
    priority: 'p2',
    deps: [],
    ...overrides,
  };
  const dir = join(root, '.jeff', 'tasks', `${String(task.id).padStart(4, '0')}-${task.slug}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'task.json'), `${JSON.stringify(task)}\n`, 'utf8');
  return dir;
}

test('issue 283: recordAcceptance binds the exact gate hash as a third terminal', async () => {
  const { root, taskDir, blocked, hash } = await exhaustedCouncilBlock();
  try {
    const accepted = await acceptApi.recordAcceptance(root, '18', acceptanceInput(hash));
    const persisted = await readTask(taskDir);

    assert.equal(accepted.status, 'operator_accepted');
    assert.equal(persisted.status, 'operator_accepted');
    assert.notEqual(accepted.status, 'done');
    assert.notEqual(accepted.status, 'abandoned');
    assert.notEqual(accepted.status, 'blocked');
    assert.equal(accepted.acceptance.hash, hash);
    assert.equal(accepted.acceptance.hash, blocked.tests.gate.hash);
    assert.equal(accepted.tests.gate.hash, hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 283: recordAcceptance records operator identity timestamp reason and evidence', async () => {
  const { root, taskDir, hash } = await exhaustedCouncilBlock();
  try {
    await acceptApi.recordAcceptance(root, '18', acceptanceInput(hash));
    const disposition = (await readTask(taskDir)).acceptance;

    assert.equal(disposition.acceptedBy, 'Chef');
    assert.equal(typeof disposition.acceptedAt, 'string');
    assert.match(disposition.acceptedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.equal(disposition.reason, ISSUE_283_REASON);
    assert.deepEqual(disposition.evidence, ISSUE_283_EVIDENCE);
    assert.ok(disposition.evidence.length > 0);
    assert.ok(disposition.reason.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 283: recordAcceptance preserves review audit refute council and recovery outcomes', async () => {
  const { root, taskDir, blocked, hash } = await exhaustedCouncilBlock();
  try {
    await acceptApi.recordAcceptance(root, '18', acceptanceInput(hash));
    const accepted = await readTask(taskDir);

    assert.deepEqual(accepted.review, blocked.review);
    assert.deepEqual(accepted.review2, blocked.review2);
    assert.deepEqual(accepted.audit, blocked.audit);
    assert.deepEqual(accepted.refutes, blocked.refutes);
    assert.deepEqual(accepted.convergence.council, blocked.convergence.council);
    assert.deepEqual(accepted.convergence.recovery, blocked.convergence.recovery);
    assert.equal(accepted.review.verdict, 'needs-work');
    assert.equal(accepted.convergence.council.outcome, 'blocked-to-operator');
    assert.equal(accepted.convergence.recovery.episode, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 283: snapshot distinguishes blocked operator_accepted and done', async () => {
  const { root, hash } = await exhaustedCouncilBlock();
  try {
    await writeExtraTask(root, {
      id: 17,
      slug: 'still-blocked',
      title: 'Still blocked',
      status: 'blocked',
      blockedReason: 'waiting on another lineage',
      deps: [],
    });
    await writeExtraTask(root, {
      id: 16,
      slug: 'already-done',
      title: 'Already done',
      status: 'done',
      stage: 'done',
      deps: [],
    });
    await acceptApi.recordAcceptance(root, '18', acceptanceInput(hash));

    const snapshot = await buildSnapshot(root, { now: () => FIXED_NOW });
    const byId = new Map(snapshot.tasks.map((task) => [task.id, task]));
    assert.equal(byId.get(17)?.status, 'blocked');
    assert.equal(byId.get(16)?.status, 'done');
    assert.equal(byId.get(18)?.status, 'operator_accepted');
    assert.notEqual(byId.get(18)?.status, 'done');
    assert.notEqual(byId.get(18)?.status, 'blocked');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 283: an accepted predecessor satisfies downstream ready-set', async () => {
  const { root, hash } = await exhaustedCouncilBlock();
  try {
    await writeExtraTask(root, { id: 19, slug: 'downstream', title: 'Downstream', deps: [18] });
    const before = await readyReport(root);
    assert.equal(before.code, 0, before.stderr.join('\n'));
    assert.equal(
      before.stdout.map((line) => JSON.parse(line)).some((task) => task.id === 19),
      false,
    );

    await acceptApi.recordAcceptance(root, '18', acceptanceInput(hash));
    const after = await readyReport(root);
    assert.equal(after.code, 0, after.stderr.join('\n'));
    assert.equal(
      after.stdout.map((line) => JSON.parse(line)).some((task) => task.id === 19),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 283: readyReport treats operator_accepted like done and abandoned', async () => {
  const root = await makeDrainRoot();
  try {
    await writeDrainTask(root, {
      id: 1,
      slug: 'accepted-dep',
      title: 'Accepted dependency',
      status: 'operator_accepted',
      stage: 'review',
    });
    await writeDrainTask(root, {
      id: 2,
      slug: 'done-dep',
      title: 'Done dependency',
      status: 'done',
      stage: 'done',
    });
    await writeDrainTask(root, {
      id: 3,
      slug: 'abandoned-dep',
      title: 'Abandoned dependency',
      status: 'abandoned',
      stage: 'done',
    });
    await writeDrainTask(root, {
      id: 4,
      slug: 'blocked-dep',
      title: 'Blocked dependency',
      status: 'blocked',
    });
    await writeDrainTask(root, { id: 5, slug: 'from-accepted', title: 'From accepted', deps: [1] });
    await writeDrainTask(root, { id: 6, slug: 'from-done', title: 'From done', deps: [2] });
    await writeDrainTask(root, { id: 7, slug: 'from-abandoned', title: 'From abandoned', deps: [3] });
    await writeDrainTask(root, { id: 8, slug: 'from-blocked', title: 'From blocked', deps: [4] });

    const report = await readyReport(root);
    assert.equal(report.code, 0, report.stderr.join('\n'));
    const readyIds = report.stdout.map((line) => JSON.parse(line).id);
    assert.deepEqual(readyIds.filter((id) => [5, 6, 7, 8].includes(id)).sort((a, b) => a - b), [5, 6, 7]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 283: claimReport refuses operator_accepted without leaving a claim', async () => {
  const root = await makeDrainRoot();
  try {
    const taskDir = await writeDrainTask(root, {
      id: 20,
      slug: 'accepted-task',
      title: 'Accepted task',
      status: 'operator_accepted',
      stage: 'review',
    });
    const report = await claimReport(root, '20', { by: 'lane-a', now: () => FIXED_NOW });
    assert.equal(report.code, 1);
    assert.match(report.stderr.join('\n'), /operator_accepted/);
    await assert.rejects(readFile(join(taskDir, '.claim', 'claim.json'), 'utf8'), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 283: recordAcceptance succeeds when the checkpoint is not on trunk', async () => {
  const { root, taskDir, hash } = await exhaustedCouncilBlock();
  try {
    runGit(root, ['branch', 'keep-checkpoint']);
    runGit(root, ['checkout', '--orphan', 'trunk']);
    runGit(root, ['commit', '--allow-empty', '-qm', 'unrelated trunk']);
    const trunkBefore = runGit(root, ['rev-parse', 'trunk']);
    runGit(root, ['checkout', 'keep-checkpoint']);
    const headBefore = runGit(root, ['rev-parse', 'HEAD']);
    const ancestor = spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', hash, 'trunk'], {
      encoding: 'utf8',
    });
    assert.notEqual(ancestor.status, 0);

    await acceptApi.recordAcceptance(root, '18', acceptanceInput(hash));
    const accepted = await readTask(taskDir);
    assert.equal(accepted.status, 'operator_accepted');
    assert.equal(accepted.acceptance.hash, hash);
    assert.equal(runGit(root, ['rev-parse', 'trunk']), trunkBefore);
    assert.equal(runGit(root, ['rev-parse', 'HEAD']), headBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 283: recordAcceptance succeeds when the checkpoint is on trunk without moving refs', async () => {
  const { root, taskDir, hash } = await exhaustedCouncilBlock();
  try {
    runGit(root, ['branch', '-f', 'trunk', 'HEAD']);
    const trunkBefore = runGit(root, ['rev-parse', 'trunk']);
    const headBefore = runGit(root, ['rev-parse', 'HEAD']);
    assert.equal(trunkBefore, hash);

    await acceptApi.recordAcceptance(root, '18', acceptanceInput(hash));
    const accepted = await readTask(taskDir);
    assert.equal(accepted.status, 'operator_accepted');
    assert.equal(accepted.acceptance.hash, hash);
    assert.equal(runGit(root, ['rev-parse', 'trunk']), trunkBefore);
    assert.equal(runGit(root, ['rev-parse', 'HEAD']), headBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 283: recordAcceptance rejects a checkpoint that does not match tests.gate.hash', async () => {
  const { root, taskDir, hash } = await exhaustedCouncilBlock();
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const other = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    assert.notEqual(other, hash);
    await assert.rejects(
      acceptApi.recordAcceptance(root, '18', acceptanceInput(other)),
      /\[record-accept\].*(gate\.hash|checkpoint)/i,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 283: recordAcceptance rejects missing evidence and reason', async (t) => {
  for (const [name, overrides] of /** @type {Array<[string, Record<string, unknown>]>} */ ([
    ['empty evidence', { evidence: [] }],
    ['missing output', { evidence: [{ command: 'inspect', output: '' }] }],
    ['empty reason', { reason: '' }],
  ])) {
    await t.test(name, async () => {
      const { root, taskDir, hash } = await exhaustedCouncilBlock();
      try {
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        await assert.rejects(
          acceptApi.recordAcceptance(root, '18', acceptanceInput(hash, overrides)),
          /\[record-accept\].*(evidence|reason)/i,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 283: recordAcceptance rejects ineligible tasks', async (t) => {
  await t.test('in-progress code work', async () => {
    const { root, taskDir } = await makeRoot(councilTask({
      tests: {
        authored_by_agent_id: 'original-test-author',
        green: true,
        evidence: [{ command: 'node --test', output: 'green' }],
        gate: ISSUE_237_BASELINE_GATE,
      },
    }));
    try {
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      const hash = (await readTask(taskDir)).tests.gate.hash;
      await assert.rejects(
        acceptApi.recordAcceptance(root, '18', acceptanceInput(hash)),
        /\[record-accept\].*(ineligible|blocked-to-operator|exhausted)/i,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('operation task', async () => {
    const { root, taskDir } = await makeRoot(operationTask({
      status: 'blocked',
      blockedReason: 'operator stop',
    }));
    try {
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        acceptApi.recordAcceptance(root, '18', acceptanceInput('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
        /\[record-accept\].*(ineligible|operation|code)/i,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('blocked without exhausted council recovery', async () => {
    const { root, taskDir } = await makeRoot(canonicalTask({
      category: 'code',
      status: 'blocked',
      blockedReason: 'waiting on a human',
      tests: {
        authored_by_agent_id: 'plan-agent',
        green: true,
        evidence: [{ command: 'node --test', output: 'green' }],
        gate: ISSUE_237_BASELINE_GATE,
      },
    }));
    try {
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      const hash = (await readTask(taskDir)).tests.gate.hash;
      await assert.rejects(
        acceptApi.recordAcceptance(root, '18', acceptanceInput(hash)),
        /\[record-accept\].*(ineligible|blocked-to-operator|exhausted)/i,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('exhausted council-block without a recorded gate hash', async () => {
    const { root, taskDir } = await makeRoot(councilTask({
      tests: { authored_by_agent_id: 'plan-agent', green: false, evidence: [] },
    }));
    try {
      await recordSpecialistReturn(root, 'council', '18', issue237CouncilReturn('operator-escalation'));
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        acceptApi.recordAcceptance(root, '18', acceptanceInput('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
        /\[record-accept\].*(gate\.hash|checkpoint|ineligible)/i,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 283: recordAcceptance is idempotent without duplicate acceptance rows', async () => {
  const { root, taskDir, hash } = await exhaustedCouncilBlock();
  try {
    await acceptApi.recordAcceptance(root, '18', acceptanceInput(hash));
    const first = await readTask(taskDir);
    await acceptApi.recordAcceptance(root, '18', acceptanceInput(hash));
    const second = await readTask(taskDir);

    assert.equal(second.status, 'operator_accepted');
    assert.deepEqual(second.acceptance, first.acceptance);
    assert.equal(Array.isArray(second.acceptances), false);
    assert.equal(Object.keys(second).filter((key) => key.startsWith('acceptance')).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 283: validateStore accepts a well-formed operator_accepted checkpoint', async () => {
  const { root, taskDir, blocked, hash } = await exhaustedCouncilBlock();
  try {
    await writeFile(join(taskDir, 'task.json'), `${JSON.stringify({
      ...blocked,
      status: 'operator_accepted',
      acceptance: acceptanceRecord(hash),
    }, null, 2)}\n`, 'utf8');

    const result = await validateStore(root);
    assert.equal(result.ok, true, result.stderr.join('\n'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 283: validateStore rejects operator_accepted that rewrites a failed review', async () => {
  const { root, taskDir, blocked, hash } = await exhaustedCouncilBlock();
  try {
    await writeFile(join(taskDir, 'task.json'), `${JSON.stringify({
      ...blocked,
      status: 'operator_accepted',
      acceptance: acceptanceRecord(hash),
      review: {
        ...blocked.review,
        verdict: 'pass',
        findings: [],
      },
    }, null, 2)}\n`, 'utf8');

    const result = await validateStore(root);
    assert.equal(result.ok, false);
    assert.match(result.stderr.join('\n'), /judgment|review|disposition/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 283: validateStore rejects a mismatched or evidenceless acceptance', async (t) => {
  await t.test('hash does not match tests.gate.hash', async () => {
    const { root, taskDir, blocked, hash } = await exhaustedCouncilBlock();
    try {
      await writeFile(join(taskDir, 'task.json'), `${JSON.stringify({
        ...blocked,
        status: 'operator_accepted',
        acceptance: acceptanceRecord('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      }, null, 2)}\n`, 'utf8');
      assert.notEqual(hash, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

      const result = await validateStore(root);
      assert.equal(result.ok, false);
      assert.match(result.stderr.join('\n'), /gate\.hash|checkpoint/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  await t.test('missing evidence', async () => {
    const { root, taskDir, blocked, hash } = await exhaustedCouncilBlock();
    try {
      await writeFile(join(taskDir, 'task.json'), `${JSON.stringify({
        ...blocked,
        status: 'operator_accepted',
        acceptance: acceptanceRecord(hash, { evidence: [] }),
      }, null, 2)}\n`, 'utf8');

      const result = await validateStore(root);
      assert.equal(result.ok, false);
      assert.match(result.stderr.join('\n'), /evidence/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('issue 283: cook accept records the disposition through the CLI', async () => {
  const { root, taskDir, hash } = await exhaustedCouncilBlock();
  try {
    const file = join(root, 'accept.json');
    await writeFile(file, `${JSON.stringify({
      hash,
      reason: ISSUE_283_REASON,
      evidence: ISSUE_283_EVIDENCE,
    }, null, 2)}\n`, 'utf8');
    const result = runCook(root, ['accept', '18', 'Chef', file]);
    assert.equal(result.code, 0, result.stderr);
    const accepted = await readTask(taskDir);
    assert.equal(accepted.status, 'operator_accepted');
    assert.equal(accepted.acceptance.hash, hash);
    assert.equal(accepted.acceptance.acceptedBy, 'Chef');
    assert.equal(accepted.acceptance.reason, ISSUE_283_REASON);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
