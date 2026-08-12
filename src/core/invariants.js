// @ts-check

/**
 * Pure per-check invariant functions for the authoritative JS validator. Most
 * checks retain the former Bash behavior; destination changes live here first
 * and are specified directly rather than derived from the transition oracle.
 *
 * No I/O. Every function is a deterministic function of the collected task
 * objects and returns the exact violation strings `cook.sh` emits (parity is
 * over exit code + failing-check identity, so message wording is load-bearing).
 * Task input is treated as UNTRUSTED: a malformed shape that would make jq abort
 * (fail CLOSED → die) throws here, so the orchestrator can never fall through to
 * a "validation OK" on a store it could not evaluate.
 */

import { isDeepStrictEqual } from 'node:util';

import { isType } from './validate.js';
import { councilResearchViolation, requiresCouncilResearchProvenance } from './council.js';
import {
  archivedJudgeAgentIds,
  forbiddenCouncilAgentIds,
  isAgentId,
  isArchivedVerifierAgentForbidden,
  isRecoveryParticipantEligible,
} from './identity-policy.js';
import {
  hasCompletedApprovalProvenance,
  isAuthoritativeOperation,
  isOperationCycle,
  isSameApproval,
} from './operation-state.js';

/**
 * jq's `a // b`: yield `b` when `a` is null, false, or absent.
 * @param {any} v
 * @param {any} d
 * @returns {any}
 */
function jqOr(v, d) {
  return (v === null || v === undefined || v === false) ? d : v;
}

/**
 * jq string interpolation `\(v)`: null/absent renders empty, else `String(v)`.
 * @param {any} v
 * @returns {string}
 */
function jqStr(v) {
  return (v === null || v === undefined) ? '' : String(v);
}

/**
 * jq's `length` (cook.sh inv4 na-justification, skills/cook/scripts/cook.sh:431:
 * `(($t.tests.evidence // []) | length)`): array → element count, string →
 * codepoint count, number → absolute value, object → key count, null → 0. A jq
 * boolean has no length (`true | length` aborts), so this throws : the caller's
 * fail-CLOSED trap then renders the verdict. Replaces `String(v).length`, which
 * diverged (e.g. numeric `0` → "0".length == 1 instead of jq's 0).
 * @param {any} v
 * @returns {number}
 */
function jqLength(v) {
  if (v === null || v === undefined) return 0;
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'string') return [...v].length;
  if (typeof v === 'number') return Math.abs(v);
  if (typeof v === 'boolean') throw new Error('jq length: boolean has no length');
  if (isType(v, 'object')) return Object.keys(v).length;
  throw new Error('jq length: unsupported type');
}

/**
 * jq aborts when it indexes or iterates a present value of the wrong
 * container type (`42 | .k`, `[] | .k`, `42 | .[]`). Mirror that: throw when
 * a field is present (non-null) but not of the expected container `type`
 * ('object' for tests/agents/convergence/review/audit, 'array' for deps), so
 * the caller's fail-CLOSED catch renders the verdict instead of JS silently
 * reading `undefined`/iterating nothing (fail OPEN).
 * @param {any} v
 * @param {'object' | 'array'} type
 * @param {string} name - field name, for the "malformed <name>" message
 * @returns {void}
 */
function assertContainerType(v, type, name) {
  if (v !== null && v !== undefined && !isType(v, type)) {
    throw new Error(`malformed ${name}`);
  }
}

const STATUSES = ['pending', 'in_progress', 'blocked', 'done', 'abandoned'];
// `test` is accepted only as a legacy persisted-ledger resume state.
const STAGES = ['capture', 'plan', 'test', 'implement', 'refactor', 'execute', 'review', 'verify', 'audit', 'done'];
const PRIOS = ['p0', 'p1', 'p2', 'p3', 'p4'];
// The repair destinations a kickback stays confined to.
const CONFINED_KICK_STAGES = ['implement', 'refactor'];
// A demoted council finding parked on `.jeff/FOLLOWUPS.md` instead of a task.
const LEDGER_FOLLOWUP = 'ledger';

/**
 * `[gate]` done-gate pre-flight (cook.sh:338-346). Over `done` tasks only, and
 * null-tolerant: a done task without `tests.gate` (legacy) and any non-done task
 * are skipped. Fails CLOSED (throws) if a present `tests.gate` is not an object.
 *
 * @param {any[]} tasks
 * @returns {string[]}
 */
export function gatePreflight(tasks) {
  const out = [];
  for (const t of tasks) {
    if (t.status !== 'done') continue;
    if (t.category === 'operation') continue;
    // jq reads `$t.tests.gate` for this done task; a present non-object `tests`
    // would abort jq (index a non-object) → fail CLOSED. Mirror it.
    assertContainerType(t.tests, 'object', 'tests');
    const g = (t.tests === null || t.tests === undefined) ? null : t.tests.gate;
    if (g === null || g === undefined) continue;
    if (!isType(g, 'object')) throw new Error('malformed tests.gate');
    const id = jqStr(t.id);
    if (g.green !== true) {
      out.push(`task ${id}: done but tests.gate.green != true (tests.green not backed by a green full-suite gate) [gate]`);
    }
    if (g.clean !== true) {
      out.push(`task ${id}: done but tests.gate.clean != true (gate ran on a dirty tree) [gate]`);
    }
    if (typeof g.hash !== 'string' || g.hash === '') {
      out.push(`task ${id}: done but tests.gate.hash is missing/empty (a recorded gate must carry the gated hash) [gate]`);
    }
    if (t.tests.green === true && g.green !== true) {
      out.push(`task ${id}: tests.green == true but not backed by tests.gate.green == true [gate]`);
    }
  }
  return out;
}

/** @param {any[]} evidence */
function hasNonemptyEvidence(evidence) {
  return Array.isArray(evidence)
    && evidence.length > 0
    && evidence.every((item) => (
      typeof item?.command === 'string'
      && item.command.length > 0
      && typeof item.output === 'string'
      && item.output.length > 0
    ));
}


/** @param {any} left @param {any} right */
function isSameRefute(left, right) {
  return isType(left, 'object')
    && isType(right, 'object')
    && left.agent_id === right.agent_id
    && left.source === right.source
    && left.finding === right.finding
    && left.verdict === right.verdict
    && left.rationale === right.rationale
    && Array.isArray(left.evidence)
    && Array.isArray(right.evidence)
    && left.evidence.length === right.evidence.length
    && left.evidence.every((/** @type {any} */ item, /** @type {number} */ index) => (
      item?.command === right.evidence[index]?.command
      && item?.output === right.evidence[index]?.output
    ));
}

