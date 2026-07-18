// @ts-check

import { appendFile, lstat, readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join, dirname, basename, relative, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { assertStoreContained, readMode, readConfig } from './store.js';
import { checkProfile } from './validate-store.js';
import { git } from './git.js';
import { isType } from './validate.js';

/** @typedef {{ code: number, stdout: string[], stderr: string[] }} Verdict */

const PROFILE_TEMPLATE = `\`\`\`json
{
  "mode": "lite",
  "plan_store": ".jeff/tasks",
  "ledger": ".jeff/run-ledger.json",
  "sources": [
    { "path": ".jeff/profile.md", "hash": "sha256:000000000000000000000000000000000000000000000000000000000000000" }
  ]
}
\`\`\`

## Operating Profile

Task location: \`.jeff/tasks/\`; breakdown: one task per logical change.

Integration: feature branch → PR → team merges; jeff never pushes the protected base.

Handoff: specialist leaves tests green, \`cook validate\` passing, stage committed.

Test command: \`make test\`.

Standards: operator code-standards skill (baseline); language skill overrides.

Audit triggers: destructive ops, prompt-injection surfaces, security-sensitive paths.

Vocabulary:
- task = Jeff task (maps to team tracker issue)
- stage = pipeline phase (capture/plan/implement/refactor/review/audit/done)
`;

/**
 * Report the current project mode and activation state without external tools.
 *
 * @param {string} root
 * @returns {Promise<Verdict>}
 */
export async function doctorReport(root) {
  const mode = await readMode(root);
  const cfg = await readConfig(root);
  const active = String(cfg?.active ?? false) === 'true';
  const stdout = [
    'cook doctor',
    `  root: ${root}`,
    '  node: OK',
    `  mode: ${mode}`,
    active ? '  jeff: ACTIVE' : '  jeff: inactive (run `cook init` to activate)',
  ];
  if (mode === 'lite') {
    stdout.push('  git hook: intentionally not installed (no mode installs a hook; team owns git policy)');
  }
  return { code: 0, stdout, stderr: [] };
}

/**
 * Whether `root` is the top level of a real Git work tree, including a linked
 * worktree whose `.git` is a file. Matches cook.sh's `is_git_root` probe.
 *
 * @param {string} root
 * @returns {boolean}
 */
function isGitRoot(root) {
  const result = git(root, ['rev-parse', '--show-toplevel']);
  if (result.status !== 0) return false;
  try {
    return realpathSync(root) === realpathSync((result.stdout ?? '').replace(/\r?\n$/, ''));
  } catch {
    return false;
  }
}

/**
 * Resolve Git's local exclude file within Git's actual common metadata
 * directory. Linked worktrees legitimately keep that directory outside the
 * worktree root, so the common-dir boundary, not `root`, owns containment.
 *
 * @param {string} root
 * @returns {Promise<string>}
 */
async function resolveGitExclude(root) {
  const excludeResult = git(root, ['rev-parse', '--git-path', 'info/exclude']);
  const excludeValue = (excludeResult.stdout ?? '').trim();
  const commonResult = git(root, ['rev-parse', '--git-common-dir']);
  const commonValue = (commonResult.stdout ?? '').trim();
  if (excludeResult.status !== 0 || excludeValue === '' || commonResult.status !== 0 || commonValue === '') {
    throw new Error(`could not resolve Git info/exclude: ${root}`);
  }

  const exclude = resolve(root, excludeValue);
  try {
    if ((await lstat(exclude)).isSymbolicLink()) {
      throw new Error(`refusing Git info/exclude symlink: ${exclude}`);
    }
  } catch (error) {
    if (/** @type {any} */ (error).code !== 'ENOENT') throw error;
  }

  let metadataDir;
  let excludeDir;
  try {
    metadataDir = realpathSync(resolve(root, commonValue));
    excludeDir = realpathSync(dirname(exclude));
  } catch {
    throw new Error(`could not validate Git info/exclude: ${exclude}`);
  }
  if (basename(exclude) !== 'exclude' || relative(metadataDir, excludeDir) !== 'info') {
    throw new Error(`refusing Git info/exclude path outside Git metadata: ${exclude}`);
  }
  return exclude;
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
export async function writeFileAtomic(target, json) {
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
 * `config.json` : an ABSENT config gets `{schemaVersion:1, system:"jeff",
 * active:true}`, an EXISTING config has `.active` set to `true` preserving every
 * other key and its ORDER (update-in-place if present, append-last if not). The
 * config is `JSON.stringify(obj, null, 2) + '\n'` (byte-identical to jq's
 * pretty-print) written atomically. Then prints the activation line, exit 0.
 *
 * @param {string} root
 * @returns {Promise<Verdict>}
 */
export async function initProject(root) {
  if (!isGitRoot(root)) {
    return { code: 1, stdout: [], stderr: [`cook: not a git repository: ${root}`] };
  }

  const bk = join(root, '.jeff');
  const tasksDir = join(bk, 'tasks');
  const memoryDir = join(bk, 'memory');
  const configPath = join(bk, 'config.json');
  try {
    await assertStoreContained(root, [tasksDir, memoryDir, configPath]);
  } catch (error) {
    return { code: 1, stdout: [], stderr: [`cook: ${/** @type {Error} */ (error).message}`] };
  }

  await mkdir(tasksDir, { recursive: true });
  await mkdir(memoryDir, { recursive: true });

  // `.gitkeep` if absent : never truncate an existing one (`[ -f … ] || :>`).
  await writeFile(join(tasksDir, '.gitkeep'), '', { flag: 'wx', encoding: 'utf8' })
    .catch((/** @type {any} */ e) => { if (e.code !== 'EEXIST') throw e; });

  /** @type {string | null} */
  let raw = null;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (e) {
    let exists = true;
    try {
      await lstat(configPath);
    } catch (statErr) {
      if (/** @type {any} */ (statErr).code === 'ENOENT') exists = false;
      else throw statErr;
    }
    if (exists) {
      return { code: 1, stdout: [], stderr: [`cook: cannot read existing config.json: ${configPath}`] };
    }
    raw = null; // absent → create fresh below
  }
  // Existing config: read → set `.active = true` (in place / append-last) →
  // re-serialize. Absent: the jq-form default. An unparseable existing config
  // throws (fails closed) rather than clobbering a user's real project state.
  const obj = raw === null ? { schemaVersion: 1, system: 'jeff', active: true } : JSON.parse(raw);
  if (!isType(obj, 'object')) {
    return { code: 1, stdout: [], stderr: [`cook: config.json must be an object: ${configPath}`] };
  }
  obj.active = true;

  await writeFileAtomic(configPath, `${JSON.stringify(obj, null, 2)}\n`);

  return {
    code: 0,
    stdout: [`cook: jeff activated in ${root} (scaffold + marked active).`],
    stderr: [],
  };
}

/**
 * Activate lite mode and exclude Jeff bookkeeping through Git's local exclude.
 *
 * @param {string} root
 * @returns {Promise<Verdict>}
 */
export async function liteProject(root) {
  if (!isGitRoot(root)) {
    return { code: 1, stdout: [], stderr: [`cook: not a git repository: ${root} (cook lite needs git to exclude .jeff/ locally)`] };
  }

  let exclude;
  try {
    exclude = await resolveGitExclude(root);
  } catch (error) {
    return { code: 1, stdout: [], stderr: [`cook: ${/** @type {Error} */ (error).message}`] };
  }

  const bk = join(root, '.jeff');
  const tasksDir = join(bk, 'tasks');
  const memoryDir = join(bk, 'memory');
  const configPath = join(bk, 'config.json');
  try {
    await assertStoreContained(root, [tasksDir, memoryDir, configPath]);
  } catch (error) {
    return { code: 1, stdout: [], stderr: [`cook: ${/** @type {Error} */ (error).message}`] };
  }
  await mkdir(tasksDir, { recursive: true });
  await mkdir(memoryDir, { recursive: true });
  await writeFile(join(tasksDir, '.gitkeep'), '', { flag: 'wx', encoding: 'utf8' })
    .catch((/** @type {any} */ error) => { if (error.code !== 'EEXIST') throw error; });

  let config;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (/** @type {any} */ (error).code === 'ENOENT') {
      config = { schemaVersion: 1, system: 'jeff' };
    } else {
      return { code: 1, stdout: [], stderr: [`cook: invalid config.json: ${configPath}`] };
    }
  }
  if (!isType(config, 'object')) {
    return { code: 1, stdout: [], stderr: [`cook: config.json must be an object: ${configPath}`] };
  }
  config.schemaVersion ??= 1;
  config.mode = 'lite';
  config.active = true;
  await writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`);

  await mkdir(dirname(exclude), { recursive: true });
  let excluded = false;
  try {
    excluded = (await readFile(exclude, 'utf8')).split(/\r?\n/).includes('.jeff/');
  } catch (error) {
    if (/** @type {any} */ (error).code !== 'ENOENT') throw error;
  }
  if (!excluded) await appendFile(exclude, '.jeff/\n', 'utf8');

  return {
    code: 0,
    stdout: [`cook: lite mode active in ${root}: quality pipeline on, registry off (.jeff/ git-excluded locally).`],
    stderr: [],
  };
}

/**
 * Mark Jeff inactive while preserving all task history.
 *
 * @param {string} root
 * @returns {Promise<Verdict>}
 */
export async function deinitProject(root) {
  const configPath = join(root, '.jeff', 'config.json');
  try {
    await assertStoreContained(root, [configPath]);
  } catch (error) {
    return { code: 1, stdout: [], stderr: [`cook: ${/** @type {Error} */ (error).message}`] };
  }
  const stdout = [];
  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    if (!isType(config, 'object')) {
      return { code: 1, stdout: [], stderr: [`cook: config.json must be an object: ${configPath}`] };
    }
    config.active = false;
    await writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`);
    stdout.push('cook: marked inactive (active=false); .jeff/ task state preserved.');
  } catch (error) {
    if (/** @type {any} */ (error).code !== 'ENOENT') {
      return { code: 1, stdout: [], stderr: [`cook: invalid config.json: ${configPath}`] };
    }
  }
  stdout.push('cook: jeff is inactive here. Run `cook init` to re-activate; remove .jeff/ manually to delete history.');
  return { code: 0, stdout, stderr: [] };
}

