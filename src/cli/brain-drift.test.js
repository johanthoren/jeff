// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * Test design (.jeff/tasks/item4-brains/notes.md, "## Test design"), AC2⊕AC6:
 * spawn `scripts/brain-drift.js` (never import it) against the real
 * `agents/` tree (default agents dir) -> expect exit 0, proving
 * resolveBrain('anthropic', stage) matches the live frontmatter for all 6
 * dispatched stages ("reused verbatim"). Then spawn it against a temp
 * `mkdtemp` copy of the 6 files with ONE field mutated -> expect non-zero
 * exit + stderr naming the drifted stage. The temp dir is built by copying
 * the real files; the real `agents/*.md` are only ever READ, never written.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const DRIFT_SCRIPT = join(REPO_ROOT, 'scripts', 'brain-drift.js');
const AGENTS_DIR = join(REPO_ROOT, 'agents');

const STAGES = ['plan', 'test', 'implement', 'refactor', 'review', 'audit'];

/**
 * @param {string[]} args
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runDrift(args) {
  const res = spawnSync(process.execPath, [DRIFT_SCRIPT, ...args], { encoding: 'utf8' });
  return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

test('brain-drift exits 0 against the real agents/ tree (frontmatter matches the table)', () => {
  const result = runDrift([AGENTS_DIR]);
  assert.equal(result.code, 0, `expected exit 0, got ${result.code}; stderr: ${result.stderr}`);
});

test('brain-drift exits non-zero and names the drifted stage on an injected single-field drift', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-brain-drift-test-'));
  try {
    for (const stage of STAGES) {
      const raw = await readFile(join(AGENTS_DIR, `cook-${stage}.md`), 'utf8');
      const drifted = stage === 'implement'
        ? raw.replace(/^model: opus$/m, 'model: sonnet')
        : raw;
      await writeFile(join(dir, `cook-${stage}.md`), drifted, 'utf8');
    }
    const result = runDrift([dir]);
    assert.notEqual(result.code, 0, 'expected non-zero exit on injected drift');
    assert.match(result.stderr, /implement/, 'stderr should name the drifted stage');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
