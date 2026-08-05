// @ts-check

import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { collectTasks, readConfig, readTask, writeTask } from './store.js';
import { locateTask, withStoreLock } from './store-lock.js';
import { appendJournalEvents } from './journal.js';
import { git, treeDirty } from './git.js';
import { configSchemaViolations, isIsoDateTime, taskSchemaViolations } from './task-schema.js';
import { runInvariants } from './invariants.js';
import { validateSpecialistReturn } from './record-contract.js';
import {
  activeRefuterAgentIds,
  archivedJudgeAgentIds,
  forbiddenCouncilAgentIds,
  isAgentId,
  isArchivedVerifierAgentForbidden,
  isRefuteAgentForbidden,
} from './identity-policy.js';
import {
  currentOperationCycle,
  hasBoundPendingApprovalRequest,
  isSameApproval,
  latestApprovalRequest,
  nextOperationExecutionCycle,
  OPERATION_STATE_VERSION,
} from './operation-state.js';

/** @typedef {import('./types.js').TaskJson} TaskJson */
/** @typedef {Record<string, any>} MutableRecordTask */

const now = () => `${new Date().toISOString().slice(0, 19)}Z`;
const KICKBACK_STAGE_ORDER = ['capture', 'plan', 'execute', 'implement', 'refactor'];
// The repair destinations a kickback stays confined to.
const CONFINED_KICK_STAGES = ['implement', 'refactor'];
const FALSE_VERIFICATION_REASON = 'Verifier postconditions remain false after finding demotion.';
const DEFAULT_CONVERGENCE = {
  cap: 2,
  stages: { review: { blockingKickbacks: 0 }, audit: { blockingKickbacks: 0 } },
  council: { convened: false, stage: null, members: [], findings: [], verdict: null, outcome: null },
};

/** @param {MutableRecordTask} task */
function isOperation(task) {
  return task.category === 'operation';
}

/** @param {Record<string, any>} result */
function isOperationPlanReturn(result) {
  return result.result === 'plan'
    || (result.result === 'escalation' && !Object.hasOwn(result, 'refactorOpportunity'));
}

/** @param {MutableRecordTask} task */
function plannedApprovalBoundary(task) {
  if (!isOperation(task) || task.plan?.requiresApproval !== true) return null;
  return typeof task.plan.approvalBoundary === 'string' ? task.plan.approvalBoundary : null;
}


/** @param {MutableRecordTask} task */
function isAwaitingCouncil(task) {
  return task.convergence?.council?.convened === false
    && task.convergence.council.stage !== null;
}


/** @param {MutableRecordTask} task */
function defaultConvergence(task) {
  if (!isOperation(task)) return structuredClone(DEFAULT_CONVERGENCE);
  return {
    cap: 2,
    stages: { verify: { blockingKickbacks: 0 }, audit: { blockingKickbacks: 0 } },
    council: { convened: false, stage: null, members: [], findings: [], verdict: null, outcome: null },
  };
}

/** @param {any} outcome */
function hasBlockingFinding(outcome) {
  return outcome?.findings?.some((/** @type {any} */ finding) => finding.class === 'blocking') === true;
}

/** @param {Record<string, any>} result @param {string} nonBlockingVerdict */
function judgmentVerdict(result, nonBlockingVerdict) {
  return hasBlockingFinding(result) ? 'needs-work' : nonBlockingVerdict;
}

/** @param {any} outcome */
function isConsistentJudgment(outcome) {
  if (!['pass', 'needs-work'].includes(outcome?.verdict)) return !hasBlockingFinding(outcome);
  return outcome.verdict === judgmentVerdict(outcome, 'pass');
}

/** @param {any} outcome */
function isPassingJudgment(outcome) {
  return outcome?.verdict === 'pass' && isConsistentJudgment(outcome);
}

/** @param {any} outcome */
function isFailingJudgment(outcome) {
  return outcome?.verdict === 'needs-work' && isConsistentJudgment(outcome);
}

/** @param {MutableRecordTask} task */
function isOperationReverifyEligible(task) {
  const findings = task.verification?.findings;
  return isOperation(task)
    && task.status === 'in_progress'
    && task.stage === 'verify'
    && task.execution?.result === 'executed'
    && isAgentId(task.agents?.executor_agent_id)
    && task.execution.executor_agent_id === task.agents.executor_agent_id
    && Array.isArray(findings)
    && isFailingJudgment(task.verification)
    && isAgentId(task.agents?.verifier_agent_id)
    && task.verification.verifier_agent_id === task.agents.verifier_agent_id
    && !findings.some((/** @type {any} */ finding) => finding.refute != null)
    && task.convergence?.council?.stage === null
    && task.convergence.council.convened === false
    && !findings.some((/** @type {any} */ finding) => (
      finding.class === 'blocking' && finding.kickTo === 'execute'
    ));
}

/** @param {MutableRecordTask} task */
function haveActiveBlockersSurvivedRefute(task) {
  return judgmentSources(task).every(({ source, outcome }) => (
    (outcome?.findings ?? [])
      .filter((/** @type {any} */ finding) => finding.class === 'blocking')
      .every((/** @type {any} */ finding) => (
        finding.refute?.source === source && finding.refute.verdict === 'survives'
      ))
  ));
}

/** @param {MutableRecordTask} task @param {string} at */
function judgmentHistoryEntry(task, at) {
  if (isOperation(task)) {
    return {
      cycle: task.judgmentHistory?.length ?? 0,
      at,
      verification: task.verification,
      audit: task.audit,
      agents: {
        verifier_agent_id: task.agents.verifier_agent_id,
        audit_agent_id: task.agents.audit_agent_id,
      },
    };
  }
  return {
    at,
    review: task.review,
    review2: task.review2 ?? null,
    audit: task.audit,
    agents: {
      reviewer_agent_id: task.agents.reviewer_agent_id,
      reviewer2_agent_id: task.agents.reviewer2_agent_id,
      audit_agent_id: task.agents.audit_agent_id,
    },
  };
}

/** @param {MutableRecordTask} task */
function activeJudgmentCycle(task) {
  return isOperation(task)
    ? currentOperationCycle(task)
    : task.judgmentHistory?.length ?? 0;
}

/** @param {MutableRecordTask} task */
function isPendingCouncilRecovery(task) {
  return task.convergence?.council?.convened === true
    && task.convergence.council.verdict === 'block'
    && task.convergence.council.outcome === null;
}