/**
 * Print and validate the active operating profile.
 *
 * @param {string} root
 * @returns {Promise<Verdict>}
 */
export async function profileReport(root) {
  const profilePath = join(root, '.jeff', 'profile.md');
  try {
    await assertStoreContained(root, [profilePath]);
  } catch (error) {
    return { code: 1, stdout: [], stderr: [`cook: ${/** @type {Error} */ (error).message}`] };
  }
  let text;
  try {
    text = await readFile(profilePath, 'utf8');
  } catch (error) {
    if (/** @type {any} */ (error).code === 'ENOENT') {
      return { code: 1, stdout: [], stderr: ['cook: no profile found: .jeff/profile.md does not exist (run `cook profile init` to create one)'] };
    }
    throw error;
  }
  const message = checkProfile(text);
  const stdout = text.replace(/\n$/, '').split('\n');
  return message === null
    ? { code: 0, stdout, stderr: [] }
    : { code: 1, stdout, stderr: [message] };
}

/**
 * Write the bounded default operating profile without clobbering an existing one.
 *
 * @param {string} root
 * @returns {Promise<Verdict>}
 */
export async function profileInit(root) {
  const bk = join(root, '.jeff');
  const profilePath = join(bk, 'profile.md');
  try {
    await assertStoreContained(root, [profilePath]);
  } catch (error) {
    return { code: 1, stdout: [], stderr: [`cook: ${/** @type {Error} */ (error).message}`] };
  }
  await mkdir(bk, { recursive: true });
  try {
    await writeFile(profilePath, PROFILE_TEMPLATE, { flag: 'wx', encoding: 'utf8' });
  } catch (error) {
    if (/** @type {any} */ (error).code === 'EEXIST') {
      return { code: 1, stdout: [], stderr: [`cook: profile already exists: ${profilePath} (no-clobber; remove it manually to reinitialise)`] };
    }
    throw error;
  }
  return { code: 0, stdout: ['cook: wrote default profile to .jeff/profile.md'], stderr: [] };
}
