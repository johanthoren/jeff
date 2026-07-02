// @ts-check

/**
 * Hand-rolled field-validation predicates: the 1:1 port target of what
 * `cook.sh` does in jq today. Pure functions, no I/O. These are the primitives
 * the validator port (spec item 2) composes into invariant checks.
 */

/**
 * Presence check: a value is present unless it is `null` or `undefined`.
 *
 * Deliberately *not* truthiness: `0`, `''`, and `false` are present values.
 * This matches jq's `!= null` semantics for a required field.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPresent(value) {
  return value !== null && value !== undefined;
}

/**
 * Type check by name. Understands `'array'` as a distinct type (unlike
 * `typeof`, which reports `'object'` for arrays) and treats `null` as *not* an
 * object.
 *
 * @param {unknown} value
 * @param {'string' | 'number' | 'boolean' | 'object' | 'array'} type
 * @returns {boolean}
 */
export function isType(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  return typeof value === type;
}

/**
 * Enum check: is `value` one of the `allowed` members?
 *
 * @param {unknown} value
 * @param {ReadonlyArray<unknown>} allowed
 * @returns {boolean}
 */
export function isOneOf(value, allowed) {
  return allowed.includes(value);
}
