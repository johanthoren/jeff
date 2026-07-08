// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBrain } from './brains.js';

/**
 * Test design (.jeff/tasks/item4-brains/notes.md, "## Test design"):
 * DIRECT behavioral pins on the pure resolver (no cook.sh oracle exists for
 * brains : greenfield). Anthropic base `{model,effort}` verbatim is owned
 * by the drift check (AC2⊕AC6, src/cli/brain-drift.test.js), NOT restated
 * here as literal constants : these rows assert only the delta behaviors
 * (provider-agnostic effort, unknown-provider fallback, unknown-stage
 * throw, fable elevation + degrade, availability-fallback matrix).
 */

test('AC1: tier->effort is the durable, provider-agnostic invariant (judge stages xhigh)', () => {
  for (const stage of ['plan', 'review', 'audit']) {
    const anthropic = resolveBrain('anthropic', stage);
    const untuned = resolveBrain('untuned-x', stage, { sessionModel: 'm' });
    assert.equal(anthropic.effort, 'xhigh', `anthropic ${stage} effort`);
    assert.equal(untuned.effort, 'xhigh', `untuned-x ${stage} effort`);
  }
});

test('AC1: tier->effort is provider-agnostic for build/tidy/encode tiers', () => {
  for (const stage of ['implement']) {
    assert.equal(resolveBrain('anthropic', stage).effort, 'high', `anthropic ${stage} effort`);
    assert.equal(resolveBrain('untuned-x', stage, { sessionModel: 'm' }).effort, 'high', `untuned-x ${stage} effort`);
  }
  assert.equal(resolveBrain('anthropic', 'test').effort, 'medium');
  assert.equal(resolveBrain('untuned-x', 'test', { sessionModel: 'm' }).effort, 'medium');
  // AC3 (refactor-brain-xhigh): refactor's xhigh is sourced from STAGE_TIER,
  // not the provider column : an untuned provider still yields xhigh.
  assert.equal(resolveBrain('untuned-x', 'refactor', { sessionModel: 'm' }).effort, 'xhigh');
});

test('AC1: untuned/absent-column provider falls back to opts.sessionModel, effort preserved', () => {
  const result = resolveBrain('untuned-x', 'plan', { sessionModel: 'm' });
  assert.deepEqual(result, { provider: 'untuned-x', model: 'm', effort: 'xhigh' });
});

test('AC1: unknown/undispatched stage throws (fail-closed)', () => {
  assert.throws(() => resolveBrain('anthropic', 'bogus-stage'));
});

test('AC1: capture stage throws (out of resolver domain, never dispatched)', () => {
  assert.throws(() => resolveBrain('anthropic', 'capture'));
});

test('AC3: topBrain=fable elevates the judge tier only; non-judge stages unchanged; other values ignored', () => {
  for (const stage of ['plan', 'review', 'audit']) {
    const r = resolveBrain('anthropic', stage, { topBrain: 'fable' });
    assert.deepEqual(r, { provider: 'anthropic', model: 'fable', effort: 'xhigh' });
  }
  for (const stage of ['implement', 'test', 'refactor']) {
    const withFable = resolveBrain('anthropic', stage, { topBrain: 'fable' });
    const withoutFable = resolveBrain('anthropic', stage);
    assert.deepEqual(withFable, withoutFable, `${stage} must be unaffected by topBrain=fable`);
  }
  // a non-`fable` value is ignored, not an error: no elevation, no throw
  const ignored = resolveBrain('anthropic', 'plan', { topBrain: 'opus' });
  assert.notEqual(ignored.model, 'fable');
});

test('AC3: topBrain=fable + fable unavailable degrades to opus, xhigh preserved', () => {
  const r = resolveBrain('anthropic', 'plan', { topBrain: 'fable', availableModels: ['opus', 'sonnet'] });
  assert.deepEqual(r, { provider: 'anthropic', model: 'opus', effort: 'xhigh' });
});

test('AC4: availableModels present, table pin already available -> unchanged', () => {
  const r = resolveBrain('anthropic', 'plan', { availableModels: ['opus', 'sonnet'] });
  assert.equal(r.model, 'opus');
  assert.equal(r.effort, 'xhigh');
});

test('AC4: availableModels present, table pin missing -> degrades down the ladder, effort preserved', () => {
  const r = resolveBrain('anthropic', 'plan', { availableModels: ['sonnet'] });
  assert.equal(r.model, 'sonnet');
  assert.equal(r.effort, 'xhigh');
});

test('AC4: availableModels present, nothing left down the ladder -> sessionModel, effort preserved, never hard-fails', () => {
  const r = resolveBrain('anthropic', 'plan', { availableModels: [], sessionModel: 'floor-model' });
  assert.equal(r.model, 'floor-model');
  assert.equal(r.effort, 'xhigh');
});

test('AC4: no availableModels given -> the table pin is returned unchanged (no fallback)', () => {
  const r = resolveBrain('anthropic', 'plan');
  assert.equal(r.model, 'opus');
  assert.equal(r.effort, 'xhigh');
});

test('refactor-brain-xhigh AC1: resolveBrain(anthropic, refactor) resolves to opus·xhigh', () => {
  // Deliberate exception to this file's "base owned by drift" header (:8-15),
  // same pattern as the `opus` pins at :69/:87 : refactor's value changed in
  // this task and nothing else value-pins it.
  assert.deepEqual(resolveBrain('anthropic', 'refactor'), { provider: 'anthropic', model: 'opus', effort: 'xhigh' });
});
