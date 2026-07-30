# Backlog

Soft, Jeff-maintained orientation. Not gated by `cook validate`. Forward-looking only.

Next free id: n/a in lite mode; GitHub issues own numbering.

## NEXT

- **`#121`** specialists cannot know their dispatch id, so every `cook record` fails the identity check on first attempt. Costs a round trip per stage on every host; six extra dispatches during `#117`. Consider dropping the specialist-authored `agent_id` entirely, since the host-observed id is both sufficient and more trustworthy.
- **`#122`** bare `cook verify` prints `verify green` while leaving `tests.green` false and `tests.gate` null; the binding form `cook verify --task <id>` is undocumented in `cook help`. Fails toward a false green.
- **`#108`** guard authoritative approval validation so a degenerate ledger reports a violation instead of killing the validator.
- **`#110`** bind approval grants to their request id rather than to text plus timestamp ordering.
- **`#113`** pin the operation-category residue: a regression for the restored priority check, `approvalRequests` in the code-side cross-category guard, and INV-8 documentation scoped to what is actually checked.

## TODO

- **`#137`** lock which side of the formula the project-state carve-out sits on. Test 22 holds that the recipe's section names a bare `.jeff/` class, not where. The reachable regression is a byte-optimizing collapse of the two sentences into one formula, which keeps every token and every guard green while reopening the CWE-706 write edge. The `#136` audit's candidate seam is in the issue verbatim, with its false-positive ceiling and the standards review's structural argument that the property is not lockable within the discipline. Weigh together with `#135`.
- **`#135`** bring `security-auditor`'s own paths under one resolution recipe. After `#123` its References list mixes two bases on adjacent lines, and the new lock matches `reference/*.md` only, so the `scripts/*` form is invisible to every guard. Its `:32-38` recipe also announces a base directory that a dispatched station, handed the file by absolute path with no skill loader, does not have. Pair with the orphaned `skills/security-auditor/reference/json-schema.md`.
- **`#132`** bind the bundled-skill guard to identity, not just resolution: the brief's absolute path is unconditionally authoritative with nothing tying it back to the declared spelling. Also the reverse lock matches only `.md`, so a non-`.md` bundled asset escapes declaration.
- **`#130`** cut two verbatim duplications from the always-loaded `SKILL.md` (`:137`/`:155`, `:143`/`:206`). Same class `#120` cut from `cook-implement.md:18`; fell outside AC4 on a technicality.
- **`cook indiff` false positive**: it compares the working tree, so an unrelated uncommitted file (`.jeff/BACKLOG.md` during `#128`) is reported as an out-of-diff refactor edit. Stashing and re-running gives exit 0. A false kickback signal on a scope guard erodes trust in the guard; consider comparing committed state or naming unrelated dirt separately.
- **`pi-coding-agent` 0.83.0** is published against the pinned `^0.80.10`. `#126` deliberately did not take it: a three-minor jump on the dependency backing the pi shell and all of `src/pi/` should not ride a security fix. Reconsider at the same time whether it belongs in `dependencies` at all, since every Claude Code and Codex user installs the whole Pi agent SDK and it was the sole source of both advisories.
- **`#124`** test-guard fallout from the `#117` relocation: one change-detector assertion, and two negative guards still scoped to `SKILL.md` after the prose they guard moved into `reference/`.
- **`#125`** two facts still have a second home after the pointer conversion: effort values in `docs/specs/jeff-design.md:52` (found by both `#117` reviewers) and the operation approval sequence in `AGENTS.md:45` (reviewers split on whether it counts).
- **`secrets` scanner coverage**: split out of `#126`, which cleared the advisories and left this open. Decide whether to install `gitleaks` or record `secrets` as knowingly uncovered.
- **`#118`** point the state-schema reference at `src/core/task-schema.js` instead of restating it. Split out of `#117` at capture because the overlap was asserted, not measured; audit which prose facts the checked schema genuinely covers before deleting any.
- **`#106`** reject duplicate approval after a re-stop; demoted out of `#105`, wants its own cycle. Confirmed live on `main @ 6ead6b5`: a same-boundary re-stop appends a fresh request at `src/core/record.js:793`, after which the prior grant no longer binds and the request becomes grantable again.

## DEFERRED / NON-CRITICAL

