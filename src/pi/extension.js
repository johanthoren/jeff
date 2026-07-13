// @ts-check

import { readConfig } from '../core/store.js';
import { dispatchRoleSession as runRoleSession, STAGES } from './role-session.js';
import { recordSpecialistReturn } from '../core/record.js';

/** @param {unknown} result */
export function formatDispatchResult(result) {
  return JSON.stringify(result, null, 2);
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
  const text = String(line);
  if (!wrap) return [text.slice(0, max)];
  if (max === 0) return [''];

  const chunks = [];
  for (let i = 0; i < text.length; i += max) chunks.push(text.slice(i, i + max));
  return chunks.length ? chunks : [''];
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
  if (r.details && typeof r.details === 'object') return /** @type {Record<string, any>} */ (r.details);
  if (!Array.isArray(r.content)) return {};
  const text = r.content.find((part) => part?.type === 'text' && typeof part.text === 'string')?.text;
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** @typedef {{ severity?: string, file?: string, line?: number, summary?: string }} DisplayFinding */

/**
 * @param {unknown} finding
 * @returns {DisplayFinding | null}
 */
function normalizeDisplayFinding(finding) {
  if (!finding || typeof finding !== 'object') return null;
  const f = /** @type {Record<string, any>} */ (finding);
  const severity = (f.class === 'blocking' || f.class === 'follow-up') ? f.class : f.severity;
  if (severity !== 'blocking' && severity !== 'follow-up') return null;
  return { ...f, severity, summary: typeof f.what === 'string' ? f.what : f.summary };
}

/**
 * @param {unknown} transcript
 * @returns {DisplayFinding[]}
 */
function transcriptFindings(transcript) {
  if (typeof transcript !== 'string') return [];
  const lines = transcript.split('\n');
  const start = lines.findIndex((line) => /^\s*findings:\s*$/.test(line));
  if (start === -1) return [];

  /** @type {DisplayFinding[]} */
  const findings = [];
  /** @type {DisplayFinding | null} */
  let current = null;

  for (const line of lines.slice(start + 1)) {
    if (/^\S[^:]*:\s*/.test(line) || /^\s*```/.test(line)) break;

    const item = line.match(/^\s*-\s*(?:file:\s*(.+?)\s*)?$/);
    if (item) {
      if (current) findings.push(current);
      current = item[1] ? { file: item[1] } : {};
      continue;
    }

    const field = line.match(/^\s*(file|line|class|severity|what|summary):\s*(.+?)\s*$/);
    if (!field || !current) continue;
    const [, key, value] = field;
    if (key === 'line') current.line = Number(value);
    else if (key === 'file') current.file = value;
    else if (key === 'class' || key === 'severity') current.severity = value;
    else current.summary = value;
  }

  if (current) findings.push(current);
  return findings.filter((finding) => finding.severity === 'blocking' || finding.severity === 'follow-up');
}

/**
 * @param {Record<string, any>} details
 * @returns {DisplayFinding[]}
 */
function displayFindings(details) {
  if (!Array.isArray(details.findings)) return transcriptFindings(details.transcript);
  return details.findings.reduce((findings, finding) => {
    const display = normalizeDisplayFinding(finding);
    if (display) findings.push(display);
    return findings;
  }, /** @type {DisplayFinding[]} */ ([]));
}

/**
 * @param {Record<string, any>} details
 * @returns {string}
 */
function compactDispatchLine(details) {
  const stage = typeof details.stage === 'string' ? details.stage : 'cook_dispatch';
  const findings = displayFindings(details);
  const blocking = findings.filter((finding) => finding?.severity === 'blocking').length;
  const followUp = findings.filter((finding) => finding?.severity === 'follow-up').length;
  const counts = findings.length ? `blocking ${blocking}, follow-up ${followUp}` : '';
  const status = [details.status, details.verdict, details.outcome, details.result]
    .find((value) => typeof value === 'string' && value.trim()) || 'complete';
  const summary = findings
    .map((finding) => {
      const file = typeof finding?.file === 'string' ? finding.file : undefined;
      const line = typeof finding?.line === 'number' ? `:${finding.line}` : '';
      const text = typeof finding?.summary === 'string' ? finding.summary : '';
      return file ? `${file}${line} ${text}`.trim() : text;
    })
    .filter(Boolean)
    .join('; ');
  const headline = `${stage}: ${counts || status}`;
  return summary ? `${headline} | ${summary}` : headline;
}

/**
 * @param {unknown} result
 * @param {{ expanded?: boolean, isPartial?: boolean }} opts
 */
function renderDispatchResult(result, opts) {
  const details = dispatchDetails(result);
  const stage = typeof details.stage === 'string' ? details.stage : 'cook_dispatch';
  if (opts.isPartial) return textComponent([`${stage}: running`]);
  if (opts.expanded) return textComponent(formatDispatchResult(details).split('\n'), { wrap: true });
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
      });

      if (params.taskId) {
        let specialistReturn;
        try {
          specialistReturn = JSON.parse(result.transcript);
        } catch {
          throw new Error('cook_dispatch: specialist return is not strict JSON [record-json]');
        }
        await recordSpecialistReturn(ctx.cwd, params.stage, params.taskId, specialistReturn, result.agent_id);
      }

      return {
        content: [{ type: 'text', text: formatDispatchResult(result) }],
        details: result,
      };
    },
  });
}
