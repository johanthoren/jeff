// @ts-check

import { readFile, lstat, mkdir, realpath, rmdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assertStoreContained, collectTasks, readMode, readTask, writeTask } from './store.js';
import { git, treeDirty } from './git.js';
import { isIsoDateTime, taskSchemaViolations } from './task-schema.js';
import { runInvariants } from './invariants.js';
import { validateSpecialistReturn } from './record-contract.js';
import { activeRefuterAgentIds, forbiddenCouncilAgentIds, isRefuteAgentForbidden } from './identity-policy.js';
import { parseCanonicalOperationBatch } from './operation-batch.js';

/** @typedef {import('./types.js').TaskJson} TaskJson */
/** @typedef {Record<string, any>} MutableRecordTask */

const now = () => `${new Date().toISOString().slice(0, 19)}Z`;
const wait = (/** @type {number} */ milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const RECORD_LOCK_ATTEMPTS = 100;
const KICKBACK_STAGE_ORDER = ['capture', 'plan', 'execute', 'implement', 'refactor'];
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
function canonicalPlanApprovalBoundary(task) {
  if (!isOperation(task) || task.plan?.requiresApproval !== true) return null;
  try {
    return parseCanonicalOperationBatch(task.plan.approvalBoundary).canonical;
  } catch {
    return null;
  }
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
  return task.judgmentHistory?.length ?? 0;
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
    else if (blockingAudit) task.stage = 'audit';
    else if (blockingVerification || !task.verification?.verifier_agent_id) task.stage = 'verify';
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

/** @param {MutableRecordTask} task @param {string} at */
function archiveAndResetJudgments(task, at) {
  task.judgmentHistory = [
    ...(task.judgmentHistory ?? []),
    judgmentHistoryEntry(task, at),
  ];
  task.agents.audit_agent_id = null;
  task.audit = { required: task.audit.required, verdict: 'na', audit_agent_id: null, findings: [], evidence: [] };
  if (isOperation(task)) {
    task.agents.verifier_agent_id = null;
    task.verification = { verdict: null, verifier_agent_id: null, postconditions: [], findings: [], evidence: [] };
    return;
  }
  task.agents.reviewer_agent_id = null;
  task.agents.reviewer2_agent_id = null;
  task.review = { verdict: null, reviewer_agent_id: null, findings: [], evidence: [] };
  task.review2 = null;
}

/** @param {MutableRecordTask} task @param {string} at */
function resetJudgmentsAfterFix(task, at) {
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
  if (!hasCurrentJudgment) return;
  const latestJudgmentKickback = task.kickbacks.findLast((/** @type {any} */ kickback) => (
    judgmentSources(task).some(({ source }) => source === kickback.from)
  ));
  if (!latestJudgmentKickback) return;
  const latestHistory = task.judgmentHistory?.at(-1);
  if (latestHistory && !isIsoDateTime(latestHistory.at)) {
    throw new Error('[record-transition] judgmentHistory latest at is invalid');
  }
  const latestHistoryInstant = latestHistory ? Date.parse(latestHistory.at) : null;
  if (latestHistoryInstant !== null && Date.parse(latestJudgmentKickback.at) <= latestHistoryInstant) return;

  archiveAndResetJudgments(task, at);
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
  if (hasSurvivor && isPendingCouncilRecovery(task)) {
    blockCouncilRecovery(task);
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
  const capped = survivorGroups.find(({ counter }) => (
    counter.blockingKickbacks >= task.convergence.cap
  ));
  if (capped) {
    if (task.convergence.council.convened !== true && task.convergence.council.stage === null) {
      task.convergence.council.stage = capped.convergenceStage;
    }
    settleJudgments(task);
    return;
  }

  const kickbacks = survivorGroups.map(({ convergenceStage, counter, survivors }) => {
    counter.blockingKickbacks += 1;
    const destination = survivors
      .map(({ finding: item }) => item.kickTo)
      .sort((left, right) => KICKBACK_STAGE_ORDER.indexOf(left) - KICKBACK_STAGE_ORDER.indexOf(right))[0];
    return {
      from: convergenceStage,
      to: destination,
      reason: survivors.map(({ finding: item }) => item.what).join('; '),
      at,
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
  if (pending.stage !== council.stage || !counter || counter.blockingKickbacks < task.convergence.cap) {
    throw new Error(`[record-transition] ${council.stage} council is not active`);
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

  task.convergence.council = council;
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
  return pending.verdict === 'block'
    && pending.outcome === null
    && isDeepStrictEqual(returned, { ...pending, outcome: returned.outcome });
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
    const pendingApproval = next.execution?.result === 'approval-required'
      ? next.execution.approvalRequired
      : null;
    const parentGrant = pendingApproval === null ? undefined : next.execution?.approval;
    const plannedApproval = canonicalPlanApprovalBoundary(next);
    if (plannedApproval !== null
      && ((result.result === 'approval-required' && result.approvalRequired !== plannedApproval)
        || (result.result === 'executed'
          && (pendingApproval !== plannedApproval || parentGrant?.mutation !== plannedApproval)))) {
      throw new Error('[record-approval] request and parent grant must match the planned canonical batch');
    }
    if (result.result === 'executed' && next.plan?.requiresApproval === true && pendingApproval === null) {
      throw new Error('[record-approval] approval-gated plan requires a parent grant');
    }
    if (result.result === 'executed' && pendingApproval !== null && parentGrant === undefined) {
      throw new Error('[record-approval] parent grant is required for the pending request');
    }
    if (parentGrant !== undefined && parentGrant.mutation !== pendingApproval) {
      throw new Error('[record-approval] parent grant does not match the exact mutation request');
    }
    next.agents.executor_agent_id = result.agent_id;
    next.execution = {
      result: result.result,
      executor_agent_id: result.agent_id,
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
      if (isScopedCouncilFix) archiveAndResetJudgments(next, at);
      else resetJudgmentsAfterFix(next, at);
      next.verification ??= { verdict: null, verifier_agent_id: null, postconditions: [], findings: [], evidence: [] };
      next.stage = 'verify';
    }
  } else if (stage === 'implement') {
    const isScopedCouncilFix = isPendingCouncilRecovery(next);
    next.agents.implementer_agent_id = result.agent_id;
    next.implement = { agent_id: result.agent_id, result: result.result, files: result.files, greenRun: result.greenRun };
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
      if (isScopedCouncilFix) archiveAndResetJudgments(next, at);
      else resetJudgmentsAfterFix(next, at);
      next.stage = refactorOwed ? 'refactor' : 'review';
    }
  } else if (stage === 'refactor') {
    next.refactor = { agent_id: result.agent_id, result: result.result, files: result.files, outsideDiff: result.outsideDiff, greenRun: result.greenRun, summary: result.summary };
    resetJudgmentsAfterFix(next, at);
    invalidateVerification(next);
    next.stage = 'review';
  } else if (stage === 'review') recordReview(next, result);
  else if (stage === 'verify') recordVerify(next, result);
  else if (stage === 'audit') recordAudit(next, result);
  else if (stage === 'refute') recordRefute(next, result, at);
  else recordCouncil(next, result, at);
  return /** @type {TaskJson} */ (next);
}

/** @param {string} parent @param {string} child */
function escapes(parent, child) {
  const path = relative(parent, child);
  return path === '..' || path.startsWith(`..${sep}`);
}


/** @param {string} root @param {() => Promise<any>} operation */
async function withStoreLock(root, operation) {
  try {
    await assertStoreContained(root);
  } catch (error) {
    throw new Error(`[record-task] ${/** @type {Error} */ (error).message}`);
  }
  const lock = join(root, '.jeff', '.record-lock');
  let acquired = false;
  for (let attempt = 0; attempt < RECORD_LOCK_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lock);
      acquired = true;
      break;
    } catch (error) {
      if (/** @type {any} */ (error).code !== 'EEXIST') throw error;
      if (attempt + 1 < RECORD_LOCK_ATTEMPTS) await wait(5);
    }
  }
  if (!acquired) throw new Error('[record-lock] store lock is busy or unavailable');
  try {
    return await operation();
  } finally {
    await rmdir(lock);
  }
}

/** @param {string} root @param {string} id @param {any[]} tasks */
async function locateTask(root, id, tasks) {
  const matches = tasks.filter((task) => String(task.id) === id);
  if (matches.length !== 1) throw new Error(`[record-task] task ${id} ${matches.length ? 'is ambiguous' : 'was not found'}`);
  const taskFile = resolve(root, matches[0]._dir);
  const taskDir = dirname(taskFile);
  const base = await realpath(join(root, '.jeff', 'tasks'));
  const actualDir = await realpath(taskDir);
  if (escapes(base, actualDir) || (await lstat(taskFile)).isSymbolicLink()) {
    throw new Error(`[record-task] task ${id} escapes .jeff/tasks`);
  }
  return { taskDir, taskPath: matches[0]._dir };
}

/**
 * @param {string} root
 * @param {string} id
 * @param {(task: TaskJson) => TaskJson} update
 * @param {{allowTransientTerminal?: boolean}} [options]
 */
export async function updateTask(root, id, update, options = {}) {
  return withStoreLock(root, async () => {
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
    const lite = (await readMode(root)) === 'lite';
    const store = tasks.map((stored) => stored._dir === taskPath ? { ...candidate, _dir: taskPath } : stored);
    const candidatePrunePrefix = `task ${String(candidate.id)}:`;
    const violations = [...taskSchemaViolations(candidate, { lite }), ...runInvariants(store, { lite })]
      .filter((violation) => !(
        options.allowTransientTerminal === true
        && !lite
        && task.status !== 'done'
        && candidate.status === 'done'
        && violation.startsWith(candidatePrunePrefix)
        && violation.includes('[prune]')
      ));
    if (violations.length) throw new Error(violations[0]);
    await writeTask(taskDir, candidate);
    return candidate;
  });
}

/** @param {string} root @param {string} id */
async function readLocatedTask(root, id) {
  try {
    await assertStoreContained(root);
  } catch (error) {
    throw new Error(`[record-task] ${/** @type {Error} */ (error).message}`);
  }
  const tasks = await collectTasks(root);
  const { taskDir } = await locateTask(root, id, tasks);
  return readTask(taskDir, root);
}

/** @param {MutableRecordTask} task */
function operationApprovalBoundary(task) {
  if (!isOperation(task)) throw new Error('[operation-apply] tracked execute requires an operation task');
  if (task.stage !== 'execute') {
    throw new Error('[operation-apply] operation task is not at execute');
  }
  if (task.status !== 'in_progress') {
    throw new Error('[operation-apply] operation task is not active');
  }
  const violations = taskSchemaViolations(task, { lite: true });
  if (task.plan?.result !== 'plan' || typeof task.plan.requiresApproval !== 'boolean' || violations.length) {
    throw new Error(`[operation-apply] malformed completed operation plan${violations[0] ? `: ${violations[0]}` : ''}`);
  }
  if (task.plan.requiresApproval === false) return null;
  return parseCanonicalOperationBatch(task.plan.approvalBoundary).canonical;
}

/** @param {string} root @param {string} id */
export async function getOperationApprovalBoundary(root, id) {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('[operation-apply] task id is required');
  }
  return operationApprovalBoundary(await readLocatedTask(root, id));
}

/** @param {string} root @param {string} id */
export async function getApprovedOperationBoundary(root, id) {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('[operation-apply] task id is required');
  }
  const task = /** @type {MutableRecordTask} */ (await readLocatedTask(root, id));
  const boundary = operationApprovalBoundary(task);
  if (boundary === null) throw new Error('[operation-apply] operation task is not approval-gated');
  const execution = task.execution;
  if (execution?.result !== 'approval-required' || execution.approvalRequired !== boundary) {
    throw new Error('[operation-apply] pending request does not match the completed plan');
  }
  const grant = execution.approval;
  if (grant?.mutation !== boundary || typeof grant.grantedBy !== 'string' || !isIsoDateTime(grant.grantedAt)) {
    throw new Error('[operation-apply] parent grant is missing or does not match the pending request');
  }
  const retained = task.approvals?.some((/** @type {any} */ approval) => (
    approval?.mutation === grant.mutation
    && approval?.grantedBy === grant.grantedBy
    && approval?.grantedAt === grant.grantedAt
  )) === true;
  if (!retained) throw new Error('[operation-apply] parent grant is stale or not retained');
  return boundary;
}

/** @param {string} root @param {string} id */
export async function getVerificationSeams(root, id) {
  const task = await readLocatedTask(root, id);
  const seams = task.category === 'operation' && task.plan?.result === 'plan'
    ? task.plan.verificationSeams
    : null;
  if (!Array.isArray(seams) || !seams.every((seam) => typeof seam === 'string' && seam.length > 0)) {
    throw new Error('[verify-query] task has no completed operation plan verification seams');
  }
  return [...seams];
}

/** @param {string} root @param {string} id */
export async function getPendingApproval(root, id) {
  const task = await readLocatedTask(root, id);
  const pending = task.category === 'operation'
    && task.stage === 'execute'
    && task.execution?.result === 'approval-required'
    ? task.execution.approvalRequired
    : null;
  if (typeof pending !== 'string' || pending.length === 0) {
    throw new Error('[record-approval] no active pending exact request');
  }
  const plannedApproval = canonicalPlanApprovalBoundary(/** @type {MutableRecordTask} */ (task));
  if (plannedApproval !== null && pending !== plannedApproval) {
    throw new Error('[record-approval] pending request does not match the planned canonical batch');
  }
  return pending;
}

/** @param {string} root @param {string} id @param {string} grantedBy @param {string} mutation */
export async function recordApproval(root, id, grantedBy, mutation) {
  if (typeof grantedBy !== 'string' || grantedBy.trim().length === 0) {
    throw new Error('[record-approval] operator identity is required');
  }
  return updateTask(root, id, (task) => {
    const next = /** @type {any} */ (structuredClone(task));
    const pending = next.category === 'operation'
      && next.stage === 'execute'
      && next.execution?.result === 'approval-required'
      ? next.execution.approvalRequired
      : null;
    if (typeof pending !== 'string' || pending.length === 0) {
      throw new Error('[record-approval] no active pending exact request');
    }
    const plannedApproval = canonicalPlanApprovalBoundary(next);
    if (plannedApproval !== null && pending !== plannedApproval) {
      throw new Error('[record-approval] pending request does not match the planned canonical batch');
    }
    if (mutation !== pending) {
      throw new Error('[record-approval] exact mutation does not match the pending request');
    }
    if (next.execution.approval !== undefined) {
      throw new Error('[record-approval] pending request already has an operator grant');
    }
    const grantedAt = now();
    const grant = { mutation: pending, grantedBy, grantedAt };
    next.execution.approval = grant;
    next.approvals = [...(next.approvals ?? []), grant];
    next.updatedAt = grantedAt;
    return /** @type {TaskJson} */ (next);
  });
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
  if (stage !== 'council' && specialistReturn.agent_id !== observedAgentId) {
    throw new Error(`[record-identity] claimed agent ${specialistReturn.agent_id} does not match observed agent ${observedAgentId ?? '<missing>'}`);
  }
  return updateTask(root, id, (task) => transitionTask(task, stage, specialistReturn), { allowTransientTerminal: true });
}
