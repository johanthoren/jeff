# Full mode: the task registry, terminal prune, and the entry-state baseline

Read this when a full-mode project needs task files laid down, when a task reaches a terminal state, or when the entry-state baseline is unknown. `skills/cook/SKILL.md` owns the loop, the gates, and everything both modes share.

## Creating a task (hand-authored; no scaffolder verb)

There is **no** `cook new`/`create`/`add` verb, and none is planned (a deliberate call; see `[[jeff-no-cook-new-verb]]`); tasks are **hand-authored**. When a captured task needs its files laid down, do it by hand:

- **Next id** = one greater than the maximum id in the union of live task ids and `prunedTaskIds` (or `1` when that union is empty). Cross-check BACKLOG's "Next free id" line for stale orientation; the live task directories and terminal provenance are authoritative.
- **Create `.jeff/tasks/00NN-<slug>/`** with three files: `task.json` (canonical shape in `skills/cook/reference/jeff-state-schema.md` §`task.json`), `task.md` (goal / acceptance criteria / non-goals / audit), and `notes.md`.
- **Orient the backlog:** add the live task to `BACKLOG.md` and bump BACKLOG's "Next free id" line. Do not add a live id to `prunedTaskIds`; the task directory is its registry entry.
- **Validate, then preserve:** run `cook validate` before integration and preserve the capture/config/backlog changes durably through the repository/context-selected checkpoint. Do not require a separate trunk commit: completed work lands as one green task commit.

This covers only the **mechanical scaffolding**. The interrogation → acceptance-criteria judgement stays in the Jeff-run `capture` stage; these steps are not a bypass of it.

## BACKLOG.md: orientation and maintenance

`.jeff/BACKLOG.md` is the soft, Jeff-maintained backlog (NOW / NEXT / TODO). Read it fresh at the top of every loop, alongside `cook ls`. It is the shared orientation record; role memory must not substitute for it. It is **soft**: sections are optional (NOW may be empty), `cook validate` never reads or gates on it, and it must not duplicate `task.json`-owned facts (no status, deps, priority values, or titles-as-truth). It is also **forward-looking only**: it holds *pending* work and nothing else. It is **not** a done-task ledger, a pipeline narrative, or release history.

**Before starting a task, check freshness and refresh if stale.** Stale means any of:
- NOW or NEXT names a `done` or nonexistent task id.
- An open task (per `cook ls`) is absent from NOW/NEXT/TODO without being deliberately omitted.
- A referenced id no longer exists (per `cook ls`).

When stale, refresh before picking up the task: correct NOW/NEXT, reconcile any missing open tasks, and drop dangling ids.

Keep BACKLOG current so each fresh context starts with honest orientation rather than stale state.

## Terminal-with-removal (prune)

**When a full-mode task reaches a terminal state (`done` or `abandoned`), prune it from the store.** A done/abandoned task dir must **not** rest in the committed full-mode store; the archive is git history and tags, not a resting `0NNN/` dir. On reaching a terminal state, run this sequence (it is the same for `done` and `abandoned`; the only difference is the commit message and that an abandoned task records `abandonReason`):
1. **Record terminal provenance.** Append the finishing id to `prunedTaskIds` only after its task record earns `done` or `abandoned`, and do so immediately before removing that exact task directory. The array contains unique positive integers and terminal ids only.
2. **Leave successors intact and remove only the terminal dir.** Do not rewrite any successor's `deps`; `git rm -r` only `.jeff/tasks/0NNN-<slug>/`.
3. **Refresh BACKLOG.md.** **Remove** the finished task from BACKLOG entirely (NOW/NEXT/TODO) and write **no** done-record or release narrative: the archive is git tags/history and memory, not BACKLOG. Optionally promote NEXT→NOW for the next task, and file new pending follow-up ids into TODO (or NEXT if imminent).
4. **Validate the terminal bookkeeping, then satisfy the Git contract in `skills/cook/SKILL.md` (§Git).**

## Entry-state baseline

A task must start from a **known-green baseline** (the full suite passing before any of this task's code lands) so the one post-change gate can attribute a red result to *this* task.

- **Establish it with a local full run when the state is unknown**: session start, after any out-of-band change to the tree, or when the prior task did not finish green. Once established, **carry it forward**: each post-change green is the next task's baseline. Across sessions, **in full mode** `cook baseline check [<hash>]` answers whether the current HEAD is already a logged green+clean baseline (from a prior `cook verify`), so a known-good tree need not be re-run. (**In lite mode the run log is empty**, so there is no logged baseline to check.)
- **CI is a confirming cross-check, not the gate.** This project has macOS-bash-3.2-vs-CI divergence, so CI-green does not imply local-green; the local full run is what gates.
- **A red baseline is a hard stop.** Never cook on a red tree: the break is pre-existing, not this task's; resolve it (or escalate) before starting.
- **In full mode**, the durable **hash-keyed run log** (`.jeff/test-runs.jsonl`, git-excluded) and the `cook verify` / `cook baseline check` helpers make carry-forward work **across** sessions: `cook verify` logs each gate verdict keyed by HEAD + tree-dirty flag, and `cook baseline check` reads that log to confirm a green+clean baseline at the current HEAD. **In lite mode nothing is logged** (`.jeff/` is the team's tree, not jeff's): a lite orchestrator binds each gate record to `git rev-parse HEAD` **directly**, never `tail`-ing `test-runs.jsonl` (which is empty).
