// @ts-check

import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/** @param {string} packageRoot @param {string | undefined} filePath */
function isBundledSkill(packageRoot, filePath) {
  if (!filePath) return false;
  try {
    const rel = relative(packageRoot, realpathSync(filePath));
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  } catch {
    return false;
  }
}

/** @param {any} parentModelRegistry @param {any} model @param {string} agentId */
async function createCredentialStore(parentModelRegistry, model, agentId) {
  if (typeof parentModelRegistry?.getApiKey !== 'function') {
    throw new Error('cook_dispatch: OMP model registry is unavailable');
  }
  const apiKey = await parentModelRegistry.getApiKey(model, agentId);
  if (typeof apiKey !== 'string' || apiKey === '') {
    throw new Error(`cook_dispatch: OMP authentication is unavailable for ${model.provider}/${model.id}`);
  }
  const oauth = parentModelRegistry.authStorage?.hasOAuth?.(model.provider) === true;
  const credential = Object.freeze(oauth
    ? { type: 'oauth', access: apiKey, refresh: '', expires: 253402300799000 }
    : { type: 'api_key', key: apiKey });
  return Object.freeze({
    read: async (/** @type {string} */ provider) => provider === model.provider ? credential : undefined,
    list: async () => [{ providerId: model.provider, type: credential.type }],
    modify: async (/** @type {string} */ provider, /** @type {(value: any) => Promise<any>} */ update) => {
      if (provider !== model.provider) return undefined;
      await update(credential);
      return credential;
    },
    delete: async () => {},
  });
}

/**
 * Adapt the installed public Pi SDK to the OMP child contract without using
 * independent auth, settings, resource discovery, or model state.
 *
 * @param {any} sdk
 * @param {{ cwd: string, packageRoot: string, tools: string[], effort: string | undefined, agentId: string, parentModelRegistry: any, currentModel: any }} opts
 */
export async function prepareInstalledSdkSession(sdk, opts) {
  if (typeof sdk.ModelRuntime?.create !== 'function'
    || typeof sdk.SettingsManager?.inMemory !== 'function'
    || typeof sdk.DefaultResourceLoader !== 'function') {
    return undefined;
  }

  const settingsManager = sdk.SettingsManager.inMemory({
    defaultProvider: opts.currentModel.provider,
    defaultModel: opts.currentModel.id,
    defaultThinkingLevel: opts.effort,
    enabledModels: [`${opts.currentModel.provider}/${opts.currentModel.id}`],
    compaction: { enabled: false },
    retry: { enabled: false, maxRetries: 0 },
    packages: [],
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  });
  const modelRuntime = await sdk.ModelRuntime.create({
    credentials: await createCredentialStore(opts.parentModelRegistry, opts.currentModel, opts.agentId),
    modelsStore: {
      read: async (/** @type {string} */ provider) => provider === opts.currentModel.provider
        ? { models: [opts.currentModel] }
        : undefined,
      write: async () => {},
      delete: async () => {},
    },
    allowModelNetwork: false,
  });
  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd: opts.cwd,
    agentDir: opts.packageRoot,
    settingsManager,
    additionalSkillPaths: [join(opts.packageRoot, 'skills')],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    skillsOverride: (/** @type {{ skills: any[], diagnostics: any[] }} */ result) => ({
      ...result,
      skills: result.skills.filter((skill) => isBundledSkill(opts.packageRoot, skill.filePath)),
    }),
  });
  await resourceLoader.reload();

  return {
    toolNames: opts.tools,
    sessionOptions: {
      modelRuntime,
      resourceLoader,
      settingsManager,
      scopedModels: [{ model: opts.currentModel, thinkingLevel: opts.effort }],
      noTools: 'all',
    },
  };
}
