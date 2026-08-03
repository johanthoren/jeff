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
// Issue 101 removed command capability from all four judgment stations and
// pinned the narrow grant here. Issue 173 reverses that for the two operation
// judgment stations only, and the reversal is deliberate rather than a repair:
// every verification seam an operation can name is a command (`git ls-remote`,
// `gh run view`, `npm view`), so a station that cannot run one cannot verify at
// all. Issue 170 is the observed instance. Issue 101 could not foresee it,
// because it introduced the operation category in the same task.
//
// The other half of issue 101 stands. No judgment station mutates, so none
// carries Edit or Write, and `cook-review` / `cook-refute` keep the narrow
// grant: both read a diff already present in the working tree, so neither was
// structurally broken the way the operation stations were.
//
// Exact equality is load-bearing in both directions: this fails if an operation
// station narrows again, and it fails if any judgment station gains Edit or
// Write.
const JUDGMENT_AGENT_GRANTS = {
  '../../agents/cook-review.md': 'tools: Read, Grep, Glob',
  '../../agents/cook-verify.md': 'tools: Read, Grep, Glob, Bash',
  '../../agents/cook-audit.md': 'tools: Read, Grep, Glob, Bash',
  '../../agents/cook-refute.md': 'tools: Read, Grep, Glob',
};
const JUDGMENT_AGENT_FILES = Object.keys(JUDGMENT_AGENT_GRANTS);
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

test('issue 173 reverses issue 101: operation judgment stations run commands, no judgment station edits or writes', async () => {
  for (const [relative, expected] of Object.entries(JUDGMENT_AGENT_GRANTS)) {
    const file = new URL(relative, import.meta.url);
    const text = await readFile(file, 'utf8');
    const tools = frontmatterLines(text).find((line) => line.startsWith('tools:'));

    assert.equal(tools, expected, `${relative} must grant exactly this`);
  }
});

test('judgment role return examples expose the active cycle identity', async () => {
  for (const relative of JUDGMENT_AGENT_FILES) {
    const file = new URL(relative, import.meta.url);
    const text = await readFile(file, 'utf8');

    assert.match(text, /"cycle":0/, `${relative} must show cycle as a JSON number`);
  }
});
