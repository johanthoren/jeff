// @ts-check

/** @param {unknown[]} values */
function agentIds(values) {
  return values.filter((value) => typeof value === 'string' && value !== '');
}

/** @param {Record<string, any>} task */
function recordedAgentIds(task) {
  return agentIds([
    task.agents?.implementer_agent_id,
    task.agents?.reviewer_agent_id,
    task.agents?.reviewer2_agent_id,
    task.agents?.audit_agent_id,
  ]);
}

/** @param {Record<string, any>} task */
function currentJudgeAgentIds(task) {
  return agentIds([
    task.review?.reviewer_agent_id,
    task.review2?.reviewer_agent_id,
    task.audit?.audit_agent_id,
  ]);
}

/** @param {Record<string, any>} task */
function historicalJudgeAgentIds(task) {
  return (task.judgmentHistory ?? []).flatMap((/** @type {any} */ judgment) => agentIds([
    judgment.review?.reviewer_agent_id,
    judgment.review2?.reviewer_agent_id,
    judgment.audit?.audit_agent_id,
  ]));
}

/** @param {Record<string, any>} task */
function refuterAgentIds(task) {
  return agentIds((task.refutes ?? []).map((/** @type {any} */ refute) => refute.agent_id));
}

/** @param {Record<string, any>} task */
export function forbiddenRefuteAgentIds(task) {
  return new Set([
    ...recordedAgentIds(task),
    ...currentJudgeAgentIds(task),
    ...refuterAgentIds(task),
  ]);
}

/** @param {Record<string, any>} task @param {unknown} agentId */
export function isRefuteAgentForbidden(task, agentId) {
  return forbiddenRefuteAgentIds(task).has(agentId);
}

/** @param {Record<string, any>} task */
export function forbiddenCouncilAgentIds(task) {
  return new Set([
    ...recordedAgentIds(task),
    ...currentJudgeAgentIds(task),
    ...historicalJudgeAgentIds(task),
    ...refuterAgentIds(task),
  ]);
}
