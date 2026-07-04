// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

/**
 * Test design (.jeff/tasks/item3d2-plan-issue/notes.md, "## Test design"):
 * one NEW node:test differential file, extending the plan-parity seam with a
 * controlled remote: spawn BOTH the frozen oracle
 * (`bash skills/cook/scripts/cook.sh plan …`) and the port
 * (`node src/cli/cook.js plan …`) with `COOK_ROOT=<fixture>` and a `gh` STUB
 * on PATH, comparing the port's output against the oracle's OWN LIVE output
 * (never a hardcoded golden). For write-back rows also compare the captured
 * written-back body; for the security rows (V-REJECT, S-SHAPE) assert on the
 * port's gh argv log. `src/cli/plan-parity.test.js` (the 3d1 markdown
 * differential file) is REUSED unchanged as the refactor safety-net
 * (D-REUSE-1) and is NOT touched here.
 *
 * Rows map to the plan's F-SECTION / F-CHECK / F-CHECK-IDEMPOTENT / F-APPEND /
 * V-ACCEPT / V-REJECT / R-USAGE / D-ABSENT / D-VIEW-FAIL / D-EDIT-FAIL /
 * D-CHECK-NOMATCH / D-APPEND-NOANCHOR / D-SECTION-NOMATCH / S-SHAPE /
 * L-FULL-REFUSE table.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const COOK_SH = join(REPO_ROOT, 'skills', 'cook', 'scripts', 'cook.sh');
const COOK_JS = join(REPO_ROOT, 'src', 'cli', 'cook.js');

const FIXTURE_ISSUE_REF = '#42';
const FIXTURE_ISSUE_URL = 'https://github.com/test-owner/test-repo/issues/42';

// Fixture issue body (test-doer defined, NOT the frozen bats fixture): a
// `## Plan` section with a tick target, an idempotent already-checked item, an
// append anchor, then a `## Notes` section.
const FIXTURE_BODY = [
  '## Plan',
  '',
  '- [ ] implement the feature',
  '- [ ] write tests for the feature',
  '- [x] design the feature',
  '',
  '## Notes',
  '',
  'Some other content here.',
].join('\n') + '\n';

// Isolated gh stub (test-doer's own build, in the spirit of tests/gh-issues.bats):
// logs full argv to $GH_ARGV_LOG; serves $GH_STUB_BODY_FILE on `issue view … -q
// .body …`; captures the --body-file bytes (either `--body-file <p>` or
// `--body-file=<p>` form) to $GH_BODY_CAPTURE on `issue edit`; honors
// GH_STUB_FAIL_VIEW=1 / GH_STUB_FAIL_EDIT=1 (stderr line + exit 1, no capture
// write on edit failure).
const GH_STUB_SCRIPT = `#!/bin/sh
# Isolated gh stub for src/cli/plan-issue-parity.test.js. No real network.
printf '%s\\n' "$*" >> "\${GH_ARGV_LOG:-/dev/null}"

subcmd="$1"; shift
[ "$subcmd" = "issue" ] || { printf 'gh stub: unsupported subcommand: %s\\n' "$subcmd" >&2; exit 1; }
action="$1"; shift

case "$action" in
  view)
    if [ "\${GH_STUB_FAIL_VIEW:-0}" = "1" ]; then
      printf 'gh: error: HTTP 401: Unauthorized\\n' >&2
      exit 1
    fi
    cat "\${GH_STUB_BODY_FILE}"
    exit 0
    ;;
  edit)
    if [ "\${GH_STUB_FAIL_EDIT:-0}" = "1" ]; then
      printf 'gh: error: HTTP 422: Unprocessable Entity\\n' >&2
      exit 1
    fi
    _body_path=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --body-file)   _body_path="$2"; shift ;;
        --body-file=*) _body_path="\${1#--body-file=}" ;;
      esac
      shift
    done
    if [ -n "$_body_path" ] && [ -f "$_body_path" ]; then
      cat "$_body_path" > "\${GH_BODY_CAPTURE}"
    fi
    exit 0
    ;;
  *)
    printf 'gh stub: unknown action: %s\\n' "$action" >&2
    exit 1
    ;;
esac
`;

/** @param {string} prefix @returns {Promise<string>} */
async function makeRoot(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * @param {string} bin
 * @param {string} entry
 * @param {string} root
 * @param {string[]} args
 * @param {Record<string,string>} [envOverrides]
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
function run(bin, entry, root, args, envOverrides = {}) {
  const res = spawnSync(bin, [entry, ...args], {
    env: { ...process.env, COOK_ROOT: root, ...envOverrides },
    encoding: 'utf8',
  });
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

/** @param {string} root @param {string[]} args @param {Record<string,string>} [env] */
function runOracle(root, args, env) {
  return run('bash', COOK_SH, root, args, env);
}

/** @param {string} root @param {string[]} args @param {Record<string,string>} [env] */
function runJs(root, args, env) {
  return run(process.execPath, COOK_JS, root, args, env);
}

/**
 * Assert full parity (raw stdout, raw stderr, exit code) between the oracle
 * and the JS port for the same fixture + args, each with its OWN env (distinct
 * gh argv-log / body-capture files, per the "no shared mutable state" rule).
 * Never trims: trailing-newline parity is part of the contract.
 *
 * @param {string} root
 * @param {string[]} args
 * @param {Record<string,string>} oracleEnv
 * @param {Record<string,string>} jsEnv
 */
function assertParity(root, args, oracleEnv, jsEnv) {
  const oracle = runOracle(root, args, oracleEnv);
  const js = runJs(root, args, jsEnv);
  assert.equal(js.stdout, oracle.stdout, `stdout mismatch for cook ${args.join(' ')}`);
  assert.equal(js.stderr, oracle.stderr, `stderr mismatch for cook ${args.join(' ')}`);
  assert.equal(js.code, oracle.code, `exit code mismatch for cook ${args.join(' ')}`);
}

/** @param {string} path @returns {Promise<string>} '' if the file does not exist */
async function readFileSafe(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

/** @param {string} root */
async function writeLiteConfig(root) {
  const bk = join(root, '.jeff');
  await mkdir(join(bk, 'tasks'), { recursive: true });
  await writeFile(join(bk, 'config.json'), JSON.stringify({ schemaVersion: 1, mode: 'lite', active: true }), 'utf8');
}

/** @returns {string} the real `jq` binary path (via `which`), for the gh-absent PATH's jq shim */
function whichJq() {
  const res = spawnSync('which', ['jq'], { encoding: 'utf8' });
  return res.stdout.trim();
}

async function makeGhStubDir() {
  const dir = await makeRoot('jeff-plan-issue-parity-stub-');
  const stubPath = join(dir, 'gh');
  await writeFile(stubPath, GH_STUB_SCRIPT, 'utf8');
  await chmod(stubPath, 0o755);
  return dir;
}

/**
 * Build a full stub-present-PATH fixture: a lite COOK_ROOT, a gh stub dir, a
 * fixture body file, and per-side (oracle/port) argv-log + body-capture
 * paths. Everything lives under mkdtemp; call `cleanup()` in a `finally`.
 *
 * @param {string} prefix
 */
async function makeIssueSession(prefix) {
  const root = await makeRoot(`jeff-plan-issue-parity-${prefix}-`);
  await writeLiteConfig(root);
  const stubDir = await makeGhStubDir();
  const bodyFile = join(root, 'fixture-body.txt');
  await writeFile(bodyFile, FIXTURE_BODY, 'utf8');
  const oracleLog = join(root, 'oracle-argv.log');
  const jsLog = join(root, 'js-argv.log');
  const oracleCapture = join(root, 'oracle-capture.txt');
  const jsCapture = join(root, 'js-capture.txt');
  const stubPath = `${stubDir}:${process.env.PATH}`;

  return {
    root,
    oracleLog,
    jsLog,
    oracleCapture,
    jsCapture,
    /** @param {Record<string,string>} [extra] */
    oracleEnv(extra = {}) {
      return { PATH: stubPath, GH_ARGV_LOG: oracleLog, GH_BODY_CAPTURE: oracleCapture, GH_STUB_BODY_FILE: bodyFile, ...extra };
    },
    /** @param {Record<string,string>} [extra] */
    jsEnv(extra = {}) {
      return { PATH: stubPath, GH_ARGV_LOG: jsLog, GH_BODY_CAPTURE: jsCapture, GH_STUB_BODY_FILE: bodyFile, ...extra };
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
      await rm(stubDir, { recursive: true, force: true });
    },
  };
}

// Annotate-only forbidden fragments (S-SHAPE): the port's gh argv log must
// never contain a lifecycle/label/assignee/milestone flag or the bare `--body`
// form (only `--body-file=` is allowed).
const FORBIDDEN_ARGV_FRAGMENTS = [' --state', '--add-label', '--remove-label', '--assignee', '--milestone', 'issue close', ' --body '];

/** @param {string} argvLog */
function assertAnnotateOnly(argvLog) {
  for (const forbidden of FORBIDDEN_ARGV_FRAGMENTS) {
    assert.ok(!argvLog.includes(forbidden), `gh argv log must not contain ${JSON.stringify(forbidden)}`);
  }
}

// =====================================================================
// F-SECTION — read-only fetch + bounds, no gh issue edit (AC1, AC3, AC6)
// =====================================================================

test('plan section on a valid issue ref fetches the body and prints bounds, read-only, matching the oracle', async () => {
  const s = await makeIssueSession('fsection');
  try {
    assertParity(s.root, ['plan', 'section', FIXTURE_ISSUE_REF, 'plan'], s.oracleEnv(), s.jsEnv());
    const oracleLog = await readFileSafe(s.oracleLog);
    const jsLog = await readFileSafe(s.jsLog);
    assert.match(oracleLog, /issue view/, 'oracle must have fetched via issue view');
    assert.match(jsLog, /issue view/, 'port must have fetched via issue view');
    assert.doesNotMatch(oracleLog, /issue edit/, 'oracle: section is read-only');
    assert.doesNotMatch(jsLog, /issue edit/, 'port: section is read-only');
  } finally {
    await s.cleanup();
  }
});

// =====================================================================
// F-CHECK / F-CHECK-IDEMPOTENT / F-APPEND — fetch + engine + write-back
// (AC3, AC5/S-SHAPE, AC6)
// =====================================================================

test('plan check on a valid issue ref ticks the match and writes the body back via gh issue edit, matching the oracle', async () => {
  const s = await makeIssueSession('fcheck');
  try {
    assertParity(s.root, ['plan', 'check', FIXTURE_ISSUE_REF, 'implement the feature'], s.oracleEnv(), s.jsEnv());
    const oracleBody = await readFileSafe(s.oracleCapture);
    const jsBody = await readFileSafe(s.jsCapture);
    assert.equal(jsBody, oracleBody, 'written-back body must match the oracle');
    const jsLog = await readFileSafe(s.jsLog);
    assert.match(jsLog, /issue edit/, 'port must write back via issue edit');
    assert.match(jsLog, /--body-file=/, 'port must use the --body-file= form');
    assertAnnotateOnly(jsLog);
  } finally {
    await s.cleanup();
  }
});

test('plan check on an already-checked item is idempotent and still writes the body back, matching the oracle', async () => {
  const s = await makeIssueSession('fcheckidem');
  try {
    assertParity(s.root, ['plan', 'check', FIXTURE_ISSUE_REF, 'design the feature'], s.oracleEnv(), s.jsEnv());
    const oracleBody = await readFileSafe(s.oracleCapture);
    const jsBody = await readFileSafe(s.jsCapture);
    assert.equal(jsBody, oracleBody, 'written-back (unchanged) body must match the oracle');
  } finally {
    await s.cleanup();
  }
});

test('plan append on a valid issue ref inserts after the section and writes the body back, matching the oracle', async () => {
  const s = await makeIssueSession('fappend');
  try {
    assertParity(s.root, ['plan', 'append', FIXTURE_ISSUE_REF, 'plan', '- [ ] new task item'], s.oracleEnv(), s.jsEnv());
    const oracleBody = await readFileSafe(s.oracleCapture);
    const jsBody = await readFileSafe(s.jsCapture);
    assert.equal(jsBody, oracleBody, 'written-back body must match the oracle');
    const jsLog = await readFileSafe(s.jsLog);
    assert.match(jsLog, /issue edit/, 'port must write back via issue edit');
    assert.match(jsLog, /--body-file=/, 'port must use the --body-file= form');
    assertAnnotateOnly(jsLog);
  } finally {
    await s.cleanup();
  }
});

// =====================================================================
// V-ACCEPT — valid refs route to the adapter and succeed (AC1, AC2)
// =====================================================================

test('valid issue refs (#0, #1234567, and a valid issues URL) route to the adapter and succeed, matching the oracle', async () => {
  const s = await makeIssueSession('vaccept');
  try {
    assertParity(s.root, ['plan', 'section', '#0', 'plan'], s.oracleEnv(), s.jsEnv());
    assertParity(s.root, ['plan', 'section', '#1234567', 'plan'], s.oracleEnv(), s.jsEnv());
    assertParity(s.root, ['plan', 'section', FIXTURE_ISSUE_URL, 'plan'], s.oracleEnv(), s.jsEnv());
  } finally {
    await s.cleanup();
  }
});

// =====================================================================
// V-REJECT — issue-shaped but invalid refs fail-closed before any gh spawn
// (AC2, AC5 security core)
// =====================================================================

const REJECTED_REFS = ['#', '#--foo', '#1abc', '#1; rm -rf x', 'https://github.com/o/r/pull/42', 'https://example.com/x'];

REJECTED_REFS.forEach((ref, i) => {
  test(`invalid issue ref ${JSON.stringify(ref)} is rejected fail-closed before any gh call, matching the oracle`, async () => {
    const s = await makeIssueSession(`vreject-${i}`);
    try {
      assertParity(s.root, ['plan', 'section', ref, 'plan'], s.oracleEnv(), s.jsEnv());
      const oracleLog = await readFileSafe(s.oracleLog);
      const jsLog = await readFileSafe(s.jsLog);
      assert.equal(oracleLog, '', 'oracle must not spawn gh for a rejected ref');
      assert.equal(jsLog, '', 'port must not spawn gh for a rejected ref');
    } finally {
      await s.cleanup();
    }
  });
});

// =====================================================================
// R-USAGE — issue-path usage strings (AC1)
// =====================================================================

test('issue-path usage strings (missing trailing arg) are the <issue-ref>-worded variants, matching the oracle', async () => {
  const s = await makeIssueSession('rusage');
  try {
    assertParity(s.root, ['plan', 'section', FIXTURE_ISSUE_REF], s.oracleEnv(), s.jsEnv());
    assertParity(s.root, ['plan', 'check', FIXTURE_ISSUE_REF], s.oracleEnv(), s.jsEnv());
    assertParity(s.root, ['plan', 'append', FIXTURE_ISSUE_REF, 'plan'], s.oracleEnv(), s.jsEnv());
  } finally {
    await s.cleanup();
  }
});

// =====================================================================
// D-ABSENT — gh absent from PATH, jq present (AC4)
// =====================================================================

test('plan section with gh absent from PATH dies with the gh-required message and makes no write-back, matching the oracle', async () => {
  const root = await makeRoot('jeff-plan-issue-parity-dabsent-');
  const jqShimDir = await makeRoot('jeff-plan-issue-parity-jqshim-');
  try {
    await writeLiteConfig(root);
    await symlink(whichJq(), join(jqShimDir, 'jq'));
    // gh lives only in /opt/homebrew/bin (excluded); the jq symlink guarantees
    // require_jq passes so BOTH sides reach the gh-absent branch rather than
    // diverging at require_jq.
    const absentPath = `${jqShimDir}:/usr/bin:/bin`;
    assertParity(root, ['plan', 'section', FIXTURE_ISSUE_REF, 'plan'], { PATH: absentPath }, { PATH: absentPath });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(jqShimDir, { recursive: true, force: true });
  }
});

// =====================================================================
// D-VIEW-FAIL / D-EDIT-FAIL — gh present but the call fails (AC4)
// =====================================================================

test("gh issue view failing dies with gh's stderr then the cook die line, no write-back, matching the oracle", async () => {
  const s = await makeIssueSession('dviewfail');
  try {
    const extra = { GH_STUB_FAIL_VIEW: '1' };
    assertParity(s.root, ['plan', 'check', FIXTURE_ISSUE_REF, 'implement the feature'], s.oracleEnv(extra), s.jsEnv(extra));
    const jsLog = await readFileSafe(s.jsLog);
    assert.match(jsLog, /issue view/);
    assert.doesNotMatch(jsLog, /issue edit/);
    const jsCapture = await readFileSafe(s.jsCapture);
    assert.equal(jsCapture, '', 'no write-back when view fails');
  } finally {
    await s.cleanup();
  }
});

test("gh issue edit failing dies with gh's stderr then the cook die line, no orphan write-back, matching the oracle", async () => {
  const s = await makeIssueSession('deditfail');
  try {
    const extra = { GH_STUB_FAIL_EDIT: '1' };
    assertParity(s.root, ['plan', 'check', FIXTURE_ISSUE_REF, 'implement the feature'], s.oracleEnv(extra), s.jsEnv(extra));
    const jsCapture = await readFileSafe(s.jsCapture);
    assert.equal(jsCapture, '', 'no successful write-back when edit fails');
  } finally {
    await s.cleanup();
  }
});

// =====================================================================
// D-CHECK-NOMATCH / D-APPEND-NOANCHOR / D-SECTION-NOMATCH — engine die
// BEFORE any edit (AC3, AC6)
// =====================================================================

test('plan check with no matching substring dies before any edit, body not written back, matching the oracle', async () => {
  const s = await makeIssueSession('dchecknomatch');
  try {
    assertParity(s.root, ['plan', 'check', FIXTURE_ISSUE_REF, 'no-such-needle'], s.oracleEnv(), s.jsEnv());
    const jsLog = await readFileSafe(s.jsLog);
    assert.match(jsLog, /issue view/);
    assert.doesNotMatch(jsLog, /issue edit/);
    const jsCapture = await readFileSafe(s.jsCapture);
    assert.equal(jsCapture, '', 'no write-back when the engine dies');
  } finally {
    await s.cleanup();
  }
});

test('plan append with no matching anchor dies before any edit, body not written back, matching the oracle', async () => {
  const s = await makeIssueSession('dappendnoanchor');
  try {
    assertParity(s.root, ['plan', 'append', FIXTURE_ISSUE_REF, 'does-not-exist', 'text'], s.oracleEnv(), s.jsEnv());
    const jsLog = await readFileSafe(s.jsLog);
    assert.match(jsLog, /issue view/);
    assert.doesNotMatch(jsLog, /issue edit/);
    const jsCapture = await readFileSafe(s.jsCapture);
    assert.equal(jsCapture, '', 'no write-back when the engine dies');
  } finally {
    await s.cleanup();
  }
});

test('plan section with no matching anchor dies, matching the oracle', async () => {
  const s = await makeIssueSession('dsectionnomatch');
  try {
    assertParity(s.root, ['plan', 'section', FIXTURE_ISSUE_REF, 'does-not-exist'], s.oracleEnv(), s.jsEnv());
  } finally {
    await s.cleanup();
  }
});

// =====================================================================
// L-FULL-REFUSE — issue write path is lite-only, refuses before any gh
// call (AC7)
// =====================================================================

test('plan check on a valid issue ref in full mode refuses before any gh call, matching the oracle', async () => {
  const root = await makeRoot('jeff-plan-issue-parity-lfull-');
  const stubDir = await makeGhStubDir();
  try {
    // No .jeff/config.json written → full mode.
    const bodyFile = join(root, 'fixture-body.txt');
    await writeFile(bodyFile, FIXTURE_BODY, 'utf8');
    const oracleLog = join(root, 'oracle-argv.log');
    const jsLog = join(root, 'js-argv.log');
    const stubPath = `${stubDir}:${process.env.PATH}`;
    /** @param {string} log */
    const envFor = (log) => ({ PATH: stubPath, GH_ARGV_LOG: log, GH_STUB_BODY_FILE: bodyFile });
    assertParity(root, ['plan', 'check', FIXTURE_ISSUE_REF, 'implement the feature'], envFor(oracleLog), envFor(jsLog));
    assert.equal(await readFileSafe(oracleLog), '', 'oracle must not spawn gh in full mode (require_lite precedes fetch)');
    assert.equal(await readFileSafe(jsLog), '', 'port must not spawn gh in full mode (require_lite precedes fetch)');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(stubDir, { recursive: true, force: true });
  }
});
