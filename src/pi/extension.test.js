// @ts-check

import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jeffExtension, { formatDispatchResult } from './extension.js';

test('package.json exposes the Pi extension and cook skill package paths', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));

  assert.deepEqual(pkg.pi, {
    extensions: ['./src/pi/extension.js'],
    skills: ['./skills'],
  });
});

test('formatDispatchResult exposes agent id, brain, and transcript to the parent model', () => {
  const text = formatDispatchResult({
    agent_id: '0123456789abcdef',
    stage: 'review',
    brain: { provider: 'anthropic', model: 'claude-opus-4-5', effort: 'xhigh' },
    transcript: 'SMOKE OK',
  });

  assert.match(text, /0123456789abcdef/);
  assert.match(text, /claude-opus-4-5/);
  assert.match(text, /SMOKE OK/);
});

test('extension registers /jeff-status and cook_dispatch', () => {
  const commands = new Map();
  const tools = new Map();
  const pi = {
    /**
     * @param {string} name
     * @param {any} definition
     */
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    /** @param {any} definition */
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
  };

  jeffExtension(pi);

  assert.equal(commands.has('jeff-status'), true);
  assert.equal(commands.get('jeff-status').description, 'Report that the jeff Pi package is active');
  assert.equal(tools.has('cook_dispatch'), true);
  assert.deepEqual(tools.get('cook_dispatch').parameters.required, ['stage', 'brief']);
});