/** @param {any} task @param {string} source @param {any} finding */
function hasRetainedSourceRefute(task, source, finding) {
  const refute = finding?.refute;
  return refute?.source === source
    && refute.verdict === 'survives'
    && refute.finding === `${finding.file}:${finding.line} ${finding.what}`
    && Array.isArray(task.refutes)
    && task.refutes.some((/** @type {any} */ retained) => isSameRefute(retained, refute));
}

/**
 * @param {any} outcome
 * @param {any} agents
 * @param {string} outcomeIdentity
 * @param {string} agentIdentity
 */
function judgmentIdentity(outcome, agents, outcomeIdentity, agentIdentity) {
  return outcome?.[outcomeIdentity] ?? agents?.[agentIdentity] ?? null;
}

/** @param {any} task */
function hasTargetedRepairProof(task) {
  if (task.category === 'operation' || !Array.isArray(task.judgmentHistory)) return true;
  const judgmentKickbacks = Array.isArray(task.kickbacks)
    ? task.kickbacks.filter((/** @type {any} */ kickback) => ['review', 'audit'].includes(kickback?.from))
    : [];
  const hasTypedKickback = judgmentKickbacks.some((/** @type {any} */ kickback) => (
    Array.isArray(kickback.findings) && kickback.findings.length > 0
  ));
  if (!hasTypedKickback) return true;
  if (task.judgmentHistory.length === 0) return true;

  const history = task.judgmentHistory.at(-1);
  const council = task.convergence?.council;
  const lastKickback = judgmentKickbacks.at(-1);
  const councilReason = `Council block: ${(Array.isArray(council?.findings) ? council.findings : [])
    .filter((/** @type {any} */ finding) => finding.survived === true)
    .map((/** @type {any} */ finding) => finding.summary)
    .join('; ')}`;
  const hasPendingCouncilKickback = council?.convened === true
    && council.verdict === 'block'
    && council.outcome === null
    && lastKickback?.from === council.stage
    && lastKickback?.to === 'implement'
    && lastKickback?.reason === councilReason
    && lastKickback?.findings === undefined;
  const contractKickbacks = hasPendingCouncilKickback
    ? judgmentKickbacks.slice(0, -1)
    : judgmentKickbacks;
  const latestKickback = contractKickbacks.at(-1);
  if (!isType(history, 'object') || !isType(latestKickback, 'object')) return false;
  const judgments = [
    ['review', 'reviewer_agent_id'],
    ['review2', 'reviewer_agent_id'],
    ['audit', 'audit_agent_id'],
  ];
  const staleIdentity = judgments.some(([source, identity]) => {
    const agentIdentity = source === 'review2' ? 'reviewer2_agent_id' : identity;
    const liveId = judgmentIdentity(task[source], task.agents, identity, agentIdentity);
    const archivedId = judgmentIdentity(
      history[source],
      history.agents,
      identity,
      agentIdentity,
    );
    return liveId != null
      && archivedId !== liveId
      && task.judgmentHistory.slice(0, -1).some((/** @type {any} */ entry) => (
        judgmentIdentity(entry?.[source], entry?.agents, identity, agentIdentity) === liveId
      ));
  });
  if (staleIdentity) return false;
  const retainedSources = judgments.filter(([source, identity]) => {
    const agentIdentity = source === 'review2' ? 'reviewer2_agent_id' : identity;
    const liveId = judgmentIdentity(task[source], task.agents, identity, agentIdentity);
    const archivedId = judgmentIdentity(
      history[source],
      history.agents,
      identity,
      agentIdentity,
    );
    return liveId != null && archivedId === liveId;
  });
  const liveRaisingSources = [
    ...(task.review?.verdict === 'needs-work' || task.review2?.verdict === 'needs-work'
      ? ['review'] : []),
    ...(task.audit?.verdict === 'needs-work' ? ['audit'] : []),
  ];
  const isAwaitingFreshRepair = CONFINED_KICK_STAGES.includes(task.stage)
    && task.convergence?.council?.stage == null
    && task.convergence?.council?.convened !== true
    && liveRaisingSources.includes(latestKickback.from)
    && Number.isFinite(Date.parse(latestKickback.at))
    && Number.isFinite(Date.parse(history.at))
    && Date.parse(history.at) <= Date.parse(latestKickback.at);
  const isAwaitingFreshReset = ['capture', 'plan'].includes(latestKickback.to)
    && ['capture', 'plan', 'implement'].includes(task.stage)
    && liveRaisingSources.includes(latestKickback.from)
    && Number.isFinite(Date.parse(latestKickback.at))
    && Number.isFinite(Date.parse(history.at))
    && Date.parse(history.at) <= Date.parse(latestKickback.at);
  const isAwaitingJudgmentWork = isAwaitingFreshRepair || isAwaitingFreshReset;
  if (!Array.isArray(latestKickback.findings) || latestKickback.findings.length === 0) {
    return retainedSources.length === 0;
  }

  const raisingSources = isAwaitingJudgmentWork
    ? liveRaisingSources
    : [
      ...(history.review?.verdict === 'needs-work' || history.review2?.verdict === 'needs-work'
        ? ['review'] : []),
      ...(history.audit?.verdict === 'needs-work' ? ['audit'] : []),
    ];
  if (!raisingSources.includes(latestKickback.from)) return retainedSources.length === 0;
  const kickbacks = raisingSources.map((source) => contractKickbacks.findLast((/** @type {any} */ kickback) => (
    kickback.from === source && kickback.at === latestKickback.at
  ))).filter((kickback) => kickback !== undefined);
  const findings = kickbacks.flatMap((/** @type {any} */ kickback) => kickback.findings ?? []);
  const typedContract = kickbacks.length === raisingSources.length
    && kickbacks.every((/** @type {any} */ kickback) => (
      CONFINED_KICK_STAGES.includes(kickback.to)
      && Array.isArray(kickback.findings)
      && kickback.findings.length > 0
      && kickback.findings.every((/** @type {any} */ finding) => (
        CONFINED_KICK_STAGES.includes(finding?.kickTo)
        && (finding?.source === kickback.from
          || (kickback.from === 'review' && finding?.source === 'review2'))
        && typeof finding?.file === 'string'
        && finding.file.length > 0
      ))
    ));
  if ((!typedContract && !isAwaitingFreshReset)
    || !Number.isFinite(Date.parse(latestKickback.at))
    || !Number.isFinite(Date.parse(history.at))
    || (!isAwaitingJudgmentWork && Date.parse(history.at) < Date.parse(latestKickback.at))) {
    return retainedSources.length === 0;
  }

  const findingFiles = new Set(findings.map((/** @type {any} */ finding) => finding.file));
  const repairStages = [...new Set([
    ...kickbacks.map((/** @type {any} */ kickback) => kickback.to),
    ...findings.map((/** @type {any} */ finding) => finding.kickTo),
  ])];
  const pendingRepairStage = isAwaitingFreshRepair
    ? task.stage
    : (task.stage === 'refactor'
      && repairStages.includes('implement')
      && repairStages.includes('refactor') ? task.stage : null);
  const recordedRepairs = repairStages
    .filter((stage) => pendingRepairStage !== 'implement' && stage !== pendingRepairStage)
    .map((stage) => [stage, task[stage]])
    .filter(([, repair]) => isType(repair, 'object'));
  const permitsLegacyRepairProof = task.judgmentHistory.length === 1
    && contractKickbacks.filter((/** @type {any} */ kickback) => (
      Array.isArray(kickback.findings) && kickback.findings.length > 0
    )).length === raisingSources.length;
  const repairsAreConfined = recordedRepairs.every(([stage, repair]) => (
    (stage === 'implement' ? repair.result === 'green' : repair.result === 'clean')
    && (repair.repairRound === contractKickbacks.length
      || (repair.repairRound === undefined && permitsLegacyRepairProof))
    && Array.isArray(repair.files)
    && repair.files.length > 0
    && repair.files.every((/** @type {any} */ file) => findingFiles.has(file))
  ));
  const hasConfinedRepair = repairStages.length > 0
    && recordedRepairs.length === repairStages.length
    && repairsAreConfined;
  const hasPartialConfinedRepair = repairStages.includes(task.stage)
    && recordedRepairs.length > 0
    && repairsAreConfined;
  const hasCurrentRepairProof = hasConfinedRepair || hasPartialConfinedRepair;
  const raised = new Set(raisingSources);
  if (retainedSources.length === 0) {
    const hasRetainableSibling = judgments.some(([source, identity]) => {
      const agentIdentity = source === 'review2' ? 'reviewer2_agent_id' : identity;
      const archivedId = judgmentIdentity(history[source], history.agents, identity, agentIdentity);
      const liveId = judgmentIdentity(task[source], task.agents, identity, agentIdentity);
      return !raised.has(source === 'review2' ? 'review' : source)
        && archivedId != null
        && archivedId === liveId
        && history[source]?.verdict === 'pass';
    });
    if (isAwaitingJudgmentWork) return !hasRetainableSibling;
    if (!hasCurrentRepairProof) return true;
  }
  if (!hasCurrentRepairProof && !isAwaitingJudgmentWork) return false;
  if (retainedSources.some(([source]) => raised.has(source === 'review2' ? 'review' : source))) {
    return false;
  }
  return judgments
    .filter(([source]) => !raised.has(source === 'review2' ? 'review' : source))
    .every(([source, identity]) => {
      const archived = history[source];
      const live = task[source];
      const agentIdentity = source === 'review2' ? 'reviewer2_agent_id' : identity;
      const archivedId = judgmentIdentity(archived, history.agents, identity, agentIdentity);
      const liveId = judgmentIdentity(live, task.agents, identity, agentIdentity);
      if (archivedId === null && liveId === null) return true;
      return archivedId !== null
        && archivedId === liveId
        && archived?.verdict === 'pass'
        && live?.verdict === 'pass'
        && isDeepStrictEqual(live, archived);
    });
}


