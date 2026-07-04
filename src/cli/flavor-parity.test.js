// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * Test design (.jeff/tasks/item5a1-flavor/notes.md, "## Test design"):
 * a differential spawn — run the same fixture through BOTH
 * `node src/cli/cook.js flavor [args]` (the JS port) and
 * `bash skills/cook/scripts/cook.sh flavor [args]` (the frozen oracle), each
 * with COOK_ROOT=<isolated mkdtemp> and a controlled JEFF_FLAVOR (set to the
 * row's value, or deleted from the spawn env for the unset cell), passed
 * identically to both. Asserts byte-identical stdout, byte-identical stderr,
 * and identical exit code (assertParity). The expectation is always the
 * oracle's own runtime output — never a hardcoded golden — so this stays a
 * genuine differential. Rows: C1-C11 (config branch), E1-E6 (env branch),
 * A1-A2 (arg-rejection). See the 19-row matrix in notes.md for the full
 * pinning rationale of each row.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const COOK_SH = join(REPO_ROOT, 'skills', 'cook', 'scripts', 'cook.sh');
const COOK_JS = join(REPO_ROOT, 'src', 'cli', 'cook.js');

/**
 * Build the spawn env for a row: COOK_ROOT is always injected; JEFF_FLAVOR is
 * either set to `flavorEnv` or, when `flavorEnv` is `undefined`, deleted from
 * the spawn env entirely (the "unset" cell) — identical for both spawns.
 *
 * @param {string} root
 * @param {string} [flavorEnv]
 * @returns {NodeJS.ProcessEnv}
 */
function buildEnv(root, flavorEnv) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, COOK_ROOT: root };
  if (flavorEnv === undefined) {
    delete env.JEFF_FLAVOR;
  } else {
    env.JEFF_FLAVOR = flavorEnv;
  }
  return env;
}

/**
 * @param {string} root
 * @param {string[]} args
 * @param {string} [flavorEnv]
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runOracle(root, args, flavorEnv) {
  const res = spawnSync('bash', [COOK_SH, ...args], {
    env: buildEnv(root, flavorEnv),
    encoding: 'utf8',
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/**
 * @param {string} root
 * @param {string[]} args
 * @param {string} [flavorEnv]
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function runJs(root, args, flavorEnv) {
  const res = spawnSync(process.execPath, [COOK_JS, ...args], {
    env: buildEnv(root, flavorEnv),
    encoding: 'utf8',
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/**
 * Assert full parity (raw stdout, raw stderr, exit code) between the oracle
 * and the JS port for the same fixture + args + env.
 *
 * @param {string} root
 * @param {string[]} args
 * @param {string} [flavorEnv]
 */
function assertParity(root, args, flavorEnv) {
  const oracle = runOracle(root, args, flavorEnv);
  const js = runJs(root, args, flavorEnv);
  assert.equal(js.stdout, oracle.stdout, `stdout mismatch for cook ${args.join(' ')}`);
  assert.equal(js.stderr, oracle.stderr, `stderr mismatch for cook ${args.join(' ')}`);
  assert.equal(js.code, oracle.code, `exit code mismatch for cook ${args.join(' ')}`);
}

/** @returns {Promise<string>} a fresh isolated fixture root */
async function makeRoot() {
  return mkdtemp(join(tmpdir(), 'jeff-flavor-parity-'));
}

/**
 * Write `.jeff/config.json` verbatim from a raw string (no JSON.stringify),
 * so the unparseable + non-scalar rows are byte-exact as the row names them.
 *
 * @param {string} root
 * @param {string} raw
 */
async function writeConfig(root, raw) {
  await mkdir(join(root, '.jeff'), { recursive: true });
  await writeFile(join(root, '.jeff', 'config.json'), raw, 'utf8');
}

// ---------------------------------------------------------------------------
// Config-branch rows (writeConfig + flavor args = ['flavor'])
// ---------------------------------------------------------------------------

test('C1: config .flavor:null, env unset -> null falls through to env default (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    await writeConfig(root, '{"flavor": null}');
    assertParity(root, ['flavor'], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('C2: config .flavor:true, env=plain -> boolean true wins over env (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    await writeConfig(root, '{"flavor": true}');
    assertParity(root, ['flavor'], 'plain');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('C3: config .flavor:false, env=kitchen -> null-only guard, false != absent (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    await writeConfig(root, '{"flavor": false}');
    assertParity(root, ['flavor'], 'kitchen');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('C4: config .flavor:"kitchen", env=plain -> string kitchen wins over env (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    await writeConfig(root, '{"flavor": "kitchen"}');
    assertParity(root, ['flavor'], 'plain');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('C5: config .flavor:"plain", env=kitchen -> string plain wins over env (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    await writeConfig(root, '{"flavor": "plain"}');
    assertParity(root, ['flavor'], 'kitchen');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('C6: config .flavor:"banana", env=kitchen -> unknown token maps to plain (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    await writeConfig(root, '{"flavor": "banana"}');
    assertParity(root, ['flavor'], 'kitchen');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('C7: config .flavor:"", env=kitchen -> empty string falls through to env (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    await writeConfig(root, '{"flavor": ""}');
    assertParity(root, ['flavor'], 'kitchen');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('C8: config .flavor:"true", env=plain -> JSON string "true" collapses to kitchen (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    await writeConfig(root, '{"flavor": "true"}');
    assertParity(root, ['flavor'], 'plain');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('C9: config .flavor:42, env=kitchen -> non-scalar number maps to plain, no crash (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    await writeConfig(root, '{"flavor": 42}');
    assertParity(root, ['flavor'], 'kitchen');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('C10: config .flavor:{"a":1}, env=kitchen -> non-scalar object maps to plain, no crash (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    await writeConfig(root, '{"flavor": {"a":1}}');
    assertParity(root, ['flavor'], 'kitchen');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('C11: unparseable config, env=plain -> degrades to env, never throws (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    await writeConfig(root, '{ not json');
    assertParity(root, ['flavor'], 'plain');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Env-branch rows (no .jeff/config.json, flavor args = ['flavor'])
// ---------------------------------------------------------------------------

test('E1: config absent, env unset -> default kitchen (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    assertParity(root, ['flavor'], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('E2: config absent, env=kitchen -> kitchen (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    assertParity(root, ['flavor'], 'kitchen');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('E3: config absent, env=plain -> plain (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    assertParity(root, ['flavor'], 'plain');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('E4: config absent, env=banana (other) -> plain (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    assertParity(root, ['flavor'], 'banana');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('E5: config absent, env="" (empty) -> default kitchen (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    assertParity(root, ['flavor'], '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('E6: config absent, env=true -> collapse arm "true" maps to kitchen (AC1, AC3)', async () => {
  const root = await makeRoot();
  try {
    assertParity(root, ['flavor'], 'true');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Arg-rejection rows (leftover token, fail-closed)
// ---------------------------------------------------------------------------

test("A1: cook flavor -x -> unknown option, fail-closed (AC2, AC3)", async () => {
  const root = await makeRoot();
  try {
    assertParity(root, ['flavor', '-x'], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("A2: cook flavor foo -> unexpected argument, fail-closed (AC2, AC3)", async () => {
  const root = await makeRoot();
  try {
    assertParity(root, ['flavor', 'foo'], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
