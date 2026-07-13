// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { recordSpecialistReturn as recordObservedSpecialistReturn } from '../core/record.js';
import { runVerify } from '../core/verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const COOK_JS = join(HERE, 'cook.js');

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

/** @param {string} root @param {string[]} args */
function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

/**
 * @param {string} root
 * @param {string} stage
 * @param {string} id
 * @param {Record<string, any>} value
 */
function recordSpecialistReturn(root, stage, id, value) {
  return recordObservedSpecialistReturn(root, stage, id, value, value.agent_id);
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

function implementReturn(agentId = 'implementer', overrides = {}) {
  return {
    agent_id: agentId,
    stage: 'implement',
    result: 'green',
    files: ['src/core/record.js'],
    greenRun: { command: 'node --test src/cli/record.test.js', output: 'pass' },
    kickback: null,
    ...overrides,
  };
}

function refactorReturn(agentId = 'refactorer') {
  return {
    agent_id: agentId,
    stage: 'refactor',
    result: 'clean',
    files: [],
    outsideDiff: [],
    greenRun: { command: 'node --test src/cli/record.test.js', output: 'pass' },
    summary: ['No refactor needed.'],
  };
}

/** @param {string} agentId @param {Record<string, unknown>} [overrides] */
function reviewReturn(agentId, overrides = {}) {
  return {
    agent_id: agentId,
    stage: 'review',
    cycle: 0,
    verdict: 'pass',
    acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: true }],
    findings: [],
    evidence: [{ command: 'git diff --check', output: 'clean' }],
    ...overrides,
  };
}

function auditReturn(agentId = 'auditor', overrides = {}) {
  return {
    agent_id: agentId,
    stage: 'audit',
    cycle: 0,
    verdict: 'pass',
    scan: { command: 'review-security --json', recommendation: 'PASS', reportPath: '/tmp/report.md' },
    coverage: [{ category: 'path_traversal', status: 'covered_no_hits' }],
    findings: [],
    evidence: [{ command: 'review-security --json', output: 'no findings' }],
    ...overrides,
  };
}

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
  return {
    agent_id: agentId,
    stage: 'refute',
    cycle: 0,
    finding: `${finding.file}:${finding.line} ${finding.what}`,
    verdict: 'survives',
    rationale: 'The supported input reaches the reported failure.',
    evidence: [{ command: 'node --test src/cli/record.test.js', output: 'failure reproduced' }],
    ...overrides,
  };
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
      coverage: [{ category: 'identity_spoofing', status: 'covered_no_hits' }],
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

/** @returns {any} */
function reviewTwoCouncilTask() {
  const task = councilTask();
  const finding = structuredClone(task.review.findings[0]);
  finding.refute.source = 'review2';
  return councilTask({
    review: {
      ...task.review,
      verdict: 'pass',
      reportedVerdict: 'pass',
      findings: [],
      evidence: [{ command: 'git diff --check', output: 'clean' }],
      acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: true }],
    },
    review2: {
      ...task.review2,
      verdict: 'needs-work',
      reportedVerdict: 'needs-work',
      findings: [finding],
      evidence: [{ command: 'git diff --check', output: 'blocking finding' }],
      acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: false }],
    },
    refutes: [finding.refute],
  });
}

/** @param {string | null} [outcome] @param {Record<number, Record<string, any>>} [memberOverrides] @returns {any} */
function councilReturn(outcome = null, memberOverrides = {}) {
  return {
    stage: 'council',
    council: {
      convened: true,
      stage: 'review',
      members: [
        { agent_id: 'council-integrity', lens: 'integrity', temperature: 0.3 },
        { agent_id: 'council-security', lens: 'security', temperature: 0.7 },
        { agent_id: 'council-pragmatist', lens: 'pragmatist', temperature: 1.0 },
      ].map((member, index) => ({ ...member, ...(memberOverrides[index] ?? {}) })),
      findings: [{
        id: 'F1',
        summary: 'The recording path loses a result.',
        source: 'review',
        blockingVotes: 2,
        survived: true,
        followupTaskId: null,
      }],
      verdict: 'block',
      outcome,
    },
  };
}

