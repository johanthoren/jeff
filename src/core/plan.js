// @ts-check

/**
 * `plan.js`: the markdown-backend port of cook.sh's `plan section|check|append`
 * (skills/cook/scripts/cook.sh:881-1042), at byte parity with the frozen oracle.
 * The three verbs are verdict-shaped (`{ code, stdout[], stderr[] }`); the CLI
 * (`cook.js`) validates the subcommand, then dispatches here, where each verb does
 * its OWN arg-count usage check (mirroring the oracle's `[ "$#" -eq N ]`).
 *
 * The awk of `plan_section_bounds` / `plan_check_file` / `plan_append_file` is
 * replicated in JS (no shelling out): the slug rule, the naive fence toggle, the
 * section-bounds walk, the first-match checkbox tick, and the verbatim section
 * append. `resolveRefPath` is a faithful port of `resolve_ref_path` : the
 * fail-closed, per-hop symlink containment guard (the security core): a plain
 * `fs.realpathSync` is deliberately REJECTED because it resolves an in→out→in
 * symlink chain the oracle refuses (a parity break AND a containment hole).
 *
 * The GitHub-issue backend (`is_issue_ref` routing, slice 3d2) is `planIssueOp`
 * below: an issue-shaped ref is routed by `cook.js` past `resolveRefPath`
 * entirely, straight to `gh`, reusing the same `checkContent`/`appendContent`
 * transforms as the markdown verbs (no containment : a fetched issue body is
 * not a user path).
 */

