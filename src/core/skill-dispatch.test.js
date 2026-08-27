// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDispatchSkills } from './skill-dispatch.js';

const CODE_STANDARDS = '/pkg/skills/code-standards/SKILL.md';
const TESTING = '/pkg/skills/testing/SKILL.md';
const HOST_RUST = '/host/skills/rust/SKILL.md';
const REPO_RUST = '/repo/.agents/skills/rust/SKILL.md';
const INSTALLED_RUST = '/plugins/other/skills/rust/SKILL.md';
const JEFF_RUST = '/pkg/skills/rust/SKILL.md';
const REPO_SWIFT = '/repo/skills/swift/SKILL.md';
const INSTALLED_CLOJURE = '/plugins/clojure/skills/clojure/SKILL.md';
const BROKEN_CLAIMED = '/missing/skills/code-standards/SKILL.md';

/** @param {string[]} paths */
function existsOnly(paths) {
  const allowed = new Set(paths);
  return (/** @type {string} */ path) => allowed.has(path);
}

function mandatoryFloor() {
  return [
    { name: 'code-standards', path: CODE_STANDARDS },
    { name: 'testing', path: TESTING },
  ];
}

test('#285 resolveDispatchSkills claims Jeff-bundled mandatory skill paths that resolve', () => {
  const result = resolveDispatchSkills({
    mandatory: mandatoryFloor(),
    languageName: null,
    sources: { host: [], repo: [], installed: [] },
    exists: existsOnly([CODE_STANDARDS, TESTING]),
  });

  assert.equal(result.failClosed, false);
  assert.deepEqual(result.missingClaimed, []);
  assert.equal(result.languagePath, null);
  assert.ok(result.claimed.includes(CODE_STANDARDS));
  assert.ok(result.claimed.includes(TESTING));
});

test('#285 resolveDispatchSkills claims the host-provided matching language skill path', () => {
  const result = resolveDispatchSkills({
    mandatory: mandatoryFloor(),
    languageName: 'rust',
    sources: {
      host: [{ name: 'rust', path: HOST_RUST }],
      repo: [{ name: 'rust', path: REPO_RUST }],
      installed: [{ name: 'rust', path: INSTALLED_RUST }],
    },
    exists: existsOnly([
      CODE_STANDARDS,
      TESTING,
      HOST_RUST,
      REPO_RUST,
      INSTALLED_RUST,
      JEFF_RUST,
    ]),
  });

  assert.equal(result.failClosed, false);
  assert.equal(result.languagePath, HOST_RUST);
  assert.ok(result.claimed.includes(CODE_STANDARDS));
  assert.ok(result.claimed.includes(TESTING));
  assert.ok(result.claimed.includes(HOST_RUST));
  assert.equal(result.claimed.includes(REPO_RUST), false);
  assert.equal(result.claimed.includes(INSTALLED_RUST), false);
  assert.equal(result.claimed.includes(JEFF_RUST), false);
});

test('#285 resolveDispatchSkills stays valid when no matching language skill exists', () => {
  const result = resolveDispatchSkills({
    mandatory: mandatoryFloor(),
    languageName: 'rust',
    sources: { host: [], repo: [], installed: [] },
    exists: existsOnly([CODE_STANDARDS, TESTING, JEFF_RUST]),
  });

  assert.equal(result.failClosed, false);
  assert.equal(result.languagePath, null);
  assert.deepEqual(result.missingClaimed, []);
  assert.ok(result.claimed.includes(CODE_STANDARDS));
  assert.ok(result.claimed.includes(TESTING));
  assert.equal(result.claimed.includes(JEFF_RUST), false);
});

test('#285 resolveDispatchSkills fails closed when a brief claims a required path that does not resolve', () => {
  const result = resolveDispatchSkills({
    mandatory: [
      { name: 'code-standards', path: BROKEN_CLAIMED },
      { name: 'testing', path: TESTING },
    ],
    languageName: null,
    sources: { host: [], repo: [], installed: [] },
    exists: existsOnly([TESTING]),
  });

  assert.equal(result.failClosed, true);
  assert.ok(result.missingClaimed.includes(BROKEN_CLAIMED));
  assert.equal(result.missingClaimed.includes(TESTING), false);
});

test('#285 resolveDispatchSkills uses repository then installed package when host has no match', () => {
  const fromRepo = resolveDispatchSkills({
    mandatory: mandatoryFloor(),
    languageName: 'swift',
    sources: {
      host: [],
      repo: [{ name: 'swift', path: REPO_SWIFT }],
      installed: [{ name: 'swift', path: '/plugins/other/skills/swift/SKILL.md' }],
    },
    exists: existsOnly([
      CODE_STANDARDS,
      TESTING,
      REPO_SWIFT,
      '/plugins/other/skills/swift/SKILL.md',
    ]),
  });
  assert.equal(fromRepo.failClosed, false);
  assert.equal(fromRepo.languagePath, REPO_SWIFT);
  assert.ok(fromRepo.claimed.includes(REPO_SWIFT));

  const fromInstalled = resolveDispatchSkills({
    mandatory: mandatoryFloor(),
    languageName: 'clojure',
    sources: {
      host: [],
      repo: [],
      installed: [{ name: 'clojure', path: INSTALLED_CLOJURE }],
    },
    exists: existsOnly([CODE_STANDARDS, TESTING, INSTALLED_CLOJURE]),
  });
  assert.equal(fromInstalled.failClosed, false);
  assert.equal(fromInstalled.languagePath, INSTALLED_CLOJURE);
  assert.ok(fromInstalled.claimed.includes(INSTALLED_CLOJURE));
});