- **`#56`** retain the Codex-native UX follow-up; keep it outside model routing and the shared method. Unblocked (its stated predecessor `#27` is closed) but deliberately unqueued.
- **HEAD-probe regression** (was `#71`, closed 2026-07-28): add a separate `git rev-parse HEAD` failure regression only if the HEAD and status probe paths diverge, or if the shared `git()` helper changes. Both probes currently sit adjacent and fail closed in `src/core/record.js:933-948`.
- **Test-ownership enforcement** (surfaced by the closed `#111`): the implement stage does not own tests, yet `#107`'s fix commit added one. If this is worth enforcing mechanically, write it against the pipeline contract so it binds every future task.
- **Cursor support** remains an adapter, not a fork. Add it only against the authoritative core and recording boundary; create no host-specific workflow path.
- Long-tail security scanners are frozen. `#26` is closed; reopen or supersede only when run history shows a new engine catches unique actionable findings.

## RELEASED 3.8.0 (2026-07-30)

The context-engineering arc shipped as one release. `#131` via PR #133 (`afd0a73`) made the bundled-skill lock a property of adding a pointer, after finding that seven pointer sites existed and exactly one was locked. `#123`, `#134` and `#136` shipped together via PR #138 (`a07cb7b`): one base-directory recipe for every payload path, scoped to payload paths after the `#123` audit found the generalization pulled project state into the plugin root (CWE-706), then shrunk after `#134`'s reviewers found 412 of its 432 added bytes were enumeration and argument rather than rule. `#126` via PR #139 (`f42df9e`) cleared both npm advisories, which `npm audit fix` cannot do: they are pinned under `pi-coding-agent`'s own `node_modules` and need `overrides` plus a lockfile rebuilt from scratch.

Arc totals: `skills/cook/SKILL.md` 310 to 227 lines and 47530 to 30638 bytes, a 35.5% cut on the file that loads in full on every activation; payload structural guards 7 to 22; `skills/cook/reference/` 2 files to 6. Twenty-one independent judgments across the seven tasks, fourteen reviews and seven required audits, every task under dual review, zero blocking findings and zero kickbacks throughout.

Two things the arc found that its issues did not predict: `#120`'s latent broken pointer had survived in two more files (`code-standards` and `security-auditor` both named reference files in a form no guard could see), and each pass reproduced the same pattern one level down until `#136` made the lock a property of the change rather than something the next task must remember. Follow-ups tracked as `#132`, `#135` and `#137`.

## CLOSED EARLIER (2026-07-29)

`#120` and `#128` merged together via PR #127 (`67753bb`). `#120` cut prescriptive rules the declared frontier tier no longer needs; `#128` finished the bundled-skill pointer mechanism those cuts depend on and absorbed `#129`. Payload prose net -1176 bytes after paying for the pointer mechanism and the fail-closed rule. Six judgments across the two tasks (four reviews, two required audits), zero blocking findings, zero kickbacks, both gates green on a clean tree. Three of the issue's own cut candidates came back as argued keeps: `cook-implement.md:12-15`, `cook-audit.md:16`, and two of the six review smells. The deletion exposed a latent defect, a relative `load-bearing-vs-liturgy.md` pointer that resolved to a nonexistent path while the cut ledger leaned on it for coverage. Follow-ups split out as `#130` and `#131`.

## CLOSED PREVIOUS PASS (2026-07-28)

`#117` merged via PR #119: harness right-sized for a declared frontier-tier target (Opus 5 / GPT-5.6 Sol / Grok 4.5), `SKILL.md` 311 to 228 lines, four branch-gated blocks moved to `skills/cook/reference/`. Zero blocking findings from two reviewers and a forced audit, zero kickbacks. Version deliberately not bumped; decided at release. `#107` merged via PR #114. `#109` merged via PR #115. `#112` added the terminal abandonment path and reconciled local ledgers `#101` and `#105` to `abandoned` with their council history intact. Pruned as superseded or satisfied: `#102` (met by `#107`, pinned at `src/pi/extension.test.js:283`), `#103` (docs aligned by `#105`/`#107`), `#104` (verifier query-kind architecture never shipped; `SKILL.md:242` settles the premise the other way), `#71` and `#111` (see DEFERRED above). The abandoned `codex/task-80-pi-human-returns` branch and both stale worktrees were removed.
