// @ts-check

/**
 * `validateStore(root)`: the in-process verdict boundary. Port of cook.sh's
 * `cmd_validate` order of operations (skills/cook/scripts/cook.sh:308-632),
 * returning a verdict object instead of printing + exiting, so the CLI and the
 * future pi extension can both consume it without spawning a subprocess.
 *
 * Sequence (parity target): collect (fail closed) → `[gate]` pre-flight
 * short-circuit → full-mode empty-store early return → main invariant pass →
 * profile conformance → OK.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectTasks, readMode } from './store.js';
import { gatePreflight, runInvariants } from './invariants.js';

/**
 * @typedef {Object} Verdict
 * @property {boolean} ok - true iff the store validates
 * @property {number} code - process exit code (0 OK, 1 any failure)
 * @property {string[]} stdout - lines to print to stdout
 * @property {string[]} stderr - lines to print to stderr
 */

/**
 * @param {string} root - repository root (COOK_ROOT-resolved)
 * @returns {Promise<Verdict>}
 */
export async function validateStore(root) {
  const lite = (await readMode(root)) === 'lite';

  // 1. Collect, fail CLOSED on any unparseable task.json.
  let tasks;
  try {
    tasks = await collectTasks(root);
  } catch (err) {
    const stderr = [];
    const dir = err && /** @type {any} */ (err).dir;
    if (dir) stderr.push(`cook: validation FAILED: unparseable task.json at ${dir}`);
    stderr.push('cook: validation FAILED: could not parse the task store (unreadable or malformed task path/JSON under .jeff/tasks/).');
    return { ok: false, code: 1, stdout: [], stderr };
  }

  // 2. [gate] done-gate pre-flight — short-circuits the whole pass on violation.
  let gateViolations;
  try {
    gateViolations = gatePreflight(tasks);
  } catch {
    return {
      ok: false,
      code: 1,
      stdout: [],
      stderr: ['cook: validation FAILED: could not evaluate the [gate] done-gate pre-flight (malformed tests.gate JSON?).'],
    };
  }
  if (gateViolations.length > 0) {
    return {
      ok: false,
      code: 1,
      stdout: [],
      stderr: [...gateViolations, `cook: validation FAILED (${gateViolations.length} issue(s))`],
    };
  }

  // 3. Full mode over an empty store: nothing to validate. (Lite runs even empty.)
  if (!lite && tasks.length === 0) {
    return {
      ok: true,
      code: 0,
      stdout: ['cook: no tasks under .jeff/tasks/: nothing to validate.'],
      stderr: [],
    };
  }

  // 4. Main invariant pass — fail CLOSED if it could not evaluate.
  let violations;
  try {
    violations = runInvariants(tasks, { lite });
  } catch {
    return {
      ok: false,
      code: 1,
      stdout: [],
      stderr: ['cook: validation FAILED: the invariant pass could not evaluate the task store.'],
    };
  }
  if (violations.length > 0) {
    return {
      ok: false,
      code: 1,
      stdout: [],
      stderr: [...violations, `cook: validation FAILED (${violations.length} issue(s))`],
    };
  }

  // 5. Profile conformance — present-means-conform; absent is fine.
  let profileText = null;
  try {
    profileText = await readFile(join(root, '.jeff', 'profile.md'), 'utf8');
  } catch {
    profileText = null;
  }
  if (profileText !== null) {
    const message = checkProfile(profileText);
    if (message !== null) {
      return {
        ok: false,
        code: 1,
        stdout: [],
        stderr: [message, 'cook: validation FAILED: .jeff/profile.md does not conform (fix it or remove it)'],
      };
    }
  }

  // 6. OK.
  return {
    ok: true,
    code: 0,
    stdout: [`cook: validation OK (${tasks.length} task(s))`],
    stderr: [],
  };
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
