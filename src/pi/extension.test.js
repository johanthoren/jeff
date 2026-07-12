// @ts-check

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jeffExtension, { formatDispatchResult } from './extension.js';

/** @param {Record<string, unknown>} [dependencies] */
function registeredDispatchTool(dependencies) {
  const tools = new Map();
  /** @type {any} */ (jeffExtension)({
    registerCommand() {},
    /** @param {any} definition */
    registerTool(definition) { tools.set(definition.name, definition); },
  }, dependencies);
  return tools.get('cook_dispatch');
}

function completedDispatchResult(overrides = {}) {
  const details = {
    stage: 'review',
    agent_id: '0123456789abcdef',
    brain: { provider: 'anthropic', model: 'claude-opus-4-5', effort: 'xhigh' },
    transcript: 'RAW TRANSCRIPT BLOB',
    evidence: 'targeted evidence line',
    diff: 'diff --git a/src/pi/extension.js b/src/pi/extension.js',
    findings: [
      { severity: 'blocking', file: 'src/pi/extension.js', line: 12, summary: 'renderer returns raw JSON' },
      { severity: 'follow-up', file: 'src/pi/extension.test.js', line: 34, summary: 'add compact render guard' },
    ],
    ...overrides,
  };

  return {
    content: [{ type: 'text', text: formatDispatchResult(details) }],
    details,
  };
}

/**
 * @param {ReturnType<typeof completedDispatchResult>} result
 * @param {Record<string, unknown>} [options]
 * @param {number} [width]
 */
function renderDispatchLines(result, options = {}, width = 200) {
  const component = registeredDispatchTool().renderResult(
    result,
    { expanded: false, isPartial: false, ...options },
    {},
    {},
  );
  return component.render(width);
}

/**
 * @param {ReturnType<typeof completedDispatchResult>} result
 * @param {Record<string, unknown>} [options]
 * @param {number} [width]
 */
function renderDispatchResult(result, options = {}, width = 200) {
  return renderDispatchLines(result, options, width).join('\n');
}

test('package.json exposes the Pi extension and cook skill package paths', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));

  assert.deepEqual(pkg.pi, {
    extensions: ['./src/pi/extension.js'],
    skills: ['./skills'],
  });
});

test('formatDispatchResult exposes agent id, brain, and transcript to the parent model', () => {
  const text = formatDispatchResult({
    agent_id: '0123456789abcdef',
    stage: 'review',
    brain: { provider: 'anthropic', model: 'claude-opus-4-5', effort: 'xhigh' },
    transcript: 'SMOKE OK',
  });

  assert.match(text, /0123456789abcdef/);
  assert.match(text, /claude-opus-4-5/);
  assert.match(text, /SMOKE OK/);
});

test('extension registers /jeff-status and cook_dispatch', () => {
  const commands = new Map();
  const tools = new Map();
  const pi = {
    /**
     * @param {string} name
     * @param {any} definition
     */
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    /** @param {any} definition */
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
  };

  jeffExtension(pi);

  assert.equal(commands.has('jeff-status'), true);
  assert.equal(commands.get('jeff-status').description, 'Report that the jeff Pi package is active');
  assert.equal(tools.has('cook_dispatch'), true);
  assert.deepEqual(tools.get('cook_dispatch').parameters.required, ['stage', 'brief']);
  assert.deepEqual(tools.get('cook_dispatch').parameters.properties.stage.enum, [
    'plan', 'implement', 'refactor', 'review', 'audit', 'refute',
  ]);
});

test('completed cook_dispatch results render as compact feed rows', () => {
  const output = renderDispatchResult(completedDispatchResult());

  assert.match(output, /review/);
  assert.match(output, /blocking/i);
  assert.match(output, /follow-up/i);
});

