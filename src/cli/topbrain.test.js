// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * Test design (.jeff/tasks/item4-brains/notes.md, "## Test design"), AC5:
 * spawn `cook topbrain` (src/cli/cook.js, the new VERBS entry) with an
 * isolated `mkdtemp` COOK_ROOT + explicit env, no cook.sh oracle (greenfield
 * verb). Asserts config `topBrain` > env `JEFF_TOP_BRAIN` > unset, printing
 * one token (`fable` | `default`), exit 0 in every case (never hard-fails).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const COOK_JS = join(REPO_ROOT, 'src', 'cli', 'cook.js');

/**
 * @param {string} root
 * @param {Record<string, string>} [env]
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runTopbrain(root, env = {}) {
  const res = spawnSync(process.execPath, [COOK_JS, 'topbrain'], {
    env: { ...process.env, COOK_ROOT: root, JEFF_TOP_BRAIN: '', ...env },
    encoding: 'utf8',
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/**
 * @param {string} root
 * @param {string} body - raw file body (may be invalid JSON, for the degrade row)
 */
async function writeConfigRaw(root, body) {
  await mkdir(join(root, '.jeff'), { recursive: true });
  await writeFile(join(root, '.jeff', 'config.json'), body, 'utf8');
}

test('cook topbrain: config topBrain=fable -> prints fable, exit 0', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-topbrain-test-'));
  try {
    await writeConfigRaw(dir, JSON.stringify({ topBrain: 'fable' }));
    const result = runTopbrain(dir);
    assert.equal(result.stdout, 'fable\n');
    assert.equal(result.code, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cook topbrain: env JEFF_TOP_BRAIN=fable, no config -> prints fable, exit 0', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-topbrain-test-'));
  try {
    const result = runTopbrain(dir, { JEFF_TOP_BRAIN: 'fable' });
    assert.equal(result.stdout, 'fable\n');
    assert.equal(result.code, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cook topbrain: config present (non-fable) + env=fable -> prints default (config wins, env not consulted)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-topbrain-test-'));
  try {
    await writeConfigRaw(dir, JSON.stringify({ topBrain: 'opus' }));
    const result = runTopbrain(dir, { JEFF_TOP_BRAIN: 'fable' });
    assert.equal(result.stdout, 'default\n');
    assert.equal(result.code, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cook topbrain: neither config nor env -> prints default, exit 0', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-topbrain-test-'));
  try {
    const result = runTopbrain(dir);
    assert.equal(result.stdout, 'default\n');
    assert.equal(result.code, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cook topbrain: unparseable config + env=fable -> degrades to env, prints fable, never hard-fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-topbrain-test-'));
  try {
    await writeConfigRaw(dir, '{ not json');
    const result = runTopbrain(dir, { JEFF_TOP_BRAIN: 'fable' });
    assert.equal(result.stdout, 'fable\n');
    assert.equal(result.code, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cook topbrain: top-level primitive config -> degrades to env/default, never hard-fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-topbrain-test-'));
  try {
    await writeConfigRaw(dir, '42');
    const result = runTopbrain(dir, { JEFF_TOP_BRAIN: 'fable' });
    assert.equal(result.stdout, 'fable\n');
    assert.equal(result.code, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
