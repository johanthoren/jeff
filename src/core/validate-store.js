// @ts-check

/**
 * `validateStore(root)`: the authoritative in-process verdict boundary used by
 * the CLI and host integrations. The former Bash implementation remains a
 * transition oracle for intentionally unchanged behavior.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectTasks, readConfig } from './store.js';
import { gatePreflight, runInvariants } from './invariants.js';
import { configSchemaViolations, taskSchemaViolations } from './task-schema.js';
import { isType } from './validate.js';

/**
 * @typedef {Object} Verdict
 * @property {boolean} ok - true iff the store validates
 * @property {number} code - process exit code (0 OK, 1 any failure)
 * @property {string[]} stdout - lines to print to stdout
 * @property {string[]} stderr - lines to print to stderr
 */

/**
 * The two verdict shapes every branch below returns: a failure carries only
 * stderr (code 1), a pass carries only stdout (code 0). Centralized so the
 * shape lives in one place instead of six repeated object literals.
 *
 * @param {string[]} stderr
 * @returns {Verdict}
 */
function fail(stderr) {
  return { ok: false, code: 1, stdout: [], stderr };
}

/**
 * @param {string[]} stdout
 * @returns {Verdict}
 */
function pass(stdout) {
  return { ok: true, code: 0, stdout, stderr: [] };
}

/**
 * Parse a dotted numeric core from a package-style version stamp.
 * Returns null when the stamp is not a comparable dotted-numeric series.
 *
 * @param {unknown} stamp
 * @returns {number[] | null}
 */
function parseDottedNumericVersion(stamp) {
  if (typeof stamp !== 'string' || stamp.length === 0) return null;
  const core = stamp.trim().split(/[-+]/, 1)[0];
  if (!core || !/^\d+(?:\.\d+)*$/.test(core)) return null;
  return core.split('.').map((part) => Number(part));
}

/**
 * True when `left` is strictly newer than `right` under dotted-numeric order.
 * Unparsable stamps never count as newer.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function isStrictlyNewerVersion(left, right) {
  const a = parseDottedNumericVersion(left);
  const b = parseDottedNumericVersion(right);
  if (a === null || b === null) return false;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

/**
 * Maximum comparable nonempty pipelineVersion among collected tasks, or null.
 *
 * @param {object[]} tasks
 * @returns {string | null}
 */
function maxComparablePipelineVersion(tasks) {
  /** @type {string | null} */
  let max = null;
  for (const task of tasks) {
    const stamp = /** @type {any} */ (task).pipelineVersion;
    if (typeof stamp !== 'string' || stamp.length === 0) continue;
    if (parseDottedNumericVersion(stamp) === null) continue;
    if (max === null || isStrictlyNewerVersion(stamp, max)) max = stamp;
  }
  return max;
}

/**
 * Installed plugin package version, or null when unreadable/empty.
 *
 * @returns {Promise<string | null>}
 */
async function readInstalledPipelineVersion() {
  try {
    const raw = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
    const version = JSON.parse(raw).version;
    if (typeof version !== 'string' || version.length === 0) return null;
    return version;
  } catch {
    return null;
  }
}


/**
 * @param {string} root - repository root (COOK_ROOT-resolved)
 * @returns {Promise<Verdict>}
 */
export async function validateStore(root) {
  let config;
  try {
    config = await readConfig(root, { strict: true });
  } catch (error) {
    return fail([`cook: validation FAILED: ${/** @type {Error} */ (error).message}`]);
  }
  const lite = config?.mode === 'lite';
  const prunedTaskIds = !lite && Array.isArray(config?.prunedTaskIds)
    ? /** @type {number[]} */ (config.prunedTaskIds)
    : undefined;

  // 1. Collect, fail CLOSED on any unparseable task.json.
  let tasks;
  try {
    tasks = await collectTasks(root);
  } catch (err) {
    const stderr = [];
    const dir = err && /** @type {any} */ (err).dir;
    if (dir) stderr.push(`cook: validation FAILED: unparseable task.json at ${dir}`);
    stderr.push('cook: validation FAILED: could not parse the task store (unreadable or malformed task path/JSON under .jeff/tasks/).');
    return fail(stderr);
  }

  // 1b. Fail open when the store was written by a newer pipeline than this
  // installed validator understands. Unversioned / same / older / unparsable
  // stamps keep the deny-on-real-invalid path below.
  const installed = await readInstalledPipelineVersion();
  const maxPipeline = maxComparablePipelineVersion(tasks);
  if (
    installed !== null
    && maxPipeline !== null
    && isStrictlyNewerVersion(maxPipeline, installed)
  ) {
    return pass([
      `cook: validation skipped: store pipelineVersion ${maxPipeline} is newer than installed validator ${installed}`,
    ]);
  }


  // 2. Collect persisted-shape and semantic violations. Schema failures remain
  // authoritative but include fail-closed invariant markers.
  const schemaViolations = [
    ...configSchemaViolations(config, { lite }),
    ...tasks.flatMap((task) => taskSchemaViolations(task, { lite })),
  ];
  let invariantViolations;
  try {
    invariantViolations = runInvariants(tasks, { lite, prunedTaskIds });
  } catch {
    invariantViolations = ['cook: validation FAILED: the invariant pass could not evaluate the task store.'];
  }
  if (schemaViolations.length > 0) {
    const violations = [...schemaViolations, ...invariantViolations];
    return fail([...violations, `cook: validation FAILED (${violations.length} issue(s))`]);
  }

  // 3. [gate] done-gate pre-flight: short-circuits the verdict on violation.
  let gateViolations;
  try {
    gateViolations = gatePreflight(tasks);
  } catch {
    return fail(['cook: validation FAILED: could not evaluate the [gate] done-gate pre-flight (malformed tests.gate JSON?).']);
  }
  if (gateViolations.length > 0) {
    return fail([...gateViolations, `cook: validation FAILED (${gateViolations.length} issue(s))`]);
  }

  // 4. Shared invariant verdict for empty and nonempty stores.
  if (invariantViolations.length > 0) {
    return fail([
      ...invariantViolations,
      `cook: validation FAILED (${invariantViolations.length} issue(s))`,
    ]);
  }
  if (!lite && tasks.length === 0) {
    return pass(['cook: no tasks under .jeff/tasks/: nothing to validate.']);
  }

  // 5. Profile conformance: present-means-conform; absent is fine.
  let profileText = null;
  try {
    profileText = await readFile(join(root, '.jeff', 'profile.md'), 'utf8');
  } catch {
    profileText = null;
  }
  if (profileText !== null) {
    const message = checkProfile(profileText);
    if (message !== null) {
      return fail([message, 'cook: validation FAILED: .jeff/profile.md does not conform (fix it or remove it)']);
    }
  }

  return pass([`cook: validation OK (${tasks.length} task(s))`]);
}

