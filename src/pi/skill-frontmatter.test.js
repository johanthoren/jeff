// @ts-check

import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKILL_FILES = ['../../skills/cook/SKILL.md'];

/**
 * @param {string} text
 * @returns {string[]}
 */
function frontmatterLines(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  return match ? match[1].split('\n') : [];
}

test('skill frontmatter descriptions with colon-space are quoted or block scalars', async () => {
  for (const relative of SKILL_FILES) {
    const file = new URL(relative, import.meta.url);
    const text = await readFile(file, 'utf8');
    const description = frontmatterLines(text).find((line) => line.startsWith('description:'));

    assert.ok(description, `${relative} has a description`);
    const value = description.slice('description:'.length).trimStart();
    const quotedOrBlock = value.startsWith('"') || value.startsWith("'") || value.startsWith('|') || value.startsWith('>');

    assert.equal(
      quotedOrBlock || !value.includes(': '),
      true,
      `${relative} description must quote colon-space values for YAML parsers`,
    );
  }
});