/** @param {MutableRecordTask} task @param {Record<string, any>} result */
function assertCurrentJudgment(task, result) {
  if (task.status === 'done' || task.stage === 'done') {
    throw new Error('[record-transition] task is done; judgment return is no longer active');
  }
  if (result.cycle !== activeJudgmentCycle(task)) {
    throw new Error(`[record-transition] judgment cycle ${result.cycle} is not active`);
  }
  const builderId = isOperation(task)
    ? task.agents.executor_agent_id
    : task.agents.implementer_agent_id;
  if (isPendingCouncilRecovery(task) && builderId === result.agent_id) {
    throw new Error(`[record-identity] recovery judge ${result.agent_id} violates specialist separation`);
  }
  if (isPendingCouncilRecovery(task) && isOperation(task)) {
    const priorRecoveryIds = new Set([
      ...archivedJudgeAgentIds(task),
      ...(task.convergence.council.members ?? [])
        .map((/** @type {any} */ member) => member.agent_id),
    ]);
    if (priorRecoveryIds.has(result.agent_id)) {
      throw new Error(`[record-identity] recovery ${result.stage} must use a fresh identity, not a previous judge or council member`);
    }
  }
  const currentAgentIds = [
    task.review?.reviewer_agent_id,
    task.review2?.reviewer_agent_id,
    task.verification?.verifier_agent_id,
    task.audit?.audit_agent_id,
    ...activeRefuterAgentIds(task),
  ];
  if (currentAgentIds.includes(result.agent_id)) {
    throw new Error(`[record-transition] duplicate agent return from ${result.agent_id}`);
  }
}

/** @param {MutableRecordTask} task */
function settleJudgments(task) {
  if (isOperation(task)) {
    const blockingVerification = hasBlockingFinding(task.verification);
    const blockingAudit = hasBlockingFinding(task.audit);
    task.status = 'in_progress';
    if (isAwaitingCouncil(task)) task.stage = task.convergence.council.stage;
    else if (!task.verification?.verifier_agent_id) task.stage = 'verify';
    else if (blockingAudit) task.stage = 'audit';
    else if (blockingVerification) task.stage = 'verify';
    else if (task.audit.required && !task.audit.audit_agent_id) task.stage = 'audit';
    else if (isPendingCouncilRecovery(task)) task.stage = task.convergence.council.stage;
    else {
      task.stage = 'done';
      task.status = 'done';
    }
    return;
  }

  const requiredReviews = task.complexity === 'simple' ? 1 : 2;
  const reviews = [task.review, task.review2].filter((outcome) => outcome?.reviewer_agent_id);
  const blockingReview = reviews.some(hasBlockingFinding);
  const blockingAudit = hasBlockingFinding(task.audit);

  task.status = 'in_progress';
  if (isAwaitingCouncil(task)) task.stage = task.convergence.council.stage;
  else if (blockingAudit) task.stage = 'audit';
  else if (blockingReview || reviews.length < requiredReviews) task.stage = 'review';
  else if (task.audit.required && !task.audit.audit_agent_id) task.stage = 'audit';
  else if (isPendingCouncilRecovery(task)) task.stage = task.convergence.council.stage;
  else {
    task.stage = 'done';
    task.status = 'done';
  }
}

/** @param {MutableRecordTask} task */
function hasFalseVerificationPostcondition(task) {
  return isOperation(task)
    && task.verification?.postconditions?.some((/** @type {any} */ row) => row.ok !== true) === true;
}

/** @param {MutableRecordTask} task @param {string} at */
function kickFalseVerificationToExecute(task, at) {
  task.kickbacks = [...task.kickbacks, {
    from: 'verify',
    to: 'execute',
    reason: FALSE_VERIFICATION_REASON,
    at,
  }];
  task.stage = 'execute';
  task.status = 'in_progress';
}

/** @param {MutableRecordTask} task @param {string} at @param {Set<string>} [sources] */
function archiveAndResetJudgments(task, at, sources) {
  task.judgmentHistory = [
    ...(task.judgmentHistory ?? []),
    judgmentHistoryEntry(task, at),
  ];
  if (sources === undefined || sources.has('audit')) {
    task.agents.audit_agent_id = null;
    task.audit = { required: task.audit.required, verdict: 'na', audit_agent_id: null, findings: [], evidence: [] };
  }
  if (isOperation(task)) {
    task.agents.verifier_agent_id = null;
    task.verification = { verdict: null, verifier_agent_id: null, postconditions: [], findings: [], evidence: [] };
    return;
  }
  if (sources === undefined || sources.has('review')) {
    task.agents.reviewer_agent_id = null;
    task.agents.reviewer2_agent_id = null;
    task.review = { verdict: null, reviewer_agent_id: null, findings: [], evidence: [] };
    task.review2 = null;
  }
}

/**
 * @param {MutableRecordTask} task
 * @param {Record<string, any>[]} kickbacks
 * @param {unknown} files
 */
function isScopedCodeRepair(task, kickbacks, files) {
  const council = task.convergence?.council;
  if (isOperation(task)
    || council?.stage != null
    || council?.convened === true
    || !Array.isArray(files)
    || files.length === 0
    || kickbacks.length === 0) return false;
  const findings = kickbacks.flatMap((kickback) => (
    Array.isArray(kickback.findings) ? kickback.findings : []
  ));
  return kickbacks.every((kickback) => (
    Array.isArray(kickback.findings)
    && kickback.findings.length > 0
    && kickback.findings.every((/** @type {any} */ finding) => (
      ['review', 'review2', 'audit'].includes(finding.source)
      && typeof finding.file === 'string'
      && finding.file.length > 0
      && Number.isInteger(finding.line)
      && finding.line >= 1
      && typeof finding.what === 'string'
      && finding.what.length > 0
      && CONFINED_KICK_STAGES.includes(finding.kickTo)
      && (finding.source === kickback.from
        || (kickback.from === 'review' && finding.source === 'review2'))
    ))
  ))
    && files.every((file) => findings.some((/** @type {any} */ finding) => finding.file === file));
}

/** @param {MutableRecordTask} task @param {any} history @param {'review' | 'audit'} source */
function sourceJudgments(task, history, source) {
  if (source === 'audit') {
    return [[task.audit, history?.audit, 'audit_agent_id', 'audit_agent_id']];
  }
  return [
    [task.review, history?.review, 'reviewer_agent_id', 'reviewer_agent_id'],
    [task.review2, history?.review2, 'reviewer_agent_id', 'reviewer2_agent_id'],
  ];
}

/** @param {MutableRecordTask} task @param {any} history @param {'review' | 'audit'} source */
function hasUnarchivedFailure(task, history, source) {
  return sourceJudgments(task, history, source).some(([live, archived, identity, agentIdentity]) => {
    const liveId = live?.[identity] ?? task.agents?.[agentIdentity];
    const archivedId = archived?.[identity] ?? history?.agents?.[agentIdentity];
    return isFailingJudgment(live) && liveId != null && liveId !== archivedId;
  });
}

