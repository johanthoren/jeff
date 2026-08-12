// @ts-check

import { isType } from './validate.js';

export const COUNCIL_ROUTES = [
  'confined-repair',
  'test-contract-repair',
  'refactor',
  'causal-subgraph-reconstruction',
  'full-replan',
  'operator-escalation',
];

export const OPERATION_COUNCIL_ROUTES = [
  'scoped-execute',
  'operator-escalation',
];

export const RECONSTRUCTION_QUESTION = 'Are these independent defects, or evidence that this part of the design should be reconstructed?';

/** @param {unknown} value */
function isNonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/** @param {unknown} value */
function isNonemptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonemptyString);
}

/** @param {unknown} value */
function isUniqueStringArray(value) {
  return isNonemptyStringArray(value) && new Set(value).size === value.length;
}

/** @param {unknown[]} left @param {unknown[]} right */
function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** @param {string} value */
function canonicalText(value) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {unknown} value @returns {unknown} */
function canonicalValue(value) {
  if (typeof value === 'string') return canonicalText(value);
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isType(value, 'object')) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

/** @param {any} inquiry */
function canonicalInquiry(inquiry) {
  return JSON.stringify(canonicalValue(inquiry));
}

/**
 * Returns the first invalid canonical research field.
 *
 * Persisted ledger validation may opt into complete historical omission.
 * Live council aggregates must always carry all three inquiries and synthesis.
 *
 * @param {any} council
 * @param {{allowOmission?: boolean, category?: 'code' | 'operation'}} [options]
 * @returns {string | null}
 */
export function councilResearchViolation(council, options = {}) {
  const members = Array.isArray(council?.members) ? council.members : [];
  const present = council?.synthesis !== undefined
    || members.some((member) => member?.inquiry !== undefined);
  if (!present) return options.allowOmission === true ? null : 'synthesis';
  if (members.length !== 3) return 'members';
  const allowedRoutes = options.category === 'operation'
    ? OPERATION_COUNCIL_ROUTES
    : options.category === 'code'
      ? COUNCIL_ROUTES
      : [...COUNCIL_ROUTES, ...OPERATION_COUNCIL_ROUTES];


  for (let index = 0; index < members.length; index += 1) {
    const inquiry = members[index]?.inquiry;
    if (!isType(inquiry, 'object')) return `members[${index}].inquiry`;
    if (!isNonemptyString(inquiry.question)) return `members[${index}].inquiry.question`;
    if (!isNonemptyString(inquiry.problemRestatement)) return `members[${index}].inquiry.problemRestatement`;
    for (const field of ['causalHypotheses', 'solutionStrategies', 'decisiveEvidence']) {
      if (!isNonemptyStringArray(inquiry[field])) return `members[${index}].inquiry.${field}`;
    }
    if (!isUniqueStringArray(inquiry.solutionStrategies)
      || inquiry.solutionStrategies.length < 2
      || !inquiry.solutionStrategies.every((route) => allowedRoutes.includes(route))) {
      return `members[${index}].inquiry.solutionStrategies`;
    }
    if (!Array.isArray(inquiry.findingVotes)) return `members[${index}].inquiry.findingVotes`;
  }

  if (new Set(members.map((member) => canonicalInquiry(member.inquiry))).size !== 3) {
    return 'members.inquiry';
  }
  if (!members.some((member) => member.inquiry.question === RECONSTRUCTION_QUESTION)) {
    return 'members.inquiry.question';
  }

  const findings = Array.isArray(council?.findings) ? council.findings : [];
  const findingIds = findings.map((finding) => finding?.id);
  if (findingIds.length === 0 || !findingIds.every(isNonemptyString)
    || new Set(findingIds).size !== findingIds.length) return 'findings';

  for (let memberIndex = 0; memberIndex < members.length; memberIndex += 1) {
    const votes = members[memberIndex].inquiry.findingVotes;
    const voteIds = votes.map((vote) => vote?.id);
    if (votes.length !== findings.length || new Set(voteIds).size !== voteIds.length
      || findingIds.some((id) => !voteIds.includes(id))) {
      return `members[${memberIndex}].inquiry.findingVotes`;
    }
    for (let voteIndex = 0; voteIndex < votes.length; voteIndex += 1) {
      const vote = votes[voteIndex];
      if (!isType(vote, 'object') || !isNonemptyString(vote.id)
        || typeof vote.blocking !== 'boolean' || !isNonemptyString(vote.rationale)) {
        return `members[${memberIndex}].inquiry.findingVotes[${voteIndex}]`;
      }
    }
  }

  for (const finding of findings) {
    const blockingVotes = members.filter((member) => (
      member.inquiry.findingVotes.find((vote) => vote.id === finding.id)?.blocking === true
    )).length;
    if (finding.blockingVotes !== blockingVotes || finding.survived !== (blockingVotes >= 2)) {
      return 'findings.blockingVotes';
    }
  }

  const synthesis = council?.synthesis;
  if (!isType(synthesis, 'object')) return 'synthesis';
  if (!isNonemptyString(synthesis.problemRestatement)) return 'synthesis.problemRestatement';
  for (const field of ['survivingBlockers', 'causalHypotheses', 'solutionStrategies', 'rejectedAlternatives', 'decisiveEvidence']) {
    if (!Array.isArray(synthesis[field]) || !synthesis[field].every(isNonemptyString)) {
      return `synthesis.${field}`;
    }
  }
  if (!isUniqueStringArray(synthesis.solutionStrategies) || synthesis.solutionStrategies.length < 2
    || !synthesis.solutionStrategies.every((route) => allowedRoutes.includes(route))) {
    return 'synthesis.solutionStrategies';
  }
  if (!allowedRoutes.includes(synthesis.selectedStrategy)
    || !synthesis.solutionStrategies.includes(synthesis.selectedStrategy)) {
    return 'synthesis.selectedStrategy';
  }
  const rejectedAlternatives = synthesis.rejectedAlternatives;
  const nonselectedStrategies = synthesis.solutionStrategies
    .filter((route) => route !== synthesis.selectedStrategy);
  if (!isUniqueStringArray(rejectedAlternatives)
    || rejectedAlternatives.length !== nonselectedStrategies.length
    || rejectedAlternatives.some((route) => !nonselectedStrategies.includes(route))) {
    return 'synthesis.rejectedAlternatives';
  }
  const surviving = findings.filter((finding) => finding.survived === true).map((finding) => finding.id);
  if (!sameValues(synthesis.survivingBlockers, surviving)) return 'synthesis.survivingBlockers';
  if (council.verdict !== (surviving.length > 0 ? 'block' : 'ship')) return 'verdict';
  return null;
}
