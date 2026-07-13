# Backlog

Soft, Jeff-maintained orientation. Not gated by `cook validate`. Forward-looking only.

Next free id: n/a in lite mode; GitHub issues own numbering.

## NOW

- **Release candidate:** 3.3.0 contains the host-neutral specialist recorder, the archived-cycle reset fix, and simplified scoped recovery.
- **Parallel/non-blocking: `#37`:** investigate duplicated collapsed `Thinking...` rows; fix locally or track the owning Pi/provider defect.

## NEXT

### 1. One-core Node cutover

- **`#61`:** complete the host-neutral Node cutover, add the no-live-reference guard, and retire `cook.sh` only after parity plus Pi, Claude Code, and Codex smoke tests. Until then Bash remains the transition oracle.

### 2. Conditional refactor

- **`#41`, after `#61`:** run refactor only for a named simplification opportunity. Add no decision stage, analytics, counters, or evaluation subsystem.

### 3. Cursor support after the seam exists

- Cursor is an adapter, not a fork.
- Do not build Cursor-specific glue around `cook.sh`.
- Add it only after the authoritative core and recording boundary exist.

## DEFERRED / NON-CRITICAL

- **`#56`** retain the Codex-native UX follow-up; keep it outside model routing and the shared method.
- **`#47`** clarify the legacy in-flight branch example in the migration guide; non-blocking review-council follow-up from #38.
- Long-tail security scanners are frozen. `#26` is closed; reopen or supersede only when run history shows a new engine catches unique actionable findings.