/** @param {MutableRecordTask} task @param {any} history */
function hasRetainedJudgment(task, history) {
  return ['review', 'audit'].some((source) => (
    sourceJudgments(task, history, /** @type {'review' | 'audit'} */ (source))
      .some(([live, archived, identity, agentIdentity]) => {
        const liveId = live?.[identity] ?? task.agents?.[agentIdentity];
        const archivedId = archived?.[identity] ?? history?.agents?.[agentIdentity];
        return isPassingJudgment(live) && liveId != null && liveId === archivedId;
      })
  ));
}

/**
 * @param {MutableRecordTask} task
 * @param {Record<string, any>} latest
 * @param {('review' | 'audit')[]} sources
 */
function judgmentRoundKickbacks(task, latest, sources) {
  return sources.map((source) => task.kickbacks.findLast((/** @type {any} */ kickback) => (
    kickback.from === source && kickback.at === latest.at
  ))).filter((kickback) => kickback !== undefined);
}

/** @param {MutableRecordTask} task */
function codeJudgmentKickbacks(task) {
  return task.kickbacks.filter((/** @type {any} */ kickback) => (
    ['review', 'audit'].includes(kickback.from)
  ));
}

/** @param {MutableRecordTask} task */
function currentCodeRepairRound(task) {
  return codeJudgmentKickbacks(task).length;
}


/** @param {MutableRecordTask} task @param {string} at @param {unknown} [files] */
function resetJudgmentsAfterFix(task, at, files) {
  const hasCurrentJudgment = judgmentSources(task).some(({ outcome }) => (
    outcome?.reviewer_agent_id != null
    || outcome?.verifier_agent_id != null
    || outcome?.audit_agent_id != null
  )) || [
    task.agents.reviewer_agent_id,
    task.agents.reviewer2_agent_id,
    task.agents.verifier_agent_id,
    task.agents.audit_agent_id,
  ].some((agentId) => agentId != null);
  if (!hasCurrentJudgment) return false;
  if (isOperation(task)) {
    const latestKickback = task.kickbacks.findLast((/** @type {any} */ kickback) => (
      judgmentSources(task).some(({ source }) => source === kickback.from)
    ));
    if (!latestKickback) return false;
    const latestHistory = task.judgmentHistory?.at(-1);
    if (latestHistory && !isIsoDateTime(latestHistory.at)) {
      throw new Error('[record-transition] judgmentHistory latest at is invalid');
    }
    if (latestHistory && Date.parse(latestKickback.at) <= Date.parse(latestHistory.at)) return false;
    archiveAndResetJudgments(task, at);
    return false;
  }
  const judgmentKickbacks = codeJudgmentKickbacks(task);
  const latestJudgmentKickback = judgmentKickbacks.at(-1);
  if (!latestJudgmentKickback) return false;
  const latestHistory = task.judgmentHistory?.at(-1);
  if (latestHistory && !isIsoDateTime(latestHistory.at)) {
    throw new Error('[record-transition] judgmentHistory latest at is invalid');
  }
  const sources = /** @type {('review' | 'audit')[]} */ (['review', 'audit']);
  const activeSources = sources.filter((source) => hasUnarchivedFailure(task, latestHistory, source));
  if (latestHistory
    && (latestJudgmentKickback.findings === undefined
      || (Array.isArray(latestJudgmentKickback.findings)
        && latestJudgmentKickback.findings.length === 0))
    && Date.parse(latestJudgmentKickback.at) <= Date.parse(latestHistory.at)
    && (Date.parse(latestJudgmentKickback.at) < Date.parse(latestHistory.at)
      || activeSources.length === 0)) {
    return false;
  }

  if (activeSources.includes(latestJudgmentKickback.from)) {
    const activeKickbacks = judgmentRoundKickbacks(task, latestJudgmentKickback, activeSources);
    const scoped = activeKickbacks.length === activeSources.length
      && isScopedCodeRepair(task, activeKickbacks, files);
    archiveAndResetJudgments(
      task,
      at,
      scoped ? new Set(activeSources) : undefined,
    );
    return scoped;
  }

  if (!latestHistory || !hasRetainedJudgment(task, latestHistory)) return false;
  const raisingSources = sources.filter((source) => (
    sourceJudgments(task, latestHistory, source).some(([, archived]) => isFailingJudgment(archived))
  ));
  const consumedKickbacks = judgmentRoundKickbacks(task, latestJudgmentKickback, raisingSources);
  const includesImplement = consumedKickbacks.some((kickback) => (
    kickback.to === 'implement'
    || kickback.findings?.some((/** @type {any} */ finding) => finding.kickTo === 'implement')
  ));
  const scoped = consumedKickbacks.length === raisingSources.length
    && isScopedCodeRepair(task, consumedKickbacks, files)
    && (!includesImplement
      || isScopedCodeRepair(task, consumedKickbacks, task.implement?.files));
  if (!scoped) archiveAndResetJudgments(task, at);
  return scoped;
}

/** @param {MutableRecordTask} task @param {Record<string, any>} result */
function recordReview(task, result) {
  const firstOccupied = task.review?.reviewer_agent_id != null || task.agents.reviewer_agent_id != null;
  const secondOccupied = task.review2?.reviewer_agent_id != null || task.agents.reviewer2_agent_id != null;
  if (firstOccupied && secondOccupied) {
    throw new Error('[record-transition] both review slots are already occupied for this judgment cycle');
  }
  const second = firstOccupied;
  const target = second ? 'review2' : 'review';
  if (second) task.agents.reviewer2_agent_id = result.agent_id;
  else task.agents.reviewer_agent_id = result.agent_id;
  task[target] = {
    verdict: judgmentVerdict(result, 'pass'),
    reportedVerdict: result.verdict,
    reviewer_agent_id: result.agent_id,
    findings: result.findings,
    evidence: result.evidence,
    acLedger: result.acLedger,
  };
  settleJudgments(task);
}

