// @ts-check

/** @type {Record<string, string>} */
const FAMILY_PREFIX = {
  opus: 'claude-opus-',
  sonnet: 'claude-sonnet-',
};

/**
 * Resolve jeff's semantic model aliases to Pi's concrete model ids.
 *
 * @param {string | undefined} alias
 * @param {{ provider: string, sessionModelId?: string, availableModelIds?: Iterable<string> }} opts
 * @returns {string | undefined}
 */
export function resolvePiModelId(alias, opts) {
  const available = [...(opts.availableModelIds ?? [])];

  if (alias === 'fable' && available.includes('claude-fable-5')) {
    return 'claude-fable-5';
  }

  const prefix = alias ? FAMILY_PREFIX[alias] : undefined;
  if (prefix) {
    const match = available.filter((id) => id.startsWith(prefix)).sort().at(-1);
    if (match) return match;
  }

  if (alias && available.includes(alias)) return alias;
  return opts.sessionModelId;
}
