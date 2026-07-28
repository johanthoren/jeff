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

- **`#131`** harden the bundled-skill guard `#128` shipped: the fail-closed rule names no resolution base (so a consumer repo with its own `skills/testing/SKILL.md` resolves the relative path to a different document and the guard stays silent), the pointer `#128` added at `cook-audit.md:16` is itself unlocked by any test, and the operation lane carries no stop. The second item is a repeating pattern, not an instance: whatever fixes it should make the lock a property of adding a pointer, ideally one table-driven assertion over (role file, required path).
- **`#130`** cut two verbatim duplications from the always-loaded `SKILL.md` (`:137`/`:155`, `:143`/`:206`). Same class `#120` cut from `cook-implement.md:18`; fell outside AC4 on a technicality.
- **`cook indiff` false positive**: it compares the working tree, so an unrelated uncommitted file (`.jeff/BACKLOG.md` during `#128`) is reported as an out-of-diff refactor edit. Stashing and re-running gives exit 0. A false kickback signal on a scope guard erodes trust in the guard; consider comparing committed state or naming unrelated dirt separately.
- **`#123`** the base-directory resolution recipe covers only the package CLI, while six reference reads are written plugin-root-relative. Three now sit at live branch points.
- **`#124`** test-guard fallout from the `#117` relocation: one change-detector assertion, and two negative guards still scoped to `SKILL.md` after the prose they guard moved into `reference/`.
- **`#125`** two facts still have a second home after the pointer conversion: effort values in `docs/specs/jeff-design.md:52` (found by both `#117` reviewers) and the operation approval sequence in `AGENTS.md:45` (reviewers split on whether it counts).
- **`#126`** clear the two pre-existing npm advisories (1 high, 1 medium) before the next publish; decide separately whether to install `gitleaks` or record `secrets` as knowingly uncovered.
- **`#118`** point the state-schema reference at `src/core/task-schema.js` instead of restating it. Split out of `#117` at capture because the overlap was asserted, not measured; audit which prose facts the checked schema genuinely covers before deleting any.
- **`#106`** reject duplicate approval after a re-stop; demoted out of `#105`, wants its own cycle. Confirmed live on `main @ 6ead6b5`: a same-boundary re-stop appends a fresh request at `src/core/record.js:793`, after which the prior grant no longer binds and the request becomes grantable again.

## DEFERRED / NON-CRITICAL

- **`#56`** retain the Codex-native UX follow-up; keep it outside model routing and the shared method. Unblocked (its stated predecessor `#27` is closed) but deliberately unqueued.
- **HEAD-probe regression** (was `#71`, closed 2026-07-28): add a separate `git rev-parse HEAD` failure regression only if the HEAD and status probe paths diverge, or if the shared `git()` helper changes. Both probes currently sit adjacent and fail closed in `src/core/record.js:933-948`.
- **Test-ownership enforcement** (surfaced by the closed `#111`): the implement stage does not own tests, yet `#107`'s fix commit added one. If this is worth enforcing mechanically, write it against the pipeline contract so it binds every future task.
- **Cursor support** remains an adapter, not a fork. Add it only against the authoritative core and recording boundary; create no host-specific workflow path.
- Long-tail security scanners are frozen. `#26` is closed; reopen or supersede only when run history shows a new engine catches unique actionable findings.

## CLOSED THIS PASS (2026-07-29)

`#120` and `#128` merged together via PR #127 (`67753bb`). `#120` cut prescriptive rules the declared frontier tier no longer needs; `#128` finished the bundled-skill pointer mechanism those cuts depend on and absorbed `#129`. Payload prose net -1176 bytes after paying for the pointer mechanism and the fail-closed rule. Six judgments across the two tasks (four reviews, two required audits), zero blocking findings, zero kickbacks, both gates green on a clean tree. Three of the issue's own cut candidates came back as argued keeps: `cook-implement.md:12-15`, `cook-audit.md:16`, and two of the six review smells. The deletion exposed a latent defect, a relative `load-bearing-vs-liturgy.md` pointer that resolved to a nonexistent path while the cut ledger leaned on it for coverage. Follow-ups split out as `#130` and `#131`.

## CLOSED PREVIOUS PASS (2026-07-28)

`#117` merged via PR #119: harness right-sized for a declared frontier-tier target (Opus 5 / GPT-5.6 Sol / Grok 4.5), `SKILL.md` 311 to 228 lines, four branch-gated blocks moved to `skills/cook/reference/`. Zero blocking findings from two reviewers and a forced audit, zero kickbacks. Version deliberately not bumped; decided at release. `#107` merged via PR #114. `#109` merged via PR #115. `#112` added the terminal abandonment path and reconciled local ledgers `#101` and `#105` to `abandoned` with their council history intact. Pruned as superseded or satisfied: `#102` (met by `#107`, pinned at `src/pi/extension.test.js:283`), `#103` (docs aligned by `#105`/`#107`), `#104` (verifier query-kind architecture never shipped; `SKILL.md:242` settles the premise the other way), `#71` and `#111` (see DEFERRED above). The abandoned `codex/task-80-pi-human-returns` branch and both stale worktrees were removed.