/** @param {MutableRecordTask} task @param {Record<string, any>} result */
function recordVerify(task, result) {
  if (task.verification?.verifier_agent_id != null || task.agents.verifier_agent_id != null) {
    throw new Error('[record-transition] verification slot is already occupied for this judgment cycle');
  }
  if (task.agents.executor_agent_id === result.agent_id) {
    throw new Error('[inv2] executor == verifier');
  }
  if (isArchivedVerifierAgentForbidden(task, result.agent_id)) {
    throw new Error(
      `[record-identity] verifier ${result.agent_id} must use a fresh identity, not an archived verifier`,
    );
  }
  const planned = task.plan?.postconditions;
  if (!Array.isArray(planned)
    || planned.length !== result.postconditions.length
    || planned.some((/** @type {string} */ postcondition, /** @type {number} */ index) => (
      postcondition !== result.postconditions[index].postcondition
    ))) {
    throw new Error('[record-transition] verification postconditions must exactly match the plan in order');
  }
  task.agents.verifier_agent_id = result.agent_id;
  task.verification = {
    verdict: judgmentVerdict(result, 'pass'),
    reportedVerdict: result.verdict,
    verifier_agent_id: result.agent_id,
    postconditions: result.postconditions,
    findings: result.findings,
    evidence: result.evidence,
  };
  settleJudgments(task);
}

/** @param {MutableRecordTask} task @param {Record<string, any>} result */
function recordAudit(task, result) {
  if (task.audit?.audit_agent_id != null || task.agents.audit_agent_id != null) {
    throw new Error('[record-transition] audit slot is already occupied for this judgment cycle');
  }
  if (isOperation(task) && task.audit.required === true && result.verdict === 'na') {
    throw new Error('[record-transition] required audit cannot return na');
  }
  if (!isOperation(task) && task.agents.implementer_agent_id === result.agent_id) {
    throw new Error('[inv2] implementer == auditor');
  }
  if (isOperation(task) && task.agents.executor_agent_id === result.agent_id) {
    throw new Error('[inv2] executor == auditor');
  }
  task.agents.audit_agent_id = result.agent_id;
  task.audit = {
    ...task.audit,
    verdict: judgmentVerdict(result, result.verdict === 'needs-work' ? 'pass' : result.verdict),
    reportedVerdict: result.verdict,
    audit_agent_id: result.agent_id,
    findings: result.findings,
    evidence: result.evidence,
    scan: result.scan,
    coverage: result.coverage,
  };
  settleJudgments(task);
}

/**
 * A source that has reached the cap buys one bonus cycle before the council
 * arms, and only on recorded evidence: it has not spent the bonus already,
 * every survivor in this round is confined to a repair stage, and the round is
 * strictly smaller than the last kickback that source raised. A historical
 * kickback carrying no findings contract is never evidence.
 *
 * @param {MutableRecordTask} task
 * @param {{convergenceStage: string, counter: Record<string, any>, survivors: Record<string, any>[]}} group
 * @returns {boolean}
 */
function isBonusEligible(task, { convergenceStage, counter, survivors }) {
  if (counter.bonusGranted === true) return false;
  if (!survivors.every(({ finding }) => CONFINED_KICK_STAGES.includes(finding.kickTo))) return false;
  const last = codeJudgmentKickbacks(task).findLast((/** @type {any} */ kickback) => (
    kickback.from === convergenceStage
  ));
  return Array.isArray(last?.findings) && survivors.length < last.findings.length;
}

/** @param {MutableRecordTask} task @param {Record<string, any>} result @param {string} at */
function recordRefute(task, result, at) {
  const activeFindings = judgmentSources(task).flatMap(({ source, outcome }) => (
    (outcome?.findings ?? []).map((/** @type {any} */ finding) => ({ source, finding }))
  ));
  const sourceFindings = result.source === undefined
    ? activeFindings
    : activeFindings.filter(({ source }) => source === result.source);
  const candidates = sourceFindings.filter(({ finding }) => (
    result.finding === `${finding.file}:${finding.line} ${finding.what}`
  ));
  if (candidates.length > 1) throw new Error('[record-transition] refute finding identity is ambiguous');
  const target = candidates[0];
  const source = target?.source;
  const finding = target?.finding;
  if (!finding || finding.class !== 'blocking') throw new Error('[record-transition] refute finding is not an active blocker');
  if (finding.refute) throw new Error('[record-transition] finding already has a refute');
  const refute = { agent_id: result.agent_id, source, finding: result.finding, verdict: result.verdict, rationale: result.rationale, evidence: result.evidence };
  task.refutes = [...(task.refutes ?? []), refute];
  finding.refute = refute;
  if (result.verdict === 'refuted') {
    finding.class = 'follow-up';
    const outcome = judgmentSources(task).find((item) => item.source === source)?.outcome;
    outcome.verdict = hasBlockingFinding(outcome) ? 'needs-work' : 'pass';
  }

  if (activeFindings.some(({ finding: item }) => item.class === 'blocking' && !item.refute)) return;
  const hasSurvivor = activeFindings.some(({ finding: item }) => item.refute?.verdict === 'survives');

  const pendingRecovery = isPendingCouncilRecovery(task);
  if (pendingRecovery && (hasSurvivor || hasFalseVerificationPostcondition(task))) {
    blockCouncilRecovery(task);
    if (!hasSurvivor) task.blockedReason = FALSE_VERIFICATION_REASON;
    return;
  }
  if (hasSurvivor && task.convergence === undefined) {
    task.convergence = defaultConvergence(task);
  }

  const survivorGroups = [...new Set(
    judgmentSources(task).map(({ source }) => source === 'review2' ? 'review' : source),
  )].map((convergenceStage) => ({
    convergenceStage,
    counter: task.convergence?.stages?.[convergenceStage],
    survivors: activeFindings.filter(({ source: itemSource, finding: item }) => (
      (itemSource === 'review2' ? 'review' : itemSource) === convergenceStage
      && item.class === 'blocking'
      && item.refute?.verdict === 'survives'
    )),
  })).filter(({ survivors }) => survivors.length > 0);
  const cappedGroups = survivorGroups.filter(({ counter }) => (
    counter.blockingKickbacks >= task.convergence.cap
  ));
  const bonusGroups = cappedGroups.filter((group) => isBonusEligible(task, group));
  if (cappedGroups.some((group) => !bonusGroups.includes(group))) {
    if (task.convergence.council.convened !== true && task.convergence.council.stage === null) {
      task.convergence.council.stage = cappedGroups[0].convergenceStage;
    }
    settleJudgments(task);
    return;
  }
  for (const group of survivorGroups) {
    if (bonusGroups.includes(group)) group.counter.bonusGranted = true;
    else group.counter.blockingKickbacks += 1;
  }

  const kickbacks = survivorGroups.map(({ convergenceStage, survivors }) => {
    const destination = survivors
      .map(({ finding: item }) => item.kickTo)
      .sort((left, right) => KICKBACK_STAGE_ORDER.indexOf(left) - KICKBACK_STAGE_ORDER.indexOf(right))[0];
    return {
      from: convergenceStage,
      to: destination,
      reason: survivors.map(({ finding: item }) => item.what).join('; '),
      at,
      ...(isOperation(task) ? {} : {
        findings: survivors.map(({ source, finding: item }) => ({
          source,
          file: item.file,
          line: item.line,
          what: item.what,
          kickTo: item.kickTo,
        })),
      }),
    };
  });
  if (!kickbacks.length) {
    if (hasFalseVerificationPostcondition(task)) {
      kickFalseVerificationToExecute(task, at);
      return;
    }
    settleJudgments(task);
    return;
  }
  task.kickbacks = [...task.kickbacks, ...kickbacks];
  task.stage = kickbacks
    .map((kickback) => kickback.to)
    .sort((left, right) => KICKBACK_STAGE_ORDER.indexOf(left) - KICKBACK_STAGE_ORDER.indexOf(right))[0];
  task.status = 'in_progress';
}

