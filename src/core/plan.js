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
 * append. `resolveRefPath` is a faithful port of `resolve_ref_path` — the
 * fail-closed, per-hop symlink containment guard (the security core): a plain
 * `fs.realpathSync` is deliberately REJECTED because it resolves an in→out→in
 * symlink chain the oracle refuses (a parity break AND a containment hole).
 *
 * The GitHub-issue backend (`is_issue_ref` routing) is slice 3d2: an issue-shaped
 * ref falls through here to the markdown containment path (a non-existent
 * `ROOT/<ref>`, refused by `resolveRefPath`) — no special handling in 3d1.
 */

import { readFile } from 'node:fs/promises';
import { lstatSync, statSync, realpathSync, readlinkSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { writeFileAtomic } from './lifecycle.js';

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
 * check is not enough — an in-ROOT chain whose final target lands outside ROOT
 * escapes if we stop after one readlink), bounded by SYMLINK_MAX_HOPS so a cycle
 * fails CLOSED. A plain `fs.realpathSync(candidate)` is NOT used: it would resolve
 * (and thus accept) an in→out→in chain the oracle refuses.
 *
 * @param {string} root
 * @param {string} ref
 * @returns {string | null}
 */
function resolveRefPath(root, ref) {
  const rootdir = resolveDir(root);
  if (rootdir === null) return null;

  // Absolute refs kept as-is; relative refs joined onto raw ROOT (NOT path.join —
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
 * including the last — so a file with a trailing newline round-trips, and one
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

// --- verbs ----------------------------------------------------------------

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
  const resolved = resolveRefPath(root, file);
  if (resolved === null) {
    return die(`plan section: file must resolve to an existing file inside the repo: ${file}`);
  }
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
  const resolved = resolveRefPath(root, file);
  if (resolved === null) {
    return die(`plan check: file must resolve to an existing file inside the repo: ${file}`);
  }
  const lines = splitLines(await readFile(resolved, 'utf8'));
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
      const text = line.substring(6); // substr($0, 7) — text after `- [x] `
      // index(text, needle) > 0 is 1-based: an empty needle is 0 → no match.
      if (sub !== '' && text.includes(sub)) {
        matched = true;
        if (/^- \[ \] /.test(line)) line = line.replace(/^- \[ \] /, '- [x] ');
      }
    }
    out.push(line);
  }
  if (!matched) return die(`plan check: no checklist item matches: ${sub}`);
  await writeFileAtomic(resolved, joinLines(out));
  return { code: 0, stdout: [], stderr: [] };
}

/**
 * `cook plan append <file> <anchor> <text>`: insert `text` as a new line AFTER
 * the last non-blank line (`/[^ \t]/`) within the section's bounds, so the
 * trailing blank separator before the next heading survives. `text` is inserted
 * BYTE-VERBATIM (the oracle passes it via ENVIRON, not awk `-v`, to skip escape
 * processing — a JS string arg is already verbatim). Anchor not found dies. Atomic,
 * containment FIRST. Parity with plan_append (:1012) + plan_append_file (:977).
 *
 * @param {string} root
 * @param {...string} args
 * @returns {Promise<Verdict>}
 */
export async function planAppend(root, ...args) {
  if (args.length !== 3) return die('usage: cook plan append <file> <anchor> <text>');
  const [file, anchor, text] = args;
  const resolved = resolveRefPath(root, file);
  if (resolved === null) {
    return die(`plan append: file must resolve to an existing file inside the repo: ${file}`);
  }
  const lines = splitLines(await readFile(resolved, 'utf8'));
  const bounds = sectionBounds(lines, anchor);
  if (bounds === null) return die(`plan append: no heading matches anchor: ${anchor}`);
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
  await writeFileAtomic(resolved, joinLines(out));
  return { code: 0, stdout: [], stderr: [] };
}
