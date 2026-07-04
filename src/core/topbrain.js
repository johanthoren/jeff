// @ts-check

/**
 * The impure wrapper for the top-brain knob (keeps `brains.js` pure). Resolves
 * the effective `JEFF_TOP_BRAIN` setting (spec §5) with the `flavor` precedence
 * (`cmd_flavor`: per-repo config > env > default) and surfaces it as a `cook`
 * verb. Item 7's dispatch reuses `readTopBrain`; nothing else here is for item 7.
 */

import { readConfig } from './store.js';

/**
 * The effective top-brain token: `'fable'` iff the resolved setting is the literal
 * `fable`, else `'default'`. Precedence: `.jeff/config.json` `"topBrain"` (when the
 * key is present) > env `JEFF_TOP_BRAIN` > unset. Only `fable` is honored (any other
 * value is the deferred arbitrary override, §9). Degrades to the env (never
 * hard-fails) on a missing or unparseable config, mirroring `readMode`.
 *
 * @param {string} root
 * @returns {Promise<'fable' | 'default'>}
 */
export async function readTopBrain(root) {
  /** @type {unknown} */
  let effective = process.env.JEFF_TOP_BRAIN;
  const cfg = await readConfig(root);
  if (cfg && 'topBrain' in cfg) {
    // Config present with the key → config wins outright; env not consulted.
    effective = cfg.topBrain;
  }
  // Missing/unparseable config (readConfig → null) → keep the env value
  // (degrade, never hard-fail).
  return effective === 'fable' ? 'fable' : 'default';
}

/**
 * `cook topbrain`: print the effective token, exit 0 (never hard-fails).
 *
 * @param {string} root
 * @returns {Promise<{ code: number, stdout: string[], stderr: string[] }>}
 */
export async function topbrainReport(root) {
  return { code: 0, stdout: [await readTopBrain(root)], stderr: [] };
}
