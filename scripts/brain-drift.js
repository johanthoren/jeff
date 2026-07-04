#!/usr/bin/env node
// @ts-check

/**
 * Frontmatter drift check (spec §5.2, the ponytail `check-rule-copies.js` analog):
 * for each of the 6 dispatched stages, assert `agents/cook-<stage>.md`'s
 * frontmatter `model` + `effort` still equals the anthropic column, using
 * `resolveBrain('anthropic', stage)` as the single source of truth. Exits
 * non-zero naming any drifted stage(s), else 0. No generator: 6 files × 2 fields
 * does not earn codegen.
 *
 * The agents dir is `argv[2]` (default `<repo>/agents`) — the testability seam: a
 * test points it at a temp drifted copy, never mutating the real files.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBrain } from '../src/core/brains.js';

const STAGES = ['plan', 'test', 'implement', 'refactor', 'review', 'audit'];
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Extract `model:`/`effort:` from a cook-*.md YAML frontmatter block (between the
 * first `---` fences), same vocabulary as the frontmatter (`medium`, not `med`).
 *
 * @param {string} raw
 * @returns {{ model: string | undefined, effort: string | undefined }}
 */
function parseFrontmatter(raw) {
  const fence = raw.match(/^---\n([\s\S]*?)\n---/);
  const fm = fence ? fence[1] : raw;
  return {
    model: fm.match(/^model:\s*(\S+)\s*$/m)?.[1],
    effort: fm.match(/^effort:\s*(\S+)\s*$/m)?.[1],
  };
}

async function main() {
  const agentsDir = process.argv[2] || join(REPO_ROOT, 'agents');
  let drifted = 0;
  for (const stage of STAGES) {
    const expected = resolveBrain('anthropic', stage);
    const actual = parseFrontmatter(await readFile(join(agentsDir, `cook-${stage}.md`), 'utf8'));
    if (actual.model !== expected.model || actual.effort !== expected.effort) {
      drifted++;
      process.stderr.write(
        `brain-drift: ${stage}: frontmatter drifted from the table — ` +
          `expected model=${expected.model} effort=${expected.effort}, ` +
          `got model=${actual.model} effort=${actual.effort}\n`,
      );
    }
  }
  process.exit(drifted > 0 ? 1 : 0);
}

main();
