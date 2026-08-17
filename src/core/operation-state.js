// @ts-check

import { isType } from './validate.js';

export const OPERATION_STATE_VERSION = 1;

/** @param {Record<string, any>} task */
export function isAuthoritativeOperation(task) {
  return task.category === 'operation' && task.operationStateVersion === OPERATION_STATE_VERSION;
}

/** @param {unknown} value */
export function isOperationCycle(value) {
  return Number.isInteger(value) && Number(value) >= 0;
}

/** @param {Record<string, any>} task */
export function currentOperationCycle(task) {
  return isOperationCycle(task.execution?.cycle)
    ? task.execution.cycle
    : Array.isArray(task.judgmentHistory)
      ? task.judgmentHistory.length
      : 0;
}

/** @param {Record<string, any>} task */
export function nextOperationExecutionCycle(task) {
  if (task.execution?.result === 'approval-required') return currentOperationCycle(task);
  const current = currentOperationCycle(task);
  return task.execution === undefined ? current : current + 1;
}

/** @param {Record<string, any>} task */
export function isAwaitingScopedOperationExecution(task) {
  const council = task.convergence?.council;
  return task.stage === 'execute'
    && council?.convened === true
    && council.verdict === 'block'
    && council.outcome === null
    && task.execution?.cycle === council.cycle;
}

/** @param {Record<string, any>} task */
export function latestApprovalRequest(task) {
  return Array.isArray(task.approvalRequests) ? task.approvalRequests.at(-1) : undefined;
}

/** @param {any} left @param {any} right */
export function isSameApproval(left, right) {
  return left !== null
    && right !== null
    && typeof left === 'object'
    && typeof right === 'object'
    && left.mutation === right.mutation
    && left.grantedBy === right.grantedBy
    && left.grantedAt === right.grantedAt;
}

/** @param {Record<string, any>} task */
export function hasBoundPendingApprovalRequest(task) {
  const execution = task.execution;
  const request = latestApprovalRequest(task);
  return execution?.result === 'approval-required'
    && request !== undefined
    && request.id === task.approvalRequests.length - 1
    && execution.approvalRequestId === request.id
    && request.mutation === task.plan?.approvalBoundary
    && execution.approvalRequired === request.mutation
    && request.requestedBy === execution.executor_agent_id
    && request.requestedAt === execution.recordedAt
    && request.cycle === execution.cycle;
}

/** @param {Record<string, any>} task */
export function hasCompletedApprovalProvenance(task) {
  const execution = task.execution;
  const request = latestApprovalRequest(task);
  const grant = execution?.approval;
  const retained = Array.isArray(task.approvals) ? task.approvals.at(-1) : undefined;
  if (task.plan?.requiresApproval !== true
    || execution?.result !== 'executed'
    || request === undefined
    || !isType(grant, 'object')
    || request.id !== task.approvalRequests.length - 1
    || execution.approvalRequestId !== request.id
    || request.mutation !== task.plan.approvalBoundary
    || request.cycle !== execution.cycle
    || request.requestedBy === execution.executor_agent_id
    || request.requestedBy === grant.grantedBy
    || grant.mutation !== request.mutation
    || !isSameApproval(grant, retained)
    || (grant.requestId !== undefined
      && (grant.requestId !== request.id || grant.requestId !== execution.approvalRequestId))) {
    return false;
  }
  const requestedAt = Date.parse(request.requestedAt);
  const grantedAt = Date.parse(grant.grantedAt);
  const recordedAt = Date.parse(execution.recordedAt);
  return Number.isFinite(requestedAt)
    && Number.isFinite(grantedAt)
    && Number.isFinite(recordedAt)
    && requestedAt <= grantedAt
    && grantedAt <= recordedAt;
}