/** @param {MutableRecordTask} task @param {Record<string, any>} council */
function assertCouncilInput(task, council) {
  if (isOperation(task)) {
    if (!task.verification?.verifier_agent_id || (task.audit.required && !task.audit.audit_agent_id)) {
      throw new Error('[record-transition] council requires every active judgment return');
    }
  } else {
    const requiredReviews = task.complexity === 'simple' ? 1 : 2;
    const reviews = [task.review, task.review2].filter((outcome) => outcome?.reviewer_agent_id);
    if (reviews.length !== requiredReviews || (task.audit.required && !task.audit.audit_agent_id)) {
      throw new Error('[record-transition] council requires every active judgment return');
    }
  }
  const blockers = judgmentSources(task).flatMap(({ source, outcome }) => (
    (outcome?.findings ?? [])
      .filter((/** @type {any} */ finding) => finding.class === 'blocking')
      .map((/** @type {any} */ finding) => ({ source, summary: finding.what, refute: finding.refute }))
  ));
  if (blockers.some(({ source, refute }) => refute?.source !== source || refute.verdict !== 'survives')) {
    throw new Error('[record-transition] council requires a source-bound surviving refute for every active blocker');
  }
  const expectedFindings = new Set(blockers.map(({ source, summary }) => `${source}\0${summary}`));
  if (blockers.length !== expectedFindings.size) {
    throw new Error('[record-transition] council findings must exactly match the active source-bound blocker union');
  }
  const returnedFindings = council.findings.map((/** @type {any} */ finding) => `${finding.source}\0${finding.summary}`);
  if (returnedFindings.length !== expectedFindings.size
    || new Set(returnedFindings).size !== returnedFindings.length
    || returnedFindings.some((/** @type {string} */ finding) => !expectedFindings.has(finding))) {
    throw new Error('[record-transition] council findings must exactly match the active source-bound blocker union');
  }
}

/** @param {MutableRecordTask} task @param {Record<string, any>} result @param {string} at */
function recordCouncil(task, result, at) {
  const council = result.council;
  const pending = task.convergence?.council;
  const counter = task.convergence?.stages?.[council.stage];
  if (!pending) {
    throw new Error('[record-transition] council is not awaiting a return');
  }
  if (pending.convened === true) {
    recordCouncilRecovery(task, council);
    return;
  }
  if (pending.stage !== council.stage || !counter
    || counter.blockingKickbacks !== task.convergence.cap) {
    throw new Error(`[record-transition] ${council.stage} council is not active at the exact cap`);
  }
  assertCouncilInput(task, council);
  const forbidden = forbiddenCouncilAgentIds(task);
  const reused = council.members.find((/** @type {any} */ member) => forbidden.has(member.agent_id));
  if (reused) {
    throw new Error(`[record-identity] council member ${reused.agent_id} reuses a prior judge identity`);
  }
  if (council.verdict === 'block' && council.outcome !== null) {
    throw new Error('[record-transition] initial council block must have outcome null');
  }

  task.convergence.council = {
    ...council,
    cycle: activeJudgmentCycle(task),
    executor_agent_id: task.agents.executor_agent_id,
  };
  if (council.verdict === 'ship') {
    if (hasFalseVerificationPostcondition(task)) {
      kickFalseVerificationToExecute(task, at);
      return;
    }
    task.stage = 'done';
    task.status = 'done';
    return;
  }
  const survivors = council.findings.filter((/** @type {any} */ finding) => finding.survived);
  const destination = isOperation(task) ? 'execute' : 'implement';
  task.kickbacks = [...task.kickbacks, {
    from: council.stage,
    to: destination,
    reason: `Council block: ${survivors.map((/** @type {any} */ finding) => finding.summary).join('; ')}`,
    at,
  }];
  task.stage = destination;
  task.status = 'in_progress';
}

/** @param {Record<string, any>} pending @param {Record<string, any>} returned */
function isPreservedCouncilBlock(pending, returned) {
  const { cycle: _cycle, executor_agent_id: _executorAgentId, ...specialistFields } = pending;
  return pending.verdict === 'block'
    && pending.outcome === null
    && isDeepStrictEqual(returned, { ...specialistFields, outcome: returned.outcome });
}

/** @param {MutableRecordTask} task */
function blockCouncilRecovery(task) {
  const council = task.convergence.council;
  council.outcome = 'blocked-to-operator';
  task.status = 'blocked';
  task.blockedReason = council.findings
    .filter((/** @type {any} */ finding) => finding.survived)
    .map((/** @type {any} */ finding) => finding.summary)
    .join('; ');
}

