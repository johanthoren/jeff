// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * Test design (.jeff/tasks/item3d1-plan-md/notes.md, "## Test design"):
 * one node:test differential file spawning BOTH the frozen bash oracle
 * (`skills/cook/scripts/cook.sh plan …`) and the JS port (`src/cli/cook.js
 * plan …`) with `COOK_ROOT=<fixture>`, asserting the port's output against the
 * oracle's OWN LIVE runtime output — never a hardcoded golden string.
 * Read-only rows (S1-S5, C1-C7, D1) use ONE shared mkdtemp fixture +
 * assertParity (raw stdout+stderr+rc, byte-exact). Mutating rows (K1-K4,
 * A1-A3) use a fixture PAIR (A=oracle, B=JS) seeded byte-identically,
 * asserting stdout/stderr/rc parity AND readFile(A) === readFile(B) (or, for
 * refusals, that the victim file is byte-unchanged from its pre-image). C8 is
 * a refusal row (containment refuses before any write, so there's no
 * cross-talk risk) and uses a SINGLE shared victim so the refusal's echoed
 * raw arg matches on both sides. Rows map to the plan's
 * S1-S5/K1-K4/A1-A3/C1-C8/D1 table.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const COOK_SH = join(REPO_ROOT, 'skills', 'cook', 'scripts', 'cook.sh');
const COOK_JS = join(REPO_ROOT, 'src', 'cli', 'cook.js');

/**
 * @param {string} bin
 * @param {string} entry
 * @param {string} root
 * @param {string[]} args
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function run(bin, entry, root, args) {
  const res = spawnSync(bin, [entry, ...args], {
    env: { ...process.env, COOK_ROOT: root },
    encoding: 'utf8',
  });
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

/** @param {string} root @param {string[]} args */
function runOracle(root, args) {
  return run('bash', COOK_SH, root, args);
}

/** @param {string} root @param {string[]} args */
function runJs(root, args) {
  return run(process.execPath, COOK_JS, root, args);
}

/**
 * Assert full parity (raw stdout, raw stderr, exit code) between the oracle
 * and the JS port for the same fixture + args. Never trims: trailing-newline
 * parity is part of the contract.
 *
 * @param {string} root
 * @param {string[]} args
 */
function assertParity(root, args) {
  const oracle = runOracle(root, args);
  const js = runJs(root, args);
  assert.equal(js.stdout, oracle.stdout, `stdout mismatch for cook ${args.join(' ')}`);
  assert.equal(js.stderr, oracle.stderr, `stderr mismatch for cook ${args.join(' ')}`);
  assert.equal(js.code, oracle.code, `exit code mismatch for cook ${args.join(' ')}`);
}

