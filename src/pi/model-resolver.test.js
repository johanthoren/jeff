// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePiModelId } from './model-resolver.js';

test('model alias resolution maps fable to claude-fable-5 when available', () => {
  const got = resolvePiModelId('fable', {
    provider: 'anthropic',
    sessionModelId: 'claude-sonnet-4-5',
    availableModelIds: ['claude-sonnet-4-5', 'claude-fable-5'],
  });

  assert.equal(got, 'claude-fable-5');
});

test('model alias resolution picks the newest matching family model', () => {
  const got = resolvePiModelId('opus', {
    provider: 'anthropic',
    sessionModelId: 'claude-sonnet-4-5',
    availableModelIds: ['claude-opus-4-1', 'claude-opus-4-5', 'claude-sonnet-4-5'],
  });

  assert.equal(got, 'claude-opus-4-5');
});

test('model alias resolution falls back to the current session model', () => {
  const got = resolvePiModelId('sonnet', {
    provider: 'anthropic',
    sessionModelId: 'claude-opus-4-5',
    availableModelIds: ['claude-opus-4-5'],
  });

  assert.equal(got, 'claude-opus-4-5');
});