/** @param {any} task @param {any} [verification] @param {any} [audit] */
function operationBlockers(task, verification = task.verification, audit = task.audit) {
  return [
    ['verify', verification],
    ['audit', audit],
  ].flatMap(([source, outcome]) => (
    (outcome?.findings ?? [])
      .filter((/** @type {any} */ finding) => finding.class === 'blocking')
      .map((/** @type {any} */ finding) => ({
        source,
        finding,
        key: `${source}\0${finding.what}`,
        proven: hasRetainedSourceRefute(task, source, finding),
      }))
  ));
}

/** @param {any} task */
function isExactOperationCouncilShip(task) {
  const council = task.convergence?.council;
  if (council?.convened !== true || council.verdict !== 'ship' || council.outcome !== 'shipped') {
    return false;
  }
  const blockers = operationBlockers(task);
  const resolved = council.findings
    .filter((/** @type {any} */ finding) => finding.survived === false)
    .map((/** @type {any} */ finding) => `${finding.source}\0${finding.summary}`);
  const blockerKeys = blockers.map(({ key }) => key);
  return blockers.length > 0
    && blockers.every(({ proven }) => proven)
    && blockerKeys.length === resolved.length
    && new Set(blockerKeys).size === blockerKeys.length
    && new Set(resolved).size === resolved.length
    && blockerKeys.every((finding) => resolved.includes(finding));
}

/** @param {any} task */
function hasScopedOperationCouncilProof(task) {
  const council = task.convergence?.council;
  const survivors = council?.findings?.filter((/** @type {any} */ finding) => finding.survived === true) ?? [];
  const expectedReason = `Council block: ${survivors.map((/** @type {any} */ finding) => finding.summary).join('; ')}`;
  const councilKickbacks = (task.kickbacks ?? []).filter((/** @type {any} */ kickback) => (
    kickback.from === council?.stage
    && kickback.to === 'execute'
    && kickback.reason === expectedReason
  ));
  if (councilKickbacks.length !== 1 || !Array.isArray(task.judgmentHistory)) return false;

  const councilKeys = council.findings.map((/** @type {any} */ finding) => `${finding.source}\0${finding.summary}`);
  const history = task.judgmentHistory.at(-1);
  if (!history) return false;
  const blockers = operationBlockers(task, history.verification, history.audit);
  const blockerKeys = blockers.map(({ key }) => key);
  if (blockers.length === 0
    || !blockers.every(({ proven }) => proven)
    || blockerKeys.length !== councilKeys.length
    || new Set(blockerKeys).size !== blockerKeys.length
    || new Set(councilKeys).size !== councilKeys.length
    || !blockerKeys.every((finding) => councilKeys.includes(finding))
    || Date.parse(history.at) < Date.parse(councilKickbacks[0].at)) {
    return false;
  }

  const currentIds = [
    task.verification?.verifier_agent_id,
    task.audit?.audit_agent_id,
  ].filter((agentId) => agentId !== null && agentId !== undefined);
  const latestHistoricalIds = new Set([
    history.agents?.verifier_agent_id,
    history.agents?.audit_agent_id,
  ].filter(isAgentId));
  const basicFreshness = isAgentId(task.verification?.verifier_agent_id)
    && new Set(currentIds).size === currentIds.length
    && currentIds.every((agentId) => isAgentId(agentId) && !latestHistoricalIds.has(agentId));
  if (!isAuthoritativeOperation(task)) return basicFreshness;

  const historicalIds = new Set(archivedJudgeAgentIds(task));
  const councilMemberIds = new Set(
    (council.members ?? []).map((/** @type {any} */ member) => member.agent_id),
  );
  return basicFreshness
    && isOperationCycle(council.cycle)
    && isAgentId(council.executor_agent_id)
    && task.execution?.cycle === council.cycle + 1
    && isAgentId(task.execution?.executor_agent_id)
    && task.execution.executor_agent_id === task.agents?.executor_agent_id
    && task.execution.executor_agent_id !== council.executor_agent_id
    && Date.parse(task.execution.recordedAt) >= Date.parse(history.at)
    && [...historicalIds].every((agentId) => !councilMemberIds.has(agentId))
    && currentIds.every((agentId) => !historicalIds.has(agentId) && !councilMemberIds.has(agentId));
}

