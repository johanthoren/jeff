#!/usr/bin/env node
// @ts-check

/**
 * Host-neutral Node CLI. Resolves the store root from `COOK_ROOT`, the current
 * Git top-level, or cwd, then dispatches to verdict-shaped core functions.
 * Imports only Node stdlib and `src/core/*`; host launch adapters remain outside.
 */

import { validateStore } from '../core/validate-store.js';
import { lsReport, statusReport, showReport } from '../core/reporters.js';
import { runVerify } from '../core/verify.js';
import {
  deinitProject,
  doctorReport,
  initProject,
  liteProject,
  profileInit,
  profileReport,
} from '../core/lifecycle.js';
import { adoptPlan, planSection, planCheck, planAppend, isIssueRef, planIssueOp } from '../core/plan.js';
import { runBaseline } from '../core/baseline.js';
import { flavorReport } from '../core/flavor.js';
import { git, indiffReport } from '../core/git.js';
import { recordSpecialistFile } from '../core/record.js';

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

/** @returns {{ code: number, stdout: string[], stderr: string[] }} */
function usageReport() {
  return {
    code: 0,
    stdout: [
      'cook: Jeff CLI.',
      '',
      'Subcommands:',
      '  validate     Check .jeff state against the schema and invariants.',
      '  verify       Run the configured full-suite gate.',
      '  record       Record a specialist or council result.',
      '  baseline check [<hash>]  Check the green, clean baseline log.',
      '  ls           List tasks.',
      '  status       Report in-flight tasks and backlog health.',
      '  show <id>    Print one task ledger.',
      '  init         Activate Jeff and scaffold .jeff/.',
      '  lite         Activate lite mode and locally Git-exclude .jeff/.',
      '  on <ref>     Adopt a markdown plan or GitHub issue in lite mode.',
      '  plan <sub>   Read or update a markdown plan or GitHub issue.',
      '  indiff <base-ref> <pre-ref>  Bound refactor changes to the implement diff.',
      '  deinit       Mark Jeff inactive while preserving task state.',
      '  flavor       Print the effective voice.',
      '  profile      Print and validate .jeff/profile.md.',
      '  profile init Write the default profile without clobbering.',
      '  doctor       Report the Node environment and activation state.',
      '  help         Show this help.',
    ],
    stderr: [],
  };
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
  doctor: doctorReport,
  init: initProject,
  lite: liteProject,
  deinit: deinitProject,
  flavor: flavorReport,
};

/** @type {Record<string, (root: string, ...args: string[]) => Promise<{ code: number, stdout: string[], stderr: string[] }>>} */
const PLAN_VERBS = { section: planSection, check: planCheck, append: planAppend };

async function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const rest = argv.slice(1);
  const root = process.env.COOK_ROOT || gitTopLevel() || process.cwd();

  if (sub === undefined || sub === 'help' || sub === '-h' || sub === '--help') {
    return emit(usageReport());
  }

  if (sub !== undefined && Object.hasOwn(VERBS, sub)) {
    if (rejectUnknownArgs(sub, rest)) return process.exit(1);
    return emit(await VERBS[sub](root));
  }

  if (sub === 'on') return emit(await adoptPlan(root, ...rest));
  if (sub === 'indiff') return emit(await indiffReport(root, ...rest));

  if (sub === 'profile') {
    if (rest.length === 0) return emit(await profileReport(root));
    if (rest[0] === 'init') {
      if (rest.length > 1) {
        process.stderr.write(`cook: profile init: unexpected argument '${rest[1]}'\n`);
        return process.exit(1);
      }
      return emit(await profileInit(root));
    }
    process.stderr.write(`cook: unknown profile subcommand: ${rest[0]} (try \`cook profile\` or \`cook profile init\`)\n`);
    return process.exit(1);
  }
  if (sub === 'verify') {
    if (rest.length === 0) return emit(await runVerify(root));
    if (rest[0] === '--task' && rest[1] && rest.length === 2) return emit(await runVerify(root, rest[1]));
    if (rest[0]?.startsWith('-')) process.stderr.write(`cook: verify: unknown option '${rest[0]}'\n`);
    else process.stderr.write(`cook: verify: unexpected argument '${rest[0]}'\n`);
    return process.exit(1);
  }

  if (sub === 'record') {
    const councilRecord = rest[0] === 'council';
    const expectedArguments = councilRecord ? 3 : 4;
    if (rest.length !== expectedArguments) {
      process.stderr.write('cook: usage: cook record <stage> <id> <observed-agent-id> <file>\n');
      process.stderr.write('       or: cook record council <id> <file>\n');
      return process.exit(1);
    }
    try {
      const observedAgentId = councilRecord ? undefined : rest[2];
      const file = councilRecord ? rest[2] : rest[3];
      await recordSpecialistFile(root, rest[0], rest[1], file, observedAgentId);
      return emit({ code: 0, stdout: [`cook: recorded ${rest[0]} for task ${rest[1]}`], stderr: [] });
    } catch (error) {
      process.stderr.write(`cook: ${/** @type {Error} */ (error).message}\n`);
      return process.exit(1);
    }
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
    // arg-count usage checks : parity with cook.sh's cmd_baseline (:1470).
    return emit(await runBaseline(root, rest));
  }

  if (sub === 'plan') {
    // `plan <sub> <target> …` (like `show`, NOT a VERBS entry): validate the
    // subcommand FIRST : parity with cook.sh's cmd_plan (:1024) : then dispatch
    // to the core verb, which does its own arg-count usage check. When the first
    // plan positional (the target) is an issue ref (`#…`/`http(s)://…`), route to
    // the github-issues adapter instead of the markdown path : parity with
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

  process.stderr.write(`cook: unknown subcommand: ${sub} (try \`cook help\`)\n`);
  return process.exit(1);
}

main();
