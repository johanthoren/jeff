// @ts-check

/** @param {unknown} value @returns {value is string} */
export function isAgentId(value) {
  return typeof value === 'string' && value.length > 0;
}

/** @param {unknown[]} values @returns {string[]} */
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
    ? task.judgmentHistory.flatMap((/** @type {any} */ entry) => agentIds([
      ...Object.values(entry?.agents ?? {}),
      entry?.review?.reviewer_agent_id,
      entry?.review2?.reviewer_agent_id,
      entry?.verification?.verifier_agent_id,
      entry?.audit?.audit_agent_id,
    ]))
    : [];
}

/** @param {Record<string, any>} task */
export function archivedVerifierAgentIds(task) {
  return Array.isArray(task.judgmentHistory)
    ? task.judgmentHistory.flatMap((/** @type {any} */ entry) => agentIds([
      entry?.agents?.verifier_agent_id,
    ]))
    : [];
}

/** @param {Record<string, any>} task @param {unknown} agentId */
export function isArchivedVerifierAgentForbidden(task, agentId) {
  return isAgentId(agentId) && archivedVerifierAgentIds(task).includes(agentId);
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
  return (/** @type {ReadonlySet<unknown>} */ (forbiddenRefuteAgentIds(task))).has(agentId);
}

/** @param {Record<string, any>} task */
export function forbiddenCouncilAgentIds(task) {
  return new Set([
    ...forbiddenRefuteAgentIds(task),
    ...archivedJudgeAgentIds(task),
    ...(task.category === 'operation' ? archivedRefuterAgentIds(task) : []),
  ]);
}

/**
 * @param {Record<string, any>} task
 * @param {string} agentId
 * @param {'test author' | 'builder'} role
 */
function hasRecordedRecoveryRole(task, agentId, role) {
  const recovery = task.convergence?.recovery;
  if (role === 'test author') {
    return recovery?.test_author_agent_id === agentId
      && task.tests?.authored_by_agent_id === agentId;
  }
  const recordedBuilder = recovery?.route === 'refactor'
    ? task.refactor?.agent_id
    : task.implement?.agent_id;
  return recovery?.builder_agent_id === agentId
    && recordedBuilder === agentId
    && (recovery?.route === 'refactor' || task.agents?.implementer_agent_id === agentId);
}

/**
 * @param {Record<string, any>} task
 * @param {unknown} agentId
 * @param {'test author' | 'builder'} role
 */
export function isRecoveryParticipantEligible(task, agentId, role) {
  if (!isAgentId(agentId)) return false;
  const recovery = task.convergence?.recovery;
  const hasRecordedRole = hasRecordedRecoveryRole(task, agentId, role);
  const currentRoleIds = role === 'test author'
    ? (hasRecordedRole ? [] : [task.tests?.authored_by_agent_id, recovery?.test_author_agent_id])
    : [
      ...(hasRecordedRole ? [] : [recovery?.builder_agent_id]),
      ...(hasRecordedRole && recovery?.route !== 'refactor'
        ? []
        : [task.agents?.implementer_agent_id]),
    ];
  const otherRoleIds = role === 'test author'
    ? [task.agents?.implementer_agent_id, recovery?.builder_agent_id]
    : [task.tests?.authored_by_agent_id, recovery?.test_author_agent_id];
  const originalRoleId = role === 'test author'
    ? recovery?.original?.test_author_agent_id
    : recovery?.original?.builder_agent_id;
  const forbidden = agentIds([
    ...currentRoleIds,
    ...otherRoleIds,
    task.agents?.reviewer_agent_id,
    task.agents?.reviewer2_agent_id,
    task.agents?.audit_agent_id,
    task.review?.reviewer_agent_id,
    task.review2?.reviewer_agent_id,
    task.audit?.audit_agent_id,
    ...archivedJudgeAgentIds(task),
    ...(task.convergence?.council?.members ?? [])
      .map((/** @type {any} */ member) => member.agent_id),
    task.convergence?.council?.synthesizer_agent_id,
    originalRoleId,
  ]);
  return !forbidden.includes(agentId);
}
