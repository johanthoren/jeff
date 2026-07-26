// @ts-check

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareInstalledSdkSession } from './pi-sdk-adapter.js';
import {
  getApprovedOperationBoundary as readApprovedOperationBoundary,
  getOperationApprovalBoundary as readOperationApprovalBoundary,
  getVerificationSeams as readVerificationSeams,
} from '../core/record.js';
import { canonicalizeOperationBatch, parseCanonicalOperationBatch } from '../core/operation-batch.js';
import { readConfig } from '../core/store.js';
import { queryVerificationState as runVerificationQuery } from '../core/verify-query.js';

export const STAGES = ['plan', 'implement', 'refactor', 'execute', 'review', 'verify', 'audit', 'refute'];

const READ_TOOLS = ['read', 'grep', 'find', 'ls'];
const COMMAND_TOOLS = [...READ_TOOLS, 'bash'];
const EDIT_TOOLS = [...COMMAND_TOOLS, 'edit', 'write'];
const PACKAGE_ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const OMP_SETTINGS = {
  'advisor.enabled': false,
  'advisor.subagents': false,
  'astEdit.enabled': false,
  'astGrep.enabled': false,
  'autolearn.enabled': false,
  'codexResets.autoRedeem': 'no',
  'compaction.remoteEnabled': false,
  'contextPromotion.enabled': false,
  'features.unexpectedStopDetection': false,
  'magicKeywords.enabled': false,
  'memory.backend': 'off',
  'modelRoles': {},
  'plan.enabled': false,
  'providers.anthropic.serverSideFallback': false,
  'retry.fallbackChains': {},
  'retry.modelFallback': false,
  'ttsr.enabled': false,
  'ttsr.builtinRules': false,
};

/**
 * @param {string} stage
 * @returns {string[]}
 */
function toolsForStage(stage, approvalGated = false) {
  if (stage === 'execute' && approvalGated) return READ_TOOLS;
  if (['plan', 'implement', 'refactor', 'execute'].includes(stage)) return EDIT_TOOLS;
  return READ_TOOLS;
}

const VerifyQueryParams = {
  type: 'object',
  required: ['kind'],
  additionalProperties: false,
  properties: {
    kind: {
      type: 'string',
      enum: ['git-head', 'git-status', 'git-ref', 'git-tree', 'git-object', 'https-get'],
      description: 'Fixed read-only query kind',
    },
    target: { type: 'string', description: 'Plan-named Git target' },
    url: { type: 'string', description: 'Plan-named HTTPS URL' },
  },
};

/**
 * @param {string} root
 * @param {string[]} verificationSeams
 * @param {(root: string, value: unknown, dependencies: { verificationSeams: string[] }) => Promise<{ command: string, output: string }>} queryVerificationState
 */
function createVerifyQueryTool(root, verificationSeams, queryVerificationState) {
  return {
    name: 'verify_query',
    label: 'Verify Query',
    description: 'Run one fixed read-only Git or HTTPS query named by the operation plan.',
    parameters: VerifyQueryParams,
    /**
     * @param {string} _toolCallId
     * @param {Record<string, unknown>} query
     */
    async execute(_toolCallId, query) {
      const evidence = await queryVerificationState(root, query, { verificationSeams });
      return {
        content: [{ type: 'text', text: JSON.stringify(evidence) }],
        details: evidence,
      };
    },
  };
}

