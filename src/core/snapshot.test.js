// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSnapshot, snapshotReport } from './snapshot.js';

const FIXED_NOW = new Date('2026-08-02T12:00:00.000Z');

/**
 * @param {string} root
 * @param {string} [prefix]
 */
async function treeMap(root, prefix = '') {
  /** @type {Record<string, string>} */
  const out = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, await treeMap(root, rel));
    else out[rel] = await readFile(join(root, rel), 'utf8');
  }
  return out;
}

/**
 * @param {string} root
 * @param {Record<string, unknown>} config
 */
async function writeConfig(root, config) {
  await mkdir(join(root, '.jeff', 'tasks'), { recursive: true });
  await writeFile(join(root, '.jeff', 'config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/**
 * @param {string} root
 * @param {string} dirName
 * @param {Record<string, unknown>} task
 */
async function writeTaskDir(root, dirName, task) {
  const dir = join(root, '.jeff', 'tasks', dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
}

/** @param {Record<string, unknown>} overrides */
function baseTask(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 1,
    slug: 'alpha',
    title: 'Alpha',
    status: 'pending',
    stage: 'capture',
    priority: 'p2',
    deps: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
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
}

test('buildSnapshot golden: fixture store projects documented JSON with tasks sorted by id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jeff-snapshot-golden-'));
  try {
    await writeConfig(root, {
      schemaVersion: 1,
      system: 'jeff',
      mode: 'lite',
      active: true,
    });
    // Path order is beta before alpha; projection must sort by id.
    await writeTaskDir(
      root,
      '020-beta',
      baseTask({
        id: 20,
        slug: 'beta',
        title: 'Beta',
        status: 'in_progress',
        stage: 'plan',
        category: 'code',
        priority: 'p1',
        deps: [10],
        discoveredFrom: 10,
        plan: {
          result: 'red',
          slices: ['do the work'],
          testFiles: ['src/core/snapshot.test.js'],
          redRun: { command: 'node --test', output: 'missing' },
          escalation: null,
          refactorOpportunity: null,
        },
      }),
    );
    await writeTaskDir(
      root,
      '010-alpha',
      baseTask({
        id: 10,
        slug: 'alpha',
        title: 'Alpha',
        status: 'blocked',
        stage: 'plan',
        category: 'operation',
        priority: 'p0',
        deps: [],
        blockedReason: 'waiting on operator fork',
        plan: {
          result: 'escalation',
          slices: ['Resolve the registry ownership fork.'],
          escalation: {
            fork: 'Which registry is authoritative?',
            options: ['local', 'remote'],
          },
        },
      }),
    );

    const doc = await buildSnapshot(root, { now: () => FIXED_NOW });

    assert.deepEqual(doc, {
      schemaVersion: 1,
      generatedAt: '2026-08-02T12:00:00.000Z',
      mode: 'lite',
      tasks: [
        {
          id: 10,
          slug: 'alpha',
          title: 'Alpha',
          status: 'blocked',
          stage: 'plan',
          category: 'operation',
          priority: 'p0',
          deps: [],
          blockedReason: 'waiting on operator fork',
          escalation: {
            fork: 'Which registry is authoritative?',
            options: ['local', 'remote'],
          },
        },
        {
          id: 20,
          slug: 'beta',
          title: 'Beta',
          status: 'in_progress',
          stage: 'plan',
          category: 'code',
          priority: 'p1',
          deps: [10],
          discoveredFrom: 10,
          blockedReason: null,
        },
      ],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildSnapshot optionality: legacy store omits claim and maxParallelTasks; present state projects them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jeff-snapshot-opt-'));
  try {
    await writeConfig(root, {
      schemaVersion: 1,
      system: 'jeff',
      mode: 'full',
      active: true,
    });
    await writeTaskDir(root, '0001-legacy', baseTask({ id: 1, slug: 'legacy', title: 'Legacy' }));

    const legacy = await buildSnapshot(root, { now: () => FIXED_NOW });
    assert.equal(Object.hasOwn(legacy, 'maxParallelTasks'), false);
    assert.equal(legacy.tasks.length, 1);
    assert.equal(Object.hasOwn(legacy.tasks[0], 'claim'), false);
    assert.equal(Object.hasOwn(legacy.tasks[0], 'category'), false);
    assert.equal(Object.hasOwn(legacy.tasks[0], 'discoveredFrom'), false);
    assert.equal(Object.hasOwn(legacy.tasks[0], 'escalation'), false);

    // Item 7 claim lives beside the task dir, not on task.json.
    // collectTasks ignores .claim; snapshot must read the side file.
    await writeConfig(root, {
      schemaVersion: 1,
      system: 'jeff',
      mode: 'full',
      active: true,
      maxParallelTasks: 3,
    });
    await writeTaskDir(
      root,
      '0001-legacy',
      baseTask({
        id: 1,
        slug: 'legacy',
        title: 'Legacy',
        category: 'code',
      }),
    );
    const claimDir = join(root, '.jeff', 'tasks', '0001-legacy', '.claim');
    await mkdir(claimDir, { recursive: true });
    const claim = { by: 'worker-a', at: '2026-08-02T11:00:00.000Z' };
    await writeFile(join(claimDir, 'claim.json'), `${JSON.stringify(claim)}\n`, 'utf8');

    const withItem7 = await buildSnapshot(root, { now: () => FIXED_NOW });
    assert.equal(withItem7.maxParallelTasks, 3);
    assert.deepEqual(withItem7.tasks[0].claim, claim);
    assert.equal(withItem7.tasks[0].category, 'code');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('snapshotReport is read-only: .jeff tree bytes are identical before and after', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jeff-snapshot-ro-'));
  try {
    await writeConfig(root, {
      schemaVersion: 1,
      system: 'jeff',
      mode: 'lite',
      active: true,
    });
    await writeTaskDir(root, '0002-ro', baseTask({ id: 2, slug: 'ro', title: 'Read only' }));
    const before = await treeMap(join(root, '.jeff'));

    const report = await snapshotReport(root, { now: () => FIXED_NOW });
    assert.equal(report.code, 0);
    assert.equal(report.stderr.length, 0);
    assert.equal(report.stdout.length, 1);
    JSON.parse(report.stdout[0]);

    const after = await treeMap(join(root, '.jeff'));
    assert.deepEqual(after, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