test('collapsed cook_dispatch rows omit empty lines, raw JSON, transcripts, and metadata', () => {
  const output = renderDispatchResult(completedDispatchResult());

  assert.doesNotMatch(output, /\n\s*\n/);
  assert.doesNotMatch(output, /\{\s*"agent_id"/);
  assert.doesNotMatch(output, /RAW TRANSCRIPT BLOB/);
  assert.doesNotMatch(output, /0123456789abcdef|anthropic|claude-opus-4-5|xhigh/);
});

test('partial running cook_dispatch result renders one small active line', () => {
  const output = renderDispatchResult(completedDispatchResult({ stage: 'implement' }), { isPartial: true });

  assert.equal(output.split('\n').filter(Boolean).length, 1);
  assert.match(output, /implement/i);
  assert.match(output, /running|active|working/i);
});

test('expanded cook_dispatch rendering includes metadata transcript evidence and diffs', () => {
  const collapsed = renderDispatchResult(completedDispatchResult());
  const expanded = renderDispatchResult(completedDispatchResult(), { expanded: true });

  assert.notEqual(expanded, collapsed);
  assert.match(expanded, /0123456789abcdef/);
  assert.match(expanded, /RAW TRANSCRIPT BLOB/);
  assert.match(expanded, /targeted evidence line/);
  assert.match(expanded, /diff --git/);
});

test('review and audit findings render counts and file-line summaries', () => {
  const output = renderDispatchResult(completedDispatchResult({ stage: 'audit' }));

  assert.match(output, /blocking\D+1/i);
  assert.match(output, /follow-up\D+1/i);
  assert.match(output, /src\/pi\/extension\.js:12.*renderer returns raw JSON/);
  assert.match(output, /src\/pi\/extension\.test\.js:34.*add compact render guard/);
});

test('collapsed cook_dispatch rows count structured findings by class and show what', () => {
  const output = renderDispatchResult(completedDispatchResult({
    findings: [
      { severity: 'high', class: 'blocking', file: 'src/pi/extension.js', line: 12, what: 'renderer counts severity' },
      { severity: 'medium', class: 'follow-up', file: 'src/pi/extension.test.js', line: 34, what: 'renderer hides what' },
    ],
  }));

  assert.match(output, /blocking\D+1/i);
  assert.match(output, /follow-up\D+1/i);
  assert.match(output, /src\/pi\/extension\.js:12.*renderer counts severity/);
  assert.match(output, /src\/pi\/extension\.test\.js:34.*renderer hides what/);
});

test('collapsed cook_dispatch rows summarize findings embedded in yaml transcript', () => {
  const output = renderDispatchResult(completedDispatchResult({
    findings: undefined,
    transcript: `\`\`\`yaml
stage: review
verdict: needs-work
findings:
  - file: src/pi/role-session.js
    line: 13
    class: blocking
    what: judgment stages can run bash
  - file: tests/parity-cook.sh
    line: 37
    class: follow-up
    what: shellcheck style
\`\`\``,
  }));

  assert.match(output, /blocking\D+1/i);
  assert.match(output, /follow-up\D+1/i);
  assert.match(output, /src\/pi\/role-session\.js:13.*judgment stages can run bash/);
  assert.match(output, /tests\/parity-cook\.sh:37.*shellcheck style/);
  assert.doesNotMatch(output, /0123456789abcdef|anthropic|claude-opus-4-5|xhigh/);
  assert.doesNotMatch(output, /```yaml|transcript|RAW TRANSCRIPT BLOB/);
});

test('cook_dispatch renderCall shows the requested running stage compactly', () => {
  const tool = registeredDispatchTool();

  assert.equal(typeof tool.renderCall, 'function');
  const component = tool.renderCall(
    { stage: 'review', brief: 'read every file and report a long detailed verdict' },
    {},
    { isPartial: true },
  );
  const output = component.render(40).join('\n');

  assert.equal(output.split('\n').filter(Boolean).length, 1);
  assert.match(output, /review/i);
  assert.match(output, /running|active|working/i);
  assert.doesNotMatch(output, /read every file|long detailed verdict/);
});

test('cook_dispatch custom renderers keep every line within the requested width', () => {
  const result = completedDispatchResult({
    transcript: `RAW TRANSCRIPT BLOB ${'x'.repeat(120)}`,
    findings: [
      {
        severity: 'blocking',
        file: 'src/pi/extension.js',
        line: 12,
        summary: `renderer returns ${'x'.repeat(120)}`,
      },
    ],
  });
  const tool = registeredDispatchTool();

  for (const line of renderDispatchLines(result, {}, 32)) assert.ok(line.length <= 32);
  for (const line of renderDispatchLines(result, { expanded: true }, 32)) assert.ok(line.length <= 32);
  for (const line of renderDispatchLines(result, { isPartial: true }, 10)) assert.ok(line.length <= 10);
  for (const line of tool.renderCall({ stage: 'review', brief: 'x'.repeat(120) }, {}, {}).render(10)) {
    assert.ok(line.length <= 10);
  }
});

test('empty transcript renders useful compact output instead of an empty box', () => {
  const output = renderDispatchResult(completedDispatchResult({ transcript: '', findings: [] }));

  assert.match(output, /review/);
  assert.doesNotMatch(output, /RAW TRANSCRIPT BLOB|^\s*$/);
});

test('cook_dispatch refuses inactive projects before starting a role session', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'jeff-pi-inactive-'));
  try {
    const tools = new Map();
    jeffExtension({
      registerCommand() {},
      /** @param {any} definition */
      registerTool(definition) { tools.set(definition.name, definition); },
    });

    await assert.rejects(
      () => tools.get('cook_dispatch').execute('call-1', { stage: 'review', brief: 'x' }, undefined, undefined, { cwd }),
      /inactive jeff project/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('cook_dispatch taskId persists the specialist result through the shared record service', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'jeff-pi-record-'));
  const taskDir = join(cwd, '.jeff', 'tasks', '018-record-specialists');
  try {
    await mkdir(taskDir, { recursive: true });
    await writeFile(join(cwd, '.jeff', 'config.json'), JSON.stringify({ active: true, mode: 'lite' }), 'utf8');
    await writeFile(join(taskDir, 'task.json'), `${JSON.stringify({
      schemaVersion: 1,
      id: '18',
      slug: 'record-specialists',
      title: 'Record specialists',
      status: 'in_progress',
      stage: 'plan',
      priority: 'p2',
      deps: [],
      complexity: 'simple',
      createdAt: '2026-07-12T00:00:00Z',
      updatedAt: '2026-07-12T00:00:00Z',
      agents: { implementer_agent_id: null, reviewer_agent_id: null, reviewer2_agent_id: null, audit_agent_id: null },
      tests: { authored_by_agent_id: null, green: false, evidence: [] },
      review: { verdict: null, reviewer_agent_id: null, findings: [], evidence: [] },
      audit: { required: false, verdict: 'na', audit_agent_id: null, findings: [], evidence: [] },
      commits: [],
      kickbacks: [],
      convergence: {
        cap: 2,
        stages: { review: { blockingKickbacks: 0 }, audit: { blockingKickbacks: 0 } },
        council: { convened: false, stage: null, members: [], findings: [], verdict: null, outcome: null },
      },
      blockedReason: null,
      abandonReason: null,
    }, null, 2)}\n`, 'utf8');
    const transcript = JSON.stringify({
      result: 'red',
      complexity: 'complex',
      auditRequired: true,
      slices: ['Record one specialist result'],
      testFiles: ['src/pi/extension.test.js'],
      redRun: { command: 'node --test src/pi/extension.test.js', output: 'missing persistence' },
      escalation: null,
    });
    let dispatched = false;
    const tool = registeredDispatchTool({
      dispatchRoleSession: async () => {
        dispatched = true;
        return {
        stage: 'plan',
        agent_id: 'pi-plan-agent',
        brain: { provider: 'local', model: 'test-model', effort: 'xhigh' },
        transcript,
        };
      },
    });

    let dispatchError;
    try {
      await tool.execute(
        'call-1',
        { stage: 'plan', brief: 'Plan task 18.', taskId: '18' },
        undefined,
        undefined,
        { cwd, model: { provider: 'local', id: 'test-model' }, modelRegistry: {} },
      );
    } catch (error) {
      dispatchError = error;
    }
    assert.equal(dispatched, true, `Pi adapter bypassed its role-session boundary: ${dispatchError}`);
    if (dispatchError) throw dispatchError;
    const task = JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf8'));

    assert.equal(task.tests.authored_by_agent_id, 'pi-plan-agent');
    assert.equal(task.complexity, 'complex');
    assert.equal(task.audit.required, true);
    assert.equal(task.stage, 'implement');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
