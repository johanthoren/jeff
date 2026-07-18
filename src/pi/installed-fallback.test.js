// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadSdk } from './role-session.js';
import { prepareInstalledSdkSession } from './pi-sdk-adapter.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const THIS_FILE = fileURLToPath(import.meta.url);
const PROBE = process.env.JEFF_INSTALLED_FALLBACK_PROBE === '1';

/** @param {string} root @param {string} [prefix] */
async function snapshotTree(root, prefix = '') {
  const snapshot = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(snapshot, await snapshotTree(root, path));
    else snapshot[path] = await readFile(join(root, path), 'utf8');
  }
  return snapshot;
}

if (PROBE) {
  test('prepared installed SDK child rejects ambient model, provider, auth, settings, and resources', async () => {
    const cwd = process.env.JEFF_INSTALLED_FALLBACK_CWD ?? assert.fail('missing probe cwd');
    const parentCredentials = {
      read: async (/** @type {string} */ provider) => provider === 'openai-codex'
        ? { type: 'oauth', access: 'parent-token', refresh: '', expires: 253402300799000 }
        : undefined,
      list: async () => [{ providerId: 'openai-codex', type: 'oauth' }],
      modify: async () => undefined,
      delete: async () => {},
    };
    const sdk = await loadSdk(undefined, undefined);
    const parentRuntime = await sdk.ModelRuntime.create({
      credentials: parentCredentials,
      modelsPath: null,
      allowModelNetwork: false,
    });
    const model = parentRuntime.getModel('openai-codex', 'gpt-5.6-sol');
    assert.ok(model, 'installed SDK must include the parent model');
    const parentModelBefore = JSON.stringify(model);
    const tools = ['read', 'grep', 'find', 'ls'];
    const toolsBefore = [...tools];
    const authRequests = [];
    const parentModelRegistry = {
      marker: 'parent-state',
      authStorage: { hasOAuth: (/** @type {string} */ provider) => provider === model.provider },
      async getApiKey(requestedModel, sessionId) {
        authRequests.push([requestedModel.provider, requestedModel.id, sessionId]);
        return 'parent-token';
      },
    };

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
    const runtime = prepared.sessionOptions.modelRuntime;
    const availableModels = (await runtime.getAvailable()).map((candidate) => `${candidate.provider}/${candidate.id}`);
    const childModel = runtime.getModel('openai-codex', 'gpt-5.6-sol');
    const unrelatedModel = runtime.getModel('ambient-provider', 'ambient-model');
    const anthropicAuth = await runtime.getAuth('anthropic');
    const unrelatedAuth = await runtime.getAuth('ambient-provider');
    const auth = await runtime.getAuth(model);
    const compatibility = runtime.getCompatibilityRequestConfig(model);

    let streamHeaders;
    let networkCalled = false;
    globalThis.fetch = async () => {
      networkCalled = true;
      throw new Error('network is forbidden in the installed fallback test');
    };
    const stream = runtime.streamSimple(model, { messages: [] }, {
      transformHeaders(headers) {
        streamHeaders = headers;
        throw new Error('probe stopped before provider I/O');
      },
    });
    await stream.result();
    assert.deepEqual({
      parentModelExact: JSON.stringify(childModel) === parentModelBefore,
      unrelatedModelExposed: unrelatedModel !== undefined,
      availableModels,
      anthropicAuthResolved: anthropicAuth !== undefined,
      unrelatedAuthResolved: unrelatedAuth !== undefined,
      parentAuthExact: auth?.auth.apiKey === 'parent-token',
      parentAuthContaminated: /ambient-secret|x-ambient/i.test(JSON.stringify(auth)),
      compatibilityContaminated: /ambient-secret|x-ambient/i.test(JSON.stringify(compatibility)),
      streamContaminated: /ambient-secret|x-ambient/i.test(JSON.stringify(streamHeaders ?? {})),
      networkCalled,
    }, {
      parentModelExact: true,
      unrelatedModelExposed: false,
      availableModels: ['openai-codex/gpt-5.6-sol'],
      anthropicAuthResolved: false,
      unrelatedAuthResolved: false,
      parentAuthExact: true,
      parentAuthContaminated: false,
      compatibilityContaminated: false,
      streamContaminated: false,
      networkCalled: false,
    });

    const loader = prepared.sessionOptions.resourceLoader;
    assert.deepEqual(loader.getExtensions().extensions, []);
    const skills = loader.getSkills().skills;
    assert.deepEqual(skills.map((skill) => skill.name).sort(), ['code-standards', 'cook', 'security-auditor', 'testing']);
    assert.ok(skills.every((skill) => !relative(PACKAGE_ROOT, skill.filePath).startsWith('..')));
    assert.deepEqual(loader.getPrompts().prompts, []);
    assert.deepEqual(loader.getThemes().themes, []);
    assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
    const settings = prepared.sessionOptions.settingsManager.getGlobalSettings();
    assert.equal(settings.defaultProvider, 'openai-codex');
    assert.equal(settings.defaultModel, 'gpt-5.6-sol');
    assert.equal(settings.defaultThinkingLevel, 'xhigh');
    assert.deepEqual(settings.compaction, { enabled: false });
    assert.deepEqual(settings.retry, { enabled: false, maxRetries: 0 });
    assert.deepEqual(settings.packages, []);
    assert.deepEqual(settings.extensions, []);
    assert.equal(settings.mcpServers, undefined);

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

    assert.deepEqual(authRequests, [['openai-codex', 'gpt-5.6-sol', 'installed-child']]);
    assert.equal(parentModelRegistry.marker, 'parent-state');
    assert.equal(JSON.stringify(model), parentModelBefore);
    assert.deepEqual(tools, toolsBefore);
    assert.deepEqual(await readdir(cwd), []);
  });
} else {
  test('installed Pi SDK fallback is hermetic and inherits only the exact parent session', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'jeff-installed-sdk-'));
    const agentDir = join(sandbox, 'agent');
    const cwd = join(sandbox, 'cwd');
    const home = join(sandbox, 'home');
    try {
      await mkdir(join(agentDir, 'skills', 'ambient'), { recursive: true });
      await mkdir(join(agentDir, 'extensions'), { recursive: true });
      await mkdir(cwd);
      await mkdir(home);
      await writeFile(join(agentDir, 'models.json'), `${JSON.stringify({
        providers: {
          'openai-codex': {
            baseUrl: 'https://ambient.invalid/v1',
            headers: { 'x-ambient-provider': 'ambient-secret' },
            models: [{
              id: 'gpt-5.6-sol',
              name: 'Ambient override',
              reasoning: true,
              input: ['text'],
              contextWindow: 777,
              maxTokens: 777,
              headers: { 'x-ambient-model': 'ambient-secret' },
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            }],
          },
          'ambient-provider': {
            baseUrl: 'https://ambient.invalid/v1',
            api: 'openai-completions',
            apiKey: '$AMBIENT_PROVIDER_KEY',
            headers: { 'x-ambient-provider': '$AMBIENT_PROVIDER_KEY' },
            models: [{ id: 'ambient-model' }],
          },
        },
      }, null, 2)}\n`, 'utf8');
      await writeFile(
        join(agentDir, 'settings.json'),
        `${JSON.stringify({
          defaultProvider: 'ambient-provider',
          defaultModel: 'ambient-model',
          defaultThinkingLevel: 'low',
          extensions: ['extensions/ambient.js'],
          skills: ['skills/ambient'],
          mcpServers: { ambient: { command: 'must-not-run' } },
        }, null, 2)}\n`,
        'utf8',
      );
      await writeFile(
        join(agentDir, 'auth.json'),
        '{"ambient-provider":{"type":"api_key","key":"ambient-file-secret"}}\n',
        'utf8',
      );
      await writeFile(
        join(agentDir, 'skills', 'ambient', 'SKILL.md'),
        '---\nname: ambient\n---\nMust not load.\n',
        'utf8',
      );
      await writeFile(
        join(agentDir, 'extensions', 'ambient.js'),
        'throw new Error("ambient extension loaded");\n',
        'utf8',
      );
      const before = await snapshotTree(agentDir);

      const child = spawnSync(process.execPath, ['--test', THIS_FILE], {
        encoding: 'utf8',
        env: {
          HOME: home,
          PATH: process.env.PATH,
          NO_COLOR: '1',
          PI_CODING_AGENT_DIR: agentDir,
          ANTHROPIC_API_KEY: 'ambient-anthropic-secret',
          AMBIENT_PROVIDER_KEY: 'ambient-provider-secret',
          JEFF_INSTALLED_FALLBACK_PROBE: '1',
          JEFF_INSTALLED_FALLBACK_CWD: cwd,
        },
      });

      assert.deepEqual(await snapshotTree(agentDir), before, 'child must not persist credentials, settings, models, or resources');
      assert.equal(child.status, 0, child.stdout + child.stderr);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
}
