# Backlog

Soft, Jeff-maintained orientation. Not gated by `cook validate`. Forward-looking only.

Next free id: n/a in lite mode; GitHub issues own numbering.

## NOW

- **Primary dogfood host:** native Jeff 3.2.0 is installed for Codex and running on GPT-5.6 Sol. Pi and Claude Code remain first-class hosts. The model stamp is execution context, not a routing rule.
- **Parallel/non-blocking: `#37`:** investigate duplicated collapsed `Thinking...` rows; fix locally or track the owning Pi/provider defect.
- **Baseline:** 3.2.0 is released and tagged at `4f453321c108d4cf20ab3f8871bc001a56b7b80c`.

## NEXT

### 1. Mechanical transcription spine

- **`#18` is next and on the critical path:** validate and atomically record structured specialist returns and `verify --task` evidence against the authoritative checked-JS schema. Keep it a deterministic bridge, not a workflow runtime.

### 2. One-core Node cutover

- **`#61`, after `#18`:** complete the host-neutral Node cutover, add the no-live-reference guard, and retire `cook.sh` only after parity plus Pi, Claude Code, and Codex smoke tests. Until then Bash remains the transition oracle.

### 3. Trial conditional refactor

- **`#41`**: after mechanical recording and the one-core cutover, dispatch refactor only for a concrete specialist-identified dedup/harmonization opportunity; record run/skip evidence and evaluate after 10 substantive code tasks. Keep the trial out of the authoritative schema until the evidence supports it.

### 4. Cursor support after the seam exists

- Cursor is an adapter, not a fork.
- Do not build Cursor-specific glue around `cook.sh`.
- Add it only after the authoritative core and recording boundary exist.

## DEFERRED / NON-CRITICAL

- **`#56`** retain the Codex-native UX follow-up; keep it outside model routing and the shared method.
- **`#50`** evaluate race-safe native test-only write fencing for the combined plan stage; non-blocking #40 audit follow-up.
- **`#47`** clarify the legacy in-flight branch example in the migration guide; non-blocking review-council follow-up from #38.
- **`#36`** conditional npm-publishing hardening: revisit only if the release-check, pinned npm toolchain, or single-maintainer trust boundary changes.
- Long-tail security scanners are frozen. `#26` is closed; reopen or supersede only when run history shows a new engine catches unique actionable findings.
- Remaining cleanup notes: `writeFileAtomic`/`writeTask` dedup, `reporters.js` dead `else`, `plan.js` empty-needle comment, widen `tsconfig` only if script typechecking becomes relevant, and ledger effort translation at the recording boundary.
