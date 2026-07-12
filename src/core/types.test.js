// @ts-check

/** @type {import('./types.js').TaskJson} */
const canonicalTask = {
  schemaVersion: 1,
  id: 27,
  slug: 'authoritative-schema',
  title: 'Authoritative schema',
  status: 'in_progress',
  stage: 'plan',
  priority: 'p2',
  deps: [],
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
  complexity: 'complex',
  agents: {
    implementer_agent_id: null,
    reviewer_agent_id: null,
    reviewer2_agent_id: null,
    audit_agent_id: null,
  },
  tests: { authored_by_agent_id: null, green: false, evidence: [] },
  review: { verdict: null, reviewer_agent_id: null, evidence: [] },
  review2: null,
  audit: { required: true, verdict: 'na', audit_agent_id: null, evidence: [] },
  commits: [],
  kickbacks: [],
  blockedReason: null,
  abandonReason: null,
  convergence: {
    cap: 2,
    stages: {
      review: { blockingKickbacks: 0 },
      audit: { blockingKickbacks: 0 },
    },
    council: {
      convened: false,
      stage: null,
      members: [],
      findings: [],
      verdict: null,
      outcome: null,
    },
  },
};
void canonicalTask;

/** @type {import('./types.js').TaskJson['review']} */
const badReview = {
  // @ts-expect-error - verdict must be ReviewVerdict ('pass' | 'needs-work' | null)
  verdict: 'bogus',
  reviewer_agent_id: null,
  evidence: [],
};
void badReview;

/** @type {import('./types.js').TaskJson['audit']} */
const badAudit = {
  required: false,
  // @ts-expect-error - verdict must be AuditVerdict ('pass' | 'needs-work' | 'na')
  verdict: 'bogus',
  audit_agent_id: null,
  evidence: [],
};
void badAudit;

/** @type {import('./types.js').TaskJson} */
const taskWithRemovedBrains = {
  ...canonicalTask,
  // @ts-expect-error - brains are accepted only by the runtime compatibility reader, not canonical writers
  brains: { plan: { model: 'opus', effort: 'xhigh' } },
};
void taskWithRemovedBrains;

/** @type {import('./types.js').TaskJson} */
const taskWithRemovedPlanIdentity = {
  ...canonicalTask,
  agents: {
    implementer_agent_id: null,
    reviewer_agent_id: null,
    reviewer2_agent_id: null,
    audit_agent_id: null,
    // @ts-expect-error - the combined plan/test identity lives only at tests.authored_by_agent_id
    plan_agent_id: 'legacy-plan-agent',
  },
};
void taskWithRemovedPlanIdentity;