/** @param {MutableRecordTask} task @param {Record<string, any>} council */
function recordCouncilRecovery(task, council) {
  const pending = task.convergence.council;
  if (!isPreservedCouncilBlock(pending, council)) {
    throw new Error('[record-transition] council recovery must preserve the recorded block');
  }
  const recoveryStage = isOperation(task) ? 'execute' : 'implement';
  if (task.stage === recoveryStage) {
    throw new Error(`[record-transition] council recovery requires a separately recorded scoped ${recoveryStage}`);
  }
  if (council.outcome === 'scoped-fix-shipped') {
    const currentJudgments = judgmentSources(task).map(({ outcome }) => outcome).filter(Boolean);
    if (currentJudgments.some((outcome) => !isConsistentJudgment(outcome))) {
      throw new Error('[record-transition] current persisted judgment is inconsistent with its blocking findings');
    }
    if (currentJudgments.some(isFailingJudgment)) {
      throw new Error('[record-transition] current recovery judgment did not pass');
    }
    let judgmentsPass;
    let hasScopedChange;
    if (isOperation(task)) {
      judgmentsPass = isPassingJudgment(task.verification)
        && (!task.audit.required || isPassingJudgment(task.audit));
      hasScopedChange = task.judgmentHistory?.length > 0
        && task.execution?.result === 'executed'
        && typeof task.execution?.executor_agent_id === 'string'
        && task.agents.executor_agent_id === task.execution.executor_agent_id;
    } else {
      const requiredReviews = task.complexity === 'simple' ? 1 : 2;
      const reviews = [task.review, task.review2].filter((outcome) => outcome?.reviewer_agent_id);
      judgmentsPass = reviews.length === requiredReviews
        && reviews.every(isPassingJudgment)
        && (!task.audit.required || isPassingJudgment(task.audit));
      const scopedImplementer = task.implement?.agent_id;
      hasScopedChange = task.judgmentHistory?.length > 0
        && task.implement?.result === 'green'
        && typeof scopedImplementer === 'string'
        && task.agents.implementer_agent_id === scopedImplementer;
      const gate = task.tests?.gate;
      if (!gate || gate.green !== true || gate.clean !== true || typeof gate.hash !== 'string' || gate.hash === '') {
        throw new Error('[record-transition] scoped council completion requires a fresh clean green verification');
      }
    }
    if (!hasScopedChange) {
      throw new Error('[record-transition] scoped recovery requires a current recorded change');
    }
    if (!judgmentsPass) {
      throw new Error('[record-transition] scoped council completion requires current recovery judgments to pass');
    }
    task.convergence.council.outcome = council.outcome;
    task.stage = 'done';
    task.status = 'done';
    return;
  }
  if (council.outcome === 'blocked-to-operator') {
    if (!judgmentSources(task).some(({ outcome }) => isFailingJudgment(outcome))) {
      throw new Error('[record-transition] blocked council recovery requires a failed current judgment');
    }
    if (!haveActiveBlockersSurvivedRefute(task)) {
      throw new Error('[record-transition] every active blocking judgment finding requires a source-bound surviving refute');
    }
    blockCouncilRecovery(task);
    return;
  }
  throw new Error('[record-transition] council recovery outcome must terminate the scoped cycle');
}

/** @param {MutableRecordTask} task */
function judgmentSources(task) {
  if (isOperation(task)) {
    return [
      { source: 'verify', outcome: task.verification },
      { source: 'audit', outcome: task.audit },
    ];
  }
  return [
    { source: 'review', outcome: task.review },
    { source: 'review2', outcome: task.review2 },
    { source: 'audit', outcome: task.audit },
  ];
}

/** @param {MutableRecordTask} task @param {boolean} isScopedCouncilFix */
function isRefactorOwed(task, isScopedCouncilFix) {
  if (task.plan?.refactorOpportunity !== null) return true;
  return judgmentSources(task).some(({ source, outcome }) => (
    (outcome?.findings ?? []).some((/** @type {any} */ finding) => (
      finding.class === 'blocking'
      && finding.kickTo === 'refactor'
      && finding.refute?.source === source
      && finding.refute.verdict === 'survives'
      && (!isScopedCouncilFix || task.convergence.council.findings.some((/** @type {any} */ councilFinding) => (
        councilFinding.source === source
        && councilFinding.summary === finding.what
        && councilFinding.survived === true
      )))
    ))
  ));
}

/** @param {MutableRecordTask} task */
function invalidateVerification(task) {
  task.tests = { ...task.tests, green: false };
  delete task.tests.gate;
}

