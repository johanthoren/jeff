// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSdk } from './role-session.js';
import { prepareInstalledSdkSession } from './pi-sdk-adapter.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('installed Pi SDK fallback inherits OMP auth and creates an isolated pinned child', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'jeff-installed-sdk-'));
  try {
    const sdk = await loadSdk(undefined, undefined);
    const catalog = await sdk.ModelRuntime.create({ allowModelNetwork: false });
    const model = catalog.getModel('openai-codex', 'gpt-5.6-sol');
    assert.ok(model, 'installed SDK must include the OMP smoke model');
    const authRequests = [];
    const parentModelRegistry = {
      authStorage: { hasOAuth: (provider) => provider === model.provider },
      async getApiKey(requestedModel, sessionId) {
        authRequests.push([requestedModel.provider, requestedModel.id, sessionId]);
        return 'inherited-omp-token';
      },
    };
    const tools = ['read', 'grep', 'find', 'ls'];
    const prepared = await prepareInstalledSdkSession(sdk, {
      cwd,
      packageRoot: PACKAGE_ROOT,
      tools,
      effort: 'xhigh',
      agentId: 'installed-child',
      parentModelRegistry,
      currentModel: model,
    });
    assert.ok(prepared);

    const auth = await prepared.sessionOptions.modelRuntime.getAuth(model);
    assert.equal(auth?.auth.apiKey, 'inherited-omp-token');
    assert.deepEqual(authRequests, [['openai-codex', 'gpt-5.6-sol', 'installed-child']]);
    assert.deepEqual(prepared.sessionOptions.resourceLoader.getExtensions().extensions, []);
    const skills = prepared.sessionOptions.resourceLoader.getSkills().skills;
    assert.deepEqual(skills.map((skill) => skill.name).sort(), ['code-standards', 'cook', 'security-auditor', 'testing']);
    assert.ok(skills.every((skill) => !relative(PACKAGE_ROOT, skill.filePath).startsWith('..')));
    const settings = prepared.sessionOptions.settingsManager.getGlobalSettings();
    assert.equal(settings.defaultProvider, 'openai-codex');
    assert.equal(settings.defaultModel, 'gpt-5.6-sol');
    assert.equal(settings.defaultThinkingLevel, 'xhigh');
    assert.deepEqual(settings.compaction, { enabled: false });
    assert.deepEqual(settings.retry, { enabled: false, maxRetries: 0 });

    const { session, extensionsResult } = await sdk.createAgentSession({
      cwd,
      model,
      thinkingLevel: 'xhigh',
      tools,
      sessionManager: sdk.SessionManager.inMemory(cwd),
      ...prepared.sessionOptions,
    });
    try {
      assert.deepEqual(session.getActiveToolNames(), tools);
      assert.equal(session.model, model);
      assert.equal(session.thinkingLevel, 'xhigh');
      assert.deepEqual(extensionsResult.extensions, []);
    } finally {
      await session.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
