// @ts-check

import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STAGES = ['plan', 'test', 'implement', 'refactor', 'review', 'audit', 'refute'];

const READ_TOOLS = ['read', 'grep', 'find', 'ls'];
const EDIT_TOOLS = ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'];
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @param {string} stage
 * @returns {string[]}
 */
function toolsForStage(stage) {
  if (stage === 'plan') return READ_TOOLS;
  if (stage === 'test' || stage === 'implement' || stage === 'refactor') return EDIT_TOOLS;
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
  const model = current.provider || current.id ? opts.currentModel : undefined;
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
  const { session } = await sdk.createAgentSession({
    cwd: opts.cwd,
    model,
    thinkingLevel: role.frontmatter.effort,
    tools: toolsForStage(opts.stage),
    sessionManager,
    modelRegistry: opts.modelRegistry,
  });

  try {
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
  } finally {
    session.dispose();
  }

  return {
    agent_id: agentId,
    stage: opts.stage,
    brain: { provider: current.provider, model: current.id, effort: role.frontmatter.effort },
    transcript: (streamed || final).trim(),
  };
}
