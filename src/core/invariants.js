// @ts-check

/**
 * Pure per-check invariant functions for the authoritative JS validator. Most
 * checks retain the former Bash behavior; destination changes live here first
 * and are specified directly rather than derived from the transition oracle.
 *
 * No I/O. Every function is a deterministic function of the collected task
 * objects and returns the exact violation strings `cook.sh` emits (parity is
 * over exit code + failing-check identity, so message wording is load-bearing).
 * Task input is treated as UNTRUSTED: a malformed shape that would make jq abort
 * (fail CLOSED → die) throws here, so the orchestrator can never fall through to
 * a "validation OK" on a store it could not evaluate.
 */

import { isType } from './validate.js';
import { forbiddenCouncilAgentIds } from './identity-policy.js';

/**
 * jq's `a // b`: yield `b` when `a` is null, false, or absent.
 * @param {any} v
 * @param {any} d
 * @returns {any}
 */
function jqOr(v, d) {
  return (v === null || v === undefined || v === false) ? d : v;
}

/**
 * jq string interpolation `\(v)`: null/absent renders empty, else `String(v)`.
 * @param {any} v
 * @returns {string}
 */
function jqStr(v) {
  return (v === null || v === undefined) ? '' : String(v);
}

/**
 * jq's `length` (cook.sh inv4 na-justification, skills/cook/scripts/cook.sh:431:
 * `(($t.tests.evidence // []) | length)`): array → element count, string →
 * codepoint count, number → absolute value, object → key count, null → 0. A jq
 * boolean has no length (`true | length` aborts), so this throws : the caller's
 * fail-CLOSED trap then renders the verdict. Replaces `String(v).length`, which
 * diverged (e.g. numeric `0` → "0".length == 1 instead of jq's 0).
 * @param {any} v
 * @returns {number}
 */
function jqLength(v) {
  if (v === null || v === undefined) return 0;
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'string') return [...v].length;
  if (typeof v === 'number') return Math.abs(v);
  if (typeof v === 'boolean') throw new Error('jq length: boolean has no length');
  if (isType(v, 'object')) return Object.keys(v).length;
  throw new Error('jq length: unsupported type');
}

/**
 * jq aborts when it indexes or iterates a present value of the wrong
 * container type (`42 | .k`, `[] | .k`, `42 | .[]`). Mirror that: throw when
 * a field is present (non-null) but not of the expected container `type`
 * ('object' for tests/agents/convergence/review/audit, 'array' for deps), so
 * the caller's fail-CLOSED catch renders the verdict instead of JS silently
 * reading `undefined`/iterating nothing (fail OPEN).
 * @param {any} v
 * @param {'object' | 'array'} type
 * @param {string} name - field name, for the "malformed <name>" message
 * @returns {void}
 */
function assertContainerType(v, type, name) {
  if (v !== null && v !== undefined && !isType(v, type)) {
    throw new Error(`malformed ${name}`);
  }
}

const STATUSES = ['pending', 'in_progress', 'blocked', 'done', 'abandoned'];
// `test` is accepted only as a legacy persisted-ledger resume state.
const STAGES = ['capture', 'plan', 'test', 'implement', 'refactor', 'review', 'audit', 'done'];
const PRIOS = ['p0', 'p1', 'p2', 'p3', 'p4'];

/**
 * `[gate]` done-gate pre-flight (cook.sh:338-346). Over `done` tasks only, and
 * null-tolerant: a done task without `tests.gate` (legacy) and any non-done task
 * are skipped. Fails CLOSED (throws) if a present `tests.gate` is not an object.
 *
 * @param {any[]} tasks
 * @returns {string[]}
 */
export function gatePreflight(tasks) {
  const out = [];
  for (const t of tasks) {
    if (t.status !== 'done') continue;
    // jq reads `$t.tests.gate` for this done task; a present non-object `tests`
    // would abort jq (index a non-object) → fail CLOSED. Mirror it.
    assertContainerType(t.tests, 'object', 'tests');
    const g = (t.tests === null || t.tests === undefined) ? null : t.tests.gate;
    if (g === null || g === undefined) continue;
    if (!isType(g, 'object')) throw new Error('malformed tests.gate');
    const id = jqStr(t.id);
    if (g.green !== true) {
      out.push(`task ${id}: done but tests.gate.green != true (tests.green not backed by a green full-suite gate) [gate]`);
    }
    if (g.clean !== true) {
      out.push(`task ${id}: done but tests.gate.clean != true (gate ran on a dirty tree) [gate]`);
    }
    if (typeof g.hash !== 'string' || g.hash === '') {
      out.push(`task ${id}: done but tests.gate.hash is missing/empty (a recorded gate must carry the gated hash) [gate]`);
    }
    if (t.tests.green === true && g.green !== true) {
      out.push(`task ${id}: tests.green == true but not backed by tests.gate.green == true [gate]`);
    }
  }
  return out;
}

