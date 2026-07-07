// @ts-check

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRolePrompt, dispatchRoleSession, loadSdk } from './role-session.js';

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

test('dispatchRoleSession inherits the current Pi model and changes only thinking level', async () => {
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
    const currentModel = { provider: 'local', id: 'qwen-dev' };

    const result = await dispatchRoleSession({
      stage: 'review',
      brief: 'Check the diff.',
      cwd: repoRoot,
      repoRoot,
      currentModel,
      modelRegistry: { find: assert.fail, getAvailable: assert.fail },
      sdk,
      generateAgentId: () => '0123456789abcdef',
    });

    assert.equal(result.agent_id, '0123456789abcdef');
    assert.equal(result.stage, 'review');
    assert.deepEqual(result.brain, { provider: 'local', model: 'qwen-dev', effort: 'xhigh' });
    assert.deepEqual(capturedOptions.tools, ['read', 'grep', 'find', 'ls', 'bash']);
    assert.equal(capturedOptions.thinkingLevel, 'xhigh');
    assert.equal(capturedOptions.model, currentModel);
    assert.match(capturedPrompt, /Review body\./);
    assert.equal(result.transcript, 'verdict: pass');
    assert.equal(disposed, true);
  });
});

test('dispatchRoleSession grants stage-appropriate tools without edit access to judgment stages', async () => {
  await withRepo(async (repoRoot) => {
    /** @type {Record<string, string>} */
    const agents = {
      plan: '---\nname: cook-plan\nmodel: opus\neffort: xhigh\n---\nPlan body.',
      audit: '---\nname: cook-audit\nmodel: opus\neffort: xhigh\n---\nAudit body.',
      refute: '---\nname: cook-refute\nmodel: opus\neffort: xhigh\n---\nRefute body.',
    };
    for (const [stage, body] of Object.entries(agents)) {
      await writeFile(join(repoRoot, 'agents', `cook-${stage}.md`), body);
    }

    /** @type {Record<string, string[]>} */
    const toolsByStage = {};
    const sdk = {
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: async (/** @type {any} */ options) => {
        toolsByStage[options.stageForTest] = options.tools;
        return { session: { subscribe() {}, async prompt() {}, dispose() {} } };
      },
    };

    for (const stage of ['plan', 'review', 'audit', 'refute']) {
      await dispatchRoleSession({
        stage,
        brief: 'Check the diff.',
        cwd: repoRoot,
        repoRoot,
        sdk: {
          ...sdk,
          createAgentSession: async (/** @type {any} */ options) => sdk.createAgentSession({ ...options, stageForTest: stage }),
        },
        generateAgentId: () => `agent-${stage}`,
      });
    }

    assert.deepEqual(toolsByStage, {
      plan: ['read', 'grep', 'find', 'ls', 'write'],
      review: ['read', 'grep', 'find', 'ls', 'bash'],
      audit: ['read', 'grep', 'find', 'ls', 'bash'],
      refute: ['read', 'grep', 'find', 'ls', 'bash'],
    });
  });
});

test('dispatchRoleSession loads bundled agents when target cwd has no agents directory', async () => {
  const target = await mkdtemp(join(tmpdir(), 'jeff-pi-target-'));
  try {
    /** @type {any} */
    let capturedPrompt = '';
    const sdk = {
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: async () => ({
        session: {
          subscribe() {},
          /** @param {string} prompt */
          async prompt(prompt) { capturedPrompt = prompt; },
          dispose() {},
        },
      }),
    };

    const result = await dispatchRoleSession({
      stage: 'review',
      brief: 'Check the diff.',
      cwd: target,
      sdk,
      generateAgentId: () => '0011223344556677',
    });

    assert.equal(result.agent_id, '0011223344556677');
    assert.match(capturedPrompt, /You are the \*\*review\*\* station of the jeff brigade/);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('loadSdk falls back when argv-adjacent index.js import fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeff-pi-sdk-'));
  try {
    const entry = join(dir, 'wrapper.mjs');
    await writeFile(entry, '');
    const fallbackSdk = { createAgentSession: true };
    /** @type {string[]} */
    const attempted = [];

    const got = await loadSdk(undefined, entry, async (specifier) => {
      attempted.push(specifier);
      if (specifier.startsWith('file:')) throw new Error('missing adjacent SDK');
      return fallbackSdk;
    });

    assert.equal(got, fallbackSdk);
    assert.equal(attempted.length, 2);
    assert.equal(attempted[0].startsWith('file:'), true);
    assert.equal(attempted[0].endsWith('/index.js'), true);
    assert.equal(attempted[1], '@earendil-works/pi-coding-agent');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('dispatchRoleSession falls back to session state when no text events arrive', async () => {
  await withRepo(async (repoRoot) => {
    const fakeSession = {
      state: {
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'state transcript' }] },
        ],
      },
      subscribe() { return () => {}; },
      async prompt() {},
      dispose() {},
    };
    const sdk = {
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: async () => ({ session: fakeSession }),
    };

    const result = await dispatchRoleSession({
      stage: 'review',
      brief: 'Check the diff.',
      cwd: repoRoot,
      repoRoot,
      sdk,
      generateAgentId: () => '0123456789abcdef',
    });

    assert.equal(result.transcript, 'state transcript');
  });
});

test('dispatchRoleSession lets Pi choose the model when no current model exists', async () => {
  await withRepo(async (repoRoot) => {
    /** @type {any} */
    let capturedOptions;
    const fakeSession = {
      model: { provider: 'picked', id: 'model-from-child' },
      thinkingLevel: 'high',
      subscribe() {
        return () => {};
      },
      async prompt() {},
      dispose() {},
    };
    const sdk = {
      SessionManager: { inMemory: () => ({}) },
      /** @param {any} options */
      createAgentSession: async (options) => {
        capturedOptions = options;
        return { session: fakeSession };
      },
    };

    const result = await dispatchRoleSession({
      stage: 'review',
      brief: 'Check the diff.',
      cwd: repoRoot,
      repoRoot,
      sdk,
      generateAgentId: () => 'fedcba9876543210',
    });

    assert.equal(capturedOptions.model, undefined);
    assert.deepEqual(result.brain, { provider: 'picked', model: 'model-from-child', effort: 'high' });
  });
});
