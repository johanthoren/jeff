// @ts-check

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const COOK_JS = join(HERE, 'cook.js');

/** @param {string[]} args @param {Record<string, string | undefined>} [env] */
function runCook(args, env = {}) {
  return spawnSync(process.execPath, [COOK_JS, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

/** @param {string} path */
async function readRepo(path) {
  return readFile(join(REPO_ROOT, path), 'utf8');
}

/** @param {string} path */
async function filesUnder(path) {
  const entries = await readdir(join(REPO_ROOT, path), { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  }));
  return nested.flat();
}

/**
 * Ignore historical comments while rejecting executable or operational references.
 * @param {string} path
 * @param {string} text
 */
function liveLines(path, text) {
  return text.split('\n').filter((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
    if ((path.endsWith('.sh') || path === 'Makefile') && trimmed.startsWith('#')) return false;
    return true;
  });
}

test('help and no-argument routing share the successful Node CLI destination', () => {
  const noArguments = runCook([]);
  const help = runCook(['help']);
  const shortHelp = runCook(['-h']);
  const longHelp = runCook(['--help']);

  for (const result of [noArguments, help, shortHelp, longHelp]) {
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.match(result.stdout, /Subcommands:/);
  }
  assert.equal(noArguments.stdout, help.stdout);
  assert.equal(shortHelp.stdout, help.stdout);
  assert.equal(longHelp.stdout, help.stdout);
});

test('shipped operational surfaces route to Node with no live cook.sh reference', async () => {
  const surfaces = [
    ...(await filesUnder('skills')),
    ...(await filesUnder('hooks')),
    ...(await filesUnder('src')).filter((path) => path.endsWith('.js') && !path.endsWith('.test.js')),
    'Makefile',
    'package.json',
  ];

  for (const path of surfaces) {
    const live = liveLines(path, await readRepo(path)).join('\n');
    assert.doesNotMatch(live, /cook\.sh/, `${path} still routes through cook.sh`);
  }
  await assert.rejects(
    access(join(REPO_ROOT, 'skills', 'cook', 'scripts', 'cook.sh'), constants.F_OK),
    { code: 'ENOENT' },
  );
  assert.match(await readRepo('skills/cook/SKILL.md'), /src\/cli\/cook\.js/);
  assert.match(await readRepo('Makefile'), /src\/cli\/cook\.js/);
});

test('shipped runtime has no live jq requirement', async () => {
  const surfaces = [
    'hooks/cook-precommit-gate.sh',
    'src/cli/cook.js',
    'src/core/lifecycle.js',
    'src/pi/extension.js',
    'src/pi/role-session.js',
  ];

  for (const path of surfaces) {
    const live = liveLines(path, await readRepo(path)).join('\n');
    assert.doesNotMatch(live, /\bjq\b/, `${path} still requires jq`);
  }
});

test('doctor reports an active project when jq is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jeff-cutover-doctor-'));
  try {
    await mkdir(join(root, '.jeff'));
    await writeFile(join(root, '.jeff', 'config.json'), JSON.stringify({ mode: 'lite', active: true }), 'utf8');

    const result = runCook(['doctor'], { COOK_ROOT: root, PATH: '/nonexistent' });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /jeff: ACTIVE/);
    assert.doesNotMatch(result.stdout + result.stderr, /\bjq\b/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('published Pi package installs its dispatch SDK when the host does not inject pi.pi', async () => {
  const manifest = JSON.parse(await readRepo('package.json'));

  assert.equal(typeof manifest.dependencies?.['@earendil-works/pi-coding-agent'], 'string');
  assert.equal(manifest.peerDependencies?.['@earendil-works/pi-coding-agent'], undefined);
  assert.equal(manifest.peerDependenciesMeta?.['@earendil-works/pi-coding-agent'], undefined);
});