/**
 * Port of cook.sh's `profile_conformance` (skills/cook/scripts/cook.sh:175-248).
 * Checks, in order: size budget (≤40 lines, ≤2000 bytes) → a parseable fenced
 * ```json front-matter block at the top → required keys (mode/plan_store/ledger
 * non-empty strings, sources an array of {path,hash} non-empty strings).
 *
 * @param {string} text - the profile.md contents
 * @returns {string | null} the (cook.sh-prefixed) failure line, or null if conformant
 */
export function checkProfile(text) {
  const lineCount = (text.match(/\n/g) || []).length;
  const byteCount = Buffer.byteLength(text, 'utf8');
  if (lineCount > 40) return `cook: profile.md exceeds 40-line budget (${lineCount} lines)`;
  if (byteCount > 2000) return `cook: profile.md exceeds 2000-byte budget (${byteCount} bytes)`;

  // Extract the JSON from the opening ```json fence to the next closing ``` line.
  // Mirrors cook.sh's `while IFS= read` loop, which skips an unterminated final
  // line: split on '\n' and drop the trailing (post-final-newline) remainder.
  const lines = text.split('\n');
  lines.pop();
  let foundOpen = false;
  let foundClose = false;
  const fm = [];
  for (const line of lines) {
    if (!foundOpen) {
      if (line === '```json') foundOpen = true;
      else if (line.length > 0) break; // a non-blank pre-fence line: no front-matter
    } else if (line === '```') {
      foundClose = true;
      break;
    } else {
      fm.push(line);
    }
  }
  if (!foundOpen || !foundClose || fm.length === 0) {
    return 'cook: profile.md: no parseable ```json front-matter fence found at the top of the file';
  }

  let parsed;
  try {
    parsed = JSON.parse(fm.join('\n'));
  } catch {
    return 'cook: profile.md: front-matter JSON is unparseable';
  }
  // Array/scalar front-matter is "unparseable" too: cook.sh's `profile_conformance`
  // jq indexes `.["mode"]`, which aborts on an array/number ("Cannot index …") with
  // jq's stderr swallowed by `2>/dev/null`, so cook.sh emits exactly this line. JS
  // would otherwise parse `[1,2,3]`/`42` fine and mis-report `missing or invalid key:
  // mode`. Reaches true byte-parity here (no jq-noise leak). The `parsed !== null`
  // clause is load-bearing and the OPPOSITE boundary from store.js's item-3 guard:
  // `null` front-matter must keep falling through to the conformance path (which
  // already matches cook.sh's null behavior : free parity). Do not drop it.
  if (parsed !== null && !isType(parsed, 'object')) {
    return 'cook: profile.md: front-matter JSON is unparseable';
  }

  const violations = profileViolations(parsed);
  if (violations.length > 0) return `cook: profile.md conformance failure: ${violations[0]}`;
  return null;
}

/**
 * The front-matter key/shape violations, in cook.sh's jq emission order (so the
 * first entry is what `head -1` would report).
 *
 * @param {any} o - the parsed front-matter object
 * @returns {string[]}
 */
function profileViolations(o) {
  const out = [];
  /** @param {string} k */
  const checkString = (k) => {
    const val = (o == null) ? undefined : o[k];
    if (typeof val !== 'string' || val === '') {
      out.push(`missing or invalid key: ${k} (must be a non-empty string)`);
    }
  };
  checkString('mode');
  checkString('plan_store');
  checkString('ledger');

  const sources = (o == null) ? undefined : o.sources;
  if (!Array.isArray(sources)) {
    out.push('missing or invalid key: sources (must be an array)');
  } else {
    for (const e of sources) {
      const path = (e == null) ? undefined : e.path;
      if (typeof path !== 'string' || path === '') out.push('sources entry missing non-empty path');
      const hash = (e == null) ? undefined : e.hash;
      if (typeof hash !== 'string' || hash === '') out.push('sources entry missing non-empty hash');
    }
  }
  return out;
}
