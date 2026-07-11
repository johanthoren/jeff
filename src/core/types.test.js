// @ts-check

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