/** @param {string | null} [outcome] @returns {any} */
function reviewTwoCouncilReturn(outcome = null) {
  const result = councilReturn(outcome);
  result.council.findings[0].source = 'review2';
  return result;
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
    },
  };
}

/** @param {string | null} [outcome] @returns {any} */
function historicalSourceLessCouncilReturn(outcome = null) {
  const result = councilReturn(outcome);
  result.council.findings = result.council.findings.map(({ source: _source, ...finding }) => finding);
  return result;
}

async function prepareScopedCouncilRecovery(task = councilTask(), councilResult = councilReturn()) {
  const { root, taskDir } = await makeRoot(task);
  await writeFile(join(root, '.jeff', 'profile.md'), 'Test command: `true`\n', 'utf8');
  runGit(root, ['init', '-q']);
  runGit(root, ['config', 'user.email', 'tests@example.com']);
  runGit(root, ['config', 'user.name', 'Tests']);
  runGit(root, ['config', 'commit.gpgsign', 'false']);
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-qm', 'baseline']);

  await recordSpecialistReturn(root, 'council', '18', councilResult);
  await recordSpecialistReturn(root, 'implement', '18', implementReturn('scoped-fix-implementer'));
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-qm', 'record scoped fix']);
  return { root, taskDir };
}

/** @param {string} root @param {Record<string, any>} [overrides] */
async function recordFreshCouncilJudgments(root, overrides = {}) {
  await recordSpecialistReturn(root, 'review', '18', reviewReturn('fresh-reviewer-one', {
    cycle: 1,
    ...overrides.review,
  }));
  if (overrides.includeAudit === true) {
    await recordSpecialistReturn(root, 'audit', '18', auditReturn('fresh-auditor', {
      cycle: 1,
      ...overrides.audit,
    }));
  }
}

async function prepareMixedStageReassessment() {
  const prepared = await prepareScopedCouncilRecovery(
    mixedStageCouncilTask(),
    mixedStageCouncilReturn(),
  );
  await recordSpecialistReturn(prepared.root, 'refactor', '18', refactorReturn('scoped-fix-refactorer'));
  runGit(prepared.root, ['add', '.']);
  runGit(prepared.root, ['commit', '-qm', 'record scoped refactor']);
  return prepared;
}

async function prepareCompletedMixedStageReassessment() {
  const prepared = await prepareMixedStageReassessment();
  const verification = await runVerify(prepared.root, '18');
  assert.equal(verification.code, 0, verification.stderr.join('\n'));
  await recordFreshCouncilJudgments(prepared.root, { includeAudit: true });
  return prepared;
}

test('record accepts the strict plan return and advances the task atomically', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const file = await writeReturn(root, planReturn());

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
    const file = await writeReturn(root, {
      agent_id: 'reviewer',
      stage: 'review',
      cycle: 0,
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

    const result = runCook(root, ['record', 'review', '18', 'reviewer', file]);

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

    const result = runCook(root, ['record', 'implement', '18', 'same-agent', file]);

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
      cycle: 0,
      verdict: 'pass',
      acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: true }],
      findings: [],
      evidence: [{ command: 'git diff', output: 'No findings.' }],
    });

    const result = runCook(root, ['record', 'review', '18', 'same-agent', file]);

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
      cycle: 0,
      verdict: 'pass',
      acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: true }],
      findings: [],
      evidence: [{ command: 'git diff --check', output: 'clean' }],
    };
    const file = await writeReturn(root, specialistReturn);

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
          coverage: [{ category: 'path_traversal', status }],
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

