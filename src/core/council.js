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

/**
 * Returns the first invalid canonical research field. Complete historical
 * omission remains valid because schema-v1 ledgers have no version marker that
 * can distinguish an old council from a new one.
 *
 * @param {any} council
 * @returns {string | null}
 */
export function councilResearchViolation(council) {
  const members = Array.isArray(council?.members) ? council.members : [];
  const present = council?.synthesis !== undefined
    || members.some((member) => member?.inquiry !== undefined);
  if (!present) return null;
  if (members.length !== 3) return 'members';

  for (let index = 0; index < members.length; index += 1) {
    const inquiry = members[index]?.inquiry;
    if (!isType(inquiry, 'object')) return `members[${index}].inquiry`;
    if (!isNonemptyString(inquiry.question)) return `members[${index}].inquiry.question`;
    if (!isNonemptyString(inquiry.problemRestatement)) return `members[${index}].inquiry.problemRestatement`;
    for (const field of ['causalHypotheses', 'solutionStrategies', 'decisiveEvidence']) {
      if (!isNonemptyStringArray(inquiry[field])) return `members[${index}].inquiry.${field}`;
    }
    if (!Array.isArray(inquiry.findingVotes)) return `members[${index}].inquiry.findingVotes`;
  }

  if (new Set(members.map((member) => JSON.stringify(member.inquiry))).size !== 3) {
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

  if (council.verdict === 'block') {
    for (const finding of findings) {
      const blockingVotes = members.filter((member) => (
        member.inquiry.findingVotes.find((vote) => vote.id === finding.id)?.blocking === true
      )).length;
      if (finding.blockingVotes !== blockingVotes || finding.survived !== (blockingVotes >= 2)) {
        return 'findings.blockingVotes';
      }
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
    || !synthesis.solutionStrategies.every((route) => COUNCIL_ROUTES.includes(route))) {
    return 'synthesis.solutionStrategies';
  }
  if (!COUNCIL_ROUTES.includes(synthesis.selectedStrategy)
    || !synthesis.solutionStrategies.includes(synthesis.selectedStrategy)) {
    return 'synthesis.selectedStrategy';
  }
  if (council.verdict === 'block') {
    const surviving = findings.filter((finding) => finding.survived === true).map((finding) => finding.id);
    if (!sameValues(synthesis.survivingBlockers, surviving)) return 'synthesis.survivingBlockers';
  }
  return null;
}
