# Backlog

Soft, Jeff-maintained orientation. Not gated by `cook validate`. Forward-looking only.

Next free id: n/a in lite mode; GitHub issues own numbering.

## NOW

- **`#112`** `blocked-to-operator` has no terminal exit. Load-bearing for orientation: the `#101` and `#105` ledgers still read `blocked` in `cook ls` even though both issues are closed, so the local store disagrees with the tracker until this is fixed. Option 1 in the issue (narrow INV-11 to admit `abandoned`) is sufficient for the terminal case.

## NEXT

- **`#108`** guard authoritative approval validation so a degenerate ledger reports a violation instead of killing the validator.
- **`#110`** bind approval grants to their request id rather than to text plus timestamp ordering.
- **`#113`** pin the operation-category residue: a regression for the restored priority check, `approvalRequests` in the code-side cross-category guard, and INV-8 documentation scoped to what is actually checked.

## TODO

- **`#106`** reject duplicate approval after a re-stop; demoted out of `#105`, wants its own cycle. Confirmed live on `main @ 6ead6b5`: a same-boundary re-stop appends a fresh request at `src/core/record.js:793`, after which the prior grant no longer binds and the request becomes grantable again.

## DEFERRED / NON-CRITICAL

- **`#56`** retain the Codex-native UX follow-up; keep it outside model routing and the shared method. Unblocked (its stated predecessor `#27` is closed) but deliberately unqueued.
- **HEAD-probe regression** (was `#71`, closed 2026-07-28): add a separate `git rev-parse HEAD` failure regression only if the HEAD and status probe paths diverge, or if the shared `git()` helper changes. Both probes currently sit adjacent and fail closed in `src/core/record.js:933-948`.
- **Test-ownership enforcement** (surfaced by the closed `#111`): the implement stage does not own tests, yet `#107`'s fix commit added one. If this is worth enforcing mechanically, write it against the pipeline contract so it binds every future task.
- **Cursor support** remains an adapter, not a fork. Add it only against the authoritative core and recording boundary; create no host-specific workflow path.
- Long-tail security scanners are frozen. `#26` is closed; reopen or supersede only when run history shows a new engine catches unique actionable findings.

## CLOSED THIS PASS (2026-07-28)

`#107` merged via PR #114. Pruned as superseded or satisfied: `#102` (met by `#107`, pinned at `src/pi/extension.test.js:283`), `#103` (docs aligned by `#105`/`#107`), `#104` (verifier query-kind architecture never shipped; `SKILL.md:242` settles the premise the other way), `#71` and `#111` (see DEFERRED above). The abandoned `codex/task-80-pi-human-returns` branch and both stale worktrees were removed.
