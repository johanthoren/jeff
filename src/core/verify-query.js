// @ts-check

import { git as runGit } from './git.js';

const QUERY_KINDS = ['git-head', 'git-status', 'git-ref', 'git-tree', 'git-object', 'https-get'];
const GIT_PREFIX = [
  '--no-optional-locks',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.untrackedCache=false',
];
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' };

/** @param {string} message @returns {never} */
function invalid(message) {
  throw new Error(`[verify-query] ${message}`);
}

/** @param {Record<string, unknown>} query @param {string[]} fields */
function requireFields(query, fields) {
  const keys = Object.keys(query);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    invalid('query fields are invalid');
  }
}

/** @param {unknown} value @returns {string} */
function gitTarget(value) {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('-') || /[\0\r\n]/u.test(value)) {
    invalid('Git target is invalid');
  }
  return value;
}

/** @param {string[]} verificationSeams @param {string} canonical */
function requireNamedSeam(verificationSeams, canonical) {
  if (!verificationSeams.includes(canonical)) invalid('query is not named by the operation plan verification seam');
}

/** @param {string} root @param {string[]} args @param {(root: string, args: string[], options: { env: Record<string, string> }) => any} git */
function queryGit(root, args, git) {
  const fullArgs = [...GIT_PREFIX, ...args];
  const result = git(root, fullArgs, { env: GIT_ENV });
  return {
    command: `git ${fullArgs.join(' ')}`,
    output: JSON.stringify({
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }),
  };
}

/**
 * Run one plan-named, fixed read-only verification query.
 *
 * @param {string} root
 * @param {unknown} value
 * @param {{
 *   verificationSeams?: string[],
 *   git?: (root: string, args: string[], options: { env: Record<string, string> }) => any,
 *   fetch?: (url: string, options: { method: 'GET', redirect: 'error' }) => Promise<{ status: number, url: string, text: () => Promise<string> }>,
 * }} [dependencies]
 * @returns {Promise<{ command: string, output: string }>}
 */
export async function queryVerificationState(root, value, dependencies = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('query is invalid');
  const query = /** @type {Record<string, unknown>} */ (value);
  if (typeof query.kind !== 'string' || !QUERY_KINDS.includes(query.kind)) invalid('query kind is invalid');
  const verificationSeams = Array.isArray(dependencies.verificationSeams)
    && dependencies.verificationSeams.every((seam) => typeof seam === 'string')
    ? dependencies.verificationSeams
    : [];
  const git = dependencies.git ?? runGit;

  if (query.kind === 'git-head') {
    requireFields(query, ['kind']);
    requireNamedSeam(verificationSeams, 'git-head');
    return queryGit(root, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{object}'], git);
  }
  if (query.kind === 'git-status') {
    requireFields(query, ['kind']);
    requireNamedSeam(verificationSeams, 'git-status');
    return queryGit(root, ['status', '--porcelain=v1', '--untracked-files=all', '--'], git);
  }
  if (query.kind === 'git-ref') {
    requireFields(query, ['kind', 'target']);
    const target = gitTarget(query.target);
    requireNamedSeam(verificationSeams, `git-ref ${target}`);
    return queryGit(root, ['rev-parse', '--verify', '--end-of-options', `${target}^{object}`], git);
  }
  if (query.kind === 'git-tree') {
    requireFields(query, ['kind', 'target']);
    const target = gitTarget(query.target);
    requireNamedSeam(verificationSeams, `git-tree ${target}`);
    return queryGit(root, ['ls-tree', '-r', '--full-tree', '--end-of-options', target], git);
  }
  if (query.kind === 'git-object') {
    requireFields(query, ['kind', 'target']);
    const target = gitTarget(query.target);
    requireNamedSeam(verificationSeams, `git-object ${target}`);
    return queryGit(root, ['cat-file', '-p', '--end-of-options', target], git);
  }

  requireFields(query, ['kind', 'url']);
  if (typeof query.url !== 'string') invalid('HTTPS URL is invalid');
  let url;
  try {
    url = new URL(query.url);
  } catch {
    invalid('HTTPS URL is invalid');
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') invalid('HTTPS URL is invalid');
  requireNamedSeam(verificationSeams, `https-get ${query.url}`);
  const fetch = dependencies.fetch ?? globalThis.fetch;
  if (typeof fetch !== 'function') invalid('HTTPS query support is unavailable');
  const response = await fetch(query.url, { method: 'GET', redirect: 'error' });
  return {
    command: `GET ${query.url}`,
    output: JSON.stringify({ status: response.status, url: response.url, body: await response.text() }),
  };
}