/** @param {string} prefix @returns {Promise<string>} */
async function makeRoot(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

// A markdown fixture covering: nested/same-depth section ends, EOF section,
// fenced `#` lines, a checklist (some fenced), and slug edge cases.
const PLAN_MD = [
  '# Top',
  '',
  'intro text',
  '',
  '## Section A',
  '',
  'section a body',
  '',
  '### Nested A1',
  '',
  'nested body',
  '',
  '## Section B',
  '',
  '- [ ] alpha task',
  '- [ ] bravo task',
  '- [x] charlie task',
  '',
  '```',
  '# not a heading',
  '- [ ] not a checklist item either',
  '```',
  '',
  'trailing paragraph in Section B',
  '',
  '## Café Corner',
  '',
  'café body',
  '',
  '## Straße',
  '',
  'strasse body',
  '',
  '## Ⅴ Roman',
  '',
  'roman body',
  '',
  '## Last Section',
  '',
  'last body, no follower',
].join('\n') + '\n';

/** @param {string} root */
async function seedPlanMd(root) {
  const file = join(root, 'PLAN.md');
  await writeFile(file, PLAN_MD, 'utf8');
  return file;
}

// =====================================================================
// S1-S5 — plan section, shared fixture, assertParity (AC1)
// =====================================================================

// --- S1: matching heading, nested + same-depth follower ends the section ---
test('plan section on a matching heading with a nested + same-depth follower matches the oracle', async () => {
  const root = await makeRoot('jeff-plan-parity-s1-');
  try {
    await seedPlanMd(root);
    assertParity(root, ['plan', 'section', 'PLAN.md', 'section-a']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- S2: last heading -> bounds run to EOF ---
test('plan section on the last heading runs to EOF, matching the oracle', async () => {
  const root = await makeRoot('jeff-plan-parity-s2-');
  try {
    await seedPlanMd(root);
    assertParity(root, ['plan', 'section', 'PLAN.md', 'last-section']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- S3: fenced `#` line is not a boundary ---
test('plan section ignores a fenced heading-like line, matching the oracle', async () => {
  const root = await makeRoot('jeff-plan-parity-s3-');
  try {
    await seedPlanMd(root);
    assertParity(root, ['plan', 'section', 'PLAN.md', 'section-b']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- S4: slug edges - case/punctuation/whitespace/non-ASCII stripping ---
test('plan section slug edges (case, punctuation, non-ASCII) resolve bounds matching the oracle', async () => {
  const root = await makeRoot('jeff-plan-parity-s4-');
  try {
    await seedPlanMd(root);
    assertParity(root, ['plan', 'section', 'PLAN.md', 'caf-corner']);
    assertParity(root, ['plan', 'section', 'PLAN.md', 'strae']);
    assertParity(root, ['plan', 'section', 'PLAN.md', '-roman']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- S5: no-match -> die byte-exact ---
test('plan section with no matching anchor dies matching the oracle', async () => {
  const root = await makeRoot('jeff-plan-parity-s5-');
  try {
    await seedPlanMd(root);
    assertParity(root, ['plan', 'section', 'PLAN.md', 'nonexistent-anchor']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// =====================================================================
// K1-K4 — plan check, fixture PAIR, byte-diff (AC2)
// =====================================================================

/**
 * @param {string} prefix
 * @returns {Promise<{ aRoot: string, bRoot: string, aFile: string, bFile: string }>}
 */
async function makePlanPair(prefix) {
  const aRoot = await makeRoot(`jeff-plan-parity-${prefix}a-`);
  const bRoot = await makeRoot(`jeff-plan-parity-${prefix}b-`);
  const aFile = await seedPlanMd(aRoot);
  const bFile = await seedPlanMd(bRoot);
  return { aRoot, bRoot, aFile, bFile };
}

// --- K1: ticks the FIRST match only, every other byte identical ---
test('plan check ticks only the first matching item, matching the oracle byte-for-byte', async () => {
  const { aRoot, bRoot, aFile, bFile } = await makePlanPair('k1');
  try {
    const oracle = runOracle(aRoot, ['plan', 'check', 'PLAN.md', 'task']);
    const js = runJs(bRoot, ['plan', 'check', 'PLAN.md', 'task']);
    assert.equal(js.stdout, oracle.stdout, 'stdout mismatch');
    assert.equal(js.stderr, oracle.stderr, 'stderr mismatch');
    assert.equal(js.code, oracle.code, 'exit code mismatch');
    assert.equal(await readFile(bFile, 'utf8'), await readFile(aFile, 'utf8'), 'mutated file bytes must match');
  } finally {
    await rm(aRoot, { recursive: true, force: true });
    await rm(bRoot, { recursive: true, force: true });
  }
});

// --- K2: already-checked item is idempotent -> file byte-unchanged ---
test('plan check on an already-checked item is idempotent, matching the oracle', async () => {
  const { aRoot, bRoot, aFile, bFile } = await makePlanPair('k2');
  try {
    const before = await readFile(aFile, 'utf8');
    const oracle = runOracle(aRoot, ['plan', 'check', 'PLAN.md', 'charlie']);
    const js = runJs(bRoot, ['plan', 'check', 'PLAN.md', 'charlie']);
    assert.equal(js.stdout, oracle.stdout, 'stdout mismatch');
    assert.equal(js.stderr, oracle.stderr, 'stderr mismatch');
    assert.equal(js.code, oracle.code, 'exit code mismatch');
    assert.equal(await readFile(aFile, 'utf8'), before, 'oracle file must be unchanged');
    assert.equal(await readFile(bFile, 'utf8'), before, 'JS file must be unchanged');
  } finally {
    await rm(aRoot, { recursive: true, force: true });
    await rm(bRoot, { recursive: true, force: true });
  }
});

// --- K3: no-match -> die byte-exact, file unchanged ---
test('plan check with no matching item dies and leaves the file unchanged, matching the oracle', async () => {
  const { aRoot, bRoot, aFile, bFile } = await makePlanPair('k3');
  try {
    const before = await readFile(aFile, 'utf8');
    const oracle = runOracle(aRoot, ['plan', 'check', 'PLAN.md', 'nonexistent-needle']);
    const js = runJs(bRoot, ['plan', 'check', 'PLAN.md', 'nonexistent-needle']);
    assert.equal(js.stdout, oracle.stdout, 'stdout mismatch');
    assert.equal(js.stderr, oracle.stderr, 'stderr mismatch');
    assert.equal(js.code, oracle.code, 'exit code mismatch');
    assert.equal(await readFile(aFile, 'utf8'), before, 'oracle file must be unchanged');
    assert.equal(await readFile(bFile, 'utf8'), before, 'JS file must be unchanged');
  } finally {
    await rm(aRoot, { recursive: true, force: true });
    await rm(bRoot, { recursive: true, force: true });
  }
});

// --- K4: fenced checklist item is never ticked (needle only inside fence) ---
test('plan check does not tick a checklist item inside a fence, matching the oracle', async () => {
  const { aRoot, bRoot, aFile, bFile } = await makePlanPair('k4');
  try {
    const before = await readFile(aFile, 'utf8');
    const oracle = runOracle(aRoot, ['plan', 'check', 'PLAN.md', 'not a checklist item either']);
    const js = runJs(bRoot, ['plan', 'check', 'PLAN.md', 'not a checklist item either']);
    assert.equal(js.stdout, oracle.stdout, 'stdout mismatch');
    assert.equal(js.stderr, oracle.stderr, 'stderr mismatch');
    assert.equal(js.code, oracle.code, 'exit code mismatch');
    assert.equal(await readFile(aFile, 'utf8'), before, 'oracle file must be unchanged');
    assert.equal(await readFile(bFile, 'utf8'), before, 'JS file must be unchanged');
  } finally {
    await rm(aRoot, { recursive: true, force: true });
    await rm(bRoot, { recursive: true, force: true });
  }
});

// =====================================================================
// A1-A3 — plan append, fixture PAIR, byte-diff (AC3)
// =====================================================================

// --- A1: insert after LAST non-blank line in the section, blank separator survives ---
test('plan append inserts after the last non-blank line in the section, matching the oracle', async () => {
  const { aRoot, bRoot, aFile, bFile } = await makePlanPair('a1');
  try {
    const oracle = runOracle(aRoot, ['plan', 'append', 'PLAN.md', 'section-b', 'a fresh todo line']);
    const js = runJs(bRoot, ['plan', 'append', 'PLAN.md', 'section-b', 'a fresh todo line']);
    assert.equal(js.stdout, oracle.stdout, 'stdout mismatch');
    assert.equal(js.stderr, oracle.stderr, 'stderr mismatch');
    assert.equal(js.code, oracle.code, 'exit code mismatch');
    assert.equal(await readFile(bFile, 'utf8'), await readFile(aFile, 'utf8'), 'mutated file bytes must match');
  } finally {
    await rm(aRoot, { recursive: true, force: true });
    await rm(bRoot, { recursive: true, force: true });
  }
});

// --- A2: text inserted BYTE-VERBATIM (backslash, real TAB, literal \n sequence) ---
test('plan append inserts text byte-verbatim, matching the oracle', async () => {
  const { aRoot, bRoot, aFile, bFile } = await makePlanPair('a2');
  try {
    const verbatimText = 'path C:\\temp\\new\ttabbed \\n notreal';
    const oracle = runOracle(aRoot, ['plan', 'append', 'PLAN.md', 'last-section', verbatimText]);
    const js = runJs(bRoot, ['plan', 'append', 'PLAN.md', 'last-section', verbatimText]);
    assert.equal(js.stdout, oracle.stdout, 'stdout mismatch');
    assert.equal(js.stderr, oracle.stderr, 'stderr mismatch');
    assert.equal(js.code, oracle.code, 'exit code mismatch');
    assert.equal(await readFile(bFile, 'utf8'), await readFile(aFile, 'utf8'), 'mutated file bytes must match');
  } finally {
    await rm(aRoot, { recursive: true, force: true });
    await rm(bRoot, { recursive: true, force: true });
  }
});

// --- A3: anchor-not-found -> die byte-exact, file unchanged ---
test('plan append with no matching anchor dies and leaves the file unchanged, matching the oracle', async () => {
  const { aRoot, bRoot, aFile, bFile } = await makePlanPair('a3');
  try {
    const before = await readFile(aFile, 'utf8');
    const oracle = runOracle(aRoot, ['plan', 'append', 'PLAN.md', 'nonexistent-anchor', 'text']);
    const js = runJs(bRoot, ['plan', 'append', 'PLAN.md', 'nonexistent-anchor', 'text']);
    assert.equal(js.stdout, oracle.stdout, 'stdout mismatch');
    assert.equal(js.stderr, oracle.stderr, 'stderr mismatch');
    assert.equal(js.code, oracle.code, 'exit code mismatch');
    assert.equal(await readFile(aFile, 'utf8'), before, 'oracle file must be unchanged');
    assert.equal(await readFile(bFile, 'utf8'), before, 'JS file must be unchanged');
  } finally {
    await rm(aRoot, { recursive: true, force: true });
    await rm(bRoot, { recursive: true, force: true });
  }
});

// =====================================================================
// C1-C8 — containment (resolve_ref_path), the security core (AC4)
// =====================================================================

// --- C1: `..`-escape ref -> refuse byte-exact ---
test('plan section refuses a ..-escape ref, matching the oracle', async () => {
  const root = await makeRoot('jeff-plan-parity-c1-');
  try {
    await seedPlanMd(root);
    assertParity(root, ['plan', 'section', '../etc/passwd', 'x']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- C2: absolute path OUTSIDE ROOT -> refuse ---
test('plan section refuses an absolute path outside ROOT, matching the oracle', async () => {
  const root = await makeRoot('jeff-plan-parity-c2-');
  const outside = await makeRoot('jeff-plan-parity-c2-outside-');
  try {
    await seedPlanMd(root);
    const outsideFile = join(outside, 'secret.md');
    await writeFile(outsideFile, '# Secret\n', 'utf8');
    assertParity(root, ['plan', 'section', outsideFile, 'secret']);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

// --- C3: non-existent ref -> refuse ---
test('plan section refuses a non-existent ref, matching the oracle', async () => {
  const root = await makeRoot('jeff-plan-parity-c3-');
  try {
    await seedPlanMd(root);
    assertParity(root, ['plan', 'section', 'DOES-NOT-EXIST.md', 'x']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- C4: in-ROOT symlink whose target is OUTSIDE ROOT -> refuse ---
test('plan section refuses an in-ROOT symlink pointing outside ROOT, matching the oracle', async () => {
  const root = await makeRoot('jeff-plan-parity-c4-');
  const outside = await makeRoot('jeff-plan-parity-c4-outside-');
  try {
    await seedPlanMd(root);
    const outsideFile = join(outside, 'real.md');
    await writeFile(outsideFile, '# Real\n', 'utf8');
    await symlink(outsideFile, join(root, 'escape.md'));
    assertParity(root, ['plan', 'section', 'escape.md', 'real']);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

// --- C5: symlink CHAIN in->out->in (final target inside ROOT, transits outside mid-hop) -> refuse ---
test('plan section refuses a symlink chain that transits outside ROOT mid-hop, matching the oracle (naive realpath would accept)', async () => {
  const root = await makeRoot('jeff-plan-parity-c5-');
  const outside = await makeRoot('jeff-plan-parity-c5-outside-');
  try {
    await seedPlanMd(root);
    const realFile = join(root, 'real.md');
    await writeFile(realFile, '# Real\n', 'utf8');
    const chainB = join(outside, 'chainB.md'); // out -> in
    await symlink(realFile, chainB);
    const chainA = join(root, 'chainA.md'); // in -> out
    await symlink(chainB, chainA);
    assertParity(root, ['plan', 'section', 'chainA.md', 'real']);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

// --- C6: symlink CYCLE (a -> b -> a) -> refuse, fails CLOSED, does not hang ---
test('plan section refuses a symlink cycle and fails closed without hanging, matching the oracle', async () => {
  const root = await makeRoot('jeff-plan-parity-c6-');
  try {
    await seedPlanMd(root);
    const a = join(root, 'cycle-a.md');
    const b = join(root, 'cycle-b.md');
    await symlink(b, a);
    await symlink(a, b);
    assertParity(root, ['plan', 'section', 'cycle-a.md', 'x']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- C7: in-ROOT symlink -> in-ROOT file RESOLVES and works (success path) ---
test('plan section resolves an in-ROOT symlink to an in-ROOT file and works, matching the oracle', async () => {
  const root = await makeRoot('jeff-plan-parity-c7-');
  try {
    const file = await seedPlanMd(root);
    await symlink(file, join(root, 'alias.md'));
    assertParity(root, ['plan', 'section', 'alias.md', 'section-a']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- C8: containment-before-mutation - check/append on an escaping target refuses AND leaves the victim unchanged ---
test('plan check/append on an escaping target refuse and leave the victim file byte-unchanged, matching the oracle', async () => {
  const root = await makeRoot('jeff-plan-parity-c8-');
  const outside = await makeRoot('jeff-plan-parity-c8-outside-');
  try {
    await seedPlanMd(root);
    const victimContent = '# Victim\n\nsecret unchanged content\n';
    // A single shared victim: containment REFUSES before any write (no tmp,
    // no mv), so there is no cross-talk risk running both sides against the
    // same path — and the refusal echoes the RAW arg, so both sides must see
    // the identical arg for their stderr to be comparable at all.
    const victim = join(outside, 'victim.md');
    await writeFile(victim, victimContent, 'utf8');

    const oracleCheck = runOracle(root, ['plan', 'check', victim, 'secret']);
    const jsCheck = runJs(root, ['plan', 'check', victim, 'secret']);
    assert.equal(jsCheck.stdout, oracleCheck.stdout, 'check stdout mismatch');
    assert.equal(jsCheck.stderr, oracleCheck.stderr, 'check stderr mismatch');
    assert.equal(jsCheck.code, oracleCheck.code, 'check exit code mismatch');
    assert.equal(await readFile(victim, 'utf8'), victimContent, 'victim must be unchanged after check (both runs)');

    const oracleAppend = runOracle(root, ['plan', 'append', victim, 'victim', 'x']);
    const jsAppend = runJs(root, ['plan', 'append', victim, 'victim', 'x']);
    assert.equal(jsAppend.stdout, oracleAppend.stdout, 'append stdout mismatch');
    assert.equal(jsAppend.stderr, oracleAppend.stderr, 'append stderr mismatch');
    assert.equal(jsAppend.code, oracleAppend.code, 'append exit code mismatch');
    assert.equal(await readFile(victim, 'utf8'), victimContent, 'victim must be unchanged after append (both runs)');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

// =====================================================================
// D1 — dispatch/usage: sub validation + per-verb usage strings (AC5)
// =====================================================================

test('plan dispatch/usage strings match the oracle for missing sub, unknown sub, and under-args', async () => {
  const root = await makeRoot('jeff-plan-parity-d1-');
  try {
    await seedPlanMd(root);
    assertParity(root, ['plan']);
    assertParity(root, ['plan', 'bogus']);
    assertParity(root, ['plan', 'section']);
    assertParity(root, ['plan', 'section', 'PLAN.md']);
    assertParity(root, ['plan', 'check']);
    assertParity(root, ['plan', 'check', 'PLAN.md']);
    assertParity(root, ['plan', 'append']);
    assertParity(root, ['plan', 'append', 'PLAN.md']);
    assertParity(root, ['plan', 'append', 'PLAN.md', 'anchor']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