/** @param {any} outcome @param {boolean} exactCouncilShip */
function isResolvedOperationJudgment(outcome, exactCouncilShip) {
  const hasBlockers = outcome?.findings?.some((/** @type {any} */ finding) => finding.class === 'blocking') === true;
  return (!hasBlockers && outcome?.verdict === 'pass') || (hasBlockers && exactCouncilShip);
}

/**
 * Main invariant pass (cook.sh:382-605): per-task field/registry checks,
 * inv1/inv2, inv4 done-gate, inv5a dep-exists, `[prune]`, the inv7-11
 * convergence block, status-conditional fields, plus the cross-task duplicate-id
 * and inv5b dependency-cycle (Kahn) checks. `lite` drops the registry-only
 * checks (id-type, inv5 provenance, duplicate-id, `[prune]`) while retaining
 * dependency cycles over local edges.
 *
 * @param {any[]} tasks
 * @returns {string[]}
 */
export function runInvariants(
  tasks,
  /** @type {{ lite: boolean, prunedTaskIds?: number[] }} */ { lite, prunedTaskIds },
) {
  const out = [];
  const ids = tasks.map((t) => t.id);
  const dependencyIds = lite ? null : new Set([...ids, ...(prunedTaskIds ?? [])]);

  if (!lite && prunedTaskIds !== undefined) {
    const prunedIds = new Set(prunedTaskIds);
    if (prunedIds.size !== prunedTaskIds.length) {
      out.push('config prunedTaskIds must contain unique ids [inv5]');
    }
    for (const id of ids) {
      if (prunedIds.has(id)) {
        out.push(`live task id ${jqStr(id)} must not appear in config prunedTaskIds [inv5]`);
      }
    }
  }

  for (const t of tasks) {
    // Fail CLOSED on type-confused containers (mirrors jq abort-on-index),
    // scoped to exactly where the jq pass indexes each field: tests/agents
    // (inv1/2) and convergence (.council) for every task; review/audit only
    // inside the done block; deps only under full mode (inv5a iterates it directly).
    assertContainerType(t.tests, 'object', 'tests');
    assertContainerType(t.agents, 'object', 'agents');
    assertContainerType(t.convergence, 'object', 'convergence');
    if (t.status === 'done') {
      assertContainerType(t.audit, 'object', 'audit');
      if (t.category !== 'operation') assertContainerType(t.review, 'object', 'review');
    }
    // Item 2 (documented strictness, Chef call 2026-07-03). cook.sh iterates
    // `($t.deps // [])[]`, which tolerates `deps:{}` (iterates an object's values →
    // empty → no deps) and `deps:false` (`false // []` → `[]` → no deps), both exit
    // 0. We assert `deps` is an array, so any present non-array `deps`
    // ({}/false/"abc"/number) throws → fail CLOSED (exit 1). Deliberate: treating an
    // object's values as "dependencies" is nonsense on untrusted input; we refuse.
    // (This seam is pinned by strengthened A4 in validate-store.test.js.)
    if (!lite) assertContainerType(t.deps, 'array', 'deps');

    const id = jqStr(t.id);
    const agents = t.agents || {};
    const ta = (t.tests && t.tests.authored_by_agent_id != null) ? t.tests.authored_by_agent_id : null;
    const im = agents.implementer_agent_id != null ? agents.implementer_agent_id : null;
    const rv = agents.reviewer_agent_id != null ? agents.reviewer_agent_id : null;
    const rv2 = agents.reviewer2_agent_id != null ? agents.reviewer2_agent_id : null;
    const ex = agents.executor_agent_id != null ? agents.executor_agent_id : null;
    const vr = agents.verifier_agent_id != null ? agents.verifier_agent_id : null;
    const au = agents.audit_agent_id != null ? agents.audit_agent_id : null;

    // id-type: registry invariant (full only). Lite ledgers may carry a string id.
    if (!lite && typeof t.id !== 'number') {
      out.push(`${jqStr(t._dir)}: id must be a number`);
    }
    // slug required
    const slug = jqOr(t.slug, '');
    if (typeof slug !== 'string' || slug === '') {
      out.push(`task ${id}: slug is required`);
    }
    // title required
    if (jqOr(t.title, '') === '') {
      out.push(`task ${id}: title is required`);
    }
    // status / stage / priority enums
    if (!STATUSES.includes(t.status)) out.push(`task ${id}: invalid status "${jqStr(t.status)}"`);
    if (!STAGES.includes(t.stage)) out.push(`task ${id}: invalid stage "${jqStr(t.stage)}"`);
    if (!PRIOS.includes(t.priority)) out.push(`task ${id}: invalid priority "${jqStr(t.priority)}"`);

    // inv1: test author != implementer
    if (ta !== null && im !== null && ta === im) {
      out.push(`task ${id}: test author == implementer (${jqStr(ta)}) [inv1]`);
    }
    // inv2: implementer != every reviewer
    if (im !== null && (im === rv || im === rv2)) {
      out.push(`task ${id}: implementer == reviewer (${jqStr(im)}) [inv2]`);
    }
    if (t.category !== 'operation' && isType(t.audit, 'object')) {
      const outcomeAuditor = t.audit.audit_agent_id != null ? t.audit.audit_agent_id : null;
      if (((t.audit.verdict === 'pass' || t.audit.verdict === 'needs-work')
          && au === null && outcomeAuditor === null)
        || (au !== null && outcomeAuditor !== null && au !== outcomeAuditor)
        || (im !== null && (au === im || outcomeAuditor === im))) {
        out.push(`task ${id}: audit outcome identity does not match its separated auditor [inv2]`);
      }
    }
    if (t.category === 'operation' && isType(t.execution, 'object')) {
      const outcomeExecutor = t.execution.executor_agent_id != null ? t.execution.executor_agent_id : null;
      if ((outcomeExecutor !== null && ex !== null && outcomeExecutor !== ex)
        || (outcomeExecutor !== null && ex === null)
        || (ex !== null && outcomeExecutor === null)) {
        out.push(`task ${id}: execution outcome identity does not match its executor [inv2]`);
      }
    }
    if (t.category === 'operation' && isType(t.execution?.approval, 'object')
      && t.execution.approval.grantedBy === ex) {
      out.push(`task ${id}: executor supplied operator approval provenance (${jqStr(ex)}) [inv2]`);
    }
    if (ex !== null && ex === vr) {
      out.push(`task ${id}: executor == verifier (${jqStr(ex)}) [inv2]`);
    }
    if (t.category === 'operation' && isType(t.verification, 'object')) {
      const outcomeVerifier = t.verification.verifier_agent_id != null ? t.verification.verifier_agent_id : null;
      const hasVerdict = t.verification.verdict === 'pass' || t.verification.verdict === 'needs-work';
      if ((hasVerdict && (vr === null || outcomeVerifier === null))
        || (vr !== null && outcomeVerifier !== null && vr !== outcomeVerifier)
        || (ex !== null && outcomeVerifier === ex)) {
        out.push(`task ${id}: verification outcome identity does not match its separated verifier [inv2]`);
      }
      if (isArchivedVerifierAgentForbidden(t, vr)
        || isArchivedVerifierAgentForbidden(t, outcomeVerifier)) {
        out.push(
          `task ${id}: fresh verifier must not reuse an archived verifier identity [operation-reverify-identity]`,
        );
      }
    }
    if (t.category === 'operation' && isType(t.audit, 'object')) {
      const outcomeAuditor = t.audit.audit_agent_id != null ? t.audit.audit_agent_id : null;
      const hasVerdict = t.audit.verdict === 'pass' || t.audit.verdict === 'needs-work';
      if ((hasVerdict && (au === null || outcomeAuditor === null))
        || (au === null) !== (outcomeAuditor === null)
        || (au !== null && outcomeAuditor !== null && au !== outcomeAuditor)
        || (ex !== null && (au === ex || outcomeAuditor === ex))
        || (vr !== null && (au === vr || outcomeAuditor === vr))) {
        out.push(`task ${id}: audit outcome identity does not match its separated auditor [inv2]`);
      }
    }
    const reviews = [
      [t.review, rv, true],
      [t.review2, rv2, false],
    ];
    for (const [outcome, recordedReviewer, acceptsSingleIdentity] of reviews) {
      if (!isType(outcome, 'object')) continue;
      const outcomeReviewer = outcome.reviewer_agent_id != null ? outcome.reviewer_agent_id : null;
      const hasVerdict = outcome.verdict === 'pass' || outcome.verdict === 'needs-work';
      const identityMismatch = outcomeReviewer !== null && recordedReviewer !== null && outcomeReviewer !== recordedReviewer;
      const missingBoundIdentity = hasVerdict && (
        acceptsSingleIdentity
          ? outcomeReviewer === null && recordedReviewer === null
          : outcomeReviewer === null || recordedReviewer === null
      );
      if (identityMismatch || missingBoundIdentity || (im !== null && outcomeReviewer === im)) {
        out.push(`task ${id}: review outcome identity does not match its separated reviewer [inv2]`);
      }
    }

    // inv4: done-gate quality invariant
    if (t.status === 'done' && t.category === 'operation') {
      const executionApproval = t.execution?.approval;
      const retainedExecutionApproval = t.plan?.requiresApproval === false
        ? executionApproval === undefined
        : t.plan?.requiresApproval === true
          && (isAuthoritativeOperation(t)
            ? hasCompletedApprovalProvenance(t)
            : executionApproval?.mutation === t.plan.approvalBoundary
              && executionApproval?.grantedBy !== ex
              && Array.isArray(t.approvals)
              && t.approvals.some((/** @type {any} */ approval) => (
                isSameApproval(approval, executionApproval)
              )));
      const executionPass = t.execution?.result === 'executed'
        && t.execution?.approvalRequired === null
        && t.execution?.executor_agent_id === ex
        && isAgentId(ex)
        && Array.isArray(t.execution?.actions)
        && t.execution.actions.length > 0
        && t.execution.actions.every((/** @type {any} */ action) => typeof action === 'string' && action.length > 0)
        && hasNonemptyEvidence(t.execution?.evidence)
        && retainedExecutionApproval;
      const planned = t.plan?.postconditions;
      const verified = t.verification?.postconditions;
      const exactPostconditions = Array.isArray(planned)
        && planned.length > 0
        && Array.isArray(verified)
        && planned.length === verified.length
        && planned.every((/** @type {any} */ postcondition, /** @type {number} */ index) => (
          verified[index]?.postcondition === postcondition
          && verified[index].ok === true
          && typeof verified[index].evidence === 'string'
          && verified[index].evidence.length > 0
        ));
      const exactCouncilShip = isExactOperationCouncilShip(t);
      const verificationPass = t.verification?.verifier_agent_id === vr
        && isAgentId(vr)
        && vr !== ex
        && exactPostconditions
        && isResolvedOperationJudgment(t.verification, exactCouncilShip)
        && hasNonemptyEvidence(t.verification?.evidence);
      const auditPass = t.audit?.required === true
        ? isAgentId(t.audit.audit_agent_id)
          && t.audit.audit_agent_id === au
          && au !== ex
          && au !== vr
          && isResolvedOperationJudgment(t.audit, exactCouncilShip)
          && hasNonemptyEvidence(t.audit.evidence)
        : t.audit?.verdict === 'pass' || t.audit?.verdict === 'na';
      if (!executionPass || !verificationPass || !auditPass) {
        out.push(`task ${id}: done operation requires executed actions/evidence, independent passing verification, and conditional audit pass [inv4]`);
      }
    }

    if (t.status === 'done' && t.category !== 'operation') {
      const tests = t.tests || {};
      const g = tests.green;
      const evidence = jqOr(tests.evidence, []);
      // Item 1 (documented strictness, Chef call 2026-07-03). cook.sh's jq is
      // `$g != true and ((evidence // []) | length) == 0 …`; the `and`
      // short-circuits, so when tests.green == true the `length` is never
      // evaluated and a `done` task with green:true + a boolean (non-lengthable)
      // evidence stays exit 0. We evaluate jqLength(evidence) EAGERLY, so a boolean
      // evidence throws → fail CLOSED (exit 1). Deliberate: an unlengthable evidence
      // is malformed; we refuse rather than silently pass. (Bug-for-bug would gate
      // this call behind `g !== true`; we deliberately don't.)
      const evLen = jqLength(evidence);
      const reviewVerdict = (t.review && t.review.verdict != null) ? t.review.verdict : null;
      if (g !== true && (g !== 'na' || evLen === 0 || reviewVerdict !== 'pass')) {
        out.push(`task ${id}: done but tests.green != true (and not a justified "na" no-test state: needs tests.green=="na" + non-empty tests.evidence + review.verdict=="pass") [inv4]`);
      }
      if (g === true && (ta === null || ta === im)) {
        out.push(`task ${id}: done but tests not authored by a non-implementer [inv4]`);
      }
      const shippedCouncil = t.convergence?.council?.convened === true
        && t.convergence.council.verdict === 'ship'
        && t.convergence.council.outcome === 'shipped';
      const councilSources = shippedCouncil
        ? new Set(t.convergence.council.findings.map((/** @type {any} */ finding) => finding.source))
        : new Set();
      const legacyCouncilStage = councilSources.has(undefined) ? t.convergence.council.stage : null;
      const councilResolved = (/** @type {'review' | 'review2' | 'audit'} */ source) => (
        councilSources.has(source) || (legacyCouncilStage === 'review' && source !== 'audit') || legacyCouncilStage === source
      );
      if (reviewVerdict !== 'pass' && !councilResolved('review')) {
        out.push(`task ${id}: done but review.verdict != pass [inv4]`);
      }
      const isHistoricalSingleReview = !Object.hasOwn(t, 'review2')
        && (Object.hasOwn(agents, 'plan_agent_id') || Object.hasOwn(agents, 'test_author_agent_id'));
      const isComplex = t.complexity !== 'simple' && !isHistoricalSingleReview;
      if (isComplex && (!isType(t.review2, 'object') || (t.review2.verdict !== 'pass' && !councilResolved('review2')))) {
        out.push(`task ${id}: complex done task requires a recorded second review with review2.verdict == pass [inv4]`);
      } else if (!isComplex && t.review2 !== null && t.review2 !== undefined
        && t.review2.verdict !== 'pass' && !councilResolved('review2')) {
        out.push(`task ${id}: done but review2.verdict != pass [inv4]`);
      }
      const av = jqOr(t.audit && t.audit.verdict, 'na');
      if (av !== 'pass' && av !== 'na' && !councilResolved('audit')) {
        out.push(`task ${id}: done but audit.verdict not pass|na [inv4]`);
      }
    }

    // inv5a: deps and discoveredFrom name live tasks or terminally pruned
    // predecessors (registry invariant, full only)
    if (dependencyIds !== null) {
      for (const d of jqOr(t.deps, [])) {
        if (!dependencyIds.has(d)) {
          out.push(`task ${id}: dep ${jqStr(d)} is neither live nor terminally pruned [inv5]`);
        }
      }
      if (Object.hasOwn(t, 'discoveredFrom') && !dependencyIds.has(t.discoveredFrom)) {
        out.push(`task ${id}: discoveredFrom ${jqStr(t.discoveredFrom)} is neither live nor terminally pruned [inv5]`);
      }
    }

    // prune: a done/abandoned dir must not rest in the store (full only)
    if (!lite && (t.status === 'done' || t.status === 'abandoned')) {
      out.push(`task ${id}: status "${jqStr(t.status)}" task dir must not rest in the store; append the id to config prunedTaskIds only after it becomes terminal, leave successor deps intact, remove only the terminal dir, and commit the removal (archive is git history/tags) [prune]`);
    }

    // convergence block (inv7-11); absent ⇒ skipped
    convergenceChecks(t, id, ids, out);
    if (!hasTargetedRepairProof(t)) {
      out.push(`task ${id}: retained judgment lacks an exact confined repair proof [inv12]`);
    }

    // status-conditional required fields
    if (t.status === 'blocked' && jqOr(t.blockedReason, '') === '') {
      out.push(`task ${id}: blocked requires blockedReason`);
    }
    if (t.status === 'abandoned' && jqOr(t.abandonReason, '') === '') {
      out.push(`task ${id}: abandoned requires abandonReason`);
    }
  }

  // duplicate ids (registry invariant, full only): one line per duplicated id
  if (!lite) {
    const counts = new Map();
    for (const i of ids) counts.set(i, (counts.get(i) || 0) + 1);
    for (const [i, c] of counts) {
      if (c > 1) out.push(`duplicate task id ${jqStr(i)}`);
    }
  }

  // inv5b: dependency cycle via Kahn over the union of local edges for each
  // local id. Terminally pruned and unresolved external ids are not local edges.
  const localIds = new Set(ids);
  /** @type {Map<any, Set<any>>} */
  const dependenciesById = new Map();
  for (const task of tasks) {
    const dependencies = dependenciesById.get(task.id) ?? new Set();
    for (const dependency of Array.isArray(task.deps) ? task.deps : []) {
      if (localIds.has(dependency)) dependencies.add(dependency);
    }
    dependenciesById.set(task.id, dependencies);
  }
  let remaining = [...dependenciesById].map(([id, dependencies]) => ({
    id,
    deps: [...dependencies],
  }));
  /** @type {any[]} */
  let removed = [];
  for (;;) {
    const ready = remaining
      .filter((n) => n.deps.every((/** @type {any} */ d) => removed.includes(d)))
      .map((n) => n.id);
    if (ready.length === 0) {
      if (remaining.length > 0) {
        out.push(`dependency cycle among tasks ${JSON.stringify(remaining.map((n) => n.id))} [inv5]`);
      }
      break;
    }
    remaining = remaining.filter((n) => !ready.includes(n.id));
    removed = removed.concat(ready);
  }

  return out;
}

