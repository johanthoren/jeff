// @ts-check

import { appendFile, lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectTasks, assertStoreContained } from './store.js';
import { locateTask, withStoreLock } from './store-lock.js';
import { isIsoDateTime } from './task-schema.js';
import { isType } from './validate.js';

export const JOURNAL_INTENT_STAGES = [
  'plan',
  'implement',
  'refactor',
  'execute',
  'review',
  'verify',
  'audit',
  'refute',
  'council',
  'external',
];

const RECORD_STAGES = JOURNAL_INTENT_STAGES.filter((stage) => stage !== 'external');

/**
 * @typedef {
 *   | {event: 'intent', stage: string, note?: string}
 *   | {event: 'record', stage: string, agent: string}
 *   | {event: 'gate', hash: string, green: boolean, clean: boolean}
 *   | {event: 'external', note?: string}
 * } JournalAppend
 */

/** @param {unknown} value */
export function isJournalIntentStage(value) {
  return typeof value === 'string' && JOURNAL_INTENT_STAGES.includes(value);
}

/** @param {Record<string, any>} value @param {string[]} fields */
function hasExactFields(value, fields) {
  const keys = Object.keys(value).sort();
  return keys.length === fields.length && keys.every((key, index) => key === fields[index]);
}

/** @param {unknown} value */
export function isJournalEvent(value) {
  if (!isType(value, 'object')) return false;
  const event = /** @type {Record<string, any>} */ (value);
  if (!Number.isSafeInteger(event.seq) || event.seq < 0 || !isIsoDateTime(event.at)) return false;

  const optionalNote = !Object.hasOwn(event, 'note') || typeof event.note === 'string';
  if (event.event === 'intent') {
    const fields = Object.hasOwn(event, 'note')
      ? ['at', 'event', 'note', 'seq', 'stage']
      : ['at', 'event', 'seq', 'stage'];
    return hasExactFields(event, fields) && isJournalIntentStage(event.stage) && optionalNote;
  }
  if (event.event === 'record') {
    return hasExactFields(event, ['agent', 'at', 'event', 'seq', 'stage'])
      && RECORD_STAGES.includes(event.stage)
      && typeof event.agent === 'string'
      && event.agent.length > 0;
  }
  if (event.event === 'gate') {
    return hasExactFields(event, ['at', 'clean', 'event', 'green', 'hash', 'seq'])
      && typeof event.hash === 'string'
      && event.hash.length > 0
      && typeof event.green === 'boolean'
      && typeof event.clean === 'boolean';
  }
  if (event.event === 'external') {
    const fields = Object.hasOwn(event, 'note')
      ? ['at', 'event', 'note', 'seq']
      : ['at', 'event', 'seq'];
    return hasExactFields(event, fields) && optionalNote;
  }
  return false;
}

/** @param {string} action @param {unknown} error */
function journalFailure(action, error) {
  const cause = error instanceof Error ? error.message : String(error);
  return new Error(`[journal] ${action}: ${cause}`);
}

/** @param {string} root @param {string} path */
async function journalExists(root, path) {
  try {
    await assertStoreContained(root, [path]);
  } catch (error) {
    throw journalFailure('boundary check failed', error);
  }

  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (/** @type {any} */ (error).code === 'ENOENT') return false;
    throw journalFailure('boundary check failed', error);
  }
  if (!stats.isFile() || stats.nlink !== 1) {
    throw new Error('[journal] target must be a regular file with exactly one hard link');
  }
  return true;
}

/**
 * Read valid journal events while retaining malformed bytes on disk.
 *
 * @param {string} root
 * @param {string} taskDir
 * @param {(message: string) => void} [warn]
 */
export async function readJournal(root, taskDir, warn = console.warn) {
  const path = join(taskDir, 'journal.jsonl');
  if (!(await journalExists(root, path))) return { raw: '', events: [] };

  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    throw journalFailure('read failed', error);
  }

  const events = [];
  const lines = raw.split('\n');
  for (const [index, line] of lines.entries()) {
    if (line === '' && (raw === '' || index === lines.length - 1)) continue;
    try {
      const event = JSON.parse(line);
      if (!isJournalEvent(event)) throw new Error('invalid journal event');
      events.push(event);
    } catch {
      warn(`cook: journal: malformed line ${index + 1}; skipped`);
    }
  }
  return { raw, events };
}

/**
 * Append events after one read while the caller holds the shared store lock.
 *
 * @param {string} root
 * @param {string} taskDir
 * @param {JournalAppend[]} values
 * @param {(message: string) => void} [warn]
 */
export async function appendJournalEvents(root, taskDir, values, warn = console.warn) {
  const { raw, events } = await readJournal(root, taskDir, warn);
  let seq = events.reduce((greatest, event) => Math.max(greatest, event.seq), -1) + 1;
  const appended = values.map((value) => {
    const event = { seq, at: new Date().toISOString(), ...value };
    if (!isJournalEvent(event)) throw new Error('[journal] invalid event');
    seq += 1;
    return event;
  });
  if (appended.length === 0) return appended;

  const path = join(taskDir, 'journal.jsonl');
  await journalExists(root, path);
  const separator = raw.length > 0 && !raw.endsWith('\n') ? '\n' : '';
  const payload = `${separator}${appended.map((event) => JSON.stringify(event)).join('\n')}\n`;
  try {
    await appendFile(path, payload, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    throw journalFailure('append failed', error);
  }
  return appended;
}

/**
 * Append one event while the caller holds the shared store lock.
 *
 * @param {string} root
 * @param {string} taskDir
 * @param {JournalAppend} value
 * @param {(message: string) => void} [warn]
 */
export async function appendJournalEvent(root, taskDir, value, warn = console.warn) {
  return (await appendJournalEvents(root, taskDir, [value], warn))[0];
}

/**
 * Append an operator-authored event to one contained task under the store lock.
 *
 * @param {string} root
 * @param {string} id
 * @param {JournalAppend} value
 */
export function appendTaskJournal(root, id, value) {
  return withStoreLock(root, async () => {
    const tasks = await collectTasks(root);
    const { taskDir } = await locateTask(root, id, tasks);
    return appendJournalEvent(root, taskDir, value);
  });
}
