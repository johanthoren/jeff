import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTask, writeTask } from './store.js';

/** @type {import('./types.js').TaskJson} */
const TASK = {
  schemaVersion: 1,
  id: 3,
  slug: 'lite-3',
  title: 'Lite 3',
  status: 'in_progress',
  stage: 'test',
  priority: 'p2',
  deps: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  branch: null,
  agents: {
    plan_agent_id: null,
    test_author_agent_id: null,
    implementer_agent_id: null,
    reviewer_agent_id: null,
    audit_agent_id: null,
  },
  tests: { authored_by_agent_id: null, green: false, evidence: [] },
  review: { verdict: null, reviewer_agent_id: null, evidence: [] },
  audit: { required: false, verdict: 'na', audit_agent_id: null, evidence: [] },
  commits: [],
  kickbacks: [],
  blockedReason: null,
  abandonReason: null,
};

test('writeTask then readTask round-trips a task object unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-store-test-'));
  try {
    await writeTask(dir, TASK);
    const result = await readTask(dir);

    assert.deepEqual(result, TASK);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readTask rejects when the dir has no task.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-store-test-'));
  try {
    await assert.rejects(() => readTask(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeTask persists task.json with mode 0600', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-store-test-'));
  try {
    await writeTask(dir, TASK);
    const st = await stat(join(dir, 'task.json'));
    assert.equal(st.mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeTask unlinks the temp file and rejects when rename fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-store-test-'));
  try {
    // Force a deterministic rename() failure: make the target a directory, so
    // rename(tmpFile, dir/task.json) fails EISDIR (POSIX: non-dir onto existing dir).
    await mkdir(join(dir, 'task.json'));
    await assert.rejects(() => writeTask(dir, TASK));
    const leftovers = await readdir(dir);
    assert.ok(
      !leftovers.some((n) => n.endsWith('.tmp')),
      `orphan temp file left behind: ${leftovers.join(', ')}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