/**
 * Kickbacks raised by `stage` that carry a typed findings contract. The inv7
 * bound counts only these: judgment history also holds untyped kickbacks (a
 * convened council's block, a false-verification kick) that no counter ever
 * tracked, and those stay outside the bound.
 *
 * @param {any} t - the task object
 * @param {string} stage - the judgment source
 * @returns {any[]}
 */
function typedSourceKickbacks(t, stage) {
  return jqOr(t.kickbacks, []).filter((/** @type {any} */ k) => (
    k?.from === stage && Array.isArray(k.findings)
  ));
}

/**
 * The evidence a granted bonus cycle requires: the source's last typed
 * kickback is fully confined to implement/refactor and strictly smaller than
 * its predecessor. Fail-closed, so a missing predecessor is no evidence.
 *
 * @param {any[]} typed - that source's typed kickbacks, in recorded order
 * @returns {boolean}
 */
function hasBonusEvidence(typed) {
  const last = typed.at(-1);
  const previous = typed.at(-2);
  if (last === undefined || previous === undefined) return false;
  return last.findings.every((/** @type {any} */ f) => CONFINED_KICK_STAGES.includes(f?.kickTo))
    && last.findings.length < previous.findings.length;
}

/**
 * Convergence invariants inv7-11 (cook.sh:464-584). Absent `convergence` ⇒ no
 * checks. Present ⇒ asserted over the recorded state, fail-closed on bad shape.
 *
 * @param {any} t - the task object
 * @param {string} id - jq-rendered `t.id`
 * @param {any[]} ids - all task ids (for followupTaskId existence)
 * @param {string[]} out - violation accumulator
 * @returns {void}
 */
