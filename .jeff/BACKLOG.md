# Backlog

Soft, Jeff-maintained orientation. Not gated by `cook validate`. Forward-looking only.

Next free id: n/a in lite mode; GitHub issues own numbering.

## NOW

- **Next — `#40`:** collapse plan and test into one fresh specialist while preserving mechanical separation.
- **Parallel/non-blocking — `#37`:** investigate duplicated collapsed `Thinking...` rows; fix locally or track the owning Pi/provider defect.
- **Baseline:** task #39's full gate was green at `02d1bc1`; release 2.0.0 is pending integration.

## NEXT

### 2. Collapse the plan-to-test handoff

- **`#40`**: one fresh specialist designs the approach and authors red tests; preserve test-author ≠ implementer and implementer ≠ reviewer mechanically. Remove the separate encoder stage and its serialization grammar with an explicit compatibility path.

### 3. Codex capability spike

- Verify native multi-agent isolation, inherited orchestrator model, per-stage effort, distinct durable agent ids, parallel review/audit, role brief injection, and structured returns.
- No production framework. Stop if a load-bearing invariant is unavailable and identify the smallest bridge.

### 4. Minimum native Codex plugin + early dogfood cutover

- Add the Codex plugin and marketplace manifests, lockstep version checks, installation docs, and the thinnest native dispatch instructions.
- Keep calling the stable `cook` command surface. Switch primary Jeff development from Pi to Codex here; Pi and Claude remain supported.

### 5. Authoritative typed schema + validator core

- **`#27`**: make the existing zero-dependency plain-JS/checkJs core authoritative after `#39`–`#40`; fold in dual-review recording and separation. `cook.sh` remains only a transition oracle. No TypeScript build layer.

### 6. Mechanical transcription spine

- **`#18`**: validate and atomically record structured specialist returns and `verify --task` evidence against the authoritative `#27` schema. Keep it a deterministic bridge, not a workflow runtime.

### 7. Host-neutral CLI + cook.sh retirement path

- Keep the Node CLI host-neutral: no Claude/Pi/Cursor assumptions in core.
- Preserve `cook.sh` only long enough to prove parity where behavior is intentionally unchanged.
- Add a no-live-reference guard: shipped skills/hooks/src must not call `cook.sh`.
- Retire `cook.sh` only after the CLI, Pi, and Claude Code pass smoke tests.

### 8. Trial conditional refactor

- **`#41`**: after mechanical recording and the one-core cutover, dispatch refactor only for a concrete specialist-identified dedup/harmonization opportunity; record run/skip evidence and evaluate after 10 substantive code tasks. Do not encode the provisional trial into `#27` first.

### 9. Dispatch/host adapter seam

- Core owns state, validation, recording, verification, git/test helpers, and stage contracts.
- Host adapters own only fresh-context launch and structured-return collection.
- Keep Pi and Claude Code adapters thin.

### 10. Cursor support after the seam exists

- Cursor is an adapter, not a fork.
- Do not build Cursor-specific glue around `cook.sh`.
- Add it only after the authoritative core and recording boundary exist.

## DEFERRED / NON-CRITICAL

- **`#47`** clarify the legacy in-flight branch example in the migration guide; non-blocking review-council follow-up from #38.
- **`#36`** conditional npm-publishing hardening: revisit only if the release-check, pinned npm toolchain, or single-maintainer trust boundary changes.
- Long-tail security scanners are frozen. `#26` is closed; reopen or supersede only when run history shows a new engine catches unique actionable findings.
- Remaining cleanup notes: `writeFileAtomic`/`writeTask` dedup, `reporters.js` dead `else`, `plan.js` empty-needle comment, widen `tsconfig` only if script typechecking becomes relevant, and ledger effort translation at the recording boundary.
