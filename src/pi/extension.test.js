// @ts-check

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { truncateToVisualLines } from '@earendil-works/pi-coding-agent';
import jeffExtension, { formatDispatchResult } from './extension.js';

/**
 * @param {Record<string, unknown>} [dependencies]
 * @param {unknown} [hostSdk]
 */
function registeredTools(dependencies, hostSdk) {
  const tools = new Map();
  /** @type {any} */ (jeffExtension)({
    pi: hostSdk,
    registerCommand() {},
    /** @param {any} definition */
    registerTool(definition) { tools.set(definition.name, definition); },
  }, dependencies);
  return tools;
}

/**
 * @param {Record<string, unknown>} [dependencies]
 * @param {unknown} [hostSdk]
 */
function registeredDispatchTool(dependencies, hostSdk) {
  return registeredTools(dependencies, hostSdk).get('cook_dispatch');
}

const AUDIT_CATEGORIES = [
  'secrets',
  'injection_sql',
  'injection_command',
  'path_traversal',
  'insecure_deserialization',
  'weak_crypto',
  'dynamic_execution',
  'tls_transport',
  'xss',
  'sensitive_logging',
  'insecure_permissions',
];

/** @param {string} stage @param {Record<string, any>} [overrides] */
function specialistReturn(stage, overrides = {}) {
  /** @type {Record<string, Record<string, any>>} */
  const returns = {
    plan: {
      stage: 'plan', result: 'red', complexity: 'complex', auditRequired: true,
      refactorOpportunity: null,
      slices: ['Project the return'], testFiles: ['src/pi/extension.test.js'],
      redRun: { command: 'node --test src/pi/extension.test.js', output: 'missing projection' }, escalation: null,
    },
    implement: {
      stage: 'implement', result: 'green', files: ['src/pi/extension.js'],
      greenRun: { command: 'node --test src/pi/extension.test.js', output: 'pass' }, kickback: null,
    },
    execute: {
      stage: 'execute',
      result: 'approval-required',
      actions: ['Captured recoverable state.'],
      evidence: [{ command: 'inspect source state', output: 'recovery snapshot recorded' }],
      kickback: null,
      approvalRequired: 'Rewrite the exact shared registry entry.',
    },
    verify: {
      stage: 'verify',
      cycle: 0,
      verdict: 'pass',
      postconditions: [{
        postcondition: 'The registry has one destination entry.',
        ok: true,
        evidence: 'source absent; destination present once',
      }],
      findings: [],
      evidence: [{ command: 'inspect registry', output: 'postconditions satisfied' }],
    },
    refactor: {
      stage: 'refactor', result: 'clean', files: [], outsideDiff: [],
      greenRun: { command: 'node --test src/pi/extension.test.js', output: 'pass' }, summary: ['Kept one projection'],
    },
    review: {
      stage: 'review', cycle: 0, verdict: 'needs-work',
      acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: true }],
      findings: [
        {
          severity: 'high', class: 'blocking', file: 'src/pi/extension.js', line: 12,
          kickTo: 'implement', what: 'renderer returns raw JSON', why: 'execution metadata reaches consumers',
        },
        {
          severity: 'low', class: 'follow-up', file: 'src/pi/extension.test.js', line: 34,
          kickTo: 'plan', what: 'add compact render guard', why: 'the compact form should stay useful',
        },
      ],
      evidence: [{ command: 'node --test src/pi/extension.test.js', output: 'failed' }],
    },
    audit: {
      stage: 'audit', cycle: 0, verdict: 'needs-work',
      scan: { command: 'cook scan', recommendation: 'BLOCK', reportPath: '.jeff/scan.json' },
      coverage: AUDIT_CATEGORIES.map((category) => ({ category, status: 'covered_no_hits' })),
      findings: [{
        severity: 'high', class: 'blocking', cwe: 'CWE-200', file: 'src/pi/extension.js', line: 247,
        kickTo: 'implement', what: 'private child data is displayed', why: 'the raw result crosses the trust boundary',
      }],
      evidence: [{ command: 'node --test src/pi/extension.test.js', output: 'failed' }],
    },
    refute: {
      stage: 'refute', cycle: 0, source: 'review',
      finding: 'src/pi/extension.js:247 raw result', verdict: 'survives',
      rationale: 'The raw return is reachable by the parent model.',
      evidence: [{ command: 'read src/pi/extension.js', output: 'raw result returned' }],
    },
  };
  return { ...returns[stage], ...overrides };
}

/**
 * @param {Record<string, any>} returned
 * @param {string} marker
 * @returns {Record<string, any>}
 */
function markPrivateReturnFields(returned, marker) {
  const common = returned;
  switch (returned.stage) {
    case 'plan':
      return { ...common, slices: [marker], testFiles: [marker], redRun: { command: marker, output: marker } };
    case 'implement':
      return { ...common, files: [marker], greenRun: { command: marker, output: marker } };
    case 'execute':
      return {
        ...common,
        actions: [marker],
        evidence: [{ command: marker, output: marker }],
      };
    case 'verify':
      return {
        ...common,
        postconditions: [{ ...returned.postconditions[0], evidence: marker }],
        evidence: [{ command: marker, output: marker }],
      };
    case 'refactor':
      return {
        ...common,
        files: [marker],
        outsideDiff: [marker],
        greenRun: { command: marker, output: marker },
      };
    case 'review':
      return {
        ...common,
        acLedger: [{ ac: marker, claimed: 'write', rederived: 'write', ok: true }],
        evidence: [{ command: marker, output: marker }],
      };
    case 'audit':
      return {
        ...common,
        scan: { ...returned.scan, command: marker, reportPath: marker },
        findings: returned.findings.map((/** @type {Record<string, any>} */ finding) => ({ ...finding, cwe: marker })),
        evidence: [{ command: marker, output: marker }],
      };
    case 'refute':
      return { ...common, evidence: [{ command: marker, output: marker }] };
    default:
      return common;
  }
}