/** @param {TaskJson} task @param {string} stage @param {Record<string, any>} result @returns {TaskJson} */
export function transitionTask(task, stage, result) {
  const at = now();
  const next = /** @type {any} */ (structuredClone(task));
  const operation = isOperation(next);
  const allowedStages = operation
    ? ['plan', 'execute', 'verify', 'audit', 'refute', 'council']
    : ['plan', 'implement', 'refactor', 'review', 'audit', 'refute', 'council'];
  if (!allowedStages.includes(stage)) {
    throw new Error(`[record-transition] ${operation ? 'operation' : 'code'} task cannot record ${stage}`);
  }
  if (stage === 'plan' && operation !== isOperationPlanReturn(result)) {
    throw new Error('[record-transition] plan return does not match the locked task category');
  }
  const isJudgment = stage === 'audit' || (operation ? stage === 'verify' : stage === 'review');
  const recoveryStage = operation ? 'execute' : 'implement';
  const isLegacyCodePlanResume = !operation && stage === 'plan' && next.stage === 'test';
  if (stage === recoveryStage && next.status === 'blocked'
    && next.convergence?.council?.outcome === 'blocked-to-operator') {
    throw new Error('[record-transition] task is blocked after failed council recovery');
  }
  if (stage === 'refute' && isRefuteAgentForbidden(next, result.agent_id)) {
    throw new Error(`[record-identity] refute agent ${result.agent_id} violates specialist separation`);
  }
  if (isJudgment || stage === 'refute') assertCurrentJudgment(next, result);
  if (!isJudgment && stage !== 'refute' && stage !== 'council' && next.stage !== stage && !isLegacyCodePlanResume) {
    throw new Error(`[record-transition] task is at ${next.stage}, not ${stage}`);
  }
  const judgmentStages = operation ? ['verify', 'audit', 'done'] : ['review', 'audit', 'done'];
  if (isJudgment && !judgmentStages.includes(next.stage)) {
    throw new Error(`[record-transition] task is at ${next.stage}, not ${stage}`);
  }
  if (isJudgment) {
    const destinations = operation ? ['capture', 'plan', 'execute'] : ['capture', 'plan', 'implement', 'refactor'];
    if (result.findings.some((/** @type {any} */ finding) => !destinations.includes(finding.kickTo))) {
      throw new Error('[record-transition] finding kickback does not match the locked task category');
    }
  }
  next.updatedAt = at;
  if (operation) {
    if (next.operationStateVersion !== undefined
      && next.operationStateVersion !== OPERATION_STATE_VERSION) {
      throw new Error(
        `[record-transition] unsupported operationStateVersion ${String(next.operationStateVersion)}`,
      );
    }
    next.operationStateVersion = OPERATION_STATE_VERSION;
  }

  if (stage === 'plan') {
    next.complexity = result.complexity;
    next.audit.required = result.auditRequired;
    if (operation) {
      if (result.result === 'escalation') {
        next.plan = {
          result: result.result,
          slices: result.slices,
          escalation: result.escalation,
        };
        next.stage = 'plan';
      } else {
        next.plan = {
          result: result.result,
          slices: result.slices,
          runbook: result.runbook,
          preconditions: result.preconditions,
          recoveryBoundary: result.recoveryBoundary,
          approvalBoundary: result.approvalBoundary,
          requiresApproval: result.requiresApproval,
          postconditions: result.postconditions,
          verificationSeams: result.verificationSeams,
          escalation: result.escalation,
        };
        next.stage = 'execute';
      }
    } else {
      next.tests.authored_by_agent_id = result.agent_id;
      next.plan = {
        result: result.result,
        slices: result.slices,
        testFiles: result.testFiles,
        redRun: result.redRun,
        escalation: result.escalation,
        refactorOpportunity: result.refactorOpportunity,
      };
      next.stage = result.result === 'escalation' ? 'capture' : 'implement';
    }
  } else if (stage === 'execute') {
    const isScopedCouncilFix = isPendingCouncilRecovery(next);
    const pendingExecution = next.execution?.result === 'approval-required' ? next.execution : null;
    const pendingApproval = pendingExecution?.approvalRequired ?? null;
    const parentGrant = pendingExecution?.approval;
    const plannedApproval = plannedApprovalBoundary(next);
    const executionCycle = nextOperationExecutionCycle(next);
    if (result.result === 'approval-required' && result.approvalRequired !== plannedApproval) {
      throw new Error('[record-approval] approval request must match the planned operator-facing boundary');
    }
    if (result.result === 'executed' && next.plan?.requiresApproval === true
      && (pendingApproval !== plannedApproval || !hasBoundPendingApprovalRequest(next))) {
      throw new Error('[record-approval] approval-gated plan requires a matching request and parent grant');
    }
    if (result.result === 'executed' && pendingApproval !== null && parentGrant === undefined) {
      throw new Error('[record-approval] parent grant is required for the pending request');
    }
    if (parentGrant !== undefined && parentGrant.mutation !== pendingApproval) {
      throw new Error('[record-approval] parent grant does not match the exact pending request');
    }
    if (parentGrant !== undefined
      && !isSameApproval(next.approvals?.at(-1), parentGrant)) {
      throw new Error('[record-approval] parent grant is stale or not retained');
    }
    if (parentGrant !== undefined
      && (parentGrant.grantedBy === pendingExecution?.executor_agent_id
        || parentGrant.grantedBy === result.agent_id)) {
      throw new Error('[record-approval] executor identity cannot supply operator provenance');
    }
    if (pendingExecution?.executor_agent_id === result.agent_id) {
      throw new Error('[record-identity] approval re-fire requires a fresh executor, not the previous requester');
    }
    if (isScopedCouncilFix
      && next.convergence.council.executor_agent_id === result.agent_id) {
      throw new Error('[record-identity] council recovery requires a fresh executor, not the previous executor');
    }
    if (result.result === 'executed') {
      if (isScopedCouncilFix) archiveAndResetJudgments(next, at);
      else resetJudgmentsAfterFix(next, at);
    }

    let approvalRequestId = pendingExecution?.approvalRequestId;
    if (result.result === 'approval-required') {
      const request = {
        id: next.approvalRequests?.length ?? 0,
        mutation: result.approvalRequired,
        requestedBy: result.agent_id,
        requestedAt: at,
        cycle: executionCycle,
      };
      next.approvalRequests = [...(next.approvalRequests ?? []), request];
      approvalRequestId = request.id;
    }
    next.agents.executor_agent_id = result.agent_id;
    next.execution = {
      result: result.result,
      executor_agent_id: result.agent_id,
      cycle: executionCycle,
      recordedAt: at,
      ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
      actions: result.actions,
      evidence: result.evidence,
      approvalRequired: result.approvalRequired,
      ...(result.result === 'executed' && parentGrant !== undefined ? { approval: parentGrant } : {}),
    };
    if (isScopedCouncilFix && result.result === 'kickback') {
      blockCouncilRecovery(next);
      return /** @type {TaskJson} */ (next);
    }

    if (result.result === 'kickback') {
      next.kickbacks = [...next.kickbacks, {
        from: 'execute',
        to: result.kickback.to,
        reason: result.kickback.reason,
        at,
      }];
      next.stage = result.kickback.to;
    } else if (result.result === 'approval-required') {
      next.stage = 'execute';
    } else {
      next.verification ??= { verdict: null, verifier_agent_id: null, postconditions: [], findings: [], evidence: [] };
      next.stage = 'verify';
    }
  } else if (stage === 'implement') {
    const isScopedCouncilFix = isPendingCouncilRecovery(next);
    next.agents.implementer_agent_id = result.agent_id;
    next.implement = {
      agent_id: result.agent_id,
      result: result.result,
      files: result.files,
      greenRun: result.greenRun,
    };
    if (isScopedCouncilFix || !result.kickback) invalidateVerification(next);
    if (isScopedCouncilFix && (result.result !== 'green' || result.kickback !== null)) {
      blockCouncilRecovery(next);
      return /** @type {TaskJson} */ (next);
    }
    if (result.kickback) {
      next.kickbacks = [...next.kickbacks, { from: 'implement', to: result.kickback.to, reason: result.kickback.reason, at }];
      next.stage = result.kickback.to;
    } else {
      const refactorOwed = isRefactorOwed(next, isScopedCouncilFix);
      let scopedJudgmentRepair = false;
      if (isScopedCouncilFix) archiveAndResetJudgments(next, at);
      else scopedJudgmentRepair = resetJudgmentsAfterFix(next, at, result.files);
      if (scopedJudgmentRepair) {
        next.implement.repairRound = currentCodeRepairRound(next);
      }
      if (refactorOwed) next.stage = 'refactor';
      else if (scopedJudgmentRepair) settleJudgments(next);
      else next.stage = 'review';
    }
  } else if (stage === 'refactor') {
    next.refactor = {
      agent_id: result.agent_id,
      result: result.result,
      files: result.files,
      outsideDiff: result.outsideDiff,
      greenRun: result.greenRun,
      summary: result.summary,
    };
    const scopedJudgmentRepair = resetJudgmentsAfterFix(next, at, result.files);
    if (scopedJudgmentRepair) {
      next.refactor.repairRound = currentCodeRepairRound(next);
    }
    invalidateVerification(next);
    settleJudgments(next);
  } else if (stage === 'review') recordReview(next, result);
  else if (stage === 'verify') recordVerify(next, result);
  else if (stage === 'audit') recordAudit(next, result);
  else if (stage === 'refute') recordRefute(next, result, at);
  else recordCouncil(next, result, at);
  return /** @type {TaskJson} */ (next);
}


/**
 * @param {string} root
 * @param {string} id
 * @param {(task: TaskJson) => TaskJson} update
 * @param {{
 *   allowTransientTerminal?: boolean,
 *   journal?: import('./journal.js').JournalAppend | import('./journal.js').JournalAppend[],
 * }} [options]
 */
