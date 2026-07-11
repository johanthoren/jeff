# Backlog

Soft, Jeff-maintained orientation. Not gated by `cook validate`. Forward-looking only.

Next free id: n/a in lite mode; GitHub issues own numbering.

## NOW

- **Primary dogfood host:** native Jeff 3.1.0 is installed for Codex; start `#27` in a new Codex thread. Pi and Claude remain supported.
- **Parallel/non-blocking — `#37`:** investigate duplicated collapsed `Thinking...` rows; fix locally or track the owning Pi/provider defect.
- **Baseline:** 3.1.0 is published from merged `main` at `f77c67f`.

## NEXT

### 2. Authoritative typed schema + validator core

- **`#27`**: make the existing zero-dependency plain-JS/checkJs core authoritative after `#39`–`#40`; fold in dual-review recording and separation. `cook.sh` remains only a transition oracle. No TypeScript build layer.

### 3. Mechanical transcription spine

- **`#18`**: validate and atomically record structured specialist returns and `verify --task` evidence against the authoritative `#27` schema. Keep it a deterministic bridge, not a workflow runtime.

### 4. Host-neutral CLI + cook.sh retirement path

- Keep the Node CLI host-neutral: no Claude/Pi/Cursor assumptions in core.
- Preserve `cook.sh` only long enough to prove parity where behavior is intentionally unchanged.
- Add a no-live-reference guard: shipped skills/hooks/src must not call `cook.sh`.
- Retire `cook.sh` only after the CLI, Pi, and Claude Code pass smoke tests.

### 5. Trial conditional refactor

- **`#41`**: after mechanical recording and the one-core cutover, dispatch refactor only for a concrete specialist-identified dedup/harmonization opportunity; record run/skip evidence and evaluate after 10 substantive code tasks. Do not encode the provisional trial into `#27` first.

### 6. Dispatch/host adapter seam

- Core owns state, validation, recording, verification, git/test helpers, and stage contracts.
- Host adapters own only fresh-context launch and structured-return collection.
- Keep Pi and Claude Code adapters thin.

### 7. Cursor support after the seam exists

- Cursor is an adapter, not a fork.
- Do not build Cursor-specific glue around `cook.sh`.
- Add it only after the authoritative core and recording boundary exist.

## DEFERRED / NON-CRITICAL

- **`#50`** evaluate race-safe native test-only write fencing for the combined plan stage; non-blocking #40 audit follow-up.
- **`#47`** clarify the legacy in-flight branch example in the migration guide; non-blocking review-council follow-up from #38.
- **`#36`** conditional npm-publishing hardening: revisit only if the release-check, pinned npm toolchain, or single-maintainer trust boundary changes.
- Long-tail security scanners are frozen. `#26` is closed; reopen or supersede only when run history shows a new engine catches unique actionable findings.
- Remaining cleanup notes: `writeFileAtomic`/`writeTask` dedup, `reporters.js` dead `else`, `plan.js` empty-needle comment, widen `tsconfig` only if script typechecking becomes relevant, and ledger effort translation at the recording boundary.
