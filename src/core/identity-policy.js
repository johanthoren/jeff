// @ts-check

/** @param {unknown[]} values */
function agentIds(values) {
  return values.filter((value) => typeof value === 'string' && value !== '');
}

/** @param {Record<string, any>} task */
function activeAgentIds(task) {
  return agentIds([
    task.agents?.implementer_agent_id,
    task.agents?.reviewer_agent_id,
    task.agents?.reviewer2_agent_id,
    task.agents?.audit_agent_id,
    task.review?.reviewer_agent_id,
    task.review2?.reviewer_agent_id,
    task.audit?.audit_agent_id,
  ]);
}

/** @param {Record<string, any>} task */
function activeRefuterAgentIds(task) {
  return [task.review, task.review2, task.audit]
    .flatMap((/** @type {any} */ outcome) => outcome?.findings ?? [])
    .flatMap((/** @type {any} */ finding) => agentIds([finding.refute?.agent_id]));
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
  return new Set([
    ...activeAgentIds(task),
    ...activeRefuterAgentIds(task),
  ]);
}