/** @param {Record<string, any>} [overrides] */
function completedDispatchResult(overrides = {}) {
  const raw = specialistReturn('review', overrides);
  const details = JSON.parse(formatDispatchResult(raw));
  return { content: [{ type: 'text', text: formatDispatchResult(raw) }], details };
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

/** @param {string[]} lines @param {number} width */
function assertFitsPiWidth(lines, width) {
  for (const line of lines) {
    assert.doesNotThrow(() => encodeURIComponent(line));
    assert.doesNotMatch(line, /\uFFFD/u);
    assert.equal(
      truncateToVisualLines(line, Number.MAX_SAFE_INTEGER, width).visualLines.length,
      1,
    );
  }
}

test('package.json exposes the Pi extension and cook skill package paths', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));

  assert.deepEqual(pkg.pi, {
    extensions: ['./src/pi/extension.js'],
    skills: ['./skills'],
  });
});

test('formatDispatchResult exposes only the closed display projection to the parent model', () => {
  const text = formatDispatchResult({
    ...specialistReturn('review'),
    brain: { provider: 'MARKER_PROVIDER', model: 'MARKER_MODEL', effort: 'MARKER_EFFORT' },
    transcript: 'MARKER_TRANSCRIPT',
    unknown: 'MARKER_UNKNOWN',
  });
  const display = JSON.parse(text);

  assert.deepEqual(Object.keys(display).sort(), ['findings', 'stage', 'verdict']);
  assert.deepEqual(Object.keys(display.findings[0]).sort(), [
    'class', 'file', 'kickTo', 'line', 'severity', 'what', 'why',
  ]);
  assert.match(text, /renderer returns raw JSON|execution metadata reaches consumers/);
  assert.doesNotMatch(text, /review-agent|MARKER_/);
});

test('issue 95 plan projection exposes a named refactor opportunity', () => {
  const opportunity = 'Delete the superseded transition helper.';
  const display = JSON.parse(formatDispatchResult(specialistReturn('plan', {
    refactorOpportunity: opportunity,
  })));

  assert.equal(display.refactorOpportunity, opportunity);
});

test('issue 105 and issue 237 extension registers every host dispatch stage', () => {
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
    'plan', 'implement', 'refactor', 'execute', 'review', 'verify', 'audit', 'refute', 'council',
    'council-synthesis',
  ]);
  assert.deepEqual([...tools.keys()], ['cook_dispatch']);
});

