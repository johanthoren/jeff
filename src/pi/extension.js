// @ts-check

import { truncateToVisualLines } from '@earendil-works/pi-coding-agent';
import { readConfig } from '../core/store.js';
import { dispatchRoleSession as runRoleSession, STAGES } from './role-session.js';
import { recordSpecialistReturn } from '../core/record.js';
import { validateSpecialistReturn } from '../core/record-contract.js';

const DISPLAY_ITEM_LIMIT = 8;
const DISPLAY_TEXT_LIMIT = 96;
const DISPLAY_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Bidi_Control}]/u;

/** @param {string} value */
function makeWellFormed(value) {
  return value.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '\uFFFD');
}

/** @param {unknown} value */
function displayText(value) {
  if (typeof value !== 'string') return '';
  let text = '';
  let characterCount = 0;
  for (const character of value) {
    if (DISPLAY_CONTROL.test(character)) continue;
    text += makeWellFormed(character);
    characterCount += 1;
    if (characterCount === DISPLAY_TEXT_LIMIT) break;
  }
  return text;
}

/** @param {unknown} values */
function displayTexts(values) {
  return Array.isArray(values) ? values.slice(0, DISPLAY_ITEM_LIMIT).map(displayText) : [];
}

/** @param {Record<string, any>} result */
function displayProjection(result) {
  const stage = displayText(result.stage);
  const status = 'verdict' in result
    ? { verdict: displayText(result.verdict) }
    : { result: displayText(result.result) };

  switch (stage) {
    case 'plan':
      return {
        stage,
        ...status,
        ...(result.escalation ? {
          escalation: {
            fork: displayText(result.escalation.fork),
            options: displayTexts(result.escalation.options),
          },
        } : {}),
      };
    case 'implement':
      return {
        stage,
        ...status,
        ...(result.kickback ? {
          kickback: {
            to: displayText(result.kickback.to),
            reason: displayText(result.kickback.reason),
          },
        } : {}),
      };
    case 'refactor':
      return { stage, ...status, summary: displayTexts(result.summary) };
    case 'review':
    case 'audit':
      return {
        stage,
        ...status,
        findings: Array.isArray(result.findings)
          ? result.findings.slice(0, DISPLAY_ITEM_LIMIT).map((finding) => ({
              severity: displayText(finding.severity),
              class: displayText(finding.class),
              file: displayText(finding.file),
              line: Number.isInteger(finding.line) && finding.line > 0 ? finding.line : undefined,
              kickTo: displayText(finding.kickTo),
              what: displayText(finding.what),
              why: displayText(finding.why),
            }))
          : [],
      };
    case 'refute':
      return {
        stage,
        ...(result.source === undefined ? {} : { source: displayText(result.source) }),
        finding: displayText(result.finding),
        ...status,
        rationale: displayText(result.rationale),
      };
    default:
      return { stage, ...status };
  }
}

/** @param {unknown} result */
export function formatDispatchResult(result) {
  const record = result && typeof result === 'object' ? /** @type {Record<string, any>} */ (result) : {};
  return JSON.stringify(displayProjection(record), null, 2);
}

/** @param {number} width */
function safeWidth(width) {
  return Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
}

/**
 * @param {string} line
 * @param {number} width
 * @param {boolean} wrap
 */
function fitLine(line, width, wrap) {
  const max = safeWidth(width);
  if (max === 0) return [''];
  const lines = truncateToVisualLines(makeWellFormed(String(line)), Number.MAX_SAFE_INTEGER, max).visualLines;
  return wrap ? lines.filter((visualLine) => visualLine.trim()) : [lines[0] ?? ''];
}

/**
 * @param {string[]} lines
 * @param {{ wrap?: boolean }} [opts]
 * @returns {{ render(width: number): string[], invalidate(): void }}
 */
function textComponent(lines, opts = {}) {
  return {
    render(width) {
      return lines.flatMap((line) => fitLine(line, width, opts.wrap === true));
    },
    invalidate() {},
  };
}

/**
 * @param {unknown} result
 * @returns {Record<string, any>}
 */
function dispatchDetails(result) {
  if (!result || typeof result !== 'object') return {};
  const r = /** @type {{ details?: unknown, content?: unknown }} */ (result);
  if (r.details && typeof r.details === 'object') return displayProjection(/** @type {Record<string, any>} */ (r.details));
  if (!Array.isArray(r.content)) return {};
  const text = r.content.find((part) => part?.type === 'text' && typeof part.text === 'string')?.text;
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object'
      ? displayProjection(/** @type {Record<string, any>} */ (parsed))
      : {};
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, any>} details
 * @returns {string}
 */
