// @ts-check

import { appendFile, readFile } from 'node:fs/promises';
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
  if (!Number.isInteger(event.seq) || event.seq < 0 || !isIsoDateTime(event.at)) return false;

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

/**
 * Read valid journal events while retaining malformed bytes on disk.
 *
 * @param {string} root
 * @param {string} taskDir
 * @param {(message: string) => void} [warn]
 */
export async function readJournal(root, taskDir, warn = console.warn) {
  const path = join(taskDir, 'journal.jsonl');
  await assertStoreContained(root, [path]);
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (/** @type {any} */ (error).code === 'ENOENT') return { raw: '', events: [] };
    throw error;
  }

  const events = [];
  for (const [index, line] of raw.split('\n').entries()) {
    if (line === '') continue;
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
 * Append one event while the caller holds the shared store lock.
 *
 * @param {string} root
 * @param {string} taskDir
 * @param {JournalAppend} value
 * @param {(message: string) => void} [warn]
 */
export async function appendJournalEvent(root, taskDir, value, warn = console.warn) {
  const { raw, events } = await readJournal(root, taskDir, warn);
  const seq = events.reduce((greatest, event) => Math.max(greatest, event.seq), -1) + 1;
  const event = { seq, at: new Date().toISOString(), ...value };
  if (!isJournalEvent(event)) throw new Error('[journal] invalid event');

  const path = join(taskDir, 'journal.jsonl');
  const separator = raw.length > 0 && !raw.endsWith('\n') ? '\n' : '';
  await appendFile(path, `${separator}${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
  return event;
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