/**
 * Main invariant pass (cook.sh:382-605): per-task field/registry checks,
 * inv1/inv2, inv4 done-gate, inv5a dep-exists, `[prune]`, the inv7-11
 * convergence block, status-conditional fields, plus the cross-task duplicate-id
 * and inv5b dependency-cycle (Kahn) checks. `lite` drops the registry-only
 * checks (id-type, inv5, duplicate-id, `[prune]`).
 *
 * @param {any[]} tasks
 * @param {{ lite: boolean }} opts
 * @returns {string[]}
 */
export function runInvariants(tasks, { lite }) {
  const out = [];
  const ids = tasks.map((t) => t.id);

  for (const t of tasks) {
    // Fail CLOSED on type-confused containers (mirrors jq abort-on-index),
    // scoped to exactly where the jq pass indexes each field: tests/agents
    // (inv1/2) and convergence (.council) for every task; review/audit only
    // inside the done block; deps only under full mode (inv5a/inv5b iterate it).
    assertContainerType(t.tests, 'object', 'tests');
    assertContainerType(t.agents, 'object', 'agents');
    assertContainerType(t.convergence, 'object', 'convergence');
    if (t.status === 'done') {
      assertContainerType(t.review, 'object', 'review');
      assertContainerType(t.audit, 'object', 'audit');
    }
    // Item 2 (documented strictness, Chef call 2026-07-03). cook.sh iterates
    // `($t.deps // [])[]`, which tolerates `deps:{}` (iterates an object's values →
    // empty → no deps) and `deps:false` (`false // []` → `[]` → no deps), both exit
    // 0. We assert `deps` is an array, so any present non-array `deps`
    // ({}/false/"abc"/number) throws → fail CLOSED (exit 1). Deliberate: treating an
    // object's values as "dependencies" is nonsense on untrusted input; we refuse.
    // (This seam is pinned by strengthened A4 in validate-store.test.js.)
    if (!lite) assertContainerType(t.deps, 'array', 'deps');

    const id = jqStr(t.id);
    const agents = t.agents || {};
    const ta = (t.tests && t.tests.authored_by_agent_id != null) ? t.tests.authored_by_agent_id : null;
    const im = agents.implementer_agent_id != null ? agents.implementer_agent_id : null;
    const rv = agents.reviewer_agent_id != null ? agents.reviewer_agent_id : null;
    const rv2 = agents.reviewer2_agent_id != null ? agents.reviewer2_agent_id : null;

    // id-type: registry invariant (full only). Lite ledgers may carry a string id.
    if (!lite && typeof t.id !== 'number') {
      out.push(`${jqStr(t._dir)}: id must be a number`);
    }
    // slug required
    const slug = jqOr(t.slug, '');
    if (typeof slug !== 'string' || slug === '') {
      out.push(`task ${id}: slug is required`);
    }
    // title required
    if (jqOr(t.title, '') === '') {
      out.push(`task ${id}: title is required`);
    }
    // status / stage / priority enums
    if (!STATUSES.includes(t.status)) out.push(`task ${id}: invalid status "${jqStr(t.status)}"`);
    if (!STAGES.includes(t.stage)) out.push(`task ${id}: invalid stage "${jqStr(t.stage)}"`);
    if (!PRIOS.includes(t.priority)) out.push(`task ${id}: invalid priority "${jqStr(t.priority)}"`);

    // inv1: test author != implementer
    if (ta !== null && im !== null && ta === im) {
      out.push(`task ${id}: test author == implementer (${jqStr(ta)}) [inv1]`);
    }
    // inv2: implementer != every reviewer
    if (im !== null && (im === rv || im === rv2)) {
      out.push(`task ${id}: implementer == reviewer (${jqStr(im)}) [inv2]`);
    }
    const reviews = [
      [t.review, rv, true],
      [t.review2, rv2, false],
    ];
    for (const [outcome, recordedReviewer, acceptsSingleIdentity] of reviews) {
      if (!isType(outcome, 'object')) continue;
      const outcomeReviewer = outcome.reviewer_agent_id != null ? outcome.reviewer_agent_id : null;
      const hasVerdict = outcome.verdict === 'pass' || outcome.verdict === 'needs-work';
      const identityMismatch = outcomeReviewer !== null && recordedReviewer !== null && outcomeReviewer !== recordedReviewer;
      const missingBoundIdentity = hasVerdict && (
        acceptsSingleIdentity
          ? outcomeReviewer === null && recordedReviewer === null
          : outcomeReviewer === null || recordedReviewer === null
      );
      if (identityMismatch || missingBoundIdentity || (im !== null && outcomeReviewer === im)) {
        out.push(`task ${id}: review outcome identity does not match its separated reviewer [inv2]`);
      }
    }

    // inv4: done-gate quality invariant
    if (t.status === 'done') {
      const tests = t.tests || {};
      const g = tests.green;
      const evidence = jqOr(tests.evidence, []);
      // Item 1 (documented strictness, Chef call 2026-07-03). cook.sh's jq is
      // `$g != true and ((evidence // []) | length) == 0 …`; the `and`
      // short-circuits, so when tests.green == true the `length` is never
      // evaluated and a `done` task with green:true + a boolean (non-lengthable)
      // evidence stays exit 0. We evaluate jqLength(evidence) EAGERLY, so a boolean
      // evidence throws → fail CLOSED (exit 1). Deliberate: an unlengthable evidence
      // is malformed; we refuse rather than silently pass. (Bug-for-bug would gate
      // this call behind `g !== true`; we deliberately don't.)
      const evLen = jqLength(evidence);
      const reviewVerdict = (t.review && t.review.verdict != null) ? t.review.verdict : null;
      if (g !== true && (g !== 'na' || evLen === 0 || reviewVerdict !== 'pass')) {
        out.push(`task ${id}: done but tests.green != true (and not a justified "na" no-test state: needs tests.green=="na" + non-empty tests.evidence + review.verdict=="pass") [inv4]`);
      }
      if (g === true && (ta === null || ta === im)) {
        out.push(`task ${id}: done but tests not authored by a non-implementer [inv4]`);
      }
      const shippedCouncil = t.convergence?.council?.convened === true
        && t.convergence.council.verdict === 'ship'
        && t.convergence.council.outcome === 'shipped';
      const councilSources = shippedCouncil
        ? new Set(t.convergence.council.findings.map((/** @type {any} */ finding) => finding.source))
        : new Set();
      const legacyCouncilStage = councilSources.has(undefined) ? t.convergence.council.stage : null;
      const councilResolved = (/** @type {'review' | 'review2' | 'audit'} */ source) => (
        councilSources.has(source) || (legacyCouncilStage === 'review' && source !== 'audit') || legacyCouncilStage === source
      );
      if (reviewVerdict !== 'pass' && !councilResolved('review')) {
        out.push(`task ${id}: done but review.verdict != pass [inv4]`);
      }
      const isHistoricalSingleReview = !Object.hasOwn(t, 'review2')
        && (Object.hasOwn(agents, 'plan_agent_id') || Object.hasOwn(agents, 'test_author_agent_id'));
      const isComplex = t.complexity !== 'simple' && !isHistoricalSingleReview;
      if (isComplex && (!isType(t.review2, 'object') || (t.review2.verdict !== 'pass' && !councilResolved('review2')))) {
        out.push(`task ${id}: complex done task requires a recorded second review with review2.verdict == pass [inv4]`);
      } else if (!isComplex && t.review2 !== null && t.review2 !== undefined
        && t.review2.verdict !== 'pass' && !councilResolved('review2')) {
        out.push(`task ${id}: done but review2.verdict != pass [inv4]`);
      }
      const av = jqOr(t.audit && t.audit.verdict, 'na');
      if (av !== 'pass' && av !== 'na' && !councilResolved('audit')) {
        out.push(`task ${id}: done but audit.verdict not pass|na [inv4]`);
      }
    }

    // inv5a: deps exist (registry invariant, full only)
    if (!lite) {
      for (const d of jqOr(t.deps, [])) {
        if (!ids.includes(d)) out.push(`task ${id}: dep ${jqStr(d)} does not exist [inv5]`);
      }
    }

    // prune: a done/abandoned dir must not rest in the store (full only)
    if (!lite && (t.status === 'done' || t.status === 'abandoned')) {
      out.push(`task ${id}: status "${jqStr(t.status)}" task dir must not rest in the store; prune at completion: remove dir, strip deps, commit removal (archive is git history/tags) [prune]`);
    }

    // convergence block (inv7-11); absent ⇒ skipped
    convergenceChecks(t, id, ids, out);

    // status-conditional required fields
    if (t.status === 'blocked' && jqOr(t.blockedReason, '') === '') {
      out.push(`task ${id}: blocked requires blockedReason`);
    }
    if (t.status === 'abandoned' && jqOr(t.abandonReason, '') === '') {
      out.push(`task ${id}: abandoned requires abandonReason`);
    }
  }

  // duplicate ids (registry invariant, full only): one line per duplicated id
  if (!lite) {
    const counts = new Map();
    for (const i of ids) counts.set(i, (counts.get(i) || 0) + 1);
    for (const [i, c] of counts) {
      if (c > 1) out.push(`duplicate task id ${jqStr(i)}`);
    }
  }

  // inv5b: dependency cycle via Kahn (registry invariant, full only)
  if (!lite) {
    let remaining = tasks.map((t) => ({
      id: t.id,
      deps: jqOr(t.deps, []).filter((/** @type {any} */ d) => ids.includes(d)),
    }));
    /** @type {any[]} */
    let removed = [];
    for (;;) {
      const ready = remaining
        .filter((n) => n.deps.every((/** @type {any} */ d) => removed.includes(d)))
        .map((n) => n.id);
      if (ready.length === 0) {
        if (remaining.length > 0) {
          out.push(`dependency cycle among tasks ${JSON.stringify(remaining.map((n) => n.id))} [inv5]`);
        }
        break;
      }
      remaining = remaining.filter((n) => !ready.includes(n.id));
      removed = removed.concat(ready);
    }
  }

  return out;
}

