// @ts-check

/**
 * The impure wrapper for the `flavor` knob (kitchen vs plain persona output).
 * Resolves the effective `JEFF_FLAVOR` setting with the `cmd_flavor` precedence
 * (per-repo config > env > default `kitchen`) and surfaces it as a `cook` verb :
 * the structural twin of `topbrain.js`, mirroring the oracle `cook.sh cmd_flavor`.
 */

import { readConfig } from './store.js';

/**
 * The effective flavor token: `'kitchen'` iff the resolved value collapses to a
 * kitchen arm (boolean `true`, string `'true'`, or `'kitchen'`), else `'plain'`.
 * Precedence: `.jeff/config.json` `"flavor"` (when present and neither JSON `null`
 * nor the empty string : a real `false` DOES override) > env `JEFF_FLAVOR` >
 * default `kitchen`. Empty or unset env → `kitchen` (mirrors `${JEFF_FLAVOR:-kitchen}`).
 * Degrades to the env value (never hard-fails) on a missing or unparseable config.
 *
 * @param {string} root
 * @returns {Promise<'kitchen' | 'plain'>}
 */
export async function readFlavor(root) {
  /** @type {unknown} */
  let raw = process.env.JEFF_FLAVOR || 'kitchen';
  const cfg = await readConfig(root);
  // Config wins unless it is absent, JSON null, or empty string (oracle's
  // null-only jq guard + `[ -n "$raw" ]` emptiness check → fall through to env).
  // (A missing/unparseable config also lands here as `cfg === null`, which
  // fails the truthy check the same way : degrade, never hard-fail.)
  if (cfg && cfg.flavor != null && cfg.flavor !== '') {
    raw = cfg.flavor;
  }
  return raw === true || raw === 'true' || raw === 'kitchen' ? 'kitchen' : 'plain';
}

/**
 * `cook flavor`: print the effective token, exit 0 (never hard-fails).
 *
 * @param {string} root
 * @returns {Promise<{ code: number, stdout: string[], stderr: string[] }>}
 */
export async function flavorReport(root) {
  return { code: 0, stdout: [await readFlavor(root)], stderr: [] };
}
