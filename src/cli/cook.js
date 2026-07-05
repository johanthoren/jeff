#!/usr/bin/env node
// @ts-check

/**
 * `cook.js`: the JS CLI entry for the ported verbs. Resolves the store root like
 * cook.sh (skills/cook/scripts/cook.sh:44) — `COOK_ROOT`, else
 * `git rev-parse --show-toplevel`, else cwd — dispatches to the pure verdict
 * function for the verb, prints its streams, and exits with the verdict code.
 * Imports only node stdlib + `src/core/*` (no pi SDK): the §6 boundary.
 *
 * Ported so far: `validate` (item 4) and the read-only reporters `ls` / `status`
 * / `show` (item 3, slice a). Every other verb stays on cook.sh (the parity
 * wrapper delegates them there), so this entry rejects an unknown subcommand
 * with a usage error rather than pretending to handle it.
 */

import { validateStore } from '../core/validate-store.js';
import { lsReport, statusReport, showReport } from '../core/reporters.js';
import { runVerify } from '../core/verify.js';
import { doctorReport, initProject } from '../core/lifecycle.js';
import { planSection, planCheck, planAppend, isIssueRef, planIssueOp } from '../core/plan.js';
import { runBaseline } from '../core/baseline.js';
import { topbrainReport } from '../core/topbrain.js';
import { flavorReport } from '../core/flavor.js';
import { git } from '../core/git.js';

/** @returns {string} the git top-level of cwd, or '' if not a git repo */
function gitTopLevel() {
  const res = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  return res.status === 0 ? (res.stdout ?? '').trim() : '';
}

/**
 * Print a verdict's streams and exit with its code (uniform across every verb).
 *
 * @param {{ code: number, stdout: string[], stderr: string[] }} verdict
 * @returns {never}
 */
function emit(verdict) {
  for (const line of verdict.stdout) process.stdout.write(`${line}\n`);
  for (const line of verdict.stderr) process.stderr.write(`${line}\n`);
  process.exit(verdict.code);
}

/**
 * Reject a leftover argument fail-closed (parity with cook.sh's
 * `reject_unknown_args`): dash-prefixed → "unknown option", else "unexpected
 * argument". Returns true (and prints) iff an argument was rejected.
 *
 * @param {string} label - the verb name for the message
 * @param {string[]} rest - args after the subcommand
 * @returns {boolean}
 */
function rejectUnknownArgs(label, rest) {
  if (rest.length === 0) return false;
  const first = rest[0];
  if (first.startsWith('-')) process.stderr.write(`cook: ${label}: unknown option '${first}'\n`);
  else process.stderr.write(`cook: ${label}: unexpected argument '${first}'\n`);
  return true;
}

/**
 * The no-argument verbs: reject any leftover argument, then emit the verdict.
 * `show` takes its own branch in `main` (an id argument, not `reject_unknown_args`).
 *
 * @type {Record<string, (root: string) => Promise<{ code: number, stdout: string[], stderr: string[] }>>}
 */
const VERBS = {
  validate: validateStore,
  ls: lsReport,
  status: statusReport,
  verify: runVerify,
  doctor: doctorReport,
  init: initProject,
  topbrain: topbrainReport,
  flavor: flavorReport,
};

/** @type {Record<string, (root: string, ...args: string[]) => Promise<{ code: number, stdout: string[], stderr: string[] }>>} */
const PLAN_VERBS = { section: planSection, check: planCheck, append: planAppend };

async function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const rest = argv.slice(1);
  const root = process.env.COOK_ROOT || gitTopLevel() || process.cwd();

  if (sub !== undefined && Object.hasOwn(VERBS, sub)) {
    if (rejectUnknownArgs(sub, rest)) return process.exit(1);
    return emit(await VERBS[sub](root));
  }

  if (sub === 'show') {
    // `show` does NOT reject_unknown_args (N5): a leading-dash arg is an id.
    // cook.sh order: empty-id first (usage), then the extra-arg guard.
    const id = rest[0];
    if (id && rest.length > 1) {
      process.stderr.write(`cook: show: unexpected argument '${rest[1]}'\n`);
      return process.exit(1);
    }
    return emit(await showReport(root, id ?? ''));
  }

  if (sub === 'baseline') {
    // `baseline check [<hash>]` (like `show`/`plan`, NOT a VERBS entry): it
    // takes its own positional args. runBaseline does its own subcommand +
    // arg-count usage checks — parity with cook.sh's cmd_baseline (:1470).
    return emit(await runBaseline(root, rest));
  }

  if (sub === 'plan') {
    // `plan <sub> <target> …` (like `show`, NOT a VERBS entry): validate the
    // subcommand FIRST — parity with cook.sh's cmd_plan (:1024) — then dispatch
    // to the core verb, which does its own arg-count usage check. When the first
    // plan positional (the target) is an issue ref (`#…`/`http(s)://…`), route to
    // the github-issues adapter instead of the markdown path — parity with
    // cook.sh's cmd_plan (:1032). Markdown refs are unchanged.
    const psub = rest[0];
    const pargs = rest.slice(1);
    if (psub === undefined || psub === '') {
      process.stderr.write('cook: usage: cook plan <section|check|append> …\n');
      return process.exit(1);
    }
    if (!Object.hasOwn(PLAN_VERBS, psub)) {
      process.stderr.write(`cook: unknown plan subcommand: ${psub} (try section|check|append)\n`);
      return process.exit(1);
    }
    const target = pargs[0];
    if (target !== undefined && isIssueRef(target)) {
      return emit(await planIssueOp(root, psub, target, ...pargs.slice(1)));
    }
    return emit(await PLAN_VERBS[psub](root, ...pargs));
  }

  process.stderr.write(`cook: unknown subcommand: ${sub === undefined ? 'help' : sub} (try \`cook help\`)\n`);
  return process.exit(1);
}

main();
