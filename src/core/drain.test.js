// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configSchemaViolations } from './task-schema.js';
import { collectTasks } from './store.js';

const FIXED_NOW = new Date('2026-08-05T12:00:00.000Z');

async function loadDrain() {
  return import('./drain.js');
}

async function makeRoot(config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jeff-drain-'));
  await mkdir(join(root, '.jeff', 'tasks'), { recursive: true });
  await writeFile(
    join(root, '.jeff', 'config.json'),
    `${JSON.stringify({ schemaVersion: 1, system: 'jeff', active: true, ...config })}\n`,
    'utf8',
  );
  return root;
}

async function writeTask(root, overrides) {
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

async function writeClaim(taskDir, by, at) {
  const claimDir = join(taskDir, '.claim');
  await mkdir(claimDir, { recursive: true });
  await writeFile(join(claimDir, 'claim.json'), `${JSON.stringify({ by, at })}\n`, 'utf8');
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test('readyReport returns the dependency matrix in priority then numeric id order', async () => {
  const root = await makeRoot({ prunedTaskIds: [90] });
  try {
    await writeTask(root, { id: 1, slug: 'done-dep', title: 'Done dependency', status: 'done', stage: 'done', priority: 'p4' });
    await writeTask(root, { id: 2, slug: 'done-ready', title: 'Done ready', priority: 'p2', deps: [1] });
    await writeTask(root, { id: 3, slug: 'pruned-ready', title: 'Pruned ready', priority: 'p1', deps: [90] });
    await writeTask(root, { id: 4, slug: 'blocked-dep', title: 'Blocked dependency', status: 'blocked', priority: 'p0' });
    await writeTask(root, { id: 5, slug: 'blocked-waiter', title: 'Blocked waiter', priority: 'p0', deps: [4] });
    await writeTask(root, { id: 6, slug: 'missing-waiter', title: 'Missing waiter', priority: 'p0', deps: [404] });
    await writeTask(root, { id: 7, slug: 'live-waiter', title: 'Live waiter', priority: 'p0', deps: [8] });
    const claimedDir = await writeTask(root, { id: 8, slug: 'claimed', title: 'Claimed', priority: 'p0' });
    await writeClaim(claimedDir, 'lane-a', '2026-08-05T10:00:00.000Z');
    await writeTask(root, { id: 9, slug: 'in-progress', title: 'In progress', status: 'in_progress', priority: 'p1' });
    await writeTask(root, { id: 10, slug: 'abandoned', title: 'Abandoned', status: 'abandoned', stage: 'done', priority: 'p0' });
    await writeTask(root, { id: 11, slug: 'first', title: 'First', priority: 'p0' });

    const { readyReport } = await loadDrain();
    const report = await readyReport(root);

    assert.equal(report.code, 0, report.stderr.join('\n'));
    assert.deepEqual(report.stdout.map((line) => JSON.parse(line)), [
      { id: 11, slug: 'first', title: 'First', priority: 'p0', deps: [] },
      { id: 3, slug: 'pruned-ready', title: 'Pruned ready', priority: 'p1', deps: [90] },
      { id: 9, slug: 'in-progress', title: 'In progress', priority: 'p1', deps: [] },
      { id: 2, slug: 'done-ready', title: 'Done ready', priority: 'p2', deps: [1] },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('claimReport atomically admits exactly one concurrent claimant and writes one complete claim', async () => {
  const root = await makeRoot();
  try {
    const taskDir = await writeTask(root, { id: 12, slug: 'atomic', title: 'Atomic claim' });
    const { claimReport } = await loadDrain();

    const reports = await Promise.all([
      claimReport(root, '12', { by: 'lane-a', now: () => FIXED_NOW }),
      claimReport(root, '12', { by: 'lane-b', now: () => FIXED_NOW }),
    ]);

    assert.deepEqual(reports.map(({ code }) => code).sort(), [0, 1]);
    const claim = JSON.parse(await readFile(join(taskDir, '.claim', 'claim.json'), 'utf8'));
    assert.deepEqual(claim, {
      by: reports[0].code === 0 ? 'lane-a' : 'lane-b',
      at: FIXED_NOW.toISOString(),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('claimReport names the existing holder when a task is already claimed', async () => {
  const root = await makeRoot();
  try {
    const taskDir = await writeTask(root, { id: 13, slug: 'held', title: 'Held claim' });
    await writeClaim(taskDir, 'lane-owner', '2026-08-05T10:00:00.000Z');
    const { claimReport } = await loadDrain();

    const report = await claimReport(root, '13', { by: 'lane-loser', now: () => FIXED_NOW });

    assert.equal(report.code, 1);
    assert.match(report.stderr.join('\n'), /lane-owner/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('claimReport refuses blocked and terminal tasks without leaving a claim', async () => {
  const root = await makeRoot();
  try {
    const fixtures = [
      [20, 'blocked'],
      [21, 'done'],
      [22, 'abandoned'],
    ];
    const dirs = await Promise.all(fixtures.map(([id, status]) => writeTask(root, {
      id,
      slug: `${status}-task`,
      title: `${status} task`,
      status,
      stage: status === 'blocked' ? 'implement' : 'done',
    })));
    const { claimReport } = await loadDrain();

    for (const [index, [id, status]] of fixtures.entries()) {
      const report = await claimReport(root, String(id), { by: 'lane-a', now: () => FIXED_NOW });
      assert.equal(report.code, 1, `${status} claim unexpectedly succeeded`);
      assert.match(report.stderr.join('\n'), new RegExp(status));
      assert.equal(await exists(join(dirs[index], '.claim')), false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('releaseReport removes an active claim and errors when the task is unclaimed', async () => {
  const root = await makeRoot();
  try {
    const taskDir = await writeTask(root, { id: 30, slug: 'release', title: 'Release claim' });
    await writeClaim(taskDir, 'lane-a', '2026-08-05T10:00:00.000Z');
    const { releaseReport } = await loadDrain();

    const released = await releaseReport(root, '30');
    const repeated = await releaseReport(root, '30');

    assert.equal(released.code, 0, released.stderr.join('\n'));
    assert.equal(await exists(join(taskDir, '.claim')), false);
    assert.equal(repeated.code, 1);
    assert.match(repeated.stderr.join('\n'), /unclaimed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('claimsReport lists every active claim with deterministic age seconds', async () => {
  const root = await makeRoot();
  try {
    const first = await writeTask(root, { id: 40, slug: 'first-claim', title: 'First claim' });
    const second = await writeTask(root, { id: 41, slug: 'second-claim', title: 'Second claim' });
    await writeTask(root, { id: 42, slug: 'unclaimed', title: 'Unclaimed task' });
    await writeClaim(first, 'lane-a', '2026-08-05T11:00:00.000Z');
    await writeClaim(second, 'lane-b', '2026-08-05T10:00:00.000Z');
    const { claimsReport } = await loadDrain();

    const report = await claimsReport(root, { now: () => FIXED_NOW });
    const claims = report.stdout.map((line) => JSON.parse(line)).sort((a, b) => a.id - b.id);

    assert.equal(report.code, 0, report.stderr.join('\n'));
    assert.deepEqual(claims.map(({ id, by, at, ageSeconds }) => ({ id, by, at, ageSeconds })), [
      { id: 40, by: 'lane-a', at: '2026-08-05T11:00:00.000Z', ageSeconds: 3600 },
      { id: 41, by: 'lane-b', at: '2026-08-05T10:00:00.000Z', ageSeconds: 7200 },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('maxParallelTasks defaults to one when the optional field is absent', async () => {
  const { maxParallelTasks } = await loadDrain();

  assert.equal(maxParallelTasks(null), 1);
  assert.equal(maxParallelTasks({}), 1);
  assert.equal(maxParallelTasks({ maxParallelTasks: 3 }), 3);
});

test('config validation accepts only positive integer maxParallelTasks values', () => {
  for (const value of [1, 2, 99]) {
    assert.deepEqual(configSchemaViolations({ maxParallelTasks: value }, { lite: false }), []);
  }
  for (const value of [0, -1, 1.5, '2', null, true]) {
    assert.match(
      configSchemaViolations({ maxParallelTasks: value }, { lite: false }).join('\n'),
      /maxParallelTasks/,
      `invalid value passed validation: ${JSON.stringify(value)}`,
    );
  }
});

test('collectTasks is indifferent to operational .claim state', async () => {
  const root = await makeRoot();
  try {
    const taskDir = await writeTask(root, { id: 50, slug: 'collected', title: 'Collected task' });
    const before = await collectTasks(root);
    await writeClaim(taskDir, 'lane-a', '2026-08-05T10:00:00.000Z');

    const after = await collectTasks(root);

    assert.deepEqual(after, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