test('issue 107 compact and issue 109 expanded Pi approval displays are exact and terminal-safe', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'jeff-pi-approval-projection-'));
  const approvalBoundary = 'Rewrite with newline \n, ESC \u001b, C1 \u0085, separator \u2028, Bidi \u202e, and lone surrogate \uD800 exactly.';
  const safeApprovalLiteral = '"Rewrite with newline \\n, ESC \\u001b, C1 \\u0085, separator \\u2028, Bidi \\u202e, and lone surrogate \\ud800 exactly."';
  try {
    await mkdir(join(cwd, '.jeff'));
    await writeFile(join(cwd, '.jeff', 'config.json'), JSON.stringify({ active: true, mode: 'lite' }), 'utf8');
    const returned = specialistReturn('execute', { approvalRequired: approvalBoundary });
    const tool = registeredDispatchTool({
      dispatchRoleSession: async () => ({
        stage: 'execute',
        agent_id: 'execute-host-agent',
        brain: { provider: 'local', model: 'test-model', effort: 'high' },
        transcript: JSON.stringify(returned),
      }),
    });
    const result = await tool.execute(
      'call-approval',
      { stage: 'execute', brief: 'Return the exact approval request.' },
      undefined,
      undefined,
      { cwd, model: { provider: 'local', id: 'test-model' }, modelRegistry: {} },
    );

    const contentBytes = JSON.stringify(result.content);
    const parentDetailsBytes = JSON.stringify(result.details);
    const expandedPrefix = '  "approvalRequired": ';
    const expandedLines = renderDispatchLines(result, { expanded: true });
    const expanded = expandedLines.join('\n');
    const expandedApprovalLines = expandedLines.filter((/** @type {string} */ line) => line.startsWith(expandedPrefix));

    assert.equal(result.details.approvalRequired, approvalBoundary);
    assert.equal(JSON.parse(result.content[0].text).approvalRequired, approvalBoundary);
    assert.deepEqual(
      expandedApprovalLines.map((/** @type {string} */ line) => line.trimEnd()),
      [`${expandedPrefix}${safeApprovalLiteral}`],
    );
    const expandedApprovalLiteral = expandedApprovalLines[0].trimEnd().slice(expandedPrefix.length);
    assert.equal(JSON.parse(expandedApprovalLiteral), approvalBoundary);
    assert.equal(JSON.parse(expanded).approvalRequired, approvalBoundary);
    assert.doesNotMatch(
      expandedApprovalLines[0],
      /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Bidi_Control}]/u,
    );
    assert.doesNotThrow(() => encodeURIComponent(expandedApprovalLines[0]));
    assert.equal(JSON.stringify(result.content), contentBytes);
    assert.equal(JSON.stringify(result.details), parentDetailsBytes);

    const compact = renderDispatchResult(result).trimEnd();
    const separator = compact.indexOf(' | ');
    assert.notEqual(separator, -1);
    const visibleApproval = compact.slice(separator + 3);
    assert.equal(visibleApproval, safeApprovalLiteral);
    assert.equal(JSON.parse(visibleApproval), approvalBoundary);
    assert.equal(compact.split('\n').length, 1);
    assert.doesNotMatch(compact, /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Bidi_Control}]/u);
    assert.doesNotThrow(() => encodeURIComponent(compact));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('cook_dispatch parses and projects every specialist result across model and TUI surfaces', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'jeff-pi-display-'));
  try {
    await mkdir(join(cwd, '.jeff'));
    await writeFile(join(cwd, '.jeff', 'config.json'), JSON.stringify({ active: true, mode: 'lite' }), 'utf8');
    /** @type {[string, Record<string, any>, string, string[], string[]][]} */
    const cases = [
      ['routine success', specialistReturn('implement'), 'green', ['implement', 'green'], ['result', 'stage']],
      ['plan escalation', specialistReturn('plan', {
        result: 'escalation',
        redRun: { command: null, output: 'Chef decision required' },
        escalation: { fork: 'Choose storage', options: ['disk', 'database'] },
      }), 'Choose storage', ['plan', 'escalation', 'Choose storage', 'disk', 'database'], [
        'escalation', 'result', 'stage',
      ]],
      ['implement kickback', specialistReturn('implement', {
        result: 'kickback', files: [],
        greenRun: { command: null, output: 'Tests overfit the implementation' },
        kickback: { to: 'plan', reason: 'Tests overfit the implementation' },
      }), 'Tests overfit', ['implement', 'kickback', 'plan', 'Tests overfit'], ['kickback', 'result', 'stage']],
      ['execute approval stop', specialistReturn('execute'), 'Rewrite the exact shared registry entry', [
        'execute', 'approval-required', 'Rewrite the exact shared registry entry',
      ], ['approvalRequired', 'result', 'stage']],
      ['operation verification', specialistReturn('verify'), 'pass', [
        'verify', 'pass',
      ], ['findings', 'stage', 'verdict']],
      ['refactor summary', specialistReturn('refactor'), 'Kept one projection', [
        'refactor', 'clean', 'Kept one projection',
      ], ['result', 'stage', 'summary']],
      ['review findings', specialistReturn('review'), 'renderer returns raw JSON', [
        'review', 'needs-work', 'high', 'blocking', 'src/pi/extension.js', '12', 'implement',
        'renderer returns raw JSON', 'execution metadata reaches consumers',
      ], ['findings', 'stage', 'verdict']],
      ['audit findings', specialistReturn('audit'), 'private child data is displayed', [
        'audit', 'needs-work', 'high', 'blocking', 'src/pi/extension.js', '247', 'implement',
        'private child data is displayed', 'raw result crosses the trust boundary',
      ], ['findings', 'stage', 'verdict']],
      ['refute survives', specialistReturn('refute'), 'raw return is reachable', [
        'refute', 'review', 'src/pi/extension.js:247 raw result', 'survives', 'raw return is reachable',
      ], ['finding', 'rationale', 'source', 'stage', 'verdict']],
      ['refute rejected', specialistReturn('refute', {
        verdict: 'refuted', rationale: 'The projection already omits the source field.',
      }), 'projection already omits', [
        'refute', 'review', 'src/pi/extension.js:247 raw result', 'refuted', 'projection already omits',
      ], ['finding', 'rationale', 'source', 'stage', 'verdict']],
    ];

    for (const [name, returned, expected, projected, topLevelKeys] of cases) {
      await t.test(name, async () => {
        const privateMarker = `PRIVATE_${String(name).replaceAll(' ', '_').toUpperCase()}`;
        const markedReturn = markPrivateReturnFields(returned, privateMarker);
        const tool = registeredDispatchTool({
          dispatchRoleSession: async () => ({
            stage: markedReturn.stage,
            agent_id: privateMarker,
            brain: { provider: privateMarker, model: privateMarker, effort: privateMarker },
            transcript: JSON.stringify(markedReturn),
            evidence: privateMarker,
            commands: privateMarker,
            diffs: privateMarker,
            unknown: privateMarker,
          }),
        });
        const result = await tool.execute(
          'call-1',
          { stage: markedReturn.stage, brief: 'Project this result.' },
          undefined,
          undefined,
          { cwd, model: { provider: 'local', id: 'test-model' }, modelRegistry: {} },
        );
        const content = result.content[0].text;
        const collapsed = renderDispatchResult(result);
        const expanded = renderDispatchResult(result, { expanded: true });

        assert.deepEqual(result.details, JSON.parse(content));
        assert.deepEqual(result.details, JSON.parse(expanded));
        assert.deepEqual(Object.keys(result.details).sort(), topLevelKeys);
        if (result.details.escalation) {
          assert.deepEqual(Object.keys(result.details.escalation).sort(), ['fork', 'options']);
        }
        if (result.details.kickback) {
          assert.deepEqual(Object.keys(result.details.kickback).sort(), ['reason', 'to']);
        }
        for (const finding of result.details.findings ?? []) {
          assert.deepEqual(Object.keys(finding).sort(), [
            'class', 'file', 'kickTo', 'line', 'severity', 'what', 'why',
          ]);
        }
        const detailsText = JSON.stringify(result.details);
        for (const surface of [content, collapsed, expanded, detailsText]) {
          assert.match(surface, new RegExp(expected, 'i'));
          assert.doesNotMatch(surface, new RegExp(privateMarker));
        }
        for (const field of projected) {
          for (const surface of [content, expanded, detailsText]) assert.match(surface, new RegExp(field, 'i'));
        }
      });
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('cook_dispatch fails closed before display for malformed, non-object, and non-strict returns', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'jeff-pi-invalid-display-'));
  try {
    await mkdir(join(cwd, '.jeff'));
    await writeFile(join(cwd, '.jeff', 'config.json'), JSON.stringify({ active: true, mode: 'lite' }), 'utf8');
    /** @type {[string, string][]} */
    const cases = [
      ['malformed JSON', 'not json PRIVATE_PAYLOAD'],
      ['JSON null', 'null'],
      ['JSON scalar', '42'],
      ['JSON array', '[]'],
      ['unknown return field', JSON.stringify({ ...specialistReturn('implement'), unknown: 'PRIVATE_PAYLOAD' })],
      ['otherwise-valid wrong-stage return', JSON.stringify(specialistReturn('plan'))],
    ];

    for (const [name, transcript] of cases) {
      await t.test(name, async () => {
        const tool = registeredDispatchTool({
          dispatchRoleSession: async () => ({
            stage: 'implement',
            agent_id: 'PRIVATE_CHILD_ID',
            brain: { provider: 'PRIVATE_PROVIDER', model: 'PRIVATE_MODEL', effort: 'PRIVATE_EFFORT' },
            transcript,
          }),
        });
        let thrown;
        try {
          await tool.execute(
            'call-1',
            { stage: 'implement', brief: 'Reject invalid output.' },
            undefined,
            undefined,
            { cwd, model: { provider: 'local', id: 'test-model' }, modelRegistry: {} },
          );
        } catch (error) {
          thrown = error;
        }

        assert.ok(thrown instanceof Error);
        assert.match(thrown.message, /cook_dispatch: specialist return/i);
        assert.ok(thrown.message.length <= 200);
        assert.doesNotMatch(thrown.message, /PRIVATE_|not json|"unknown"|42/);
      });
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('display projection omits forbidden fields and bounds allowed collections, scalars, and total output', () => {
  const presentationControls = '\u061c\u200e\u200f\u2028\u2029\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069';
  const forbidden = [
    'PRIVATE_AGENT', 'PRIVATE_PROVIDER', 'PRIVATE_MODEL', 'PRIVATE_EFFORT', 'PRIVATE_TRANSCRIPT',
    'PRIVATE_EVIDENCE', 'PRIVATE_COMMAND', 'PRIVATE_OUTPUT', 'PRIVATE_DIFF', 'PRIVATE_FILE',
    'PRIVATE_LEDGER', 'PRIVATE_SCAN', 'PRIVATE_COVERAGE', 'PRIVATE_UNKNOWN', 'OVERSIZED_TAIL',
  ];
  const findings = Array.from({ length: 1000 }, (_, index) => ({
    severity: 'high',
    class: 'blocking',
    file: `src/file-${index}.js`,
    line: index + 1,
    kickTo: 'implement',
    what: index === 0
      ? `SAFE ACTIONABLE FINDING café 界 😀\u001b[31m${presentationControls}${'x'.repeat(100_000)}OVERSIZED_TAIL`
      : (index === 999 ? 'OVERSIZED_TAIL' : `finding ${index}`),
    why: 'SAFE ROUTING REASON',
  }));
  const text = formatDispatchResult({
    stage: 'review',
    verdict: 'needs-work',
    findings,
    agent_id: 'PRIVATE_AGENT',
    brain: { provider: 'PRIVATE_PROVIDER', model: 'PRIVATE_MODEL', effort: 'PRIVATE_EFFORT' },
    transcript: 'PRIVATE_TRANSCRIPT',
    evidence: 'PRIVATE_EVIDENCE',
    commands: ['PRIVATE_COMMAND', 'PRIVATE_OUTPUT'],
    diffs: ['PRIVATE_DIFF'],
    files: ['PRIVATE_FILE'],
    acLedger: ['PRIVATE_LEDGER'],
    scan: 'PRIVATE_SCAN',
    coverage: 'PRIVATE_COVERAGE',
    unknown: 'PRIVATE_UNKNOWN',
  });
  const details = JSON.parse(text);
  const result = { content: [{ type: 'text', text }], details };
  const surfaces = [
    text,
    renderDispatchResult(result),
    renderDispatchResult(result, { expanded: true }),
    JSON.stringify(details),
  ];

  assert.ok(text.length <= 32_768);
  assert.ok(details.findings.length < findings.length);
  for (const surface of surfaces) {
    assert.match(surface, /SAFE ACTIONABLE FINDING|SAFE ROUTING REASON/);
    assert.doesNotMatch(surface, /[\p{Bidi_Control}\u2028\u2029\u001b]/u);
    for (const marker of forbidden) assert.doesNotMatch(surface, new RegExp(marker));
  }
  for (const surface of [text, renderDispatchResult(result, { expanded: true }), JSON.stringify(details)]) {
    assert.match(surface, /café 界 😀/u);
  }
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

test('expanded cook_dispatch rendering shows the projection without private execution data', () => {
  const result = completedDispatchResult();
  const collapsed = renderDispatchResult(result);
  const expanded = renderDispatchResult(result, { expanded: true });

  assert.notEqual(expanded, collapsed);
  assert.match(expanded, /renderer returns raw JSON|execution metadata reaches consumers/);
  assert.doesNotMatch(expanded, /review-agent|node --test|missing projection/);
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
      {
        severity: 'high', class: 'blocking', file: 'src/pi/extension.js', line: 12,
        kickTo: 'implement', what: 'renderer counts severity', why: 'the count routes blocking work',
      },
      {
        severity: 'medium', class: 'follow-up', file: 'src/pi/extension.test.js', line: 34,
        kickTo: 'plan', what: 'renderer hides what', why: 'the summary must remain actionable',
      },
    ],
  }));

  assert.match(output, /blocking\D+1/i);
  assert.match(output, /follow-up\D+1/i);
  assert.match(output, /src\/pi\/extension\.js:12.*renderer counts severity/);
  assert.match(output, /src\/pi\/extension\.test\.js:34.*renderer hides what/);
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

test('display projection keeps truncated Unicode well formed', () => {
  const result = completedDispatchResult({
    findings: [{
      severity: 'high',
      class: 'blocking',
      file: 'src/pi/extension.js',
      line: 12,
      kickTo: 'implement',
      what: 'boundary check',
      why: `${'x'.repeat(95)}😀 mixed-boundary emoji`,
    }],
  });
  const why = result.details.findings[0].why;

  assert.doesNotThrow(() => encodeURIComponent(why));
  assert.doesNotMatch(why, /\uFFFD/u);
});

test('display projection repairs lone surrogates across model and TUI surfaces', () => {
  const result = completedDispatchResult({
    findings: [{
      severity: 'high',
      class: 'blocking',
      file: 'src/before-high-\uD800-after-high.js',
      line: 12,
      kickTo: 'implement',
      what: 'before-low-\uDC00-after-low',
      why: 'surrounding text stays readable',
    }],
  });
  const surfaces = [
    result.content[0].text,
    JSON.stringify(result.details),
    renderDispatchResult(result),
    renderDispatchResult(result, { expanded: true }),
  ];

  for (const surface of surfaces) {
    assert.doesNotThrow(() => encodeURIComponent(surface));
    assert.match(surface, /before-high-\uFFFD-after-high/u);
    assert.match(surface, /before-low-\uFFFD-after-low/u);
  }
});

test('cook_dispatch custom renderers fit Pi terminal columns for CJK and emoji', () => {
  const result = completedDispatchResult({
    findings: [{
      severity: 'high',
      class: 'blocking',
      file: 'src/pi/extension.js',
      line: 12,
      kickTo: 'implement',
      what: '界😀'.repeat(60),
      why: 'mixed Unicode stays readable',
    }],
  });
  const tool = registeredDispatchTool();

  assertFitsPiWidth(renderDispatchLines(result, {}, 12), 12);
  assertFitsPiWidth(renderDispatchLines(result, { expanded: true }, 12), 12);
  assertFitsPiWidth(renderDispatchLines(result, { isPartial: true }, 10), 10);
  assertFitsPiWidth(tool.renderCall({ stage: 'review', brief: '界😀'.repeat(60) }, {}, {}).render(10), 10);
});

test('an empty finding list renders useful compact output instead of an empty box', () => {
  const output = renderDispatchResult(completedDispatchResult({ verdict: 'pass', findings: [] }));

  assert.match(output, /review/);
  assert.doesNotMatch(output, /^\s*$/);
});

test('cook_dispatch forwards the host-injected SDK through its default role-session boundary', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'jeff-pi-host-sdk-'));
  try {
    await mkdir(join(cwd, '.jeff'));
    await writeFile(join(cwd, '.jeff', 'config.json'), JSON.stringify({ active: true, mode: 'lite' }), 'utf8');
    const hostSdk = { createAgentSession() {} };
    let receivedSdk;
    const tool = registeredDispatchTool({
      dispatchRoleSession: async (/** @type {any} */ options) => {
        receivedSdk = options.sdk;
        return {
          stage: 'review',
          agent_id: 'host-sdk-reviewer',
          brain: { provider: 'openai', model: 'gpt-5.6', effort: 'xhigh' },
          transcript: JSON.stringify({ ...specialistReturn('review'), verdict: 'pass', findings: [] }),
        };
      },
    }, hostSdk);

    await tool.execute(
      'call-1',
      { stage: 'review', brief: 'Use the host SDK.' },
      undefined,
      undefined,
      { cwd, model: { provider: 'openai', id: 'gpt-5.6' }, modelRegistry: {} },
    );

    assert.equal(receivedSdk, hostSdk);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
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

test('issue 121 cook_dispatch taskId persists the host-observed identity for a return without agent_id', async () => {
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
      stage: 'plan',
      result: 'red',
      complexity: 'complex',
      auditRequired: true,
      refactorOpportunity: null,
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
        agent_id: 'pi-host-plan-agent',
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

    assert.equal(task.tests.authored_by_agent_id, 'pi-host-plan-agent');
    assert.equal(task.complexity, 'complex');
    assert.equal(task.audit.required, true);
    assert.equal(task.stage, 'implement');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('cook_dispatch transports the judgment cycle through the shared record contract', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'jeff-pi-record-cycle-'));
  const taskDir = join(cwd, '.jeff', 'tasks', '018-record-specialists');
  const taskFile = join(taskDir, 'task.json');
  try {
    await mkdir(taskDir, { recursive: true });
    await writeFile(join(cwd, '.jeff', 'config.json'), JSON.stringify({ active: true, mode: 'lite' }), 'utf8');
    await writeFile(taskFile, `${JSON.stringify({
      schemaVersion: 1,
      id: '18',
      slug: 'record-specialists',
      title: 'Record specialists',
      status: 'in_progress',
      stage: 'review',
      priority: 'p2',
      deps: [],
      complexity: 'simple',
      createdAt: '2026-07-12T00:00:00Z',
      updatedAt: '2026-07-12T00:00:00Z',
      agents: { implementer_agent_id: 'implementer', reviewer_agent_id: null, reviewer2_agent_id: null, audit_agent_id: null },
      tests: { authored_by_agent_id: 'plan-agent', green: true, evidence: ['gate'] },
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
    execFileSync('git', ['-C', cwd, 'init', '-q']);
    execFileSync('git', ['-C', cwd, 'add', '.']);
    execFileSync('git', [
      '-C', cwd,
      '-c', 'user.email=tests@example.com',
      '-c', 'user.name=Tests',
      '-c', 'commit.gpgsign=false',
      'commit', '-qm', 'baseline',
    ]);
    const task = JSON.parse(await readFile(taskFile, 'utf8'));
    task.tests.gate = {
      hash: execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      clean: true,
      green: true,
      command: 'make test',
      at: '2026-07-12T01:00:00Z',
    };
    await writeFile(taskFile, `${JSON.stringify(task, null, 2)}\n`, 'utf8');
    const transcript = JSON.stringify({
      stage: 'review',
      cycle: 0,
      verdict: 'pass',
      acLedger: [{ ac: 'AC1', claimed: 'write', rederived: 'write', ok: true }],
      findings: [],
      evidence: [{ command: 'node --test src/pi/extension.test.js', output: 'pass' }],
    });
    const tool = registeredDispatchTool({
      dispatchRoleSession: async () => ({
        stage: 'review',
        agent_id: 'pi-review-agent',
        brain: { provider: 'local', model: 'test-model', effort: 'xhigh' },
        transcript,
      }),
    });

    await tool.execute(
      'call-1',
      { stage: 'review', brief: 'Review task 18 in cycle 0.', taskId: '18' },
      undefined,
      undefined,
      { cwd, model: { provider: 'local', id: 'test-model' }, modelRegistry: {} },
    );
    const recorded = JSON.parse(await readFile(taskFile, 'utf8'));

    assert.equal(recorded.review.reviewer_agent_id, 'pi-review-agent');
    assert.equal(recorded.status, 'done');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('issue 237 registered Pi tool returns validated council work with host-observed identities', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'jeff-pi-council-delivery-'));
  const inquiryReturn = {
    stage: 'council',
    lens: 'integrity',
    temperature: 0.3,
    inquiry: {
      question: 'Are these independent defects, or evidence that this part of the design should be reconstructed?',
      problemRestatement: 'The live council boundary must preserve independent research.',
      causalHypotheses: ['The aggregate currently trusts model-supplied provenance.'],
      solutionStrategies: ['confined-repair', 'full-replan'],
      findingVotes: [{ id: 'F1', blocking: true, rationale: 'The provenance mismatch is reachable.' }],
      decisiveEvidence: ['The host generated a distinct child session id.'],
    },
  };
  const synthesisReturn = {
    stage: 'council-synthesis',
    synthesis: {
      problemRestatement: 'The council boundary must preserve research and provenance.',
      survivingBlockers: ['F1'],
      causalHypotheses: ['Inquiry assembly and route judgment have different owners.'],
      solutionStrategies: ['confined-repair', 'full-replan'],
      rejectedAlternatives: ['confined-repair'],
      selectedStrategy: 'full-replan',
      decisiveEvidence: ['Three independent inquiries support reconstruction.'],
    },
  };
  try {
    await mkdir(join(cwd, '.jeff'));
    await writeFile(join(cwd, '.jeff', 'config.json'), JSON.stringify({ active: true, mode: 'lite' }), 'utf8');
    const tool = registeredDispatchTool({
      dispatchRoleSession: async (/** @type {any} */ { stage }) => ({
        stage,
        agent_id: stage === 'council' ? 'host-inquiry-agent' : 'host-synthesis-agent',
        brain: { provider: 'local', model: 'test-model', effort: 'xhigh' },
        transcript: JSON.stringify(stage === 'council' ? inquiryReturn : synthesisReturn),
      }),
    });

    const inquiry = await tool.execute(
      'call-inquiry',
      { stage: 'council', brief: 'Return one independent inquiry.' },
      undefined,
      undefined,
      { cwd, model: { provider: 'local', id: 'test-model' }, modelRegistry: {} },
    );
    assert.deepEqual(inquiry.details, {
      ...inquiryReturn,
      agent_id: 'host-inquiry-agent',
    });
    assert.deepEqual(JSON.parse(inquiry.content[0].text), inquiry.details);

    const synthesis = await tool.execute(
      'call-synthesis',
      { stage: 'council-synthesis', brief: 'Independently synthesize the three inquiries.' },
      undefined,
      undefined,
      { cwd, model: { provider: 'local', id: 'test-model' }, modelRegistry: {} },
    );
    assert.deepEqual(synthesis.details, {
      ...synthesisReturn,
      agent_id: 'host-synthesis-agent',
    });
    assert.deepEqual(JSON.parse(synthesis.content[0].text), synthesis.details);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('issue 239 standalone council synthesis rejects empty research arrays', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'jeff-pi-council-synthesis-'));
  try {
    await mkdir(join(cwd, '.jeff'));
    await writeFile(join(cwd, '.jeff', 'config.json'), JSON.stringify({ active: true, mode: 'lite' }), 'utf8');
    const validSynthesis = {
      problemRestatement: 'The council boundary must preserve research and provenance.',
      survivingBlockers: ['F1'],
      causalHypotheses: ['Inquiry assembly and route judgment have different owners.'],
      solutionStrategies: ['confined-repair', 'full-replan'],
      rejectedAlternatives: ['confined-repair'],
      selectedStrategy: 'full-replan',
      decisiveEvidence: ['Three independent inquiries support reconstruction.'],
    };

    for (const field of ['causalHypotheses', 'decisiveEvidence']) {
      await t.test(`rejects empty ${field}`, async () => {
        const specialistReturn = {
          stage: 'council-synthesis',
          synthesis: { ...validSynthesis, [field]: [] },
        };
        const tool = registeredDispatchTool({
          dispatchRoleSession: async () => ({
            stage: 'council-synthesis',
            agent_id: 'host-synthesis-agent',
            brain: { provider: 'local', model: 'test-model', effort: 'xhigh' },
            transcript: JSON.stringify(specialistReturn),
          }),
        });

        await assert.rejects(
          () => tool.execute(
            `call-empty-${field}`,
            { stage: 'council-synthesis', brief: 'Independently synthesize the three inquiries.' },
            undefined,
            undefined,
            { cwd, model: { provider: 'local', id: 'test-model' }, modelRegistry: {} },
          ),
          /cook_dispatch: specialist return is invalid/,
        );
      });
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});


test('#290 cook_dispatch surfaces a partial-result signal without another dispatch', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'jeff-pi-partial-signal-'));
  try {
    await mkdir(join(cwd, '.jeff'));
    await writeFile(join(cwd, '.jeff', 'config.json'), JSON.stringify({ active: true, mode: 'lite' }), 'utf8');
    const tool = registeredDispatchTool({
      dispatchRoleSession: async () => ({
        stage: 'plan',
        agent_id: 'plan-partial',
        brain: { provider: 'local', model: 'test-model', effort: 'xhigh' },
        transcript: JSON.stringify({
          stage: 'plan',
          result: 'escalation',
          complexity: 'complex',
          auditRequired: true,
          slices: ['Bound stage context'],
          escalation: {
            fork: 'context-loading timeout',
            options: ['record the partial and continue'],
          },
        }),
        contextStatus: 'partial',
      }),
    });

    const result = await tool.execute(
      'call-partial',
      { stage: 'plan', brief: 'Keep the partial result.' },
      undefined,
      undefined,
      { cwd, model: { provider: 'local', id: 'test-model' }, modelRegistry: {} },
    );

    assert.equal(result.details.contextStatus, 'partial');
    assert.match(result.content[0].text, /partial/);
    assert.equal(result.details.stage, 'plan');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('#290 cook_dispatch timeout without JSON still returns a schema-valid plan result', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'jeff-pi-timeout-signal-'));
  try {
    await mkdir(join(cwd, '.jeff'));
    await writeFile(join(cwd, '.jeff', 'config.json'), JSON.stringify({ active: true, mode: 'lite' }), 'utf8');
    const tool = registeredDispatchTool({
      dispatchRoleSession: async () => ({
        stage: 'plan',
        agent_id: 'plan-timeout',
        brain: { provider: 'local', model: 'test-model', effort: 'xhigh' },
        transcript: '',
        contextStatus: 'timeout',
      }),
    });

    const result = await tool.execute(
      'call-timeout',
      { stage: 'plan', brief: 'Return a schema-valid partial.' },
      undefined,
      undefined,
      { cwd, model: { provider: 'local', id: 'test-model' }, modelRegistry: {} },
    );

    assert.equal(result.details.contextStatus, 'timeout');
    assert.match(result.content[0].text, /timeout/);
    assert.equal(result.details.stage, 'plan');
    assert.match(String(result.details.result), /red|plan|escalation/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

const PLANNED_POSTCONDITION = 'The source is absent and the destination exists exactly once.';

/** @param {Record<string, any>} [overrides] */
function operationTimeoutTask(overrides = {}) {
  return {
    schemaVersion: 1,
    operationStateVersion: 1,
    id: 18,
    slug: 'record-operation',
    title: 'Record operation',
    category: 'operation',
    status: 'in_progress',
    stage: 'verify',
    priority: 'p2',
    deps: [],
    complexity: 'simple',
    createdAt: '2026-07-12T00:00:00Z',
    updatedAt: '2026-07-12T00:00:00Z',
    agents: {
      executor_agent_id: 'executor',
      verifier_agent_id: null,
      audit_agent_id: null,
    },
    plan: {
      result: 'plan',
      slices: ['Reconcile the bounded registry state.'],
      runbook: ['Confirm the source entry, then move it to the destination.'],
      preconditions: ['The source entry exists exactly once.'],
      recoveryBoundary: 'Before the shared registry write, restore the captured source entry.',
      approvalBoundary: 'Rewrite the shared release registry entry from source to destination.',
      requiresApproval: false,
      postconditions: [PLANNED_POSTCONDITION],
      verificationSeams: ['Read the source and destination entries independently.'],
      escalation: null,
    },
    execution: {
      result: 'executed',
      executor_agent_id: 'executor',
      cycle: 0,
      recordedAt: '2026-07-12T00:20:00Z',
      actions: ['Moved the bounded registry entry.'],
      evidence: [{ command: 'inspect registry transition', output: 'transition complete' }],
      approvalRequired: null,
    },
    verification: {
      verdict: null,
      verifier_agent_id: null,
      postconditions: [],
      findings: [],
      evidence: [],
    },
    audit: { required: false, verdict: 'na', audit_agent_id: null, findings: [], evidence: [] },
    commits: [],
    kickbacks: [],
    convergence: {
      cap: 2,
      stages: { verify: { blockingKickbacks: 0 }, audit: { blockingKickbacks: 0 } },
      council: { convened: false, stage: null, members: [], findings: [], verdict: null, outcome: null },
    },
    blockedReason: null,
    abandonReason: null,
    ...overrides,
  };
}

/** @param {Record<string, any>} task */
async function withOperationTimeoutProject(task) {
  const cwd = await mkdtemp(join(tmpdir(), 'jeff-pi-interrupt-'));
  const taskDir = join(cwd, '.jeff', 'tasks', '018-record-operation');
  await mkdir(taskDir, { recursive: true });
  await writeFile(join(cwd, '.jeff', 'config.json'), JSON.stringify({ active: true, mode: 'lite' }), 'utf8');
  const taskFile = join(taskDir, 'task.json');
  await writeFile(taskFile, `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  return { cwd, taskFile };
}

/**
 * @param {string} cwd
 * @param {string} stage
 * @param {string} taskId
 */
async function executeTimeoutDispatch(cwd, stage, taskId) {
  const tool = registeredDispatchTool({
    dispatchRoleSession: async () => ({
      stage,
      agent_id: `${stage}-timeout`,
      brain: { provider: 'local', model: 'test-model', effort: 'xhigh' },
      transcript: '',
      contextStatus: 'timeout',
    }),
  });
  return tool.execute(
    `call-${stage}-timeout`,
    { stage, brief: 'Return a timeout without a specialist JSON.', taskId },
    undefined,
    undefined,
    { cwd, model: { provider: 'local', id: 'test-model' }, modelRegistry: {} },
  );
}

test('#290 cook_dispatch timeout with taskId on an operation whose execution.cycle differs from judgmentHistory.length returns contextStatus', async () => {
  const { cwd, taskFile } = await withOperationTimeoutProject(operationTimeoutTask({
    execution: {
      result: 'executed',
      executor_agent_id: 'executor',
      cycle: 3,
      recordedAt: '2026-07-12T00:20:00Z',
      actions: ['Moved the bounded registry entry.'],
      evidence: [{ command: 'inspect registry transition', output: 'transition complete' }],
      approvalRequired: null,
    },
  }));
  try {
    const result = await executeTimeoutDispatch(cwd, 'verify', '18');

    assert.equal(result.details.contextStatus, 'timeout');
    assert.match(result.content[0].text, /timeout/);
    const recorded = JSON.parse(await readFile(taskFile, 'utf8'));
    assert.equal(recorded.execution.cycle, 3);
    assert.equal(recorded.judgmentHistory, undefined);
    assert.equal(recorded.verification.verifier_agent_id, null);
    assert.deepEqual(recorded.verification.postconditions, []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('#290 cook_dispatch timeout with taskId on verify does not persist forged plan postconditions', async () => {
  const { cwd, taskFile } = await withOperationTimeoutProject(operationTimeoutTask());
  try {
    const result = await executeTimeoutDispatch(cwd, 'verify', '18');

    assert.equal(result.details.contextStatus, 'timeout');
    assert.match(result.content[0].text, /timeout/);
    const recorded = JSON.parse(await readFile(taskFile, 'utf8'));
    assert.deepEqual(recorded.plan.postconditions, [PLANNED_POSTCONDITION]);
    assert.equal(recorded.verification.verifier_agent_id, null);
    assert.deepEqual(recorded.verification.postconditions, []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('#290 cook_dispatch timeout with taskId on refute does not persist finding INTERRUPTED as a survivor', async () => {
  const blocker = {
    file: 'src/core/record.js',
    line: 10,
    severity: 'high',
    class: 'blocking',
    kickTo: 'execute',
    what: 'The recording path loses a result.',
    why: 'A supported completion order can overwrite durable evidence.',
  };
  const { cwd, taskFile } = await withOperationTimeoutProject(operationTimeoutTask({
    agents: {
      executor_agent_id: 'executor',
      verifier_agent_id: 'verifier',
      audit_agent_id: null,
    },
    verification: {
      verdict: 'needs-work',
      reportedVerdict: 'needs-work',
      verifier_agent_id: 'verifier',
      postconditions: [{
        postcondition: PLANNED_POSTCONDITION,
        ok: false,
        evidence: 'independent read found two destination entries',
      }],
      findings: [blocker],
      evidence: [{ command: 'inspect registry', output: 'two destination entries' }],
    },
  }));
  try {
    const result = await executeTimeoutDispatch(cwd, 'refute', '18');

    assert.equal(result.details.contextStatus, 'timeout');
    assert.match(result.content[0].text, /timeout/);
    const recorded = JSON.parse(await readFile(taskFile, 'utf8'));
    assert.equal((recorded.refutes ?? []).length, 0);
    assert.equal(recorded.verification.findings[0].refute, undefined);
    assert.equal(recorded.verification.findings[0].what, blocker.what);
    assert.equal(recorded.verification.findings[0].class, 'blocking');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
