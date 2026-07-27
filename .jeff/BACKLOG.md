# Backlog

Soft, Jeff-maintained orientation. Not gated by `cook validate`. Forward-looking only.

Next free id: n/a in lite mode; GitHub issues own numbering.

## NOW

- **`#107`** is finished and green but unmerged. `#101` and `#105` are now closed as superseded, so the stack underneath it is legitimate history rather than unfinished work, and the pull request is unblocked whenever Johan wants it opened.
- **`#112`** `blocked-to-operator` has no terminal exit. This is load-bearing for orientation: the `#101` and `#105` ledgers still read `blocked` in `cook ls` even though both issues are closed, so the local store now disagrees with the tracker until this is fixed.

## NEXT

- **`#113`** pin the operation-category residue: a regression for the restored priority check, `approvalRequests` in the code-side cross-category guard, and INV-8 documentation scoped to what is actually checked.

- **`#109`** escape the expanded Pi approval rendering: the residual half of the display-spoofing finding `#105`'s panel sustained, and the only place that disagrees with the project's own display policy.
- **`#108`** guard authoritative approval validation so a degenerate ledger reports a violation instead of killing the validator.
- **`#110`** bind approval grants to their request id rather than to text plus timestamp ordering.

## TODO

- **`#111`** restore test ownership for the marker regression added during `#107`'s final fix, and correct the stale red-run counts.
- **`#106`** reject duplicate approval after a re-stop; demoted out of `#105`, wants its own cycle.
- **`#103`** align the operation pipeline docs to what `#107` established.
- **`#102`** preserve the exact operation approval display.
- **`#104`** cover every operation verifier query kind.

## DEFERRED / NON-CRITICAL

- **`#56`** retain the Codex-native UX follow-up; keep it outside model routing and the shared method.

- **`#71`** add a separate Git HEAD-probe failure regression only if the HEAD and status probe paths diverge or a regression reaches that branch.
- **Cursor support** remains an adapter, not a fork. Add it only against the authoritative core and recording boundary; create no host-specific workflow path.
- Long-tail security scanners are frozen. `#26` is closed; reopen or supersede only when run history shows a new engine catches unique actionable findings.
