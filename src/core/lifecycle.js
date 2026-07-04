// @ts-check

import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readMode } from './store.js';

/** @typedef {{ code: number, stdout: string[], stderr: string[] }} Verdict */

/**
 * The live `jq --version` (trimmed), or `null` if jq is not on PATH — the JS
 * equivalent of cook.sh's `command -v jq` + `jq --version`. Both the oracle and
 * this port shell the SAME binary, so the version string matches; the jq-present
 * flag also gates `doctor`'s ACTIVE status, replicating cook.sh's quirk (:686).
 *
 * @returns {string | null}
 */
function jqVersion() {
  try {
    return execFileSync('jq', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * `cook doctor` (read-only): the environment/health report, at parity with
 * cook.sh's `cmd_doctor` (skills/cook/scripts/cook.sh:674). Prints, in order:
 * the header, `root:`, the jq line (OK-with-version or the MISSING install
 * hint), `mode:` (via the shared `readMode`), the jeff ACTIVE/inactive status,
 * and — lite mode only — the git-hook note.
 *
 * ACTIVE requires ALL of: `.jeff/config.json` exists, jq is on PATH, and its
 * `.active` reads as `true` — cook.sh gates the status on jq-presence (:686),
 * quirk and all, so this port does too. The `.active // false = "true"` shell
 * test maps to `String(cfg.active ?? false) === 'true'` (a JSON `true` or the
 * string `"true"` both pass; absent/null/false fail).
 *
 * NOTE (item-5 boundary): this reports **jq** to match cook.sh NOW. Item 5
 * flips the dependency check to node; do not jump ahead.
 *
 * @param {string} root
 * @returns {Promise<Verdict>}
 */
export async function doctorReport(root) {
  const configPath = join(root, '.jeff', 'config.json');
  const ver = jqVersion();

  /** @type {string[]} */
  const stdout = [];
  stdout.push('cook doctor');
  stdout.push(`  root: ${root}`);
  stdout.push(
    ver !== null
      ? `  jq:   OK (${ver})`
      : '  jq:   MISSING: run `brew install jq` (macOS) / `apt-get install jq` (Debian)',
  );

  const mode = await readMode(root);
  stdout.push(`  mode: ${mode}`);

  let active = false;
  if (ver !== null) {
    try {
      const cfg = JSON.parse(await readFile(configPath, 'utf8'));
      active = String(cfg.active ?? false) === 'true';
    } catch {
      active = false;
    }
  }
  stdout.push(active ? '  jeff: ACTIVE' : '  jeff: inactive (run `cook init` to activate)');

  if (mode === 'lite') {
    stdout.push('  git hook: intentionally not installed (no mode installs a hook; team owns git policy)');
  }

  return { code: 0, stdout, stderr: [] };
}

/**
 * Whether `<root>/.git` is a directory — the `[ -d "$ROOT/.git" ]` guard. A
 * `.git` FILE (submodule/worktree) or a missing `.git` both read false, matching
 * cook.sh's `cmd_init` (:711).
 *
 * @param {string} root
 * @returns {boolean}
 */
function isGitRepo(root) {
  try {
    return statSync(join(root, '.git')).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Write `json` to `target` atomically: a same-dir temp created exclusively
 * (`flag: 'wx'`) then renamed over the target (atomic on one filesystem, so a
 * reader never sees a partial file). Mirrors cook.sh's `mktemp` + `mv` (:703).
 * The temp path is non-observable, so `randomBytes` names it; a failed rename
 * unlinks the orphan and re-throws (fails closed). File mode is out of parity
 * scope (cook.sh is itself inconsistent), so no `mode` is forced.
 *
 * @param {string} target
 * @param {string} json
 * @returns {Promise<void>}
 */
async function writeFileAtomic(target, json) {
  const tmp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(tmp, json, { flag: 'wx', encoding: 'utf8' });
  try {
    await rename(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

/**
 * `cook init`: activate a project, at parity with cook.sh's `cmd_init` (:709) +
 * `ensure_scaffold` (:697). The git guard fires BEFORE any filesystem write:
 * a non-git dir dies `cook: not a git repository: <root>` (exit 1) with nothing
 * scaffolded. Otherwise: `mkdir -p .jeff/{tasks,memory}`; create an empty
 * `.jeff/tasks/.gitkeep` if absent (never truncate an existing one); and write
 * `config.json` — an ABSENT config gets `{schemaVersion:1, system:"jeff",
 * active:true}`, an EXISTING config has `.active` set to `true` preserving every
 * other key and its ORDER (update-in-place if present, append-last if not). The
 * config is `JSON.stringify(obj, null, 2) + '\n'` (byte-identical to jq's
 * pretty-print) written atomically. Then prints the activation line, exit 0.
 *
 * @param {string} root
 * @returns {Promise<Verdict>}
 */
export async function initProject(root) {
  if (!isGitRepo(root)) {
    return { code: 1, stdout: [], stderr: [`cook: not a git repository: ${root}`] };
  }

  const bk = join(root, '.jeff');
  await mkdir(join(bk, 'tasks'), { recursive: true });
  await mkdir(join(bk, 'memory'), { recursive: true });

  // `.gitkeep` if absent — never truncate an existing one (`[ -f … ] || :>`).
  await writeFile(join(bk, 'tasks', '.gitkeep'), '', { flag: 'wx', encoding: 'utf8' })
    .catch((/** @type {any} */ e) => { if (e.code !== 'EEXIST') throw e; });

  const configPath = join(bk, 'config.json');
  /** @type {string | null} */
  let raw = null;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch {
    raw = null; // absent → create fresh below
  }
  // Existing config: read → set `.active = true` (in place / append-last) →
  // re-serialize. Absent: the jq-form default. An unparseable existing config
  // throws (fails closed) rather than clobbering a user's real project state.
  const obj = raw === null
    ? { schemaVersion: 1, system: 'jeff', active: true }
    : Object.assign(JSON.parse(raw), { active: true });

  await writeFileAtomic(configPath, `${JSON.stringify(obj, null, 2)}\n`);

  return {
    code: 0,
    stdout: [`cook: jeff activated in ${root} (scaffold + marked active).`],
    stderr: [],
  };
}
