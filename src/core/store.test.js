import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTask, writeTask } from './store.js';

test('writeTask then readTask round-trips a task object unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-store-test-'));
  try {
    const task = {
      id: 'lite-3',
      status: 'in-progress',
      stage: 'test',
      priority: 'p2',
    };

    await writeTask(dir, task);
    const result = await readTask(dir);

    assert.deepEqual(result, task);
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
