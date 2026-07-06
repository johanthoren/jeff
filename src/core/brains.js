// @ts-check

/**
 * The brain table + resolver (spec §5 / §5.1 / §5.2). PURE, sync, zero-I/O: the
 * caller resolves `topBrain` (env/config, via `topbrain.js`) and `availableModels`
 * and passes them in `opts`, so the core is deterministic and trivially testable.
 *
 * Two tables + a tier indirection:
 *   - `STAGE_TIER`: stage → { tier, effort }. `tier → effort` is the durable,
 *     provider-agnostic invariant — effort comes from the stage/tier, NEVER the
 *     provider column (spec §5.1). Covers the 6 dispatched stages only; `capture`
 *     is Jeff-run (no agent file, never dispatched) → out of domain, throws.
 *   - `PROVIDER_COLUMNS`: provider → { tier → model }. `anthropic` concrete (the
 *     current jeff values reused verbatim); `openai` a §9/bench placeholder left
 *     unpinned so it resolves via the same fallback path as any untuned provider.
 *   - `MODEL_LADDER`: provider → [most…least capable], for the availability walk.
 */

/**
 * @typedef {Object} Brain
 * @property {string} provider
 * @property {string | undefined} model
 * @property {string} effort
 */

/** @type {Record<string, { tier: string, effort: string }>} */
const STAGE_TIER = {
  plan: { tier: 'judge', effort: 'xhigh' },
  test: { tier: 'encode', effort: 'medium' },
  implement: { tier: 'build', effort: 'high' },
  // judge caliber, but its OWN non-judge tier so topBrain=fable never elevates refactor (the fable branch keys on tier==='judge')
  refactor: { tier: 'tidy', effort: 'xhigh' },
  review: { tier: 'judge', effort: 'xhigh' },
  audit: { tier: 'judge', effort: 'xhigh' },
  refute: { tier: 'judge', effort: 'xhigh' },
};

/** @type {Record<string, Record<string, string>>} */
const PROVIDER_COLUMNS = {
  anthropic: { judge: 'opus', build: 'opus', tidy: 'opus', encode: 'sonnet' },
  // openai: §9/bench placeholder — intentionally unpinned (do NOT pin gpt-5.*);
  // resolves to opts.sessionModel like any untuned provider until a column lands.
  openai: {},
};

/** @type {Record<string, string[]>} — most → least capable, for the availability walk. */
const MODEL_LADDER = {
  // `fable` is reachable only via topBrain, but belongs here so the fable→opus
  // degrade falls out of the same downward walk.
  anthropic: ['fable', 'opus', 'sonnet'],
};

/**
 * The nearest available model scanning DOWN the provider ladder from `model`'s
 * position (never a silent UP-grade — that would be a cost surprise), else the
 * terminal floor `sessionModel`. A dispatch never hard-fails on availability.
 *
 * @param {string} provider
 * @param {string | undefined} model
 * @param {Set<string>} avail
 * @param {string | undefined} sessionModel
 * @returns {string | undefined}
 */
function degradeDown(provider, model, avail, sessionModel) {
  const ladder = MODEL_LADDER[provider];
  if (ladder && model !== undefined) {
    const start = ladder.indexOf(model);
    if (start !== -1) {
      for (let i = start + 1; i < ladder.length; i++) {
        if (avail.has(ladder[i])) return ladder[i];
      }
    }
  }
  return sessionModel;
}

/**
 * Resolve `(sessionProvider, stage)` → `{ provider, model, effort }` (spec §5.1).
 * `provider` is always `sessionProvider` (jeff never reaches across providers, §9).
 *
 * @param {string} sessionProvider
 * @param {string} stage
 * @param {{ topBrain?: string, sessionModel?: string, availableModels?: Iterable<string> }} [opts]
 * @returns {Brain}
 */
export function resolveBrain(sessionProvider, stage, opts = {}) {
  const base = STAGE_TIER[stage];
  if (base === undefined) {
    // Fail-closed: an unknown/undispatched stage (incl. `capture`) is not resolvable.
    throw new Error(`resolveBrain: unknown stage '${stage}'`);
  }
  const { tier } = base;
  let { effort } = base;
  let model;

  if (opts.topBrain === 'fable' && tier === 'judge') {
    // The one narrow opt-in (spec §5): elevate the judge tier to fable · xhigh.
    // Any other topBrain value is silently ignored (the deferred arbitrary
    // override, §9) — no elevation, not an error.
    model = 'fable';
    effort = 'xhigh';
  } else {
    model = PROVIDER_COLUMNS[sessionProvider]?.[tier] ?? opts.sessionModel;
  }

  if (opts.availableModels !== undefined) {
    // `new Set` copy-constructs fine from an existing Set, so no instanceof branch.
    const avail = new Set(opts.availableModels);
    if (model === undefined || !avail.has(model)) {
      // Effort is NEVER changed by the availability step (spec §5.1: effort never
      // silently flattens); only the model degrades.
      model = degradeDown(sessionProvider, model, avail, opts.sessionModel);
    }
  }

  return { provider: sessionProvider, model, effort };
}