const OperationApplyParams = {
  type: 'object',
  required: ['batch'],
  additionalProperties: false,
  properties: {
    batch: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['program', 'args'],
        additionalProperties: false,
        properties: {
          program: { type: 'string', minLength: 1 },
          args: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

/**
 * @param {string} root
 * @param {string} taskId
 * @param {string} approvalBoundary
 * @param {(root: string, taskId: string) => Promise<string>} getApprovedOperationBoundary
 * @param {(program: string, args: string[], options: Record<string, unknown>) => any} spawnOperation
 */
function createOperationApplyTool(
  root,
  taskId,
  approvalBoundary,
  getApprovedOperationBoundary,
  spawnOperation,
) {
  return {
    name: 'operation_apply',
    label: 'Operation Apply',
    description: 'Run the exact parent-approved argv batch from the completed operation plan.',
    parameters: OperationApplyParams,
    /** @param {string} _toolCallId @param {unknown} params */
    async execute(_toolCallId, params) {
      if (params === null || typeof params !== 'object' || Array.isArray(params)
        || Object.keys(params).length !== 1 || !Object.hasOwn(params, 'batch')) {
        throw new Error('[operation-apply] input must contain only batch');
      }
      const requested = canonicalizeOperationBatch(/** @type {Record<string, unknown>} */ (params).batch);
      const approved = await getApprovedOperationBoundary(root, taskId);
      if (requested.canonical !== approvalBoundary || approved !== approvalBoundary) {
        throw new Error('[operation-apply] batch does not match the plan, pending request, and parent grant');
      }
      const evidence = [];
      let ok = true;
      for (const action of requested.batch) {
        const result = spawnOperation(action.program, action.args, {
          cwd: root,
          encoding: 'utf8',
          shell: false,
        });
        const status = typeof result.status === 'number' ? result.status : null;
        evidence.push({
          command: JSON.stringify(action),
          output: JSON.stringify({
            status,
            signal: result.signal ?? null,
            stdout: typeof result.stdout === 'string' ? result.stdout : '',
            stderr: typeof result.stderr === 'string' ? result.stderr : '',
            ...(result.error ? { error: String(result.error.message ?? result.error) } : {}),
          }),
        });
        if (status !== 0 || result.error) {
          ok = false;
          break;
        }
      }
      const details = { ok, evidence };
      return {
        content: [{ type: 'text', text: JSON.stringify(details) }],
        details,
      };
    },
  };
}


/** @returns {string} */
export function generateAgentId() {
  return randomBytes(8).toString('hex');
}

/**
 * @param {string} raw
 * @returns {{ frontmatter: Record<string, string>, body: string }}
 */
export function parseRoleFile(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const frontmatter = /** @type {Record<string, string>} */ ({});
  if (!match) return { frontmatter, body: raw };

  for (const line of match[1].split('\n')) {
    const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (parts) frontmatter[parts[1]] = parts[2];
  }
  return { frontmatter, body: match[2].trim() };
}

/**
 * @param {{ stage: string, agentId: string, roleBody: string, brief: string, taskDir?: string }} opts
 * @returns {string}
 */
export function buildRolePrompt(opts) {
  const taskDirLine = opts.taskDir ? `Task directory: ${opts.taskDir}\n` : '';
  return [
    `stage: ${opts.stage}`,
    `agent_id: ${opts.agentId}`,
    '',
    opts.roleBody,
    '',
    '## Jeff dispatch brief',
    taskDirLine + opts.brief,
  ].join('\n');
}

/**
 * @param {unknown} session
 * @returns {string}
 */
function lastAssistantText(session) {
  const messages = /** @type {{ state?: { messages?: any[] } }} */ (session).state?.messages;
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    return message.content
      .filter((/** @type {any} */ part) => part.type === 'text')
      .map((/** @type {any} */ part) => part.text)
      .join('\n');
  }
  return '';
}

/**
 * @param {unknown} model
 * @returns {{ provider?: string, id?: string }}
 */
function modelParts(model) {
  if (!model || typeof model !== 'object') return {};
  const m = /** @type {{ provider?: unknown, id?: unknown }} */ (model);
  return {
    provider: typeof m.provider === 'string' ? m.provider : undefined,
    id: typeof m.id === 'string' ? m.id : undefined,
  };
}

/**
 * @param {unknown | undefined} injected
 * @param {string | undefined} [entry]
 * @param {(specifier: string) => Promise<any>} [importModule]
 * @returns {Promise<any>}
 */
export async function loadSdk(injected, entry = process.argv[1], importModule = (specifier) => import(specifier)) {
  if (injected) return injected;

  if (entry) {
    try {
      const distIndex = join(dirname(realpathSync(entry)), 'index.js');
      return await importModule(pathToFileURL(distIndex).href);
    } catch {
      // Fall back to normal package resolution below.
    }
  }
  return importModule('@earendil-works/pi-coding-agent');
}

/** @returns {any} */
function createDispatchAgentRegistry() {
  const refs = new Map();
  return {
    /** @param {any} ref */
    register(ref) { refs.set(ref.id, ref); return ref; },
    /** @param {string} id */
    get(id) { return refs.get(id); },
    /** @param {string} id */
    unregister(id) { refs.delete(id); },
    /** @param {string} id @param {any} session @param {string | null} sessionFile */
    attachSession(id, session, sessionFile) {
      const ref = refs.get(id);
      if (ref) Object.assign(ref, { session, sessionFile });
    },
  };
}

/** @param {string} provider @param {any} options @param {any} currentModel */
function hasExactProviderOptions(provider, options, currentModel) {
  return provider === currentModel.provider
    && options?.modelId === currentModel.id
    && (options.baseUrl === undefined || options.baseUrl === currentModel.baseUrl)
    && options.forceRefresh !== true;
}

/** @param {any} parentModelRegistry @param {any} currentModel @param {string} snapshotSessionId */
async function createChildAuthStorage(parentModelRegistry, currentModel, snapshotSessionId) {
  const exactModel = Object.freeze({
    provider: currentModel.provider,
    id: currentModel.id,
    baseUrl: currentModel.baseUrl,
  });
  const provider = exactModel.provider;
  const apiKey = await parentModelRegistry.getApiKey(currentModel, snapshotSessionId);
  const parentAuth = parentModelRegistry.authStorage;
  const hasOAuth = parentAuth.hasOAuth?.(provider) === true;
  const oauthIdentity = hasOAuth ? parentAuth.getOAuthAccountIdentity?.(provider, snapshotSessionId) : undefined;
  const identity = oauthIdentity && typeof oauthIdentity === 'object'
    ? Object.freeze(structuredClone(oauthIdentity))
    : oauthIdentity;
  const oauthAccountId = typeof identity?.accountId === 'string' ? identity.accountId : undefined;
  const getApiKey = async (/** @type {string} */ requestedProvider, /** @type {any} */ options = {}) => (
    hasExactProviderOptions(requestedProvider, options, exactModel) ? apiKey : undefined
  );

  return Object.freeze({
    close() {},
    fetchUsageReports: async () => null,
    getApiKey: (/** @type {string} */ requestedProvider, /** @type {string | undefined} */ _sessionId, /** @type {any} */ options) => (
      getApiKey(requestedProvider, options)
    ),
    getOAuthAccountId: (/** @type {string} */ requestedProvider) => requestedProvider === provider ? oauthAccountId : undefined,
    getOAuthAccountIdentity: (/** @type {string} */ requestedProvider) => requestedProvider === provider ? identity : undefined,
    hasAuth: (/** @type {string} */ requestedProvider) => requestedProvider === provider && apiKey !== undefined,
    hasOAuth: (/** @type {string} */ requestedProvider) => requestedProvider === provider && hasOAuth,
    ingestUsageHeaders: () => false,
    invalidateCredentialMatching: async () => false,
    invalidateUsageCache: async () => {},
    listResetCredits: async () => [],
    markUsageLimitReached: async () => ({ switched: false }),
    onCredentialDisabled: () => () => {},
    recordUsageCost: () => false,
    redeemResetCredit: async () => ({ ok: false, code: 'no_credit' }),
    reload: async () => {},
    remove: async () => {},
    removeCredential: async () => undefined,
    rotateSessionCredential: async () => false,
  });
}

/** @param {any} authStorage @param {any} currentModel */
function createExactModelRegistry(authStorage, currentModel) {
  const exactModel = Object.freeze({
    provider: currentModel.provider,
    id: currentModel.id,
    baseUrl: currentModel.baseUrl,
  });
  const noKey = async () => undefined;
  const isExactModel = (/** @type {any} */ model) => model === currentModel;
  const getApiKey = (/** @type {string} */ provider, /** @type {string | undefined} */ sessionId, /** @type {any} */ options = {}) => (
    hasExactProviderOptions(provider, options, exactModel)
      ? authStorage.getApiKey(provider, sessionId, {
          ...options,
          baseUrl: exactModel.baseUrl,
          modelId: exactModel.id,
        })
      : undefined
  );
  const resolver = (/** @type {string | undefined} */ sessionId) => async (/** @type {any} */ args = {}) => (
    args.error === undefined
      ? getApiKey(exactModel.provider, sessionId, { baseUrl: exactModel.baseUrl, modelId: exactModel.id })
      : undefined
  );

  return {
    authStorage,
    clearSourceRegistrations() {},
    find: (/** @type {string} */ provider, /** @type {string} */ id) => (
      provider === exactModel.provider && id === exactModel.id ? currentModel : undefined
    ),
    getAll: () => [currentModel],
    getApiKey: (/** @type {any} */ model, /** @type {string | undefined} */ sessionId) => (
      isExactModel(model)
        ? getApiKey(exactModel.provider, sessionId, { baseUrl: exactModel.baseUrl, modelId: exactModel.id })
        : undefined
    ),
    getApiKeyForProvider: getApiKey,
    getAvailable: () => authStorage.hasAuth(exactModel.provider) ? [currentModel] : [],
    getProviderBaseUrl: (/** @type {string} */ provider) => provider === exactModel.provider
      ? exactModel.baseUrl
      : undefined,
    getProviderHeaders: (/** @type {string} */ provider) => provider === exactModel.provider
      ? currentModel.headers
      : undefined,
    hasConfiguredAuth: (/** @type {any} */ model) => isExactModel(model) && authStorage.hasAuth(exactModel.provider),
    refreshRuntimeProviders: async () => {},
    refreshSelectedModelMetadata: async (/** @type {any} */ model) => {
      if (!isExactModel(model)) throw new Error('cook_dispatch: OMP requested alternate model metadata');
      return currentModel;
    },
    resolver(/** @type {any} */ model, /** @type {any} */ optionsOrSessionId) {
      if (typeof model === 'string') {
        return hasExactProviderOptions(model, optionsOrSessionId, exactModel)
          ? resolver(optionsOrSessionId.sessionId)
          : noKey;
      }
      return isExactModel(model) ? resolver(optionsOrSessionId) : noKey;
    },
    syncExtensionSources() {},
  };
}

/** @param {any} skill */
function isAllowedOmpSkill(skill) {
  const provider = skill?._source?.provider;
  if (provider === 'omp-managed' || provider === 'claude-plugins') return false;
  if (provider !== 'omp-plugins') return true;
  try {
    const relativePath = relative(PACKAGE_ROOT, realpathSync(skill.filePath));
    return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
  } catch {
    return false;
  }
}

/** @param {any} sdk */
async function loadOmpIsolation(sdk) {
  const [{ initializeWithSettings }, { applyProviderGlobalsFromSettings }] = await Promise.all([
    sdk.initializeWithSettings
      ? { initializeWithSettings: sdk.initializeWithSettings }
      // @ts-expect-error OMP rewrites this optional-peer subpath to its in-process discovery owner.
      : import('@earendil-works/pi-coding-agent/discovery'),
    sdk.applyProviderGlobalsFromSettings
      ? { applyProviderGlobalsFromSettings: sdk.applyProviderGlobalsFromSettings }
      // @ts-expect-error OMP rewrites this optional-peer subpath to its in-process provider owner.
      : import('@earendil-works/pi-coding-agent/config/provider-globals'),
  ]);
  return { initializeWithSettings, applyProviderGlobalsFromSettings };
}

/**
 * @param {any} sdk
 * @param {string} cwd
 * @param {string[]} tools
 * @param {string} agentId
 * @param {any} parentModelRegistry
 * @param {any} currentModel
 */
async function prepareOmpSession(sdk, cwd, tools, agentId, parentModelRegistry, currentModel) {
  const isolation = await loadOmpIsolation(sdk);
  const settings = sdk.createSubagentSettings(sdk.settings, OMP_SETTINGS);
  if (typeof parentModelRegistry?.getApiKey !== 'function' || !parentModelRegistry.authStorage) {
    throw new Error('cook_dispatch: OMP model registry is unavailable');
  }
  const modelRegistry = createExactModelRegistry(
    await createChildAuthStorage(parentModelRegistry, currentModel, agentId),
    currentModel,
  );
  const { skills } = await sdk.discoverSkills(cwd, undefined, {
    ...settings.getGroup('skills'),
    disabledExtensions: settings.get('disabledExtensions') ?? [],
  });
  const toolNames = tools
    .filter((name) => name !== 'ls')
    .map((name) => name === 'find' ? 'glob' : name);

  return {
    toolNames,
    sessionOptions: {
      toolNames,
      settings,
      disableExtensionDiscovery: true,
      preloadedCustomToolPaths: [],
      enableMCP: false,
      skills: skills.filter(isAllowedOmpSkill),
      rules: [],
      spawns: '',
      taskDepth: 1,
      parentTaskPrefix: agentId,
      agentId,
      agentRegistry: createDispatchAgentRegistry(),
      modelRegistry,
    },
    restoreGlobals() {
      isolation.initializeWithSettings(sdk.settings);
      isolation.applyProviderGlobalsFromSettings(sdk.settings);
    },
  };
}

/**
 * @param {{
 *   stage: string,
 *   brief: string,
 *   taskDir?: string,
 *   taskId?: string,
 *   cwd: string,
 *   repoRoot?: string,
 *   currentModel?: unknown,
 *   modelRegistry?: unknown,
 *   sdk?: unknown,
 *   generateAgentId?: () => string,
 *   getVerificationSeams?: typeof readVerificationSeams,
 *   queryVerificationState?: (root: string, value: unknown, dependencies: { verificationSeams: string[] }) => Promise<{ command: string, output: string }>,
 *   getOperationApprovalBoundary?: typeof readOperationApprovalBoundary,
 *   getApprovedOperationBoundary?: typeof readApprovedOperationBoundary,
 *   spawnOperation?: (program: string, args: string[], options: Record<string, unknown>) => any,
 * }} opts
 * @returns {Promise<{ agent_id: string, stage: string, brain: { provider: string | undefined, model: string | undefined, effort: string | undefined }, transcript: string }>}
 */
export async function dispatchRoleSession(opts) {
  if (!STAGES.includes(opts.stage)) throw new Error(`cook_dispatch: unknown stage '${opts.stage}'`);

  const repoRoot = opts.repoRoot ?? PACKAGE_ROOT;
  const rawRole = await readFile(join(repoRoot, 'agents', `cook-${opts.stage}.md`), 'utf8');
  const role = parseRoleFile(rawRole);
  const agentId = (opts.generateAgentId ?? generateAgentId)();
  const current = modelParts(opts.currentModel);
  if (!current.provider || !current.id) throw new Error('cook_dispatch: orchestrator model is unavailable');
  const sdk = await loadSdk(opts.sdk);
  let approvalBoundary = null;
  if (opts.stage === 'execute') {
    const config = await readConfig(opts.cwd);
    const resolveTrackedTask = opts.getOperationApprovalBoundary !== undefined || config?.active === true;
    const missingScopedTaskId = opts.taskDir !== undefined
      || opts.taskId !== undefined
      || opts.getOperationApprovalBoundary !== undefined;
    if (resolveTrackedTask && missingScopedTaskId
      && (typeof opts.taskId !== 'string' || opts.taskId.trim().length === 0)) {
      throw new Error('cook_dispatch: approval-gated operation execute requires a task id');
    }
    if (resolveTrackedTask && typeof opts.taskId === 'string' && opts.taskId.trim().length > 0) {
      approvalBoundary = await (opts.getOperationApprovalBoundary ?? readOperationApprovalBoundary)(
        opts.cwd,
        opts.taskId,
      );
      if (approvalBoundary !== null) {
        approvalBoundary = parseCanonicalOperationBatch(approvalBoundary).canonical;
      }
    }
  }
  const verificationSeams = opts.stage === 'verify' && opts.taskId
    ? await (opts.getVerificationSeams ?? readVerificationSeams)(opts.cwd, opts.taskId)
    : [];
  let customTools;
  if (opts.stage === 'verify') {
    customTools = [createVerifyQueryTool(
      opts.cwd,
      verificationSeams,
      opts.queryVerificationState ?? runVerificationQuery,
    )];
  } else if (opts.stage === 'execute' && approvalBoundary !== null && opts.taskId) {
    customTools = [createOperationApplyTool(
      opts.cwd,
      opts.taskId,
      approvalBoundary,
      opts.getApprovedOperationBoundary ?? readApprovedOperationBoundary,
      opts.spawnOperation ?? spawnSync,
    )];
  }
  const prompt = buildRolePrompt({
    stage: opts.stage,
    agentId,
    roleBody: role.body,
    brief: opts.brief,
    taskDir: opts.taskDir,
  });

  let streamed = '';
  let final = '';
  const sessionManager = sdk.SessionManager?.inMemory?.(opts.cwd);
  const tools = toolsForStage(opts.stage, approvalBoundary !== null);
  const omp = typeof sdk.createSubagentSettings === 'function'
    ? await prepareOmpSession(sdk, opts.cwd, tools, agentId, opts.modelRegistry, opts.currentModel)
    : undefined;
  const isolation = omp ?? await prepareInstalledSdkSession(sdk, {
    cwd: opts.cwd,
    packageRoot: PACKAGE_ROOT,
    tools,
    effort: role.frontmatter.effort,
    agentId,
    parentModelRegistry: opts.modelRegistry,
    currentModel: opts.currentModel,
  });
  /** @type {Record<string, any>} */
  const sessionOptions = {
    cwd: opts.cwd,
    model: opts.currentModel,
    thinkingLevel: role.frontmatter.effort,
    tools,
    sessionManager,
    modelRegistry: opts.modelRegistry,
    ...isolation?.sessionOptions,
  };
  if (customTools) sessionOptions.customTools = customTools;
  let created;
  try {
    created = await sdk.createAgentSession(sessionOptions);
  } finally {
    omp?.restoreGlobals();
  }
  const { session } = created;

  /** @type {{ provider?: string, id?: string }} */
  let actual = {};
  try {
    actual = modelParts(session.model ?? opts.currentModel);
    if (actual.provider !== current.provider || actual.id !== current.id) {
      throw new Error(`cook_dispatch: child model drifted from ${current.provider}/${current.id} to ${actual.provider ?? 'unknown'}/${actual.id ?? 'unknown'}`);
    }
    if (isolation) {
      const expectedTools = [
        ...isolation.toolNames,
        ...(customTools ?? []).map((tool) => tool.name),
      ];
      const active = session.getActiveToolNames?.();
      if (!Array.isArray(active) || active.length !== expectedTools.length || expectedTools.some((tool) => !active.includes(tool))) {
        const received = Array.isArray(active) ? active.join(', ') : 'unavailable';
        throw new Error(`cook_dispatch: child tool isolation failed (expected ${expectedTools.join(', ')}, got ${received})`);
      }
    }
    session.subscribe((/** @type {any} */ event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        streamed += event.assistantMessageEvent.delta;
      }
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        final = event.message.content
          .filter((/** @type {any} */ part) => part.type === 'text')
          .map((/** @type {any} */ part) => part.text)
          .join('\n');
      }
    });
    await session.prompt(prompt);
    actual = modelParts(session.model ?? opts.currentModel);
    if (actual.provider !== current.provider || actual.id !== current.id) {
      throw new Error(`cook_dispatch: child model drifted from ${current.provider}/${current.id} to ${actual.provider ?? 'unknown'}/${actual.id ?? 'unknown'}`);
    }
  } finally {
    await session.dispose();
  }

  return {
    agent_id: agentId,
    stage: opts.stage,
    brain: {
      provider: actual.provider,
      model: actual.id,
      effort: typeof session.thinkingLevel === 'string' ? session.thinkingLevel : role.frontmatter.effort,
    },
    transcript: (streamed || final || lastAssistantText(session)).trim(),
  };
}