export async function updateTask(root, id, update, options = {}) {
  return withStoreLock(root, async () => {
    const config = await readConfig(root, { strict: true });
    const lite = config?.mode === 'lite';
    const configViolations = configSchemaViolations(config, { lite });
    if (configViolations.length) throw new Error(configViolations[0]);
    const prunedTaskIds = !lite && Array.isArray(config?.prunedTaskIds)
      ? /** @type {number[]} */ (config.prunedTaskIds)
      : undefined;

    const tasks = await collectTasks(root);
    const { taskDir, taskPath } = await locateTask(root, id, tasks);
    const task = await readTask(taskDir, root);
    const candidate = update(task);
    if (task.status !== 'done' && candidate.status === 'done' && !isOperation(candidate)) {
      const gate = candidate.tests?.gate;
      if (!gate || gate.green !== true || gate.clean !== true || typeof gate.hash !== 'string' || gate.hash === '') {
        throw new Error('[record-transition] terminal completion requires a present clean green verification gate');
      }
      const head = git(root, ['rev-parse', 'HEAD']);
      if (head.status !== 0) {
        throw new Error('[record-transition] git HEAD probe failed');
      }
      if (gate.hash !== head.stdout.trim()) {
        throw new Error('[record-transition] current HEAD does not match the terminal verification');
      }
      let dirty;
      try {
        dirty = treeDirty(root);
      } catch {
        throw new Error('[record-transition] git status working tree cleanliness probe failed');
      }
      if (dirty) {
        throw new Error('[record-transition] terminal verification requires a clean working tree');
      }
    }
    const store = tasks.map((stored) => stored._dir === taskPath ? { ...candidate, _dir: taskPath } : stored);
    const candidatePrunePrefix = `task ${String(candidate.id)}:`;
    const violations = [
      ...taskSchemaViolations(candidate, { lite }),
      ...runInvariants(store, { lite, prunedTaskIds }),
    ]
      .filter((violation) => !(
        options.allowTransientTerminal === true
        && !lite
        && task.status !== 'done'
        && candidate.status === 'done'
        && violation.startsWith(candidatePrunePrefix)
        && violation.includes('[prune]')
      ));
    if (violations.length) throw new Error(violations[0]);
    if (options.journal !== undefined) {
      const journal = Array.isArray(options.journal) ? options.journal : [options.journal];
      await appendJournalEvents(root, taskDir, journal);
    }
    await writeTask(taskDir, candidate);
    return candidate;
  });
}


/** @param {string} root @param {string} id */
export async function recordReverify(root, id) {
  return updateTask(root, id, (task) => {
    if (!isOperationReverifyEligible(task)) {
      throw new Error(
        '[record-reverify] requires an untouched in-progress operation with completed execution and a needs-work verification before refute, kickback, council, or execute recovery',
      );
    }
    const next = /** @type {any} */ (structuredClone(task));
    const at = now();
    archiveAndResetJudgments(next, at, new Set(['verification']));
    next.status = 'in_progress';
    next.stage = 'verify';
    next.updatedAt = at;
    return /** @type {TaskJson} */ (next);
  });
}


/** @param {string} root @param {string} id @param {string} grantedBy */
export async function recordApproval(root, id, grantedBy) {
  if (typeof grantedBy !== 'string' || grantedBy.trim().length === 0) {
    throw new Error('[record-approval] operator identity is required');
  }
  return updateTask(root, id, (task) => {
    const next = /** @type {any} */ (structuredClone(task));
    if (next.category === 'operation') {
      if (next.operationStateVersion !== undefined
        && next.operationStateVersion !== OPERATION_STATE_VERSION) {
        throw new Error(
          `[record-approval] unsupported operationStateVersion ${String(next.operationStateVersion)}`,
        );
      }
      next.operationStateVersion = OPERATION_STATE_VERSION;
    }
    const pending = next.category === 'operation'
      && next.stage === 'execute'
      && next.execution?.result === 'approval-required'
      ? next.execution.approvalRequired
      : null;
    if (typeof pending !== 'string' || pending.length === 0) {
      throw new Error('[record-approval] no active pending exact request');
    }
    const plannedApproval = plannedApprovalBoundary(next);
    if (plannedApproval === null || pending !== plannedApproval) {
      throw new Error('[record-approval] pending request does not match the planned approval boundary');
    }
    if (!hasBoundPendingApprovalRequest(next)) {
      throw new Error('[record-approval] pending request lacks exact executor provenance');
    }
    if (next.execution.approval !== undefined) {
      throw new Error('[record-approval] pending request already has a stale operator grant');
    }
    const request = latestApprovalRequest(next);
    if (grantedBy === request.requestedBy) {
      throw new Error('[record-approval] executor identity cannot supply operator provenance');
    }
    const grantedAt = now();
    if (Date.parse(grantedAt) < Date.parse(request.requestedAt)) {
      throw new Error('[record-approval] operator grant cannot precede its request');
    }
    const grant = { mutation: pending, grantedBy, grantedAt };
    next.execution.approval = grant;
    next.approvals = [...(next.approvals ?? []), grant];
    next.updatedAt = grantedAt;
    return /** @type {TaskJson} */ (next);
  }, { journal: { event: 'record', stage: 'execute', agent: grantedBy } });
}

/** @param {string} root @param {string} stage @param {string} id @param {string} file @param {string} [observedAgentId] */
export async function recordSpecialistFile(root, stage, id, file, observedAgentId) {
  let parsed;
  try { parsed = JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error(`[record-json] invalid JSON in ${file}`); }
  return recordSpecialistReturn(root, stage, id, parsed, observedAgentId);
}

/** @param {string} root @param {string} stage @param {string} id @param {unknown} value @param {string} [observedAgentId] */
export async function recordSpecialistReturn(root, stage, id, value, observedAgentId) {
  const specialistReturn = validateSpecialistReturn(stage, value);
  if (stage !== 'council' && (typeof observedAgentId !== 'string' || observedAgentId.length === 0)) {
    throw new Error('[record-identity] observed agent is invalid');
  }
  const transitionReturn = stage === 'council'
    ? specialistReturn
    : { ...specialistReturn, agent_id: observedAgentId };
  /** @type {import('./journal.js').JournalAppend | import('./journal.js').JournalAppend[]} */
  const journal = stage === 'council'
    ? specialistReturn.council.members.map((/** @type {{agent_id: string}} */ member) => ({
      event: 'record',
      stage: 'council',
      agent: member.agent_id,
    }))
    : { event: 'record', stage, agent: /** @type {string} */ (observedAgentId) };
  return updateTask(
    root,
    id,
    (task) => transitionTask(task, stage, transitionReturn),
    {
      allowTransientTerminal: true,
      journal,
    },
  );
}