function convergenceChecks(t, id, ids, out) {
  const c = t.convergence;
  if (c === null || c === undefined) return;
  const cl = c.council;
  const conv = (cl !== null && cl !== undefined && cl.convened === true);
  const judgmentStages = t.category === 'operation' ? ['verify', 'audit'] : ['review', 'audit'];

  // inv7: cap integer ≥1; each of review/audit blockingKickbacks int in 0..cap.
  const cap = c.cap;
  if (typeof cap !== 'number' || cap < 1 || Math.floor(cap) !== cap) {
    out.push(`task ${id}: convergence.cap must be an integer ≥ 1 [inv7]`);
  } else {
    for (const st of judgmentStages) {
      const counter = c.stages?.[st];
      const bk = counter?.blockingKickbacks;
      if (typeof bk !== 'number' || bk < 0 || bk > cap || Math.floor(bk) !== bk) {
        out.push(`task ${id}: convergence.stages.${st}.blockingKickbacks must be an integer in 0..${cap} [inv7]`);
      }
      const bonus = counter?.bonusGranted === true;
      const typed = typedSourceKickbacks(t, st);
      if (bonus && !hasBonusEvidence(typed)) {
        out.push(`task ${id}: convergence.stages.${st}.bonusGranted requires a strictly smaller, fully confined last typed kickback [inv7]`);
      }
      const allowed = cap + (bonus ? 1 : 0);
      if (typed.length > allowed) {
        out.push(`task ${id}: convergence.stages.${st} allows at most ${allowed} typed kickbacks, found ${typed.length} [inv7]`);
      }
    }
  }

  // inv8 (F5): convergence present ⇒ council must be a non-null object.
  if (!isType(cl, 'object')) {
    out.push(`task ${id}: convergence present requires a non-null council object [inv8]`);
  }

  // inv8 (F4): closed enums on a non-null council object.
  if (isType(cl, 'object')) {
    const vd = cl.verdict != null ? cl.verdict : null;
    if (![null, 'ship', 'block'].includes(vd)) {
      out.push(`task ${id}: council.verdict must be one of null, ship, block [inv8]`);
    }
    const oc = cl.outcome != null ? cl.outcome : null;
    if (![null, 'shipped', 'scoped-fix-shipped', 'blocked-to-operator'].includes(oc)) {
      out.push(`task ${id}: council.outcome must be one of null, shipped, scoped-fix-shipped, blocked-to-operator [inv8]`);
    }
  }

  // inv8: council.convened must be a proper boolean (fail CLOSED on coercion).
  if (isType(cl, 'object') && typeof cl.convened !== 'boolean') {
    out.push(`task ${id}: council.convened must be a boolean [inv8]`);
  }

  // inv8: a non-convened council may not carry verdict == block.
  if (isType(cl, 'object') && !conv && cl.verdict === 'block') {
    out.push(`task ${id}: a non-convened council must not carry verdict == block [inv8]`);
  }

  // inv8: council distinctness (only when convened).
  if (conv) {
    const mem = jqOr(cl.members, []);
    const mids = mem.map((/** @type {any} */ m) => (m == null ? null : m.agent_id));
    const lenses = mem.map((/** @type {any} */ m) => (m == null ? null : m.lens));
    const forbidden = forbiddenCouncilAgentIds(t);
    if (mem.length !== 3) out.push(`task ${id}: convened council must have exactly 3 members [inv8]`);
    if (new Set(mids).size !== mids.length) {
      out.push(`task ${id}: council member agent_ids must be mutually distinct [inv8]`);
    }
    for (const mid of mids) {
      if (forbidden.has(mid)) {
        out.push(`task ${id}: council member ${jqStr(mid)} overlaps a forbidden prior judge [inv8]`);
      }
    }
    if (JSON.stringify([...lenses].sort()) !== JSON.stringify(['integrity', 'pragmatist', 'security'])) {
      out.push(`task ${id}: council lenses must be exactly integrity, security, pragmatist [inv8]`);
    }
    const synthesizerId = cl.synthesizer_agent_id;
    if (cl.synthesis !== undefined
      && (!isAgentId(synthesizerId)
        || mids.includes(synthesizerId)
        || forbidden.has(synthesizerId))) {
      out.push(`task ${id}: council synthesizer must be a fresh host-observed identity [inv8]`);
    }
    if (!judgmentStages.includes(cl.stage)) {
      out.push(`task ${id}: convened council.stage must be ${judgmentStages.join(' or ')} [inv8]`);
    }
  }
  const researchProvenance = cl?.researchProvenance;
  const hasResearch = cl?.synthesis !== undefined
    || cl?.synthesizer_agent_id !== undefined
    || jqOr(cl?.members, []).some((/** @type {any} */ member) => member?.inquiry !== undefined);
  const researchViolation = councilResearchViolation(cl, {
    allowOmission: researchProvenance === 'historical-omitted'
      || (researchProvenance === undefined && !requiresCouncilResearchProvenance(t)),
    category: t.category === 'operation' ? 'operation' : 'code',
  });
  if (researchViolation !== null) {
    out.push(`task ${id}: council.${researchViolation} is invalid canonical research [inv8]`);
  }
  if (researchProvenance === 'historical-omitted' && hasResearch) {
    out.push(`task ${id}: council research provenance is inconsistent with historical omission [inv8]`);
  }

  // inv9: per-finding determinism (only when convened).
  if (conv) {
    const fs = jqOr(cl.findings, []);
    if (fs.length < 1) out.push(`task ${id}: convened council must record at least one finding [inv9]`);
    for (const f of fs) {
      const bv = f == null ? undefined : f.blockingVotes;
      if (typeof bv !== 'number' || bv < 0 || bv > 3 || Math.floor(bv) !== bv) {
        out.push(`task ${id}: finding ${jqStr(f == null ? null : f.id)} blockingVotes must be an integer in 0..3 [inv9]`);
      }
    }
    for (const f of fs) {
      const expected = jqOr(f == null ? undefined : f.blockingVotes, -1) >= 2;
      const survived = f == null ? undefined : f.survived;
      if (survived !== expected) {
        out.push(`task ${id}: finding ${jqStr(f == null ? null : f.id)} survived must equal (blockingVotes ≥ 2) [inv9]`);
      }
    }
    const anySurvived = fs.some((/** @type {any} */ f) => f != null && f.survived === true);
    const expectedVerdict = anySurvived ? 'block' : 'ship';
    if (cl.verdict !== expectedVerdict) {
      out.push(`task ${id}: council verdict must be "${expectedVerdict}" given the per-finding survivals [inv9]`);
    }
  }

  // inv10: follow-up tracking (only when convened).
  if (conv) {
    const fs = jqOr(cl.findings, []);
    for (const f of fs) {
      const fid = jqStr(f == null ? null : f.id);
      const fut = (f == null || f.followupTaskId == null) ? null : f.followupTaskId;
      const survived = f == null ? undefined : f.survived;
      if (survived === true) {
        if (fut !== null) out.push(`task ${id}: surviving finding ${fid} must have followupTaskId == null [inv10]`);
      } else if (fut === null) {
        out.push(`task ${id}: follow-up finding ${fid} must record a followupTaskId [inv10]`);
      } else if (fut !== LEDGER_FOLLOWUP && !ids.includes(fut)) {
        out.push(`task ${id}: finding ${fid} followupTaskId ${jqStr(fut)} must be ${jqStr(LEDGER_FOLLOWUP)} or an existing task [inv10]`);
      }
    }
  }
  const recovery = c.recovery;
  if (recovery !== undefined) {
    if (t.category === 'operation' || recovery?.episode !== 1 || !conv || cl.verdict !== 'block') {
      out.push(`task ${id}: recovery must be exactly episode 1 of a blocking code council [inv11]`);
    }
    if (cl?.synthesis !== undefined && recovery?.route !== cl.synthesis.selectedStrategy) {
      out.push(`task ${id}: recovery route must equal council synthesis selectedStrategy [inv11]`);
    }
    const original = recovery?.original;
    if (!isType(original, 'object')) {
      out.push(`task ${id}: recovery must retain original delivery lineage [inv11]`);
    } else {
      if (original.complexity === 'complex' && t.complexity !== 'complex') {
        out.push(`task ${id}: recovery cannot lower original complexity [inv11]`);
      }
      if (original.audit_required === true && t.audit?.required !== true) {
        out.push(`task ${id}: recovery cannot lower the original audit floor [inv11]`);
      }
      if (isType(original.implement, 'object')
        && original.builder_agent_id !== original.implement.agent_id) {
        out.push(`task ${id}: recovery original builder must match the captured implementation [inv11]`);
      }
    }
    const testAuthor = recovery?.test_author_agent_id;
    const builder = recovery?.builder_agent_id;
    if (isAgentId(testAuthor)
      && (testAuthor !== t.tests?.authored_by_agent_id
        || !isRecoveryParticipantEligible(t, testAuthor, 'test author'))) {
      out.push(`task ${id}: recovery test author violates identity separation [inv11]`);
    }
    if (isAgentId(builder) && !isRecoveryParticipantEligible(t, builder, 'builder')) {
      out.push(`task ${id}: recovery builder violates identity separation [inv11]`);
    }
    if (['test-contract-repair', 'operator-escalation'].includes(recovery?.route)
      && builder !== null) {
      out.push(`task ${id}: recovery route cannot carry a production builder [inv11]`);
    }
    if (['confined-repair', 'refactor', 'operator-escalation'].includes(recovery?.route)
      && testAuthor !== null) {
      out.push(`task ${id}: recovery route cannot carry fresh test authorship [inv11]`);
    }
    const judgmentStage = ['review', 'audit', 'done'].includes(t.stage);
    const productionRoutes = [
      'confined-repair',
      'refactor',
      'causal-subgraph-reconstruction',
      'full-replan',
    ];
    if (judgmentStage && productionRoutes.includes(recovery?.route)) {
      const recordedBuilder = recovery.route === 'refactor'
        ? t.refactor?.agent_id
        : t.implement?.agent_id;
      if (!isAgentId(builder) || builder !== recordedBuilder) {
        out.push(`task ${id}: production recovery builder must match the recorded recovery change [inv11]`);
      }
    }
    if (recovery?.route === 'operator-escalation'
      && (cl.outcome !== 'blocked-to-operator' || t.status !== 'blocked')) {
      out.push(`task ${id}: operator escalation must block the same task [inv11]`);
    }
  }

  if (t.category === 'operation' && t.status === 'done' && conv
    && cl.verdict === 'block' && cl.outcome === 'scoped-fix-shipped'
    && !hasScopedOperationCouncilProof(t)) {
    out.push(`task ${id}: scoped-fix-shipped requires exactly one fresh adjacent recovery [operation-recovery] [inv11]`);
  }
  // inv11: block resolution / done-gate.
  if (conv && cl.verdict === 'block' && cl.outcome === 'blocked-to-operator'
    && t.status !== 'blocked' && t.status !== 'abandoned') {
    out.push(`task ${id}: council blocked-to-operator requires status == blocked or abandoned [inv11]`);
  }
  if (t.status === 'done' && conv && cl.verdict === 'block' && cl.outcome !== 'scoped-fix-shipped') {
    out.push(`task ${id}: done with an unresolved council block (outcome != scoped-fix-shipped) [inv11]`);
  }
}
