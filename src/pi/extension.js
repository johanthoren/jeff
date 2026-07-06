// @ts-check

import { dispatchRoleSession, STAGES } from './role-session.js';

/** @param {unknown} result */
export function formatDispatchResult(result) {
  return JSON.stringify(result, null, 2);
}

const DispatchParams = {
  type: 'object',
  required: ['stage', 'brief'],
  additionalProperties: false,
  properties: {
    stage: { type: 'string', enum: STAGES, description: 'jeff stage to dispatch' },
    brief: { type: 'string', description: 'Task-specific dispatch brief' },
    taskDir: { type: 'string', description: 'Optional .jeff task directory path' },
  },
};

/**
 * @param {any} pi
 */
export default function jeffExtension(pi) {
  pi.registerCommand('jeff-status', {
    description: 'Report that the jeff Pi package is active',
    /**
     * @param {string} _args
     * @param {any} ctx
     */
    handler: async (_args, ctx) => {
      ctx.ui.notify('jeff Pi package active', 'info');
    },
  });

  pi.registerTool({
    name: 'cook_dispatch',
    label: 'Cook Dispatch',
    description: 'Dispatch a jeff specialist in a fresh Pi role session.',
    promptSnippet: 'Dispatch a jeff plan, test, implement, refactor, review, audit, or refute role session.',
    parameters: DispatchParams,
    /**
     * @param {string} _toolCallId
     * @param {{ stage: string, brief: string, taskDir?: string }} params
     * @param {AbortSignal | undefined} _signal
     * @param {unknown} _onUpdate
     * @param {any} ctx
     */
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await dispatchRoleSession({
        stage: params.stage,
        brief: params.brief,
        taskDir: params.taskDir,
        cwd: ctx.cwd,
        currentModel: ctx.model,
        modelRegistry: ctx.modelRegistry,
      });

      return {
        content: [{ type: 'text', text: formatDispatchResult(result) }],
        details: result,
      };
    },
  });
}
