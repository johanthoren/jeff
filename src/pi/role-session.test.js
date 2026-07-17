// @ts-check

import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRolePrompt, dispatchRoleSession, loadSdk } from './role-session.js';

const REVIEW_AGENT = `---
name: cook-review
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

const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OMP_DEFAULT_SETTINGS = {
  disabledProviders: [],
  'providers.webSearch': 'auto',
  'providers.webSearchExclude': [],
  'providers.image': 'auto',
  'providers.anthropic.serverSideFallback': false,
  'ttsr.enabled': true,
  'ttsr.builtinRules': true,
};
const OMP_PARENT_SETTINGS = {
  disabledProviders: ['parent-disabled-provider'],
  'providers.webSearch': 'exa',
  'providers.webSearchExclude': ['brave'],
  'providers.image': 'openai',
  'providers.anthropic.serverSideFallback': true,
};
const OMP_DISCOVERED_SKILLS = [
  { name: 'code-standards', _source: { provider: 'native' } },
  { name: 'testing', _source: { provider: 'agents' } },
  { name: 'learned-shortcut', _source: { provider: 'omp-managed' } },
];

/** @param {Record<string, string>} [apiKeys] */
function ompAuthStorage(apiKeys = {}) {
  return {
    configApiKeys: new Map(Object.entries(apiKeys)),
    oauthProviders: new Set(),
    fallbackWrites: 0,
    setFallbackResolver() { this.fallbackWrites += 1; },
    /** @param {string} provider @param {string} key */
    setConfigApiKey(provider, key) { this.configApiKeys.set(provider, key); },
    /** @param {string} provider */
    removeConfigApiKey(provider) { this.configApiKeys.delete(provider); },
    clearConfigApiKeys() { this.configApiKeys.clear(); },
    /** @param {string} provider */
    hasAuth(provider) { return this.configApiKeys.has(provider); },
    /** @param {string} provider */
    hasOAuth(provider) { return this.oauthProviders.has(provider); },
    /** @param {string} provider */
    getOAuthCredential(provider) { return this.oauthProviders.has(provider) ? { type: 'oauth' } : undefined; },
    /** @param {string} provider */
    async getApiKey(provider) { return this.configApiKeys.get(provider); },
    onCredentialDisabled() { return () => {}; },
  };
}

class OmpModelRegistry {
  /**
   * @param {any} authStorage
   * @param {{ models?: any[], providers?: string[], sources?: Array<[string, string[]]> }} [state]
   */
  constructor(authStorage, state = {}) {
    this.authStorage = authStorage;
    this.models = [...(state.models ?? [])];
    this.providers = new Set(state.providers ?? []);
    this.providersBySource = new Map(
      (state.sources ?? []).map(([source, providers]) => [source, new Set(providers)]),
    );
    authStorage.setFallbackResolver?.(() => undefined);
  }

  /** @param {string[]} activeSources */
  syncExtensionSources(activeSources) {
    const active = new Set(activeSources);
    for (const source of [...this.providersBySource.keys()]) {
      if (!active.has(source)) this.clearSourceRegistrations(source);
    }
  }

  /** @param {string} source */
  clearSourceRegistrations(source) {
    const providers = this.providersBySource.get(source) ?? new Set();
    this.providersBySource.delete(source);
    for (const provider of providers) {
      this.providers.delete(provider);
      this.models = this.models.filter((model) => model.provider !== provider);
      this.authStorage.removeConfigApiKey(provider);
      this.authStorage.oauthProviders?.delete(provider);
    }
  }

  async refreshRuntimeProviders() {}
  /** @param {any} model */
  async refreshSelectedModelMetadata(model) { return model; }
  /** @param {any} model */
  hasConfiguredAuth(model) { return this.authStorage.hasAuth(model.provider); }
  /** @param {any} model */
  async getApiKey(model) { return this.authStorage.getApiKey(model.provider); }
  /** @param {any} model */
  resolver(model) { return () => this.getApiKey(model); }
  /** @param {string} provider @param {string} id */
  find(provider, id) { return this.models.find((model) => model.provider === provider && model.id === id); }
  getAll() { return [...this.models]; }
  getAvailable() { return this.models.filter((model) => this.hasConfiguredAuth(model)); }
}

/** @param {any} model */
function ompParentModelRegistry(model) {
  const authStorage = ompAuthStorage({ [model.provider]: 'extension-key' });
  authStorage.oauthProviders.add(model.provider);
  return new OmpModelRegistry(authStorage, {
    models: [model],
    providers: [model.provider],
    sources: [['/plugins/extension-provider.js', [model.provider]]],
  });
}

/** @param {OmpModelRegistry} registry */
function ompModelRegistrySnapshot(registry) {
  return {
    sources: [...registry.providersBySource].map(([source, providers]) => [source, [...providers].sort()]).sort(),
    providers: [...registry.providers].sort(),
    models: registry.models.map((model) => `${model.provider}/${model.id}`).sort(),
    configApiKeys: [...registry.authStorage.configApiKeys].sort(),
    oauthProviders: [...registry.authStorage.oauthProviders].sort(),
    fallbackWrites: registry.authStorage.fallbackWrites,
  };
}

/** @param {Record<string, unknown>} [overrides] */
function ompSettings(overrides = {}) {
  const values = /** @type {Record<string, unknown>} */ ({ ...OMP_DEFAULT_SETTINGS, ...overrides });
  return {
    /** @param {string} key */
    get: (key) => values[key],
    /** @param {string} prefix */
    getGroup: (prefix) => Object.fromEntries(
      Object.entries(values)
        .filter(([key]) => key.startsWith(`${prefix}.`))
        .map(([key, value]) => [key.slice(prefix.length + 1), value]),
    ),
    /**
     * @param {string} key
     * @param {unknown} value
     */
    override(key, value) { values[key] = value; },
    async cloneForCwd() { return ompSettings(values); },
  };
}

/** @param {any} options */
function activeOmpTools(options) {
  return [
    ...(options.toolNames ?? []),
    ...(options.customTools ?? []).map((/** @type {{ name: string }} */ tool) => tool.name),
  ];
}

/**
 * @param {(options: any) => Promise<any>} createAgentSession
 * @param {{
 *   hostState?: Record<string, any>,
 *   discoveredSkills?: any[],
 *   exposeAgentRegistry?: boolean,
 *   captureGlobalRegistry?: (registry: any) => void,
 *   syncModelRegistry?: boolean,
 * }} [testOptions]
 */
function ompSdk(createAgentSession, testOptions = {}) {
  class AgentRegistry {
    constructor() { this.refs = new Map(); }
    /** @param {any} ref */
    register(ref) { this.refs.set(ref.id, { ...ref }); }
    /** @param {string} id */
    get(id) { return this.refs.get(id); }
    list() { return [...this.refs.values()]; }
    /** @param {string} id @param {any} session */
    attachSession(id, session) {
      const ref = this.refs.get(id);
      if (ref) ref.session = session;
    }
    /** @param {string} id */
    unregister(id) { this.refs.delete(id); }
    onChange() { return () => {}; }
    static global() { return globalRegistry; }
  }
  const globalRegistry = new AgentRegistry();
  testOptions.captureGlobalRegistry?.(globalRegistry);
  const parentSettings = ompSettings(OMP_PARENT_SETTINGS);
  const initializeWithSettings = (/** @type {any} */ activeSettings) => {
    if (!testOptions.hostState) return;
    testOptions.hostState.settingsOwner = activeSettings === parentSettings ? 'parent' : 'child';
    testOptions.hostState.disabledProviders = [...(activeSettings.get('disabledProviders') ?? [])];
  };
  const applyProviderGlobalsFromSettings = (/** @type {any} */ activeSettings) => {
    if (!testOptions.hostState) return;
    testOptions.hostState.webSearch = activeSettings.get('providers.webSearch');
    testOptions.hostState.webSearchExclude = [...(activeSettings.get('providers.webSearchExclude') ?? [])];
    testOptions.hostState.image = activeSettings.get('providers.image');
  };

  /** @type {any} */
  const sdk = {
    SessionManager: { inMemory: () => ({}) },
    Settings: { isolated: ompSettings },
    settings: parentSettings,
    ModelRegistry: OmpModelRegistry,
    createSubagentSettings: (/** @type {any} */ base, /** @type {Record<string, unknown>} */ overrides) => ompSettings({
      ...Object.fromEntries(
        Object.keys({ ...OMP_DEFAULT_SETTINGS, ...OMP_PARENT_SETTINGS }).map((key) => [key, base.get(key)]),
      ),
      ...overrides,
    }),
    discoverSkills: async () => ({
      skills: (testOptions.discoveredSkills ?? OMP_DISCOVERED_SKILLS).map((skill) => ({ ...skill })),
      warnings: [],
    }),
    initializeWithSettings,
    applyProviderGlobalsFromSettings,
    createReadOnlyTools: () => ['read', 'grep', 'find', 'ls'].map((name) => ({ name })),
    createAgentSession: async (/** @type {any} */ options) => {
      const registry = options.agentRegistry ?? globalRegistry;
      const agentId = options.agentId ?? options.parentTaskPrefix ?? 'Main';
      registry.register({ id: agentId, session: null, status: 'running' });

      initializeWithSettings(options.settings);
      applyProviderGlobalsFromSettings(options.settings);
      if (testOptions.syncModelRegistry) {
        options.modelRegistry.syncExtensionSources(['<inline-autoresearch>']);
      }
      if (testOptions.hostState && !options.parentTaskPrefix) {
        testOptions.hostState.skills = (options.skills ?? OMP_DISCOVERED_SKILLS)
          .map((/** @type {any} */ skill) => skill.name);
        testOptions.hostState.rules = (options.rules ?? [{ name: 'ambient-rule' }])
          .map((/** @type {any} */ rule) => rule.name);
      }

      let created;
      try {
        created = await createAgentSession(options);
      } catch (error) {
        registry.unregister(agentId);
        throw error;
      }
      const originalDispose = created.session.dispose?.bind(created.session) ?? (() => {});
      created.session.dispose = async () => {
        try {
          await originalDispose();
        } finally {
          registry.unregister(agentId);
        }
      };
      registry.attachSession(agentId, created.session);
      return created;
    },
  };
  if (testOptions.exposeAgentRegistry !== false) sdk.AgentRegistry = AgentRegistry;
  return sdk;
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
      model: { provider: 'local', id: 'qwen-dev' },
      thinkingLevel: 'xhigh',
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
    assert.deepEqual(capturedOptions.tools, ['read', 'grep', 'find', 'ls']);
    assert.equal('toolNames' in capturedOptions, false);
    assert.equal('settings' in capturedOptions, false);
    assert.equal(capturedOptions.thinkingLevel, 'xhigh');
    assert.equal(capturedOptions.model, currentModel);
    assert.match(capturedPrompt, /Review body\./);
    assert.equal(result.transcript, 'verdict: pass');
    assert.equal(disposed, true);
  });
});

test('dispatchRoleSession grants stage-appropriate tools without command or edit access to judgment stages', async () => {
  await withRepo(async (repoRoot) => {
    /** @type {Record<string, string>} */
    const agents = {
      plan: '---\nname: cook-plan\neffort: xhigh\n---\nPlan body.',
      implement: '---\nname: cook-implement\neffort: high\n---\nImplement body.',
      refactor: '---\nname: cook-refactor\neffort: xhigh\n---\nRefactor body.',
      audit: '---\nname: cook-audit\neffort: xhigh\n---\nAudit body.',
      refute: '---\nname: cook-refute\neffort: xhigh\n---\nRefute body.',
    };
    for (const [stage, body] of Object.entries(agents)) {
      await writeFile(join(repoRoot, 'agents', `cook-${stage}.md`), body);
    }

    /** @type {Record<string, string[]>} */
    const toolsByStage = {};
    /** @type {Record<string, string>} */
    const effortByStage = {};
    const sdk = {
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: async (/** @type {any} */ options) => {
        toolsByStage[options.stageForTest] = options.tools;
        return { session: { subscribe() {}, async prompt() {}, dispose() {} } };
      },
    };

    for (const stage of ['plan', 'implement', 'refactor', 'review', 'audit', 'refute']) {
      await dispatchRoleSession({
        stage,
        brief: 'Check the diff.',
        cwd: repoRoot,
        repoRoot,
        currentModel: { provider: 'local', id: 'qwen-dev' },
        sdk: {
          ...sdk,
          createAgentSession: async (/** @type {any} */ options) => {
            effortByStage[stage] = options.thinkingLevel;
            return sdk.createAgentSession({ ...options, stageForTest: stage });
          },
        },
        generateAgentId: () => `agent-${stage}`,
      });
    }

    assert.deepEqual(toolsByStage, {
      plan: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'],
      implement: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'],
      refactor: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'],
      review: ['read', 'grep', 'find', 'ls'],
      audit: ['read', 'grep', 'find', 'ls'],
      refute: ['read', 'grep', 'find', 'ls'],
    });
    assert.deepEqual(effortByStage, {
      plan: 'xhigh',
      implement: 'high',
      refactor: 'xhigh',
      review: 'xhigh',
      audit: 'xhigh',
      refute: 'xhigh',
    });
  });
});

test('dispatchRoleSession translates every stage to an isolated OMP child session', async () => {
  await withRepo(async (repoRoot) => {
    /** @type {Record<string, string>} */
    const efforts = {
      plan: 'xhigh',
      implement: 'high',
      refactor: 'xhigh',
      review: 'xhigh',
      audit: 'xhigh',
      refute: 'xhigh',
    };
    for (const [stage, effort] of Object.entries(efforts)) {
      if (stage !== 'review') {
        await writeFile(join(repoRoot, 'agents', `cook-${stage}.md`), `---\nname: cook-${stage}\neffort: ${effort}\n---\n${stage} body.`);
      }
    }

    /** @type {Record<string, any>} */
    const optionsByStage = {};
    const currentModel = { provider: 'openai', id: 'gpt-5.6' };
    const modelRegistry = ompParentModelRegistry(currentModel);
    /** @type {Record<string, string[]>} */
    const expectedTools = {
      plan: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'],
      implement: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'],
      refactor: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'],
      review: ['read', 'grep', 'find', 'ls'],
      audit: ['read', 'grep', 'find', 'ls'],
      refute: ['read', 'grep', 'find', 'ls'],
    };
    /** @type {Record<string, string[]>} */
    const expectedOmpToolNames = {
      plan: ['read', 'grep', 'glob', 'bash', 'edit', 'write'],
      implement: ['read', 'grep', 'glob', 'bash', 'edit', 'write'],
      refactor: ['read', 'grep', 'glob', 'bash', 'edit', 'write'],
      review: ['read', 'grep', 'glob'],
      audit: ['read', 'grep', 'glob'],
      refute: ['read', 'grep', 'glob'],
    };

    for (const stage of Object.keys(efforts)) {
      await dispatchRoleSession({
        stage,
        brief: 'Do only this stage.',
        cwd: repoRoot,
        repoRoot,
        currentModel,
        modelRegistry,
        sdk: ompSdk(async (options) => {
          optionsByStage[stage] = options;
          return {
            session: {
              model: currentModel,
              thinkingLevel: efforts[stage],
              getActiveToolNames: () => activeOmpTools(options),
              subscribe() {},
              async prompt() {},
              dispose() {},
            },
          };
        }),
        generateAgentId: () => `omp-${stage}`,
      });
    }

    for (const [stage, options] of Object.entries(optionsByStage)) {
      assert.deepEqual(options.tools, expectedTools[stage]);
      assert.deepEqual(options.toolNames, expectedOmpToolNames[stage]);
      assert.equal('customTools' in options, false);
      assert.equal(options.model, currentModel);
      assert.equal(options.thinkingLevel, efforts[stage]);
      assert.equal(options.disableExtensionDiscovery, true);
      assert.deepEqual(options.preloadedCustomToolPaths, []);
      assert.equal(options.enableMCP, false);
      assert.deepEqual(options.skills.map((/** @type {any} */ skill) => skill.name), ['code-standards', 'testing']);
      assert.deepEqual(options.rules, []);
      assert.equal('contextFiles' in options, false);
      assert.equal(options.spawns, '');
      assert.equal(options.taskDepth, 1);
      assert.equal(options.parentTaskPrefix, `omp-${stage}`);
      assert.equal(options.agentId, `omp-${stage}`);
      assert.deepEqual(options.settings.get('disabledProviders'), ['parent-disabled-provider']);
      assert.equal(options.settings.get('advisor.enabled'), false);
      assert.equal(options.settings.get('advisor.subagents'), false);
      assert.equal(options.settings.get('astEdit.enabled'), false);
      assert.equal(options.settings.get('astGrep.enabled'), false);
      assert.equal(options.settings.get('autolearn.enabled'), false);
      assert.equal(options.settings.get('magicKeywords.enabled'), false);
      assert.equal(options.settings.get('memory.backend'), 'off');
      assert.equal(options.settings.get('plan.enabled'), false);
      assert.deepEqual(options.settings.get('retry.fallbackChains'), {});
      assert.equal(options.settings.get('ttsr.enabled'), false);
      assert.equal(options.settings.get('ttsr.builtinRules'), false);
    }
  });
});

test('dispatchRoleSession keeps an OMP child private with the compiled root SDK that has no AgentRegistry export', async () => {
  await withRepo(async (repoRoot) => {
    const currentModel = { provider: 'openai', id: 'gpt-5.6' };
    const modelRegistry = ompParentModelRegistry(currentModel);
    let visibleFromGlobalRegistry;
    /** @type {any} */
    let globalRegistry;
    const sdk = ompSdk(async (options) => ({
      session: {
        model: currentModel,
        thinkingLevel: 'xhigh',
        getActiveToolNames: () => activeOmpTools(options),
        subscribe() {},
        async prompt() { visibleFromGlobalRegistry = globalRegistry.get('omp-review'); },
        dispose() {},
      },
    }), {
      exposeAgentRegistry: false,
      captureGlobalRegistry(registry) { globalRegistry = registry; },
    });

    assert.equal('AgentRegistry' in sdk, false);
    await dispatchRoleSession({
      stage: 'review',
      brief: 'Review without IRC.',
      cwd: repoRoot,
      repoRoot,
      currentModel,
      modelRegistry,
      sdk,
      generateAgentId: () => 'omp-review',
    });

    assert.equal(visibleFromGlobalRegistry, undefined);
  });
});

test('dispatchRoleSession retains Jeff and authored skills but excludes unrelated plugin packages and OMP instructions', async () => {
  await withRepo(async (repoRoot) => {
    const currentModel = { provider: 'openai', id: 'gpt-5.6' };
    const modelRegistry = ompParentModelRegistry(currentModel);
    const discoveredSkills = [
      {
        name: 'code-standards',
        filePath: join(PACKAGE_ROOT, 'skills', 'code-standards', 'SKILL.md'),
        _source: { provider: 'omp-plugins', level: 'user' },
      },
      {
        name: 'repository-guidance',
        filePath: join(repoRoot, '.agents', 'skills', 'repository-guidance', 'SKILL.md'),
        _source: { provider: 'agents', level: 'project' },
      },
      {
        name: 'user-guidance',
        filePath: '/home/chef/.claude/skills/user-guidance/SKILL.md',
        _source: { provider: 'claude', level: 'user' },
      },
      {
        name: 'unrelated-omp-plugin',
        filePath: '/plugins/unrelated/skills/unrelated-omp-plugin/SKILL.md',
        _source: { provider: 'omp-plugins', level: 'user' },
      },
      {
        name: 'unrelated-claude-plugin',
        filePath: '/home/chef/.claude/plugins/cache/unrelated/skills/plugin/SKILL.md',
        _source: { provider: 'claude-plugins', level: 'user' },
      },
      {
        name: 'learned-shortcut',
        filePath: '/home/chef/.omp/agent/managed-skills/learned-shortcut/SKILL.md',
        _source: { provider: 'omp-managed', level: 'user' },
      },
    ];
    /** @type {string[]} */
    let childInstructions = [];
    const sdk = ompSdk(async (options) => ({
      session: {
        model: currentModel,
        thinkingLevel: 'xhigh',
        getActiveToolNames: () => activeOmpTools(options),
        subscribe() {},
        async prompt() {
          const skills = options.skills ?? discoveredSkills;
          const rules = options.rules ?? [{ name: 'ambient-rule' }];
          childInstructions = [
            ...skills.map((/** @type {any} */ skill) => skill.name),
            ...rules.map((/** @type {any} */ rule) => `rule:${rule.name}`),
            ...(options.settings.get('ttsr.enabled') ? ['ttsr'] : []),
            ...(options.settings.get('ttsr.builtinRules') ? ['ttsr:builtin'] : []),
          ];
        },
        dispose() {},
      },
    }), { discoveredSkills });

    await dispatchRoleSession({
      stage: 'review',
      brief: 'Use only authored standards.',
      cwd: repoRoot,
      repoRoot,
      currentModel,
      modelRegistry,
      sdk,
    });

    assert.deepEqual(childInstructions, ['code-standards', 'repository-guidance', 'user-guidance']);
  });
});

test('dispatchRoleSession disables inherited Anthropic server-side model fallback', async () => {
  await withRepo(async (repoRoot) => {
    const currentModel = {
      provider: 'anthropic',
      id: 'claude-fable-5',
      api: 'anthropic-messages',
    };
    const modelRegistry = ompParentModelRegistry(currentModel);
    let requestedModel;
    const sdk = ompSdk(async (options) => ({
      session: {
        model: currentModel,
        thinkingLevel: 'xhigh',
        getActiveToolNames: () => activeOmpTools(options),
        subscribe() {},
        async prompt() {
          requestedModel = options.settings.get('providers.anthropic.serverSideFallback')
            ? 'claude-opus-4-8'
            : options.model.id;
        },
        dispose() {},
      },
    }));

    const result = await dispatchRoleSession({
      stage: 'review',
      brief: 'Stay on the exact Anthropic model.',
      cwd: repoRoot,
      repoRoot,
      currentModel,
      modelRegistry,
      sdk,
    });

    assert.equal(requestedModel, 'claude-fable-5');
    assert.deepEqual(result.brain, { provider: 'anthropic', model: 'claude-fable-5', effort: 'xhigh' });
  });
});

function ompParentState() {
  return {
    settingsOwner: 'parent',
    disabledProviders: ['parent-disabled-provider'],
    webSearch: 'exa',
    webSearchExclude: ['brave'],
    image: 'openai',
    skills: ['parent-skill'],
    rules: ['parent-rule'],
  };
}

test('dispatchRoleSession leaves OMP parent discovery and resource state unchanged after success', async () => {
  await withRepo(async (repoRoot) => {
    const hostState = ompParentState();
    const before = structuredClone(hostState);
    const currentModel = { provider: 'openai', id: 'gpt-5.6' };
    const sdk = ompSdk(async (options) => ({
      session: {
        model: currentModel,
        thinkingLevel: 'xhigh',
        getActiveToolNames: () => activeOmpTools(options),
        subscribe() {},
        async prompt() { assert.deepEqual(hostState, before); },
        dispose() {},
      },
    }), { hostState });

    await dispatchRoleSession({
      stage: 'review',
      brief: 'Preserve parent state.',
      cwd: repoRoot,
      repoRoot,
      currentModel,
      modelRegistry: ompParentModelRegistry(currentModel),
      sdk,
    });

    assert.deepEqual(hostState, before);
  });
});

test('dispatchRoleSession leaves OMP parent discovery and resource state unchanged when startup fails', async () => {
  await withRepo(async (repoRoot) => {
    const hostState = ompParentState();
    const before = structuredClone(hostState);
    const sdk = ompSdk(async () => { throw new Error('host startup failed'); }, { hostState });

    await assert.rejects(
      dispatchRoleSession({
        stage: 'review',
        brief: 'Fail without changing parent state.',
        cwd: repoRoot,
        repoRoot,
        currentModel: { provider: 'openai', id: 'gpt-5.6' },
        modelRegistry: ompParentModelRegistry({ provider: 'openai', id: 'gpt-5.6' }),
        sdk,
      }),
      /host startup failed/,
    );

    assert.deepEqual(hostState, before);
  });
});

test('dispatchRoleSession keeps parent extension model and auth state after successful OMP creation', async () => {
  await withRepo(async (repoRoot) => {
    const currentModel = { provider: 'extension-provider', id: 'extension-model', api: 'extension-api' };
    const parentModelRegistry = ompParentModelRegistry(currentModel);
    const before = ompModelRegistrySnapshot(parentModelRegistry);
    const sdk = ompSdk(async (options) => {
      assert.notEqual(options.modelRegistry, parentModelRegistry);
      assert.equal(options.model, currentModel);
      assert.equal(await options.modelRegistry.getApiKey(currentModel), 'extension-key');
      return {
        session: {
          model: currentModel,
          thinkingLevel: 'xhigh',
          getActiveToolNames: () => activeOmpTools(options),
          subscribe() {},
          async prompt() {},
          dispose() {},
        },
      };
    }, { syncModelRegistry: true });

    const result = await dispatchRoleSession({
      stage: 'review',
      brief: 'Use the active extension model without changing the parent.',
      cwd: repoRoot,
      repoRoot,
      currentModel,
      modelRegistry: parentModelRegistry,
      sdk,
    });

    assert.deepEqual(result.brain, { provider: 'extension-provider', model: 'extension-model', effort: 'xhigh' });
    assert.deepEqual(ompModelRegistrySnapshot(parentModelRegistry), before);
  });
});

test('dispatchRoleSession keeps parent extension model and auth state when OMP creation fails', async () => {
  await withRepo(async (repoRoot) => {
    const currentModel = { provider: 'extension-provider', id: 'extension-model', api: 'extension-api' };
    const parentModelRegistry = ompParentModelRegistry(currentModel);
    const before = ompModelRegistrySnapshot(parentModelRegistry);
    const sdk = ompSdk(async () => { throw new Error('host startup failed'); }, { syncModelRegistry: true });

    await assert.rejects(
      dispatchRoleSession({
        stage: 'review',
        brief: 'Fail without changing the parent model registry.',
        cwd: repoRoot,
        repoRoot,
        currentModel,
        modelRegistry: parentModelRegistry,
        sdk,
      }),
      /host startup failed/,
    );

    assert.deepEqual(ompModelRegistrySnapshot(parentModelRegistry), before);
  });
});

test('parallel OMP creation uses independent model registries and leaves parent provider and auth state unchanged', async () => {
  await withRepo(async (repoRoot) => {
    const currentModel = { provider: 'extension-provider', id: 'extension-model', api: 'extension-api' };
    const parentModelRegistry = ompParentModelRegistry(currentModel);
    const before = ompModelRegistrySnapshot(parentModelRegistry);
    /** @type {any[]} */
    const childRegistries = [];
    /** @type {() => void} */
    let releaseCreations = () => {};
    const bothCreating = new Promise((resolve) => { releaseCreations = () => resolve(undefined); });
    const sdk = ompSdk(async (options) => {
      childRegistries.push(options.modelRegistry);
      if (childRegistries.length === 2) releaseCreations();
      await bothCreating;
      return {
        session: {
          model: currentModel,
          thinkingLevel: 'xhigh',
          getActiveToolNames: () => activeOmpTools(options),
          subscribe() {},
          async prompt() {},
          dispose() {},
        },
      };
    }, { syncModelRegistry: true });

    await Promise.all([
      dispatchRoleSession({
        stage: 'review',
        brief: 'First parallel review.',
        cwd: repoRoot,
        repoRoot,
        currentModel,
        modelRegistry: parentModelRegistry,
        sdk,
        generateAgentId: () => 'parallel-review-1',
      }),
      dispatchRoleSession({
        stage: 'review',
        brief: 'Second parallel review.',
        cwd: repoRoot,
        repoRoot,
        currentModel,
        modelRegistry: parentModelRegistry,
        sdk,
        generateAgentId: () => 'parallel-review-2',
      }),
    ]);

    assert.deepEqual(ompModelRegistrySnapshot(parentModelRegistry), before);
    assert.equal(new Set(childRegistries).size, 2);
    assert.equal(childRegistries.includes(parentModelRegistry), false);
  });
});

test('dispatchRoleSession fails before prompting when OMP widens the active tool set', async () => {
  await withRepo(async (repoRoot) => {
    let prompted = false;
    let disposed = false;
    const currentModel = { provider: 'openai', id: 'gpt-5.6' };

    await assert.rejects(
      dispatchRoleSession({
        stage: 'review',
        brief: 'Review without orchestration.',
        cwd: repoRoot,
        repoRoot,
        currentModel,
        modelRegistry: ompParentModelRegistry(currentModel),
        sdk: ompSdk(async () => ({
          session: {
            model: currentModel,
            thinkingLevel: 'xhigh',
            getActiveToolNames: () => ['read', 'grep', 'find', 'ls', 'task'],
            subscribe() {},
            async prompt() { prompted = true; },
            dispose() { disposed = true; },
          },
        })),
      }),
      /tool|isolation/i,
    );

    assert.equal(prompted, false);
    assert.equal(disposed, true);
  });
});

test('dispatchRoleSession fails closed when the child switches models', async () => {
  await withRepo(async (repoRoot) => {
    let disposed = false;
    const currentModel = { provider: 'openai', id: 'gpt-5.6' };
    const session = {
      model: currentModel,
      thinkingLevel: 'xhigh',
      subscribe() {},
      async prompt() { this.model = { provider: 'anthropic', id: 'fallback-model' }; },
      dispose() { disposed = true; },
    };

    await assert.rejects(
      dispatchRoleSession({
        stage: 'review',
        brief: 'Stay on the orchestrator model.',
        cwd: repoRoot,
        repoRoot,
        currentModel,
        sdk: { SessionManager: { inMemory: () => ({}) }, createAgentSession: async () => ({ session }) },
      }),
      /model|fallback/i,
    );

    assert.equal(disposed, true);
  });
});

test('dispatchRoleSession awaits host session disposal', async () => {
  await withRepo(async (repoRoot) => {
    let disposeAwaited = false;
    const currentModel = { provider: 'openai', id: 'gpt-5.6' };

    await dispatchRoleSession({
      stage: 'review',
      brief: 'Dispose the isolated child.',
      cwd: repoRoot,
      repoRoot,
      currentModel,
      sdk: {
        SessionManager: { inMemory: () => ({}) },
        createAgentSession: async () => ({
          session: {
            model: currentModel,
            thinkingLevel: 'xhigh',
            subscribe() {},
            async prompt() {},
            dispose: () => ({
              then(/** @type {() => void} */ resolve) {
                disposeAwaited = true;
                resolve();
              },
            }),
          },
        }),
      },
    });

    assert.equal(disposeAwaited, true);
  });
});

test('dispatchRoleSession refuses the removed test stage', async () => {
  await withRepo(async (repoRoot) => {
    await writeFile(join(repoRoot, 'agents', 'cook-test.md'), '---\nname: cook-test\neffort: medium\n---\nTest body.');
    const sdk = {
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: async () => ({
        session: { subscribe() {}, async prompt() {}, dispose() {} },
      }),
    };

    await assert.rejects(
      dispatchRoleSession({
        stage: 'test',
        brief: 'Encode tests.',
        cwd: repoRoot,
        repoRoot,
        currentModel: { provider: 'local', id: 'qwen-dev' },
        sdk,
      }),
      /unknown stage 'test'/,
    );
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
      currentModel: { provider: 'local', id: 'qwen-dev' },
      sdk,
      generateAgentId: () => '0011223344556677',
    });

    assert.equal(result.agent_id, '0011223344556677');
    assert.match(capturedPrompt, /You are the \*\*review\*\* station of the jeff brigade/);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test('bundled implement prompt documents both valid strict return outcomes', async () => {
  const role = await readFile(new URL('../../agents/cook-implement.md', import.meta.url), 'utf8');

  assert.match(role, /"result":"green"/);
  assert.match(role, /"result":"kickback"/);
  assert.match(role, /"kickback":\{"to":"plan","reason":"<reason>"\}/);
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
      currentModel: { provider: 'local', id: 'qwen-dev' },
      sdk,
      generateAgentId: () => '0123456789abcdef',
    });

    assert.equal(result.transcript, 'state transcript');
  });
});

test('dispatchRoleSession fails closed when the orchestrator model is unavailable', async () => {
  await withRepo(async (repoRoot) => {
    const sdk = {
      SessionManager: { inMemory: () => ({}) },
      createAgentSession: assert.fail,
    };

    await assert.rejects(
      dispatchRoleSession({
        stage: 'review',
        brief: 'Check the diff.',
        cwd: repoRoot,
        repoRoot,
        sdk,
        generateAgentId: () => 'fedcba9876543210',
      }),
      /orchestrator model/i,
    );
  });
});
