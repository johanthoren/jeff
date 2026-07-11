# Backlog

Soft, Jeff-maintained orientation. Not gated by `cook validate`. Forward-looking only.

Next free id: n/a in lite mode; GitHub issues own numbering.

## NOW

- **PAUSED — `#52` Codex cutover checkpoint:** native surfaces do not yet prove selected-model inheritance plus per-child stage effort in one host; keep Pi primary.
- **Operator decision:** wait/retest Codex after a host update, or continue `#27` in Pi while the cutover remains blocked.
- **Parallel/non-blocking — `#37`:** investigate duplicated collapsed `Thinking...` rows; fix locally or track the owning Pi/provider defect.
- **Baseline:** 3.0.0 is published from merged `main` at `5199e0e`.

## NEXT

### 2. Codex cutover blocked pending native host capability

- Re-run `#52` only when one native surface can demonstrate the selected orchestrator model, fresh child context, and explicit per-child `high`/`xhigh` effort together.
- Do not build a custom runtime or install the native Jeff plugin before that evidence passes.

### 3. Authoritative typed schema + validator core

- **`#27`**: make the existing zero-dependency plain-JS/checkJs core authoritative after `#39`–`#40`; fold in dual-review recording and separation. `cook.sh` remains only a transition oracle. No TypeScript build layer.

### 4. Mechanical transcription spine

- **`#18`**: validate and atomically record structured specialist returns and `verify --task` evidence against the authoritative `#27` schema. Keep it a deterministic bridge, not a workflow runtime.

### 5. Host-neutral CLI + cook.sh retirement path

- Keep the Node CLI host-neutral: no Claude/Pi/Cursor assumptions in core.
- Preserve `cook.sh` only long enough to prove parity where behavior is intentionally unchanged.
- Add a no-live-reference guard: shipped skills/hooks/src must not call `cook.sh`.
- Retire `cook.sh` only after the CLI, Pi, and Claude Code pass smoke tests.

### 6. Trial conditional refactor

- **`#41`**: after mechanical recording and the one-core cutover, dispatch refactor only for a concrete specialist-identified dedup/harmonization opportunity; record run/skip evidence and evaluate after 10 substantive code tasks. Do not encode the provisional trial into `#27` first.

### 7. Dispatch/host adapter seam

- Core owns state, validation, recording, verification, git/test helpers, and stage contracts.
- Host adapters own only fresh-context launch and structured-return collection.
- Keep Pi and Claude Code adapters thin.

### 8. Cursor support after the seam exists

- Cursor is an adapter, not a fork.
- Do not build Cursor-specific glue around `cook.sh`.
- Add it only after the authoritative core and recording boundary exist.

## DEFERRED / NON-CRITICAL

- **`#53`** improve locality of standalone parent metadata if the Codex spike is revisited; non-blocking #52 council follow-up.
- **`#50`** evaluate race-safe native test-only write fencing for the combined plan stage; non-blocking #40 audit follow-up.
- **`#47`** clarify the legacy in-flight branch example in the migration guide; non-blocking review-council follow-up from #38.
- **`#36`** conditional npm-publishing hardening: revisit only if the release-check, pinned npm toolchain, or single-maintainer trust boundary changes.
- Long-tail security scanners are frozen. `#26` is closed; reopen or supersede only when run history shows a new engine catches unique actionable findings.
- Remaining cleanup notes: `writeFileAtomic`/`writeTask` dedup, `reporters.js` dead `else`, `plan.js` empty-needle comment, widen `tsconfig` only if script typechecking becomes relevant, and ledger effort translation at the recording boundary.