function compactDispatchLine(details) {
  const stage = typeof details.stage === 'string' ? details.stage : 'cook_dispatch';
  const status = [details.verdict, details.result]
    .find((value) => typeof value === 'string' && value.trim()) || 'complete';

  if (stage === 'plan' && details.escalation) {
    return `${stage}: ${status} | ${details.escalation.fork} (${details.escalation.options.join(', ')})`;
  }
  if (stage === 'implement' && details.kickback) {
    return `${stage}: ${status} to ${details.kickback.to} | ${details.kickback.reason}`;
  }
  if (stage === 'refactor') {
    const summary = details.summary.join('; ');
    return summary ? `${stage}: ${status} | ${summary}` : `${stage}: ${status}`;
  }
  if (stage === 'refute') {
    return `${stage}: ${status} | ${details.rationale}`;
  }

  const findings = Array.isArray(details.findings) ? details.findings : [];
  const blocking = findings.filter((finding) => finding.class === 'blocking').length;
  const followUp = findings.filter((finding) => finding.class === 'follow-up').length;
  const counts = findings.length ? `blocking ${blocking}, follow-up ${followUp}` : status;
  const summary = findings
    .map((finding) => `${finding.file}:${finding.line} ${finding.what}`.trim())
    .filter(Boolean)
    .join('; ');
  return summary ? `${stage}: ${counts} | ${summary}` : `${stage}: ${counts}`;
}

/**
 * @param {unknown} result
 * @param {{ expanded?: boolean, isPartial?: boolean }} opts
 */
function renderDispatchResult(result, opts) {
  const details = dispatchDetails(result);
  const stage = typeof details.stage === 'string' ? details.stage : 'cook_dispatch';
  if (opts.isPartial) return textComponent([`${stage}: running`]);
  if (opts.expanded) return textComponent(JSON.stringify(details, null, 2).split('\n'), { wrap: true });
  return textComponent([compactDispatchLine(details)]);
}

/** @param {{ stage?: unknown }} args */
function renderDispatchCall(args) {
  const stage = typeof args.stage === 'string' ? args.stage : 'cook_dispatch';
  return textComponent([`${stage}: running`]);
}

/** @param {string} cwd */
async function assertActiveJeffProject(cwd) {
  const cfg = await readConfig(cwd);
  if (cfg?.active !== true) throw new Error(`cook_dispatch: inactive jeff project: ${cwd}`);
}

const DispatchParams = {
  type: 'object',
  required: ['stage', 'brief'],
  additionalProperties: false,
  properties: {
    stage: { type: 'string', enum: STAGES, description: 'jeff stage to dispatch' },
    brief: { type: 'string', description: 'Task-specific dispatch brief' },
    taskDir: { type: 'string', description: 'Optional .jeff task directory path' },
    taskId: { type: 'string', description: 'Optional task id whose specialist return is recorded' },
  },
};

/**
 * @param {any} pi
 * @param {{ dispatchRoleSession?: typeof runRoleSession }} [dependencies]
 */
export default function jeffExtension(pi, dependencies = {}) {
  const dispatchRoleSession = dependencies.dispatchRoleSession ?? runRoleSession;
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
    promptSnippet: 'Dispatch a jeff plan, implement, refactor, review, audit, or refute role session.',
    parameters: DispatchParams,
    renderCall: renderDispatchCall,
    renderResult: renderDispatchResult,
    /**
     * @param {string} _toolCallId
     * @param {{ stage: string, brief: string, taskDir?: string, taskId?: string }} params
     * @param {AbortSignal | undefined} _signal
     * @param {unknown} _onUpdate
     * @param {any} ctx
     */
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      await assertActiveJeffProject(ctx.cwd);
      const result = await dispatchRoleSession({
        stage: params.stage,
        brief: params.brief,
        taskDir: params.taskDir,
        cwd: ctx.cwd,
        currentModel: ctx.model,
        modelRegistry: ctx.modelRegistry,
        sdk: pi.pi,
      });

      let specialistReturn;
      try {
        specialistReturn = JSON.parse(result.transcript);
        validateSpecialistReturn(params.stage, specialistReturn);
      } catch {
        throw new Error('cook_dispatch: specialist return is invalid');
      }

      if (params.taskId) {
        try {
          await recordSpecialistReturn(ctx.cwd, params.stage, params.taskId, specialistReturn, result.agent_id);
        } catch {
          throw new Error('cook_dispatch: specialist return could not be recorded');
        }
      }

      const details = displayProjection(specialistReturn);
      return {
        content: [{ type: 'text', text: JSON.stringify(details, null, 2) }],
        details,
      };
    },
  });
}
