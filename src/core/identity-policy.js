// @ts-check

/** @param {unknown} value */
export function isAgentId(value) {
  return typeof value === 'string' && value.length > 0;
}

/** @param {unknown[]} values */
function agentIds(values) {
  return values.filter(isAgentId);
}

/** @param {Record<string, any>} task */
function activeAgentIds(task) {
  return agentIds([
    task.agents?.implementer_agent_id,
    task.agents?.reviewer_agent_id,
    task.agents?.reviewer2_agent_id,
    task.agents?.audit_agent_id,
    task.agents?.executor_agent_id,
    task.agents?.verifier_agent_id,
    task.review?.reviewer_agent_id,
    task.review2?.reviewer_agent_id,
    task.audit?.audit_agent_id,
    task.verification?.verifier_agent_id,
  ]);
}

/** @param {Record<string, any>} task */
export function archivedJudgeAgentIds(task) {
  return Array.isArray(task.judgmentHistory)
    ? task.judgmentHistory.flatMap((/** @type {any} */ entry) => agentIds(Object.values(entry?.agents ?? {})))
    : [];
}

/** @param {Record<string, any>} task */
export function activeRefuterAgentIds(task) {
  return [task.review, task.review2, task.verification, task.audit]
    .flatMap((/** @type {any} */ outcome) => outcome?.findings ?? [])
    .flatMap((/** @type {any} */ finding) => agentIds([finding.refute?.agent_id]));
}

/** @param {Record<string, any>} task */
function archivedRefuterAgentIds(task) {
  return Array.isArray(task.judgmentHistory)
    ? task.judgmentHistory
      .flatMap((/** @type {any} */ entry) => [entry?.review, entry?.review2, entry?.verification, entry?.audit])
      .flatMap((/** @type {any} */ outcome) => outcome?.findings ?? [])
      .flatMap((/** @type {any} */ finding) => agentIds([finding.refute?.agent_id]))
    : [];
}

/** @param {unknown} judgeAgentId @param {unknown} refuteAgentId */
export function isSourceRefuteAgentForbidden(judgeAgentId, refuteAgentId) {
  return isAgentId(judgeAgentId) && judgeAgentId === refuteAgentId;
}

/** @param {Record<string, any>} task */
export function forbiddenRefuteAgentIds(task) {
  return new Set([
    ...activeAgentIds(task),
    ...activeRefuterAgentIds(task),
  ]);
}

/** @param {Record<string, any>} task @param {unknown} agentId */
export function isRefuteAgentForbidden(task, agentId) {
  return forbiddenRefuteAgentIds(task).has(agentId);
}

/** @param {Record<string, any>} task */
export function forbiddenCouncilAgentIds(task) {
  const archived = task.category === 'operation'
    ? [...archivedJudgeAgentIds(task), ...archivedRefuterAgentIds(task)]
    : [];
  return new Set([
    ...forbiddenRefuteAgentIds(task),
    ...archived,
  ]);
}
