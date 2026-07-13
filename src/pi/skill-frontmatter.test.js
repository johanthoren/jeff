// @ts-check

import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SKILL_FILES = [
  '../../skills/code-standards/SKILL.md',
  '../../skills/cook/SKILL.md',
  '../../skills/security-auditor/SKILL.md',
  '../../skills/testing/SKILL.md',
];
const JUDGMENT_AGENT_FILES = ['../../agents/cook-review.md', '../../agents/cook-audit.md', '../../agents/cook-refute.md'];
const MAX_SKILL_DESCRIPTION_CHARS = 1024;

/**
 * @param {string} text
 * @returns {string[]}
 */
function frontmatterLines(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  return match ? match[1].split('\n') : [];
}

/**
 * @param {string[]} lines
 * @returns {string}
 */
function descriptionText(lines) {
  const index = lines.findIndex((line) => line.startsWith('description:'));
  assert.notEqual(index, -1, 'has a description');

  const value = lines[index].slice('description:'.length).trimStart();
  if (value.startsWith('>') || value.startsWith('|')) {
    const block = [];
    for (const line of lines.slice(index + 1)) {
      if (line && !line.startsWith(' ')) break;
      block.push(line.replace(/^  /, ''));
    }
    return block.join(value.startsWith('>') ? ' ' : '\n').trim();
  }
  return value.replace(/^['"]|['"]$/g, '');
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

test('skill frontmatter descriptions stay under Pi limit', async () => {
  for (const relative of SKILL_FILES) {
    const file = new URL(relative, import.meta.url);
    const text = await readFile(file, 'utf8');
    const description = descriptionText(frontmatterLines(text));

    assert.ok(
      description.length <= MAX_SKILL_DESCRIPTION_CHARS,
      `${relative} description is ${description.length} chars; max ${MAX_SKILL_DESCRIPTION_CHARS}`,
    );
  }
});

test('judgment agent frontmatter stays read-only', async () => {
  for (const relative of JUDGMENT_AGENT_FILES) {
    const file = new URL(relative, import.meta.url);
    const text = await readFile(file, 'utf8');
    const tools = frontmatterLines(text).find((line) => line.startsWith('tools:'));

    assert.equal(tools, 'tools: Read, Grep, Glob', `${relative} must stay read-only`);
  }
});

test('judgment role return examples expose the active cycle identity', async () => {
  for (const relative of JUDGMENT_AGENT_FILES) {
    const file = new URL(relative, import.meta.url);
    const text = await readFile(file, 'utf8');

    assert.match(text, /"cycle":0/, `${relative} must show cycle as a JSON number`);
  }
});