/**
 * Convergence invariants inv7-11 (cook.sh:464-584). Absent `convergence` ⇒ no
 * checks. Present ⇒ asserted over the recorded state, fail-closed on bad shape.
 *
 * @param {any} t - the task object
 * @param {string} id - jq-rendered `t.id`
 * @param {any[]} ids - all task ids (for followupTaskId existence)
 * @param {string[]} out - violation accumulator
 * @returns {void}
 */
function convergenceChecks(t, id, ids, out) {
  const c = t.convergence;
  if (c === null || c === undefined) return;
  const cl = c.council;
  const conv = (cl !== null && cl !== undefined && cl.convened === true);

  // inv7: cap integer ≥1; each of review/audit blockingKickbacks int in 0..cap.
  const cap = c.cap;
  if (typeof cap !== 'number' || cap < 1 || Math.floor(cap) !== cap) {
    out.push(`task ${id}: convergence.cap must be an integer ≥ 1 [inv7]`);
  } else {
    for (const st of ['review', 'audit']) {
      const bk = (c.stages && c.stages[st]) ? c.stages[st].blockingKickbacks : undefined;
      if (typeof bk !== 'number' || bk < 0 || bk > cap || Math.floor(bk) !== bk) {
        out.push(`task ${id}: convergence.stages.${st}.blockingKickbacks must be an integer in 0..${cap} [inv7]`);
      }
    }
  }

  // inv8 (F5): convergence present ⇒ council must be a non-null object.
  if (!isType(cl, 'object')) {
    out.push(`task ${id}: convergence present requires a non-null council object [inv8]`);
  }

  // inv8 (F4): closed enums on a non-null council object.
  if (isType(cl, 'object')) {
    const vd = cl.verdict != null ? cl.verdict : null;
    if (![null, 'ship', 'block'].includes(vd)) {
      out.push(`task ${id}: council.verdict must be one of null, ship, block [inv8]`);
    }
    const oc = cl.outcome != null ? cl.outcome : null;
    if (![null, 'shipped', 'scoped-fix-shipped', 'blocked-to-operator'].includes(oc)) {
      out.push(`task ${id}: council.outcome must be one of null, shipped, scoped-fix-shipped, blocked-to-operator [inv8]`);
    }
  }

  // inv8: council.convened must be a proper boolean (fail CLOSED on coercion).
  if (isType(cl, 'object') && typeof cl.convened !== 'boolean') {
    out.push(`task ${id}: council.convened must be a boolean [inv8]`);
  }

  // inv8: a non-convened council may not carry verdict == block.
  if (isType(cl, 'object') && !conv && cl.verdict === 'block') {
    out.push(`task ${id}: a non-convened council must not carry verdict == block [inv8]`);
  }

  // inv8: council distinctness (only when convened).
  if (conv) {
    const mem = jqOr(cl.members, []);
    const mids = mem.map((/** @type {any} */ m) => (m == null ? null : m.agent_id));
    const lenses = mem.map((/** @type {any} */ m) => (m == null ? null : m.lens));
    const forbidden = forbiddenCouncilAgentIds(t);
    if (mem.length !== 3) out.push(`task ${id}: convened council must have exactly 3 members [inv8]`);
    if (new Set(mids).size !== mids.length) {
      out.push(`task ${id}: council member agent_ids must be mutually distinct [inv8]`);
    }
    for (const mid of mids) {
      if (forbidden.has(mid)) {
        out.push(`task ${id}: council member ${jqStr(mid)} overlaps a forbidden prior judge [inv8]`);
      }
    }
    if (JSON.stringify([...lenses].sort()) !== JSON.stringify(['integrity', 'pragmatist', 'security'])) {
      out.push(`task ${id}: council lenses must be exactly integrity, security, pragmatist [inv8]`);
    }
    if (!['review', 'audit'].includes(cl.stage)) {
      out.push(`task ${id}: convened council.stage must be review or audit [inv8]`);
    }
  }

  // inv9: per-finding determinism (only when convened).
  if (conv) {
    const fs = jqOr(cl.findings, []);
    if (fs.length < 1) out.push(`task ${id}: convened council must record at least one finding [inv9]`);
    for (const f of fs) {
      const bv = f == null ? undefined : f.blockingVotes;
      if (typeof bv !== 'number' || bv < 0 || bv > 3 || Math.floor(bv) !== bv) {
        out.push(`task ${id}: finding ${jqStr(f == null ? null : f.id)} blockingVotes must be an integer in 0..3 [inv9]`);
      }
    }
    for (const f of fs) {
      const expected = jqOr(f == null ? undefined : f.blockingVotes, -1) >= 2;
      const survived = f == null ? undefined : f.survived;
      if (survived !== expected) {
        out.push(`task ${id}: finding ${jqStr(f == null ? null : f.id)} survived must equal (blockingVotes ≥ 2) [inv9]`);
      }
    }
    const anySurvived = fs.some((/** @type {any} */ f) => f != null && f.survived === true);
    const expectedVerdict = anySurvived ? 'block' : 'ship';
    if (cl.verdict !== expectedVerdict) {
      out.push(`task ${id}: council verdict must be "${expectedVerdict}" given the per-finding survivals [inv9]`);
    }
  }

  // inv10: follow-up tracking (only when convened).
  if (conv) {
    const fs = jqOr(cl.findings, []);
    for (const f of fs) {
      const fid = jqStr(f == null ? null : f.id);
      const fut = (f == null || f.followupTaskId == null) ? null : f.followupTaskId;
      const survived = f == null ? undefined : f.survived;
      if (survived === true) {
        if (fut !== null) out.push(`task ${id}: surviving finding ${fid} must have followupTaskId == null [inv10]`);
      } else if (fut === null) {
        out.push(`task ${id}: follow-up finding ${fid} must record a followupTaskId [inv10]`);
      } else if (!ids.includes(fut)) {
        out.push(`task ${id}: finding ${fid} followupTaskId ${jqStr(fut)} does not reference an existing task [inv10]`);
      }
    }
  }

  // inv11: block resolution / done-gate.
  if (conv && cl.verdict === 'block' && cl.outcome === 'blocked-to-operator' && t.status !== 'blocked') {
    out.push(`task ${id}: council blocked-to-operator requires status == blocked [inv11]`);
  }
  if (t.status === 'done' && conv && cl.verdict === 'block' && cl.outcome !== 'scoped-fix-shipped') {
    out.push(`task ${id}: done with an unresolved council block (outcome != scoped-fix-shipped) [inv11]`);
  }
}