import { readFile, mkdir } from 'node:fs/promises';
import { lstatSync, statSync, realpathSync, readlinkSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { writeFileAtomic } from './lifecycle.js';
import { assertStoreContained, collectTasks, readMode, writeTask } from './store.js';

/** @typedef {{ code: number, stdout: string[], stderr: string[] }} Verdict */

// Bound the symlink walk so a cycle (a -> b -> a) fails CLOSED, never spins.
// Parity with cook.sh's SYMLINK_MAX_HOPS (skills/cook/scripts/cook.sh:781).
const SYMLINK_MAX_HOPS = 40;

/**
 * A failure verdict: `die "<msg>"` prints `cook: <msg>` to stderr, exit 1.
 *
 * @param {string} msg
 * @returns {Verdict}
 */
function die(msg) {
  return { code: 1, stdout: [], stderr: [`cook: ${msg}`] };
}

// --- containment (resolve_ref_path port) ----------------------------------

/**
 * Resolve the physical (symlink-free) absolute path of an EXISTING directory, or
 * null. Port of `resolve_dir` (`cd "$1" && pwd -P`): `cd` follows symlinks and
 * fails on a non-directory, so realpath is guarded by an `isDirectory` check.
 *
 * @param {string} dir
 * @returns {string | null}
 */
function resolveDir(dir) {
  try {
    const real = realpathSync(dir);
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

/**
 * Is `p` inside `rootdir` (equal, or a descendant)? Both must be physically
 * resolved. Prefix test anchored on a trailing '/' so `/a/bc` is NOT inside
 * `/a/b`. Port of `path_is_inside`.
 *
 * @param {string} p
 * @param {string} rootdir
 * @returns {boolean}
 */
function pathIsInside(p, rootdir) {
  return p === rootdir || p.startsWith(`${rootdir}/`);
}

/** `[ -e "$1" ]`: exists, following symlinks. @param {string} p @returns {boolean} */
function pathExists(p) {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** `[ -L "$1" ]`: is a symlink (no follow). @param {string} p @returns {boolean} */
function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** `[ -f "$1" ]`: is a regular file, following symlinks. @param {string} p @returns {boolean} */
function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a user-supplied plan ref to an absolute file path provably inside ROOT,
 * or null. Faithful port of `resolve_ref_path` (skills/cook/scripts/cook.sh:827):
 * the ref's PARENT must resolve inside ROOT; the leaf must exist; then the symlink
 * chain is followed hop by hop, re-checking containment at EVERY hop (a single
 * check is not enough : an in-ROOT chain whose final target lands outside ROOT
 * escapes if we stop after one readlink), bounded by SYMLINK_MAX_HOPS so a cycle
 * fails CLOSED. A plain `fs.realpathSync(candidate)` is NOT used: it would resolve
 * (and thus accept) an in→out→in chain the oracle refuses.
 *
 * @param {string} root
 * @param {string} ref
 * @returns {string | null}
 */
export function resolveRefPath(root, ref) {
  const rootdir = resolveDir(root);
  if (rootdir === null) return null;

  // Absolute refs kept as-is; relative refs joined onto raw ROOT (NOT path.join :
  // that would normalize away the `..` the containment check must catch). The
  // parent is physically resolved below, so a lexical `..` is handled correctly.
  const candidate = ref.startsWith('/') ? ref : `${root}/${ref}`;

  const parent = dirname(candidate);
  const base = basename(candidate);
  const resolvedParent = resolveDir(parent);
  if (resolvedParent === null) return null;
  if (!pathIsInside(resolvedParent, rootdir)) return null;

  let leaf = `${resolvedParent}/${base}`;
  if (!pathExists(leaf)) return null;

  let hops = 0;
  while (isSymlink(leaf)) {
    hops += 1;
    if (hops > SYMLINK_MAX_HOPS) return null;
    const link = readlinkSync(leaf);
    let tparent = dirname(link);
    const tbase = basename(link);
    // Relative link target resolves against the link's OWN (already-resolved)
    // directory, not the original candidate's parent.
    if (!tparent.startsWith('/')) tparent = `${dirname(leaf)}/${tparent}`;
    const tresolved = resolveDir(tparent);
    if (tresolved === null) return null;
    if (!pathIsInside(tresolved, rootdir)) return null;
    leaf = `${tresolved}/${tbase}`;
    if (!pathExists(leaf)) return null;
  }

  return isFile(leaf) ? leaf : null;
}

// --- markdown engine (slug / bounds / check / append) ---------------------

/**
 * GitHub-style heading slug, byte-exact with the awk `slug()` of
 * plan_section_bounds: lowercase → trim leading/trailing ` `/`\t` → collapse
 * runs of ` `/`\t` to `-` → strip everything outside `[a-z0-9-]`. No
 * consecutive-hyphen collapse (matching the oracle, not CommonMark).
 *
 * @param {string} s
 * @returns {string}
 */
function slug(s) {
  return s
    .toLowerCase()
    .replace(/^[ \t]+|[ \t]+$/g, '')
    .replace(/[ \t]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Split file content into awk-style records: `\n`-separated, and (like awk) a
 * trailing `\n` does NOT produce a spurious empty final record.
 *
 * @param {string} content
 * @returns {string[]}
 */
function splitLines(content) {
  const lines = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Rejoin records the way awk prints them: every record followed by ORS (`\n`),
 * including the last : so a file with a trailing newline round-trips, and one
 * without gains a trailing newline exactly as the oracle's awk would.
 *
 * @param {string[]} lines
 * @returns {string}
 */
function joinLines(lines) {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/**
 * Line range `[start, end]` (1-based, inclusive) of the section whose heading
 * slug == anchor, or null. Port of plan_section_bounds: fence-aware (naive
 * ```/~~~ toggle), section ends at the next heading with depth <= start_depth,
 * else EOF.
 *
 * @param {string[]} lines
 * @param {string} anchor
 * @returns {[number, number] | null}
 */
function sectionBounds(lines, anchor) {
  let infence = false;
  let found = false;
  let startLine = 0;
  let startDepth = 0;
  const total = lines.length;
  for (let i = 0; i < total; i++) {
    const nr = i + 1;
    const line = lines[i];
    if (/^```/.test(line) || /^~~~/.test(line)) {
      infence = !infence;
      continue;
    }
    if (!infence && /^#+[ \t]/.test(line)) {
      let depth = 0;
      while (line[depth] === '#') depth += 1;
      const text = line.replace(/^#+[ \t]+/, '');
      if (found) {
        if (depth <= startDepth) return [startLine, nr - 1];
        continue;
      }
      if (slug(text) === anchor) {
        found = true;
        startLine = nr;
        startDepth = depth;
      }
    }
  }
  return found ? [startLine, total] : null;
}

/**
 * Tick the FIRST `- [ ]` whose text after `- [x] ` (`substr($0,7)`) contains
 * `sub`; already-checked is idempotent. Every other byte preserved. Returns the
 * new content, or null if no checklist item matches (the caller dies : no write).
 * The ONE copy of the check transform: both the markdown verb (`planCheck`, with
 * containment) and the issue adapter (`planIssueOp`, no containment) call it.
 * Port of plan_check_file (:932).
 *
 * @param {string} content
 * @param {string} sub
 * @returns {string | null}
 */
function checkContent(content, sub) {
  const lines = splitLines(content);
  let matched = false;
  let infence = false;
  /** @type {string[]} */
  const out = [];
  for (let line of lines) {
    if (/^```/.test(line) || /^~~~/.test(line)) {
      infence = !infence;
      out.push(line);
      continue;
    }
    if (!matched && !infence && /^- \[[ xX]\] /.test(line)) {
      const text = line.substring(6); // substr($0, 7) : text after `- [x] `
      // index(text, needle) > 0 is 1-based: an empty needle is 0 → no match.
      if (sub !== '' && text.includes(sub)) {
        matched = true;
        if (/^- \[ \] /.test(line)) line = line.replace(/^- \[ \] /, '- [x] ');
      }
    }
    out.push(line);
  }
  if (!matched) return null;
  return joinLines(out);
}

/**
 * Insert `text` as a new line AFTER the last non-blank line (`/[^ \t]/`) within
 * the section whose heading slug == `anchor`, so the trailing blank separator
 * before the next heading survives; `text` is inserted BYTE-VERBATIM. Returns the
 * new content, or null if no heading matches `anchor` (the caller dies : no
 * write). The ONE copy of the append transform, shared by `planAppend` (markdown,
 * containment) and `planIssueOp` (issue, no containment). Port of
 * plan_append_file (:977).
 *
 * @param {string} content
 * @param {string} anchor
 * @param {string} text
 * @returns {string | null}
 */
function appendContent(content, anchor, text) {
  const lines = splitLines(content);
  const bounds = sectionBounds(lines, anchor);
  if (bounds === null) return null;
  const [start, end] = bounds;

  // Insertion point: the LAST non-blank line within [start, end] (1-based).
  let ins = 0;
  for (let i = 0; i < lines.length; i++) {
    const fnr = i + 1;
    if (fnr >= start && fnr <= end && /[^ \t]/.test(lines[i])) ins = fnr;
  }

  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    if (i + 1 === ins) out.push(text);
  }
  return joinLines(out);
}

// --- verbs ----------------------------------------------------------------

/**
 * Resolve `file` inside ROOT for plan verb `verb` (`section`/`check`/`append`,
 * used only in the shared die message), or the containment-refusal `Verdict`.
 * Every verb below checks containment FIRST (an out-of-ROOT read/write is
 * refused before the file is even opened) with the same message shape, so this
 * is the one place that pairs `resolveRefPath` with its die.
 *
 * @param {string} root
 * @param {string} verb
 * @param {string} file
 * @returns {string | Verdict}
 */
function resolveRefOrDie(root, verb, file) {
  const resolved = resolveRefPath(root, file);
  if (resolved !== null) return resolved;
  return die(`plan ${verb}: file must resolve to an existing file inside the repo: ${file}`);
}

/**
 * `cook plan section <file> <anchor>`: print `<start> <end>` bounds. Containment
 * FIRST (an out-of-ROOT read is refused before the file is opened), then bounds,
 * then the no-match die. Parity with plan_section (:911).
 *
 * @param {string} root
 * @param {...string} args
 * @returns {Promise<Verdict>}
 */
export async function planSection(root, ...args) {
  if (args.length !== 2) return die('usage: cook plan section <file> <anchor>');
  const [file, anchor] = args;
  const resolved = resolveRefOrDie(root, 'section', file);
  if (typeof resolved !== 'string') return resolved;
  const bounds = sectionBounds(splitLines(await readFile(resolved, 'utf8')), anchor);
  if (bounds === null) return die(`plan section: no heading matches anchor: ${anchor}`);
  return { code: 0, stdout: [`${bounds[0]} ${bounds[1]}`], stderr: [] };
}

/**
 * `cook plan check <file> <substring>`: tick the FIRST `- [ ]` whose text after
 * `- [x] ` (`substr($0,7)`) contains the substring; already-checked is idempotent;
 * no match dies. Every other byte preserved; the write is atomic. Containment
 * FIRST (no tmp, no write on refusal). Parity with plan_check (:964) +
 * plan_check_file (:932).
 *
 * @param {string} root
 * @param {...string} args
 * @returns {Promise<Verdict>}
 */
export async function planCheck(root, ...args) {
  if (args.length !== 2) return die('usage: cook plan check <file> <substring>');
  const [file, sub] = args;
  const resolved = resolveRefOrDie(root, 'check', file);
  if (typeof resolved !== 'string') return resolved;
  const next = checkContent(await readFile(resolved, 'utf8'), sub);
  if (next === null) return die(`plan check: no checklist item matches: ${sub}`);
  await writeFileAtomic(resolved, next);
  return { code: 0, stdout: [], stderr: [] };
}

/**
 * `cook plan append <file> <anchor> <text>`: insert `text` as a new line AFTER
 * the last non-blank line (`/[^ \t]/`) within the section's bounds, so the
 * trailing blank separator before the next heading survives. `text` is inserted
 * BYTE-VERBATIM (the oracle passes it via ENVIRON, not awk `-v`, to skip escape
 * processing : a JS string arg is already verbatim). Anchor not found dies. Atomic,
 * containment FIRST. Parity with plan_append (:1012) + plan_append_file (:977).
 *
 * @param {string} root
 * @param {...string} args
 * @returns {Promise<Verdict>}
 */
export async function planAppend(root, ...args) {
  if (args.length !== 3) return die('usage: cook plan append <file> <anchor> <text>');
  const [file, anchor, text] = args;
  const resolved = resolveRefOrDie(root, 'append', file);
  if (typeof resolved !== 'string') return resolved;
  const next = appendContent(await readFile(resolved, 'utf8'), anchor, text);
  if (next === null) return die(`plan append: no heading matches anchor: ${anchor}`);
  await writeFileAtomic(resolved, next);
  return { code: 0, stdout: [], stderr: [] };
}

// --- github-issues adapter (plan_issue_op port) ---------------------------

/**
 * Is REF issue-SHAPED (routes to the issue adapter rather than the markdown
 * path)? Anything starting with '#', or any http(s) URL. ROUTING predicate ONLY:
 * a shaped ref is then strictly validated by `issueRefValidate`. Port of
 * `is_issue_ref` (:1075).
 *
 * @param {string} ref
 * @returns {boolean}
 */
export function isIssueRef(ref) {
  return ref.startsWith('#') || ref.startsWith('http://') || ref.startsWith('https://');
}

/**
 * Validate an issue-shaped REF fail-closed (SECURITY): accept ONLY a digits-only
 * `#<n>` or a strict `https://github.com/<owner>/<repo>/issues/<n>` URL. Returns
 * null when valid, or a die `Verdict` (three distinct messages, byte-exact with
 * the oracle). Called BEFORE any gh spawn : a rejected ref spawns NO gh. Port of
 * `issue_ref_validate` (:1087).
 *
 * @param {string} ref
 * @returns {Verdict | null}
 */
export function issueRefValidate(ref) {
  // The oracle's die strings themselves start with a literal `cook: ` and `die`
  // prepends another → the frozen output is a double `cook: cook: ` prefix. We
  // replicate that verbatim (parity, not aesthetics).
  // `'#'[0-9]*` in the oracle: a `#` followed by at least one digit.
  if (/^#[0-9]/.test(ref)) {
    if (!/^#[0-9]+$/.test(ref)) return die(`cook: invalid issue ref: ${ref} (expected '#<digits>').`);
    return null;
  }
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    if (!/^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/issues\/[0-9]+$/.test(ref)) {
      return die(`cook: invalid issue URL: ${ref} (expected https://github.com/<owner>/<repo>/issues/<n>).`);
    }
    return null;
  }
  return die(`cook: invalid issue ref: ${ref} (expected '#<digits>' or a github issues URL).`);
}

/**
 * Classify a `gh` `spawnSync` result as ENOENT (gh absent) vs. a non-zero exit,
 * returning the matching die `Verdict`, or null on success (status 0). The ONE
 * copy of the error-classification shared by `ghFetchBody` (view) and
 * `ghWriteBody` (edit) : each supplies its own byte-exact messages; the oracle's
 * die strings themselves start with a literal `cook: ` and `die` prepends
 * another → the frozen output is a double `cook: cook: ` prefix, replicated
 * verbatim by both callers (parity, not aesthetics). gh's stderr is inherited by
 * both callers, so its own error line streams through BEFORE the die line
 * (order parity). Shared error-shape of `gh_issue_fetch_body` (:1107) and
 * `gh_issue_write_body` (:1120).
 *
 * @param {{ error?: NodeJS.ErrnoException, status: number | null }} res
 * @param {string} enoentMsg
 * @param {string} failMsg
 * @returns {Verdict | null}
 */
function ghDie(res, enoentMsg, failMsg) {
  if (res.error && res.error.code === 'ENOENT') return die(enoentMsg);
  if (res.status !== 0) return die(failMsg);
  return null;
}

/**
 * Fetch the (already-validated) issue body via `gh issue view <ref> --json body
 * -q .body --`, spawned as an argv ARRAY (no shell → no injection). Returns the
 * body string, or a die `Verdict` (see `ghDie`). No token/body is logged. Port
 * of `gh_issue_fetch_body` (:1107).
 *
 * @param {string} ref
 * @returns {string | Verdict}
 */
export function ghFetchBody(ref) {
  const res = spawnSync('gh', ['issue', 'view', ref, '--json', 'body', '-q', '.body', '--'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const failure = ghDie(
    res,
    `cook: \`gh\` is required to read issue ${ref} but was not found on PATH (install the GitHub CLI, then retry).`,
    `cook: \`gh issue view\` failed for ${ref} (is gh authenticated? try \`gh auth status\`).`,
  );
  return failure ?? res.stdout;
}

/**
 * Write CONTENT back to issue REF as its new body via EXACTLY `gh issue edit
 * <ref> --body-file=<tmp> --` : annotate-only, NO state/label/assignee/milestone
 * flag : spawned as an argv ARRAY. CONTENT goes to a temp under `os.tmpdir()`,
 * removed in `finally` even on edit failure (no orphan). Returns null on success
 * or a die `Verdict` (see `ghDie`). Port of `gh_issue_write_body` (:1120).
 *
 * @param {string} ref
 * @param {string} content
 * @returns {Verdict | null}
 */
function ghWriteBody(ref, content) {
  const dir = mkdtempSync(join(tmpdir(), 'cook-plan-issue-'));
  const tmp = join(dir, 'body');
  try {
    writeFileSync(tmp, content);
    const res = spawnSync('gh', ['issue', 'edit', ref, `--body-file=${tmp}`, '--'], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    return ghDie(
      res,
      `cook: \`gh\` is required to update issue ${ref} but was not found on PATH.`,
      `cook: \`gh issue edit\` failed for ${ref}.`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run a plan op (section|check|append) against an ISSUE REF, reusing the markdown
 * engine byte-for-byte on the FETCHED body (no `resolveRefPath` : the body is a
 * trusted temp we fetched, not a user path). Lite-gated (writing a shared issue
 * is a lite-only act). Order: lite-gate → `issueRefValidate` → fetch → per-op
 * arg-count check + engine transform; section is read-only (bounds, no edit),
 * check/append write back via `ghWriteBody`. Any failure before the write returns
 * with no edit / no orphan temp. Port of `plan_issue_op` (:1134).
 *
 * @param {string} root
 * @param {string} op
 * @param {string} ref
 * @param {...string} rest
 * @returns {Promise<Verdict>}
 */
export async function planIssueOp(root, op, ref, ...rest) {
  if ((await readMode(root)) !== 'lite') {
    return die('`cook plan` is a lite-mode command; run `cook lite` first (writing a shared issue is a lite-only act).');
  }
  const invalid = issueRefValidate(ref);
  if (invalid !== null) return invalid;

  const fetched = ghFetchBody(ref);
  if (typeof fetched !== 'string') return fetched;
  const body = fetched;

  switch (op) {
    case 'section': {
      if (rest.length !== 1) return die('usage: cook plan section <issue-ref> <anchor>');
      const bounds = sectionBounds(splitLines(body), rest[0]);
      if (bounds === null) return die(`plan section: no heading matches anchor: ${rest[0]}`);
      return { code: 0, stdout: [`${bounds[0]} ${bounds[1]}`], stderr: [] };
    }
    case 'check': {
      if (rest.length !== 1) return die('usage: cook plan check <issue-ref> <substring>');
      const next = checkContent(body, rest[0]);
      if (next === null) return die(`plan check: no checklist item matches: ${rest[0]}`);
      return ghWriteBody(ref, next) ?? { code: 0, stdout: [], stderr: [] };
    }
    case 'append': {
      if (rest.length !== 2) return die('usage: cook plan append <issue-ref> <anchor> <text>');
      const next = appendContent(body, rest[0], rest[1]);
      if (next === null) return die(`plan append: no heading matches anchor: ${rest[0]}`);
      return ghWriteBody(ref, next) ?? { code: 0, stdout: [], stderr: [] };
    }
    default:
      return die(`unknown plan subcommand: ${op}`);
  }
}

/**
 * POSIX `cksum` for the historical, deterministic lite-ledger directory suffix.
 *
 * @param {string} value
 */
function cksum(value) {
  const bytes = Buffer.from(value);
  let crc = 0;
  const update = (/** @type {number} */ byte) => {
    crc = (crc ^ (byte << 24)) >>> 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = ((crc & 0x80000000) !== 0 ? (crc << 1) ^ 0x04c11db7 : crc << 1) >>> 0;
    }
  };
  for (const byte of bytes) update(byte);
  for (let length = bytes.length; length > 0; length = Math.floor(length / 256)) update(length & 0xff);
  return (~crc) >>> 0;
}

/** @param {string} ref @param {any} ledger @returns {Verdict} */
function existingLedgerVerdict(ref, ledger) {
  if (ledger.externalRef !== ref) {
    return die(`cook on: ledger collision at ${ledger._dir}: already owned by ${ledger.externalRef ?? 'another ref'}`);
  }
  return {
    code: 0,
    stdout: [`cook: already adopted: resuming ledger for ${ref} (${ledger._dir}).`],
    stderr: [],
  };
}

/**
 * Adopt a markdown file or GitHub issue as a lite task ledger.
 *
 * @param {string} root
 * @param {...string} args
 * @returns {Promise<Verdict>}
 */
export async function adoptPlan(root, ...args) {
  try {
    await assertStoreContained(root);
  } catch (error) {
    return die(/** @type {Error} */ (error).message);
  }
  if ((await readMode(root)) !== 'lite') {
    return die('`cook on` is a lite-mode command; run `cook lite` first (full mode tracks tasks in the registry).');
  }
  if (args.length === 0 || args[0] === '') return die('usage: cook on <ref>');
  if (args.length > 1) return die(`on: unexpected argument '${args[1]}'`);
  const ref = args[0];
  const issueRef = isIssueRef(ref);

  if (issueRef) {
    const invalid = issueRefValidate(ref);
    if (invalid !== null) return invalid;
  } else {
    const filePart = ref.split('#', 1)[0];
    if (filePart === '') return die(`cook on: invalid ref (no file part): ${ref}`);
    if (resolveRefPath(root, filePart) === null) {
      return die(`cook on: ref must resolve to an existing file inside the repo: ${ref}`);
    }
  }

  let tasks;
  try {
    tasks = await collectTasks(root);
  } catch {
    return die('cook on: could not read existing ledgers.');
  }
  const existing = tasks.find((task) => task.externalRef === ref);
  if (existing) return existingLedgerVerdict(ref, existing);

  const base = ref.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160) || 'task';
  const hash = cksum(ref);
  const tasksDir = join(root, '.jeff', 'tasks');
  const taskDir = join(tasksDir, `lite-${base}-${hash}`);
  try {
    await assertStoreContained(root, [taskDir]);
  } catch (error) {
    return die(/** @type {Error} */ (error).message);
  }
  const taskFile = `.jeff/tasks/${basename(taskDir)}/task.json`;
  const collision = tasks.find((task) => task._dir === taskFile);
  if (collision) return existingLedgerVerdict(ref, collision);
  if (issueRef) {
    const fetched = ghFetchBody(ref);
    if (typeof fetched !== 'string') return fetched;
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const task = {
    schemaVersion: 1,
    id: ref,
    externalRef: ref,
    slug: 'lite-adopt',
    title: ref,
    status: 'pending',
    stage: 'capture',
    priority: 'p2',
    deps: [],
    complexity: 'complex',
    createdAt: now,
    updatedAt: now,
    agents: {
      implementer_agent_id: null,
      reviewer_agent_id: null,
      reviewer2_agent_id: null,
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
  try {
    await mkdir(tasksDir, { recursive: true });
  } catch {
    return die('cook on: could not initialize ledger.');
  }
  try {
    await mkdir(taskDir);
  } catch (error) {
    if (/** @type {any} */ (error).code !== 'EEXIST') {
      return die('cook on: could not initialize ledger.');
    }
    let currentTasks;
    try {
      currentTasks = await collectTasks(root);
    } catch {
      return die('cook on: could not read existing ledgers.');
    }
    const owner = currentTasks.find((currentTask) => currentTask._dir === taskFile);
    if (owner) return existingLedgerVerdict(ref, owner);
    return die(`cook on: ledger initialization in progress at ${taskFile}.`);
  }
  try {
    await writeTask(taskDir, /** @type {any} */ (task));
  } catch {
    return die('cook on: could not initialize ledger.');
  }
  return {
    code: 0,
    stdout: [`cook: adopted ${ref} → ${taskDir.slice(root.length + 1)}/task.json (lite, stage:capture).`],
    stderr: [],
  };
}
