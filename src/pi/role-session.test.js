// @ts-check

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRolePrompt, dispatchRoleSession } from './role-session.js';

const REVIEW_AGENT = `---
name: cook-review
model: opus
effort: xhigh
tools: Read, Grep, Glob, Bash
---

Review body.
`;

/** @param {(dir: string) => Promise<void>} fn */
async function withRepo(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-pi-role-'));
  try {
    await mkdir(join(dir, 'agents'));
    await writeFile(join(dir, 'agents', 'cook-review.md'), REVIEW_AGENT);
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('prompt construction includes role body, task directory, brief, and agent id', () => {
  const prompt = buildRolePrompt({
    stage: 'review',
    agentId: '0123456789abcdef',
    roleBody: 'Review body.',
    brief: 'Check the diff.',
    taskDir: '.jeff/tasks/x',
  });

  assert.match(prompt, /stage: review/);
  assert.match(prompt, /agent_id: 0123456789abcdef/);
  assert.match(prompt, /Review body\./);
  assert.match(prompt, /Task directory: \.jeff\/tasks\/x/);
  assert.match(prompt, /Check the diff\./);
});

test('dispatchRoleSession starts a fresh Pi session without a real model call', async () => {
  await withRepo(async (repoRoot) => {
    /** @type {any} */
    let capturedOptions;
    let capturedPrompt = '';
    let disposed = false;
    /** @type {(event: any) => void} */
    let listener = () => {};
    const fakeSession = {
      /** @param {(event: any) => void} fn */
      subscribe(fn) {
        listener = fn;
        return () => {};
      },
      /** @param {string} prompt */
      async prompt(prompt) {
        capturedPrompt = prompt;
        listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'verdict: pass' } });
      },
      dispose() {
        disposed = true;
      },
    };
    const sdk = {
      SessionManager: {
        /** @param {string} cwd */
        inMemory: (cwd) => ({ cwd }),
      },
      /** @param {any} options */
      createAgentSession: async (options) => {
        capturedOptions = options;
        return { session: fakeSession };
      },
    };
    const modelRegistry = {
      async getAvailable() {
        return [{ provider: 'anthropic', id: 'claude-opus-4-5' }];
      },
      /**
       * @param {string} provider
       * @param {string} id
       */
      find(provider, id) {
        return { provider, id };
      },
    };

    const result = await dispatchRoleSession({
      stage: 'review',
      brief: 'Check the diff.',
      cwd: repoRoot,
      repoRoot,
      currentModel: { provider: 'anthropic', id: 'claude-sonnet-4-5' },
      modelRegistry,
      sdk,
      generateAgentId: () => '0123456789abcdef',
    });

    assert.equal(result.agent_id, '0123456789abcdef');
    assert.equal(result.stage, 'review');
    assert.deepEqual(result.brain, { provider: 'anthropic', model: 'claude-opus-4-5', effort: 'xhigh' });
    assert.deepEqual(capturedOptions.tools, ['read', 'grep', 'find', 'ls', 'bash']);
    assert.equal(capturedOptions.thinkingLevel, 'xhigh');
    assert.equal(capturedOptions.model.id, 'claude-opus-4-5');
    assert.match(capturedPrompt, /Review body\./);
    assert.equal(result.transcript, 'verdict: pass');
    assert.equal(disposed, true);
  });
});
