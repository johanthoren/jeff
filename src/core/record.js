// @ts-check

import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { collectTasks, readConfig, readTask, writeTask } from './store.js';
import { locateTask, withStoreLock } from './store-lock.js';
import { appendJournalEvents } from './journal.js';
import { git, treeDirty } from './git.js';
import { configSchemaViolations, isIsoDateTime, RECOVERY_LINEAGE_FIELDS, taskSchemaViolations } from './task-schema.js';
import { runInvariants } from './invariants.js';
import { validateHistoricalCouncilRecoveryReturn, validateSpecialistReturn } from './record-contract.js';
import { COUNCIL_ROUTES, OPERATION_COUNCIL_ROUTES, requiresCouncilResearchProvenance } from './council.js';
import {
  activeRefuterAgentIds,
  archivedJudgeAgentIds,
  forbiddenCouncilAgentIds,
  isAgentId,
  isArchivedVerifierAgentForbidden,
  isRefuteAgentForbidden,
  isRecoveryParticipantEligible,
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
    && !isAwaitingCouncil(task)
    && !isPendingCouncilRecovery(task)
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
  const audit = Object.hasOwn(task.audit, 'findings') ? task.audit : { ...task.audit, findings: [] };
  if (isOperation(task)) {
    return {
      cycle: task.judgmentHistory?.length ?? 0,
      at,
      verification: task.verification,
      audit,
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
    audit,
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
/** @param {MutableRecordTask} task */
function isPendingCodeRecovery(task) {
  return !isOperation(task)
    && isPendingCouncilRecovery(task)
    && task.convergence?.recovery?.episode === 1;
}

/** @param {MutableRecordTask} task @param {string} agentId @param {'test author' | 'builder'} role */
function assertFreshRecoveryParticipant(task, agentId, role) {
  if (!isRecoveryParticipantEligible(task, agentId, role)) {
    throw new Error(`[record-identity] recovery ${role} ${agentId} must use a fresh identity`);
  }
}


/** @param {MutableRecordTask} task */
function assertRecoveryJudgmentGate(task) {
  const gate = task.tests?.gate;
  if (!gate || gate.green !== true || gate.clean !== true
    || typeof gate.hash !== 'string' || gate.hash.length === 0) {
    throw new Error('[record-transition] recovery requires a current clean green gate before fresh judgment');
  }
}

/** @param {string} checkpointRoot @param {string} hash */
function checkpointMatchesGate(checkpointRoot, hash) {
  const head = git(checkpointRoot, ['rev-parse', 'HEAD']);
  return head.status === 0 && hash === head.stdout.trim() && !treeDirty(checkpointRoot);
}

/** @param {string} checkpointRoot @param {MutableRecordTask} task */
function assertCurrentRecoveryJudgmentGate(checkpointRoot, task) {
  assertRecoveryJudgmentGate(task);
  if (!checkpointMatchesGate(checkpointRoot, task.tests.gate.hash)) {
    throw new Error('[record-transition] recovery gate must match the clean current checkpoint before judgment');
  }
}

/** @param {string} root @param {string} [trunkRef] */
function landedTrunkOid(root, trunkRef) {
  if (typeof trunkRef !== 'string' || trunkRef === '') return null;
  const result = git(root, ['rev-parse', '--verify', trunkRef]);
  return result.status === 0 ? (result.stdout ?? '').trim() : null;
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
  if (isPendingCodeRecovery(task)) assertRecoveryJudgmentGate(task);
  if (isPendingCodeRecovery(task)) {
    const recovery = task.convergence.recovery;
    if (recovery.test_author_agent_id === result.agent_id) {
      throw new Error(`[record-identity] recovery test author ${result.agent_id} cannot judge its tests`);
    }
    if (recovery.builder_agent_id === result.agent_id) {
      throw new Error(`[record-identity] recovery builder ${result.agent_id} cannot judge its work`);
    }
  }
  if (isPendingCouncilRecovery(task) && (isOperation(task) || isPendingCodeRecovery(task))) {
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
  const synthesizerId = council.synthesizer_agent_id;
  if (!isAgentId(synthesizerId)
    || forbidden.has(synthesizerId)
    || council.members.some((/** @type {any} */ member) => member.agent_id === synthesizerId)) {
    throw new Error('[record-identity] council synthesizer must be fresh and distinct');
  }
  if (council.verdict === 'block' && council.outcome !== null) {
    throw new Error('[record-transition] initial council block must have outcome null');
  }

  task.convergence.council = {
    ...council,
    researchProvenance: 'canonical',
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
  const route = council.synthesis.selectedStrategy;
  const allowedRoutes = isOperation(task) ? OPERATION_COUNCIL_ROUTES : COUNCIL_ROUTES;
  if (!allowedRoutes.includes(route)) {
    throw new Error(`[record-transition] ${isOperation(task) ? 'operation' : 'code'} council selected an incompatible recovery route`);
  }
  if (!isOperation(task)) {
    /** @type {Record<string, any>} */
    const originalLineage = {
      plan: task.plan === undefined ? null : structuredClone(task.plan),
      test_author_agent_id: task.tests?.authored_by_agent_id ?? null,
      builder_agent_id: task.agents?.implementer_agent_id ?? null,
      implement: task.implement === undefined ? null : structuredClone(task.implement),
    };
    task.convergence.recovery = {
      episode: 1,
      route,
      baselineGate: task.tests?.gate ? structuredClone(task.tests.gate) : null,
      test_author_agent_id: null,
      builder_agent_id: null,
      original: {
        complexity: task.complexity,
        audit_required: task.audit.required,
        absentLineage: RECOVERY_LINEAGE_FIELDS.filter((field) => originalLineage[field] === null),
        ...originalLineage,
      },
    };
  }
  if (route === 'operator-escalation') {
    blockCouncilRecovery(task);
    return;
  }
  const destination = isOperation(task)
    ? 'execute'
    : (/** @type {Record<string, string>} */ ({
      'confined-repair': 'implement',
      refactor: 'refactor',
      'test-contract-repair': 'plan',
      'causal-subgraph-reconstruction': 'plan',
      'full-replan': 'plan',
    }))[route];
  task.kickbacks = [...task.kickbacks, {
    from: council.stage,
    to: destination,
    reason: `Council block: ${survivors.map((/** @type {any} */ finding) => finding.summary).join('; ')}`,
    at,
  }];
  task.stage = destination;
  task.status = 'in_progress';
}

/** @param {MutableRecordTask} task @param {Record<string, any>} returned */
function isPreservedCouncilBlock(task, returned) {
  const pending = task.convergence.council;
  const {
    cycle: _pendingCycle,
    executor_agent_id: _pendingExecutorAgentId,
    researchProvenance: _pendingResearchProvenance,
    ...pendingSpecialistFields
  } = pending;
  const {
    cycle: _returnedCycle,
    executor_agent_id: _returnedExecutorAgentId,
    researchProvenance: _returnedResearchProvenance,
    ...returnedSpecialistFields
  } = returned;
  const historicalOmission = !requiresCouncilResearchProvenance(task)
    && pending.synthesis === undefined
    && pending.synthesizer_agent_id === undefined
    && returned.synthesis === undefined
    && pending.members.every((/** @type {any} */ member) => member.inquiry === undefined)
    && returned.members.every((/** @type {any} */ member) => member.inquiry === undefined);
  if (historicalOmission) {
    delete pendingSpecialistFields.synthesizer_agent_id;
    delete returnedSpecialistFields.synthesizer_agent_id;
  }
  return pending.verdict === 'block'
    && pending.outcome === null
    && isDeepStrictEqual(returnedSpecialistFields, {
      ...pendingSpecialistFields,
      outcome: returnedSpecialistFields.outcome,
    });
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
  if (!isPreservedCouncilBlock(task, council)) {
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
      const recovery = task.convergence.recovery;
      const hasRecoveryHistory = task.judgmentHistory?.length > 0;
      if (recovery?.route === 'test-contract-repair') {
        hasScopedChange = hasRecoveryHistory
          && isAgentId(recovery.test_author_agent_id)
          && task.tests?.authored_by_agent_id === recovery.test_author_agent_id;
      } else if (recovery?.route === 'refactor') {
        hasScopedChange = hasRecoveryHistory
          && isAgentId(recovery.builder_agent_id)
          && task.refactor?.agent_id === recovery.builder_agent_id
          && task.refactor?.result === 'refactored';
      } else {
        const scopedImplementer = task.implement?.agent_id;
        hasScopedChange = hasRecoveryHistory
          && task.implement?.result === 'green'
          && typeof scopedImplementer === 'string'
          && task.agents.implementer_agent_id === scopedImplementer
          && (recovery === undefined || recovery.builder_agent_id === scopedImplementer);
      }
      const gate = task.tests?.gate;
      if (!gate || gate.green !== true || gate.clean !== true || typeof gate.hash !== 'string' || gate.hash === ''
        || gate.hash === recovery?.baselineGate?.hash) {
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
  if (isScopedCouncilFix) return false;
  if (task.plan?.refactorOpportunity !== null) return true;
  return judgmentSources(task).some(({ source, outcome }) => (
    (outcome?.findings ?? []).some((/** @type {any} */ finding) => (
      finding.class === 'blocking'
      && finding.kickTo === 'refactor'
      && finding.refute?.source === source
      && finding.refute.verdict === 'survives'
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
  if (((operation && stage === 'execute')
      || (!operation
        && ['plan', 'implement', 'refactor'].includes(stage)
        && next.convergence?.recovery?.episode === 1))
    && next.status === 'blocked'
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
    const pendingRecovery = isPendingCodeRecovery(next);
    if (pendingRecovery) {
      const route = next.convergence.recovery.route;
      if (!['test-contract-repair', 'causal-subgraph-reconstruction', 'full-replan'].includes(route)
        || !['red', 'escalation'].includes(result.result)) {
        throw new Error('[record-transition] recovery plan does not match the selected council route');
      }
      assertFreshRecoveryParticipant(next, result.agent_id, 'test author');
      archiveAndResetJudgments(next, at);
      next.convergence.recovery.test_author_agent_id = result.agent_id;
    }
    next.complexity = pendingRecovery && next.convergence.recovery.original.complexity === 'complex'
      ? 'complex'
      : result.complexity;
    next.audit.required = pendingRecovery
      ? next.convergence.recovery.original.audit_required || result.auditRequired
      : result.auditRequired;
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
      if (pendingRecovery) {
        invalidateVerification(next);
        if (result.result === 'escalation') {
          blockCouncilRecovery(next);
          return /** @type {TaskJson} */ (next);
        }
        next.stage = next.convergence.recovery.route === 'test-contract-repair'
          ? 'review'
          : 'implement';
      } else {
        next.stage = result.result === 'escalation' ? 'capture' : 'implement';
      }
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
    const pendingRecovery = isPendingCodeRecovery(next);
    if (pendingRecovery) {
      if (!['confined-repair', 'causal-subgraph-reconstruction', 'full-replan']
        .includes(next.convergence.recovery.route)) {
        throw new Error('[record-transition] recovery implement does not match the selected council route');
      }
      assertFreshRecoveryParticipant(next, result.agent_id, 'builder');
      next.convergence.recovery.builder_agent_id = result.agent_id;
    }
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
    const pendingRecovery = isPendingCodeRecovery(next);
    if (pendingRecovery) {
      if (next.convergence.recovery.route !== 'refactor') {
        throw new Error('[record-transition] recovery refactor does not match the selected council route');
      }
      assertFreshRecoveryParticipant(next, result.agent_id, 'builder');
      next.convergence.recovery.builder_agent_id = result.agent_id;
    }
    next.refactor = {
      agent_id: result.agent_id,
      result: result.result,
      files: result.files,
      outsideDiff: result.outsideDiff,
      greenRun: result.greenRun,
      summary: result.summary,
    };
    if (pendingRecovery && (result.result === 'clean' || result.files.length === 0)) {
      blockCouncilRecovery(next);
      return /** @type {TaskJson} */ (next);
    }
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
 *   allowForeignTaskViolations?: boolean,
 *   journal?: import('./journal.js').JournalAppend | import('./journal.js').JournalAppend[],
 *   trunkRef?: string,
 *   checkpointRoot?: string,
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
      if (!checkpointMatchesGate(options.checkpointRoot ?? root, gate.hash)) {
        throw new Error('[record-transition] terminal checkpoint must be clean at the verification gate hash');
      }
      if (!lite) {
        const trunk = landedTrunkOid(root, options.trunkRef);
        if (trunk === null) {
          throw new Error('[record-transition] git trunk probe failed');
        }
        if (gate.hash !== trunk) {
          throw new Error('[record-transition] current trunk does not match the terminal verification');
        }
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
        && (candidate.status === 'done' || candidate.status === 'operator_accepted')
        && violation.startsWith(candidatePrunePrefix)
        && violation.includes('[prune]')
      ))
      .filter((violation) => !(
        options.allowForeignTaskViolations === true
        && violation.startsWith('task ')
        && !violation.startsWith(candidatePrunePrefix)
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


/**
 * Discard the judgments a lane earned against an integration checkpoint that a
 * failed ancestry check or expected-old mismatch has invalidated.
 *
 * Eligibility is deliberately narrow. A live needs-work verdict is an ordinary
 * kickback, not a stale checkpoint, and archiving it here would retire a real
 * blocker: forcing fresh identities only bars the same agent from re-judging,
 * it does not stop an unrelated reviewer from passing still-unfixed work.
 * Requiring an existing checkpoint also keeps the stage reset off tasks that
 * never reached a gate.
 * @param {string} root @param {string} id
 */
export async function recordRebuild(root, id) {
  return updateTask(root, id, (task) => {
    const operation = isOperation(task);
    const checkpointed = operation
      ? task.verification?.verdict != null
      : task.tests?.gate != null;
    /** @type {Array<{ verdict?: string | null } | null | undefined>} */
    const outcomes = [task.review, task.review2, task.audit];
    if (operation) outcomes.push(task.verification);
    // Raw verdict, not isFailingJudgment: an inconsistent needs-work is malformed
    // state, and rebuild must not launder it into a clean slate either.
    const kickedBack = outcomes.some((outcome) => outcome?.verdict === 'needs-work');
    if (task.status !== 'in_progress' || !checkpointed || kickedBack) {
      throw new Error(
        '[record-rebuild] requires an in-progress task holding judgments against a recorded checkpoint with no live needs-work verdict',
      );
    }
    const next = /** @type {any} */ (structuredClone(task));
    const at = now();
    archiveAndResetJudgments(next, at);
    // Operations carry no `tests`; their verification is already reset above.
    if (!operation) invalidateVerification(next);
    next.stage = operation ? 'verify' : 'refactor';
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
    const grant = { mutation: pending, grantedBy, grantedAt, requestId: request.id };
    next.execution.approval = grant;
    next.approvals = [...(next.approvals ?? []), grant];
    next.updatedAt = grantedAt;
    return /** @type {TaskJson} */ (next);
  }, { journal: { event: 'record', stage: 'execute', agent: grantedBy } });
}

/**
 * Accept an exhausted code council-block against the recorded gate hash.
 *
 * @param {string} root
 * @param {string} id
 * @param {{ operator?: unknown, hash?: unknown, reason?: unknown, evidence?: unknown }} input
 */
export async function recordAcceptance(root, id, input) {
  const operator = input?.operator;
  if (typeof operator !== 'string' || operator.trim().length === 0) {
    throw new Error('[record-accept] operator identity is required');
  }
  return updateTask(root, id, (task) => {
    const acceptance = task.acceptance;
    if (task.status === 'operator_accepted'
      && acceptance
      && acceptance.hash === input.hash
      && acceptance.acceptedBy === operator
      && acceptance.reason === input.reason
      && isDeepStrictEqual(acceptance.evidence, input.evidence)) {
      return task;
    }
    if (isOperation(task)) {
      throw new Error('[record-accept] ineligible: only a code task can be accepted');
    }
    const recovery = /** @type {import('./types.js').CodeConvergence | undefined} */ (task.convergence)?.recovery;
    if (task.status !== 'blocked'
      || task.convergence?.council?.outcome !== 'blocked-to-operator'
      || recovery?.episode !== 1) {
      throw new Error('[record-accept] ineligible: requires an exhausted blocked-to-operator council recovery');
    }
    const gateHash = task.tests?.gate?.hash;
    if (typeof gateHash !== 'string' || gateHash.length === 0) {
      throw new Error('[record-accept] ineligible: tests.gate.hash is required');
    }
    if (input.hash !== gateHash) {
      throw new Error('[record-accept] checkpoint does not match tests.gate.hash');
    }
    if (typeof input.reason !== 'string' || input.reason.length === 0) {
      throw new Error('[record-accept] reason is required');
    }
    if (!Array.isArray(input.evidence) || input.evidence.length === 0
      || input.evidence.some((item) => !item
        || typeof item.command !== 'string' || item.command.length === 0
        || typeof item.output !== 'string' || item.output.length === 0)) {
      throw new Error('[record-accept] evidence is required');
    }
    const next = /** @type {any} */ (structuredClone(task));
    const acceptedAt = now();
    next.status = 'operator_accepted';
    next.acceptance = {
      hash: input.hash,
      acceptedBy: operator,
      acceptedAt,
      reason: input.reason,
      evidence: structuredClone(input.evidence),
    };
    next.updatedAt = acceptedAt;
    return /** @type {TaskJson} */ (next);
  }, { allowTransientTerminal: true, allowForeignTaskViolations: true });
}

/**
 * @param {Record<string, any>} specialistReturn
 * @param {unknown} observedIdentity
 */
function bindCouncilObservedIdentity(specialistReturn, observedIdentity) {
  if (observedIdentity === null || typeof observedIdentity !== 'object') {
    throw new Error('[record-identity] observed council identity is invalid');
  }
  const observed = /** @type {Record<string, any>} */ (observedIdentity);
  const memberIds = observed.member_agent_ids;
  const returnedIds = specialistReturn.council.members
    .map((/** @type {Record<string, any>} */ member) => member.agent_id);
  if (!Array.isArray(memberIds)
    || memberIds.length !== 3
    || memberIds.some((agentId) => !isAgentId(agentId))
    || !isDeepStrictEqual(memberIds, returnedIds)
    || !isAgentId(observed.synthesizer_agent_id)) {
    throw new Error('[record-identity] observed council identities do not match the aggregate');
  }
  return {
    ...specialistReturn,
    council: {
      ...specialistReturn.council,
      synthesizer_agent_id: observed.synthesizer_agent_id,
    },
  };
}

/**
 * @param {string} root
 * @param {string} stage
 * @param {string} id
 * @param {string} file
 * @param {string | {member_agent_ids: string[], synthesizer_agent_id: string}} [observedAgentId]
 * @param {{ checkpointRoot?: string, trunkRef?: string }} [options]
 */
export async function recordSpecialistFile(root, stage, id, file, observedAgentId, options) {
  let parsed;
  try { parsed = JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error(`[record-json] invalid JSON in ${file}`); }
  return recordSpecialistReturn(root, stage, id, parsed, observedAgentId, options);
}

/**
 * @param {string} root
 * @param {string} stage
 * @param {string} id
 * @param {unknown} value
 * @param {string | {member_agent_ids: string[], synthesizer_agent_id: string}} [observedAgentId]
 * @param {{ checkpointRoot?: string, trunkRef?: string }} [options]
 */
export async function recordSpecialistReturn(root, stage, id, value, observedAgentId, options) {
  let specialistReturn;
  try {
    specialistReturn = validateSpecialistReturn(stage, value);
  } catch (error) {
    if (stage !== 'council') throw error;
    specialistReturn = validateHistoricalCouncilRecoveryReturn(value);
  }
  if (stage !== 'council' && (typeof observedAgentId !== 'string' || observedAgentId.length === 0)) {
    throw new Error('[record-identity] observed agent is invalid');
  }
  /** @type {Record<string, any>} */
  const transitionReturn = stage === 'council'
    ? bindCouncilObservedIdentity(specialistReturn, observedAgentId)
    : { ...specialistReturn, agent_id: observedAgentId };
  /** @type {string | undefined} */
  let currentPipelineVersion;
  if (stage === 'council') {
    try {
      const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
      if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) throw new Error();
      currentPipelineVersion = packageJson.version;
    } catch {
      throw new Error('[record-transition] could not read the installed pipeline version');
    }
  }
  /** @type {import('./journal.js').JournalAppend | import('./journal.js').JournalAppend[]} */
  const journal = stage === 'council'
    ? [
        ...transitionReturn.council.members.map((/** @type {{agent_id: string}} */ member) => ({
          event: 'record',
          stage: 'council',
          agent: member.agent_id,
        })),
        {
          event: 'record',
          stage: 'council',
          agent: transitionReturn.council.synthesizer_agent_id,
        },
      ]
    : { event: 'record', stage, agent: /** @type {string} */ (observedAgentId) };
  return updateTask(
    root,
    id,
    (task) => {
      if (['review', 'audit'].includes(stage) && isPendingCodeRecovery(task)) {
        assertCurrentRecoveryJudgmentGate(options?.checkpointRoot ?? root, task);
      } else if (stage === 'council' && isPendingCodeRecovery(task) && options?.checkpointRoot) {
        assertCurrentRecoveryJudgmentGate(options.checkpointRoot, task);
      }
      const versionedTask = stage === 'council' && task.convergence?.council?.convened !== true && !requiresCouncilResearchProvenance(task)
        ? { ...task, pipelineVersion: currentPipelineVersion }
        : task;
      return transitionTask(versionedTask, stage, transitionReturn);
    },
    {
      allowTransientTerminal: true,
      journal,
      trunkRef: options?.trunkRef,
      checkpointRoot: options?.checkpointRoot,
    },
  );
}
