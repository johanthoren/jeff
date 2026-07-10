# Backlog

Soft, Jeff-maintained orientation. Not gated by `cook validate`. Forward-looking only.

Next free id: n/a in lite mode; GitHub issues own numbering.

## NOW

- **Top priority — `#35`:** keep the strengthened publishing checks minimal, then re-run the full gate and independent review.
- **Roadmap reset:** repo is on `main` at release `1.3.2`; Pi support is already merged. The old `pi-shell` / Phase 5a notes are historical and no longer drive the plan.
- **Baseline:** `make test` was green before `#35` began; re-establish the full gate after its last code change.
- **Deferred local ledger:** `#26` remains at capture and off the core path unless scanner breadth becomes urgent.

## NEXT

### 0. Repair linked-worktree verification

- Fix `#33`: a green `cook verify` run must not exit non-zero when `.git` is a linked-worktree gitfile.

### 1. Clean the map

- Close or mark shipped stale GitHub issues whose work is already in `1.3.1`: `#3`, `#4`, `#5`, `#6`, `#8`, `#16`, `#17`, `#19`, `#23`, `#24` if confirmed.
- Recast remaining Bash-era issue wording toward the TS destination. In particular, `#27` and `#18` still describe Bash/jq acceptance even though the next core should be TS.
- Decide whether `#26` should remain deferred or be closed/superseded by the later TS security-scanner pass.

### 2. TS schema + validator core

Goal: make the TS core the authoritative shape/check layer, not a mirror of `cook.sh`.

- Formalize task schema/types in TS.
- Keep state read/write simple and file-backed.
- Port/own validator invariants in TS as the source of truth.
- Fold in **`#27` dual-review mechanics** here:
  - `agents.reviewer2_agent_id`;
  - second-review verdict recording shape;
  - INV-2 checks implementer differs from both reviewers;
  - single-review path remains null-tolerant and unchanged.

### 3. TS transcription spine

Goal: stop relying on Jeff/the model to manually transcribe stage outcomes.

- Recast **`#18` as TS-first**:
  - `cook record <stage> <id> <file>` validates structured specialist returns;
  - writes verdicts/findings/agent ids into `task.json`;
  - rejects malformed returns and separation violations with named errors;
  - `cook verify --task <id>` records `tests.gate` directly into the task.
- This becomes the mechanical bridge between fresh specialist contexts and durable state.

### 4. Host-neutral CLI + cook.sh retirement path

Goal: `cook.sh` becomes test oracle only, then disappears from shipped paths.

- Keep Node/TS CLI behavior host-neutral: no Claude/Pi/Cursor assumptions in core.
- Preserve `cook.sh` only long enough to prove parity where parity still matters.
- Add a no-live-reference guard: shipped skills/hooks/src must not call `cook.sh`.
- Retire `cook.sh` from the payload only after TS CLI, Pi, and Claude Code all pass smoke tests.

### 5. Dispatch/host adapter seam

Goal: one core, thin host adapters.

- Core owns state, validation, record, verify, git/test helpers, and stage contracts.
- Host adapters own only how a fresh specialist context is started and how its structured return is collected.
- Keep existing Pi adapter thin; keep Claude Code wiring thin; do not bake either into the core.

### 6. Cursor support after the seam exists

Goal: Cursor is an adapter, not a fork.

- First useful version may be a manual/rules-based adapter, but full-fidelity Cursor needs fresh-context dispatch and structured return capture.
- Do not build Cursor-specific glue around `cook.sh`.
- Add Cursor only after TS core + record spine exist, so the adapter can stay small.

## DEFERRED / NON-CRITICAL

- `#26` long-tail `review-security` scanners: useful breadth, not blocking the TS migration.
- `#36` conditional npm-publishing hardening: revisit only if the release-check, pinned npm toolchain, or single-maintainer trust boundary changes.
- Remaining old code cleanup notes from the previous backlog: `writeFileAtomic`/`writeTask` dedup, `reporters.js` dead `else`, `plan.js` empty-needle comment, widen `tsconfig` if script typechecks become relevant, and ledger effort translation at recording boundary.
