// @ts-check

import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STAGES = ['plan', 'implement', 'refactor', 'review', 'audit', 'refute'];

const READ_TOOLS = ['read', 'grep', 'find', 'ls'];
const EDIT_TOOLS = ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'];
const PACKAGE_ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const OMP_SETTINGS = {
  'advisor.enabled': false,
  'advisor.subagents': false,
  'astEdit.enabled': false,
  'astGrep.enabled': false,
  'autolearn.enabled': false,
  'magicKeywords.enabled': false,
  'memory.backend': 'off',
  'plan.enabled': false,
  'providers.anthropic.serverSideFallback': false,
  'retry.fallbackChains': {},
  'ttsr.enabled': false,
  'ttsr.builtinRules': false,
};

/**
 * @param {string} stage
 * @returns {string[]}
 */
function toolsForStage(stage) {
  if (stage === 'plan' || stage === 'implement' || stage === 'refactor') return EDIT_TOOLS;
  return READ_TOOLS;
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

/** @param {any} parentAuthStorage */
function createParentAuthView(parentAuthStorage) {
  const blockedWrites = new Set([
    'clearConfigApiKeys',
    'removeConfigApiKey',
    'setConfigApiKey',
    'setFallbackResolver',
  ]);
  return new Proxy(parentAuthStorage, {
    get(target, property) {
      if (typeof property === 'string' && blockedWrites.has(property)) return () => {};
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
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
 */
async function prepareOmpSession(sdk, cwd, tools, agentId, parentModelRegistry) {
  const isolation = await loadOmpIsolation(sdk);
  const settings = sdk.createSubagentSettings(sdk.settings, OMP_SETTINGS);
  if (typeof sdk.ModelRegistry !== 'function' || !parentModelRegistry?.authStorage) {
    throw new Error('cook_dispatch: OMP model registry is unavailable');
  }
  const modelRegistry = new sdk.ModelRegistry(createParentAuthView(parentModelRegistry.authStorage));
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
 *   cwd: string,
 *   repoRoot?: string,
 *   currentModel?: unknown,
 *   modelRegistry?: unknown,
 *   sdk?: unknown,
 *   generateAgentId?: () => string,
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
  const tools = toolsForStage(opts.stage);
  const omp = typeof sdk.createSubagentSettings === 'function'
    ? await prepareOmpSession(sdk, opts.cwd, tools, agentId, opts.modelRegistry)
    : undefined;
  const sessionOptions = {
    cwd: opts.cwd,
    model: opts.currentModel,
    thinkingLevel: role.frontmatter.effort,
    tools,
    sessionManager,
    modelRegistry: opts.modelRegistry,
    ...omp?.sessionOptions,
  };
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
    if (omp) {
      const active = session.getActiveToolNames?.();
      if (!Array.isArray(active) || active.length !== omp.toolNames.length || omp.toolNames.some((tool) => !active.includes(tool))) {
        const received = Array.isArray(active) ? active.join(', ') : 'unavailable';
        throw new Error(`cook_dispatch: OMP tool isolation failed (expected ${omp.toolNames.join(', ')}, got ${received})`);
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
