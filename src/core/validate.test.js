import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPresent, isType, isOneOf } from './validate.js';

test('isPresent returns false for null and undefined', () => {
  assert.equal(isPresent(null), false);
  assert.equal(isPresent(undefined), false);
});

test('isPresent returns true for 0, empty string, and false', () => {
  assert.equal(isPresent(0), true);
  assert.equal(isPresent(''), true);
  assert.equal(isPresent(false), true);
});

test('isType returns true when value matches the named type', () => {
  assert.equal(isType('hello', 'string'), true);
  assert.equal(isType(42, 'number'), true);
});

test('isType returns false when value does not match the named type', () => {
  assert.equal(isType('hello', 'number'), false);
});

test('isType array check is not fooled by typeof', () => {
  assert.equal(isType([], 'array'), true);
  assert.equal(isType({}, 'array'), false);
});

test('isOneOf returns true for a value in allowed', () => {
  assert.equal(isOneOf('open', ['open', 'closed']), true);
});

test('isOneOf returns false for a value outside allowed', () => {
  assert.equal(isOneOf('archived', ['open', 'closed']), false);
});
