// @ts-check

/** @param {string} message @returns {never} */
function invalid(message) {
  throw new Error(`[operation-apply] ${message}`);
}

/**
 * @param {unknown} value
 * @param {number} index
 * @returns {{program: string, args: string[]}}
 */
function normalizeAction(value, index) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`batch action ${index} is invalid`);
  }
  const action = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(action);
  if (keys.length !== 2 || !Object.hasOwn(action, 'program') || !Object.hasOwn(action, 'args')) {
    invalid(`batch action ${index} must contain only program and args`);
  }
  if (typeof action.program !== 'string' || action.program.length === 0 || action.program.includes('\0')) {
    invalid(`batch action ${index} program is invalid`);
  }
  if (!Array.isArray(action.args)
    || !action.args.every((arg) => typeof arg === 'string' && !arg.includes('\0'))) {
    invalid(`batch action ${index} args are invalid`);
  }
  return { program: action.program, args: [...action.args] };
}

/**
 * Normalize an operation batch before serializing it. Rebuilding every action
 * fixes property order as `program`, then `args`; array and argv order remain
 * unchanged.
 *
 * @param {unknown} value
 * @returns {{batch: Array<{program: string, args: string[]}>, canonical: string}}
 */
export function canonicalizeOperationBatch(value) {
  if (!Array.isArray(value) || value.length === 0) {
    invalid('batch must be a nonempty array');
  }
  const batch = value.map(normalizeAction);
  return { batch, canonical: JSON.stringify(batch) };
}

/**
 * @param {unknown} value
 * @returns {{batch: Array<{program: string, args: string[]}>, canonical: string}}
 */
export function parseCanonicalOperationBatch(value) {
  if (typeof value !== 'string' || value.length === 0) {
    invalid('approval boundary must be a nonempty canonical JSON batch');
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalid('approval boundary is not valid JSON');
  }
  const normalized = canonicalizeOperationBatch(parsed);
  if (normalized.canonical !== value) {
    invalid('approval boundary is not canonical JSON');
  }
  return normalized;
}
