# Backlog

Soft, Jeff-maintained orientation. Not gated by `cook validate`. Forward-looking only.

Next free id: n/a in lite mode; GitHub issues own numbering.

## NOW

- **Release recovery — `#44`:** npm rejected the immutable 1.3.3 tag because root package provenance metadata was absent; add the canonical repository field and publish 1.3.4 without rewriting 1.3.3.
- **Completed — `#33`:** linked-worktree verification/activation merged in PR #43; its 1.3.3 package publish was superseded by #44 after provenance rejection.
- **Parallel/non-blocking — `#37`:** investigate duplicated collapsed `Thinking...` rows; fix locally or track the owning Pi/provider defect.
- **Baseline:** PR #43 CI and the local full suite were green on merged `main` at `e022edc`.

## NEXT

### 1. Correct simple-task commit semantics

- **`#38`**: full-mode simple tasks make one final green commit; intentionally red tests never land on trunk. Complex and lite integration paths stay unchanged.

### 2. Remove dead task brain metadata

- **`#39`**: stop writing `task.json.brains`; remove it from the canonical shape while tolerating historical ledgers. Keep Claude Code pins and Pi's actual dispatch-brain return unchanged.

### 3. Collapse the plan-to-test handoff

- **`#40`**: one fresh specialist designs the approach and authors red tests; preserve test-author ≠ implementer and implementer ≠ reviewer mechanically. Remove the separate encoder stage and its serialization grammar with an explicit compatibility path.

### 4. Authoritative typed schema + validator core

- **`#27`**: make the existing zero-dependency plain-JS/checkJs core authoritative after `#39`–`#40`; fold in dual-review recording and separation. `cook.sh` remains only a transition oracle. No TypeScript build layer.

### 5. Mechanical transcription spine

- **`#18`**: validate and atomically record structured specialist returns and `verify --task` evidence against the authoritative `#27` schema. Keep it a deterministic bridge, not a workflow runtime.

### 6. Host-neutral CLI + cook.sh retirement path

- Keep the Node CLI host-neutral: no Claude/Pi/Cursor assumptions in core.
- Preserve `cook.sh` only long enough to prove parity where behavior is intentionally unchanged.
- Add a no-live-reference guard: shipped skills/hooks/src must not call `cook.sh`.
- Retire `cook.sh` only after the CLI, Pi, and Claude Code pass smoke tests.

### 7. Trial conditional refactor

- **`#41`**: after mechanical recording and the one-core cutover, dispatch refactor only for a concrete specialist-identified dedup/harmonization opportunity; record run/skip evidence and evaluate after 10 substantive code tasks. Do not encode the provisional trial into `#27` first.

### 8. Dispatch/host adapter seam

- Core owns state, validation, recording, verification, git/test helpers, and stage contracts.
- Host adapters own only fresh-context launch and structured-return collection.
- Keep Pi and Claude Code adapters thin.

### 9. Cursor support after the seam exists

- Cursor is an adapter, not a fork.
- Do not build Cursor-specific glue around `cook.sh`.
- Add it only after the authoritative core and recording boundary exist.

## DEFERRED / NON-CRITICAL

- **`#36`** conditional npm-publishing hardening: revisit only if the release-check, pinned npm toolchain, or single-maintainer trust boundary changes.
- Long-tail security scanners are frozen. `#26` is closed; reopen or supersede only when run history shows a new engine catches unique actionable findings.
- Remaining cleanup notes: `writeFileAtomic`/`writeTask` dedup, `reporters.js` dead `else`, `plan.js` empty-needle comment, widen `tsconfig` only if script typechecking becomes relevant, and ledger effort translation at the recording boundary.