test('review re-entry clears stale outcomes and requires two fresh complex-task reviews', async () => {
  const task = canonicalTask({
    stage: 'review',
    complexity: 'complex',
    agents: { implementer_agent_id: 'implementer-old', reviewer_agent_id: null, reviewer2_agent_id: null, audit_agent_id: null },
    tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
  });
  const { root, taskDir } = await makeRoot(task);
  try {
    const finding = blockingFinding();
    await recordSpecialistReturn(root, 'review', '18', reviewReturn('reviewer-old', {
      verdict: 'needs-work',
      findings: [finding],
    }));
    await recordSpecialistReturn(root, 'refute', '18', {
      agent_id: 'refuter',
      stage: 'refute',
      cycle: 0,
      finding: `${finding.file}:${finding.line} lost result`,
      verdict: 'survives',
      rationale: 'The completion order is reachable.',
      evidence: [{ command: 'node --test', output: 'lost result reproduced' }],
    });
    await recordSpecialistReturn(root, 'implement', '18', implementReturn('implementer-fresh'));
    await recordSpecialistReturn(root, 'refactor', '18', refactorReturn());

    const reset = await readTask(taskDir);
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

test('implementation resets a current-cycle judgment despite a later implement kickback', async (t) => {
  const cases = [
    ['review', 'reviewer_agent_id'],
    ['audit', 'audit_agent_id'],
  ];

  for (const [source, agentField] of cases) {
    await t.test(`${source} judgment`, async () => {
      const priorCycle = { at: '2026-07-12T01:00:00+01:00', review: {}, review2: null, audit: {} };
      const currentReview = {
        verdict: source === 'review' ? 'needs-work' : 'pass',
        reviewer_agent_id: 'reviewer-current',
        findings: source === 'review' ? [blockingFinding()] : [],
        evidence: [{ command: 'node --test', output: 'review evidence' }],
      };
      const currentAudit = {
        required: true,
        verdict: source === 'audit' ? 'needs-work' : 'na',
        audit_agent_id: source === 'audit' ? 'auditor-current' : null,
        findings: source === 'audit' ? [{ ...blockingFinding(), cwe: 'CWE-20' }] : [],
        evidence: [{ command: 'review-security --json', output: 'audit evidence' }],
      };
      const task = canonicalTask({
        stage: 'implement',
        agents: {
          implementer_agent_id: 'implementer-old',
          reviewer_agent_id: 'reviewer-current',
          reviewer2_agent_id: null,
          audit_agent_id: currentAudit.audit_agent_id,
        },
        review: currentReview,
        audit: currentAudit,
        judgmentHistory: [priorCycle],
        kickbacks: [
          { from: source, to: 'implement', reason: `Current ${source} blocker.`, at: '2026-07-12T00:30:00Z' },
          { from: 'implement', to: 'plan', reason: 'Plan revision.', at: '2026-07-12T00:45:00Z' },
        ],
      });
      const { root, taskDir } = await makeRoot(task);
      try {
        await recordSpecialistReturn(root, 'implement', '18', implementReturn('implementer-fresh'));
        const recorded = await readTask(taskDir);

        assert.equal(recorded.judgmentHistory.length, 2);
        assert.deepEqual(recorded.judgmentHistory[1].review, currentReview);
        assert.deepEqual(recorded.judgmentHistory[1].audit, currentAudit);
        assert.equal(recorded.agents[agentField], null);
        assert.equal(recorded.review.reviewer_agent_id, null);
        assert.equal(recorded.review.verdict, null);
        assert.equal(recorded.audit.audit_agent_id, null);
        assert.equal(recorded.audit.verdict, 'na');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('implementation preserves judgments when history consumed the latest judgment kickback', async (t) => {
  const cases = [
    ['older with offset', '2026-07-12T00:30:00-01:00', '2026-07-12T01:00:00Z'],
    ['equal instant', '2026-07-12T01:00:00+01:00', '2026-07-12T00:00:00Z'],
  ];

  for (const [name, boundary, kickbackAt] of cases) {
    await t.test(name, async () => {
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
      const history = [{ at: boundary, review: {}, review2: null, audit: {} }];
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
        judgmentHistory: history,
        kickbacks: [{ from: 'review', to: 'implement', reason: 'Consumed review blocker.', at: kickbackAt }],
      });
      const { root, taskDir } = await makeRoot(task);
      try {
        await recordSpecialistReturn(root, 'implement', '18', implementReturn('implementer-fresh'));
        const recorded = await readTask(taskDir);

        assert.deepEqual(recorded.judgmentHistory, history);
        assert.equal(recorded.agents.reviewer_agent_id, 'reviewer-current');
        assert.equal(recorded.agents.audit_agent_id, 'auditor-current');
        assert.deepEqual(recorded.review, currentReview);
        assert.deepEqual(recorded.audit, currentAudit);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
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
    await recordSpecialistReturn(second.root, 'refute', '18', {
      agent_id: 'refuter',
      stage: 'refute',
      cycle: 0,
      finding: `${blocker.file}:${blocker.line} lost result`,
      verdict: 'refuted',
      rationale: 'The upstream guard prevents the failure.',
      evidence: [{ command: 'sed -n 1,20p src/core/record.js', output: 'guard present' }],
    });
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
  task.judgmentHistory = [{ at: '2026-07-12T00:00:01Z', review: {}, review2: null, audit: {} }];
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

test('issue 65 shared recorder rejects a spoofed specialist identity without changing the task', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');

    await assert.rejects(
      recordObservedSpecialistReturn(root, 'plan', '18', planReturn({ agent_id: 'claimed-agent' }), 'observed-agent'),
      /\[record-identity\]/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 65 CLI passes observed identity separately and rejects payload spoofing atomically', async () => {
  const { root, taskDir } = await makeRoot();
  try {
    const before = await readFile(join(taskDir, 'task.json'), 'utf8');
    const file = await writeReturn(root, planReturn({ agent_id: 'claimed-agent' }));

    const result = runCook(root, ['record', 'plan', '18', 'observed-agent', file]);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /\[record-identity\]/);
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 65 refute identity cannot reuse the implementer', async () => {
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

test('issue 65 cycle 2 council members cannot reuse any prior judge identity', async (t) => {
  /** @type {Array<[string, Record<string, any>]>} */
  const forbiddenAgentIds = [
    ['implementer', {}],
    ['reviewer-one', {}],
    ['reviewer-two', {}],
    ['auditor', {}],
    ['refuter', {}],
    ['council-security', {}],
    ['historical-auditor', {
      judgmentHistory: [{
        at: '2026-07-12T00:00:01Z',
        review: {
          verdict: 'pass',
          reviewer_agent_id: 'historical-reviewer',
          findings: [],
          evidence: ['historical review evidence'],
        },
        review2: null,
        audit: {
          required: true,
          verdict: 'pass',
          audit_agent_id: 'historical-auditor',
          findings: [],
          evidence: ['historical audit evidence'],
        },
      }],
    }],
  ];
  for (const [agentId, taskOverrides] of forbiddenAgentIds) {
    await t.test(agentId, async () => {
      const { root, taskDir } = await makeRoot(councilTask(taskOverrides));
      try {
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');

        await assert.rejects(
          recordSpecialistReturn(root, 'council', '18', councilReturn(null, { 0: { agent_id: agentId } })),
          agentId === 'historical-auditor'
            ? /\[record-identity\] council member historical-auditor reuses a prior judge identity/
            : /\[(?:record-identity|inv8)\]/,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
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

test('issue 65 scoped council completion requires fresh verification after the recorded fix', async () => {
  const { root, taskDir } = await makeRoot(councilTask());
  try {
    await recordSpecialistReturn(root, 'council', '18', councilReturn());
    await recordSpecialistReturn(root, 'implement', '18', implementReturn('scoped-fix-implementer'));
    await recordSpecialistReturn(root, 'refactor', '18', refactorReturn('scoped-fix-refactorer'));
    await recordFreshCouncilJudgments(root);
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

test('issue 65 council fix failed scoped implementation blocks atomically and cannot re-run', async () => {
  const priorGate = {
    hash: 'prior-gate',
    clean: true,
    green: true,
    command: 'make test',
    at: '2026-07-12T00:00:01Z',
  };
  const task = councilTask({
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
  const { root, taskDir } = await makeRoot(councilTask());
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
    await recordSpecialistReturn(root, 'refactor', '18', refactorReturn('scoped-fix-refactorer'));
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'record scoped fix']);
    const scopedFixHash = runGit(root, ['rev-parse', 'HEAD']);

    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    const gated = await readTask(taskDir);
    assert.equal(gated.tests.gate.hash, scopedFixHash);
    assert.equal(gated.tests.gate.clean, true);
    assert.equal(gated.tests.gate.green, true);

    await recordFreshCouncilJudgments(root);
    await recordSpecialistReturn(root, 'council', '18', councilReturn('scoped-fix-shipped'));
    const recorded = await readTask(taskDir);
    assert.equal(recorded.convergence.council.outcome, 'scoped-fix-shipped');
    assert.equal(recorded.stage, 'done');
    assert.equal(recorded.status, 'done');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 65 cycle 1 review2-origin recovery accepts a recorded fix and fresh gate', async () => {
  const { root } = await prepareScopedCouncilRecovery(reviewTwoCouncilTask(), reviewTwoCouncilReturn());
  try {
    await recordSpecialistReturn(root, 'refactor', '18', refactorReturn('scoped-fix-refactorer'));
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'record scoped refactor']);
    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));

    await recordFreshCouncilJudgments(root);
    const recorded = await recordSpecialistReturn(
      root,
      'council',
      '18',
      reviewTwoCouncilReturn('scoped-fix-shipped'),
    );
    assert.deepEqual(
      [recorded.stage, recorded.status, recorded.convergence.council.outcome],
      ['done', 'done', 'scoped-fix-shipped'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 65 cycle 1 council recovery accepts semantically equal reordered keys', async () => {
  const { root } = await prepareScopedCouncilRecovery();
  try {
    await recordSpecialistReturn(root, 'refactor', '18', refactorReturn('scoped-fix-refactorer'));
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'record scoped refactor']);
    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    await recordFreshCouncilJudgments(root);
    const original = councilReturn('scoped-fix-shipped').council;
    const reordered = {
      stage: 'council',
      council: {
        outcome: original.outcome,
        verdict: original.verdict,
        findings: original.findings,
        members: original.members,
        stage: original.stage,
        convened: original.convened,
      },
    };

    await assert.doesNotReject(recordSpecialistReturn(root, 'council', '18', reordered));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 65 cycle 1 recovery rejects a gate made stale by a later refactor', async () => {
  const { root, taskDir } = await prepareScopedCouncilRecovery();
  try {
    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    await recordSpecialistReturn(root, 'refactor', '18', refactorReturn('later-refactorer'));
    await writeFile(join(root, 'refactor-marker.txt'), 'later code-changing transition\n', 'utf8');
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'record later refactor']);
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

test('issue 67 mixed-stage scoped recovery preserves old judgments and ships only fresh passes', async () => {
  const original = mixedStageCouncilTask();
  const { root, taskDir } = await prepareMixedStageReassessment();
  try {
    const afterFix = await readTask(taskDir);
    assert.equal(afterFix.judgmentHistory.length, 1);
    assert.deepEqual(afterFix.judgmentHistory[0].review, original.review);
    assert.deepEqual(afterFix.judgmentHistory[0].review2, original.review2);
    assert.deepEqual(afterFix.judgmentHistory[0].audit, original.audit);
    assert.equal(afterFix.review.reviewer_agent_id, null);
    assert.equal(afterFix.review2.reviewer_agent_id, 'reviewer-two');
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

test('issue 67 fresh reassessment rejects every recovery identity atomically', async () => {
  const { root, taskDir } = await prepareMixedStageReassessment();
  try {
    assert.equal((await readTask(taskDir)).judgmentHistory.length, 1);
    const forbiddenAgentIds = [
      'scoped-fix-implementer',
      'reviewer-one',
      'reviewer-two',
      'auditor',
      'refuter',
      'audit-refuter',
      'council-integrity',
      'council-security',
      'council-pragmatist',
    ];

    for (const agentId of forbiddenAgentIds) {
      const before = await readFile(join(taskDir, 'task.json'), 'utf8');
      await assert.rejects(
        recordSpecialistReturn(root, 'review', '18', reviewReturn(agentId, { cycle: 1 })),
        /\[(?:record-identity|record-transition)\]/,
      );
      assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
    }

    const beforeAuditReuse = await readFile(join(taskDir, 'task.json'), 'utf8');
    await assert.rejects(
      recordSpecialistReturn(root, 'audit', '18', auditReturn('reviewer-one', { cycle: 1 })),
      /\[record-identity\]/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), beforeAuditReuse);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 67 failed fresh reassessment blocks without permitting another implementation cycle', async () => {
  const { root, taskDir } = await prepareMixedStageReassessment();
  try {
    const blocker = blockingFinding({
      line: 30,
      what: 'The scoped recovery still fails reassessment.',
      why: 'The original mixed-stage defect remains reachable after the scoped fix.',
    });
    await recordSpecialistReturn(root, 'review', '18', reviewReturn('fresh-failing-reviewer', {
      cycle: 1,
      verdict: 'needs-work',
      findings: [blocker],
    }));
    const beforeShip = await readFile(join(taskDir, 'task.json'), 'utf8');

    await assert.rejects(
      recordSpecialistReturn(root, 'council', '18', mixedStageCouncilReturn('scoped-fix-shipped')),
      /\[record-transition\].*(?:current|fresh).*judgment.*pass/,
    );
    assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), beforeShip);

    const blocked = await recordSpecialistReturn(
      root,
      'council',
      '18',
      mixedStageCouncilReturn('blocked-to-operator'),
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

test('issue 67 review cycle 2 surviving non-council refute cannot reopen implementation', async () => {
  const { root, taskDir } = await prepareMixedStageReassessment();
  try {
    await recordSpecialistReturn(root, 'review', '18', reviewReturn('fresh-reviewer-one', { cycle: 1 }));
    const blocker = {
      ...blockingFinding({
        line: 31,
        what: 'The parallel audit still fails after the scoped council fix.',
        why: 'A failed fresh reassessment must terminate the one allowed recovery cycle.',
      }),
      cwe: 'CWE-20',
    };
    await recordSpecialistReturn(root, 'audit', '18', auditReturn('fresh-failing-auditor', {
      cycle: 1,
      verdict: 'needs-work',
      findings: [blocker],
    }));

    const blocked = await recordSpecialistReturn(root, 'refute', '18', refuteReturn(
      'fresh-audit-refuter',
      blocker,
      { cycle: 1, source: 'audit' },
    ));
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.convergence.council.outcome, 'blocked-to-operator');
    assert.notEqual(blocked.stage, 'implement');

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

test('issue 67 review cycle 1 source-bound findings reopen paraphrased colliding review and audit blockers', async () => {
  const task = mixedStageCouncilTask();
  const collidingWhat = 'A shared recorder defect leaves the recovery evidence stale.';
  task.review.findings[0].what = collidingWhat;
  task.review.findings[0].refute.finding = `${task.review.findings[0].file}:${task.review.findings[0].line} ${collidingWhat}`;
  task.audit.findings[0].what = collidingWhat;
  task.audit.findings[0].refute.finding = `${task.audit.findings[0].file}:${task.audit.findings[0].line} ${collidingWhat}`;
  task.refutes = [task.review.findings[0].refute, task.audit.findings[0].refute];
  const result = mixedStageCouncilReturn();
  result.council.findings[0] = {
    ...result.council.findings[0],
    source: 'review',
    summary: 'Review found stale recovery evidence after a successful fix.',
  };
  result.council.findings[1] = {
    ...result.council.findings[1],
    source: 'audit',
    summary: 'Audit independently found stale evidence at the terminal boundary.',
  };

  const { root, taskDir } = await prepareScopedCouncilRecovery(task, result);
  try {
    const recorded = await readTask(taskDir);
    assert.equal(recorded.review.reviewer_agent_id, null);
    assert.equal(recorded.review2.reviewer_agent_id, 'reviewer-two');
    assert.equal(recorded.audit.audit_agent_id, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 67 review cycle 1 source-bound net-new council finding reopens its affected review slot', async () => {
  const result = councilReturn();
  result.council.findings[0] = {
    ...result.council.findings[0],
    source: 'review2',
    summary: 'The council found a distinct boundary failure not copied from specialist prose.',
  };

  const { root, taskDir } = await prepareScopedCouncilRecovery(reviewTwoCouncilTask(), result);
  try {
    const recorded = await readTask(taskDir);
    assert.equal(recorded.review.reviewer_agent_id, 'reviewer-one');
    assert.equal(recorded.review2, null);
    assert.equal(recorded.audit.audit_agent_id, 'auditor');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 67 review cycle 2 new councils require a valid finding source atomically', async (t) => {
  /** @type {Array<[string, any, RegExp]>} */
  const cases = [
    ['missing', historicalSourceLessCouncilReturn(), /\[record-transition\].*source.*required/],
    ['invalid', (() => {
      const result = councilReturn();
      result.council.findings[0].source = 'release';
      return result;
    })(), /\[record-schema\].*council\.findings\[0\]\.source/],
  ];

  for (const [name, returned, error] of cases) {
    await t.test(name, async () => {
      const { root, taskDir } = await makeRoot(councilTask());
      try {
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        const file = await writeReturn(root, returned);
        const result = runCook(root, ['record', 'council', '18', file]);

        assert.notEqual(result.code, 0);
        assert.match(result.stderr, error);
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 67 review cycle 2 historical source-less council remains recoverable', async () => {
  const task = councilTask();
  task.stage = 'implement';
  task.convergence.council = historicalSourceLessCouncilReturn().council;
  const { root } = await makeRoot(task);
  try {
    await writeFile(join(root, '.jeff', 'profile.md'), 'Test command: `true`\n', 'utf8');
    runGit(root, ['init', '-q']);
    runGit(root, ['config', 'user.email', 'tests@example.com']);
    runGit(root, ['config', 'user.name', 'Tests']);
    runGit(root, ['config', 'commit.gpgsign', 'false']);
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'historical council']);

    await recordSpecialistReturn(root, 'implement', '18', implementReturn('scoped-fix-implementer'));
    await recordSpecialistReturn(root, 'refactor', '18', refactorReturn('scoped-fix-refactorer'));
    runGit(root, ['add', '.']);
    runGit(root, ['commit', '-qm', 'record scoped fix']);
    const verification = await runVerify(root, '18');
    assert.equal(verification.code, 0, verification.stderr.join('\n'));
    await recordFreshCouncilJudgments(root);

    const recorded = await recordSpecialistReturn(
      root,
      'council',
      '18',
      historicalSourceLessCouncilReturn('scoped-fix-shipped'),
    );
    assert.deepEqual(
      [recorded.stage, recorded.status, recorded.convergence.council.outcome],
      ['done', 'done', 'scoped-fix-shipped'],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('issue 67 review cycle 1 archives agents-only reviewer and auditor identities before clearing slots', async (t) => {
  const cases = [
    ['review', 'agents-only-reviewer'],
    ['audit', 'agents-only-auditor'],
  ];

  for (const [stage, agentId] of cases) {
    await t.test(stage, async () => {
      const task = mixedStageCouncilTask();
      task.agents.reviewer_agent_id = 'agents-only-reviewer';
      task.review.reviewer_agent_id = null;
      task.agents.audit_agent_id = 'agents-only-auditor';
      task.audit.audit_agent_id = null;
      const { root, taskDir } = await prepareScopedCouncilRecovery(task, mixedStageCouncilReturn());
      try {
        await recordSpecialistReturn(root, 'refactor', '18', refactorReturn('scoped-fix-refactorer'));
        const archived = await readTask(taskDir);
        assert.equal(archived.judgmentHistory[0].review.reviewer_agent_id, null);
        assert.equal(archived.judgmentHistory[0].audit.audit_agent_id, null);
        assert.equal(archived.judgmentHistory[0].agents?.reviewer_agent_id, 'agents-only-reviewer');
        assert.equal(archived.judgmentHistory[0].agents?.audit_agent_id, 'agents-only-auditor');
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');
        const returned = stage === 'review'
          ? reviewReturn(agentId, { cycle: 1 })
          : auditReturn(agentId, { cycle: 1 });

        await assert.rejects(
          recordSpecialistReturn(root, stage, '18', returned),
          /\[record-identity\].*specialist separation/,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('issue 67 review cycle 1 scoped completion rejects post-verify HEAD drift atomically', async () => {
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

test('issue 67 review cycle 2 scoped completion rejects current non-state dirt atomically', async (t) => {
  /** @type {Array<[string, boolean | null]>} */
  const cases = [
    ['modified', false],
    ['staged', true],
    ['untracked', null],
  ];

  for (const [name, staged] of cases) {
    await t.test(name, async () => {
      const { root, taskDir } = await prepareMixedStageReassessment();
      try {
        const checkpointFile = join(root, 'checkpoint.txt');
        if (staged !== null) {
          await writeFile(checkpointFile, 'verified content\n', 'utf8');
          runGit(root, ['add', 'checkpoint.txt']);
          runGit(root, ['commit', '-qm', 'add checkpoint content']);
        }
        const verification = await runVerify(root, '18');
        assert.equal(verification.code, 0, verification.stderr.join('\n'));
        await recordFreshCouncilJudgments(root, { includeAudit: true });

        await writeFile(
          staged === null ? join(root, 'untracked.txt') : checkpointFile,
          'content not covered by the gate\n',
          'utf8',
        );
        if (staged === true) runGit(root, ['add', 'checkpoint.txt']);
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
  }
});

test('issue 67 review cycle 1 scoped completion rejects persisted pass labels with blockers atomically', async () => {
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

test('issue 67 review cycle 2 isolates stale council and implementer recovery bindings', async (t) => {
  /** @type {Array<[string, (task: any) => void]>} */
  const cases = [
    ['council', (task) => {
      task.judgmentHistory.at(-1).recovery.council.findings[0].summary = 'A stale prior council finding.';
    }],
    ['implementer', (task) => {
      task.judgmentHistory.at(-1).recovery.implementer_agent_id = 'stale-scoped-implementer';
    }],
  ];

  for (const [name, makeStale] of cases) {
    await t.test(name, async () => {
      const { root, taskDir } = await prepareCompletedMixedStageReassessment();
      try {
        const forged = await readTask(taskDir);
        makeStale(forged);
        await writeFile(join(taskDir, 'task.json'), `${JSON.stringify(forged, null, 2)}\n`, 'utf8');
        const before = await readFile(join(taskDir, 'task.json'), 'utf8');

        await assert.rejects(
          recordSpecialistReturn(root, 'council', '18', mixedStageCouncilReturn('scoped-fix-shipped')),
          /\[record-transition\].*(?:active|scoped|recovery).*(?:cycle|history|implementation)/,
        );
        assert.equal(await readFile(join(taskDir, 'task.json'), 'utf8'), before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
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
