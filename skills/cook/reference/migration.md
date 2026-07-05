# Migrating a bakehouse project to jeff

jeff's on-disk state **is** bakehouse v1-lean: the same `tasks/<id>/task.json`
shape, the same `test-runs.jsonl`, the same invariants. For a **tasks-model**
store (see the pre-check below) migration is therefore a **directory rename plus
a config normalization**, not a data transform: the task records carry over
byte-for-byte.

What jeff's tooling actually reads (everything else in the config is ignored):

- **state dir** is hardcoded to `.jeff/` (was `.bakehouse/`).
- `config.json` `active == true` (the PreToolUse gate engages only on this).
- `config.json` `mode == "lite"` (else full).
- `config.json` `testCommand` (full mode only, for `cook verify`).

jeff does **not** read `system`, `variant`, `createdBy`, or `index.json`. Tasks
are derived from the dirs under `tasks/`, never from a registry file.

## Before you start: confirm it is a tasks-model store

jeff understands **one** store model: tasks as `tasks/<id>/task.json`. Some
bakehouse generations (seen in `*-www` frontends and the `pi-*` projects) use a
different, event-sourced model with `batches/`, `orders/`, and `runs/` dirs
instead. jeff cannot read that model, and the failure is **silent**: `cook
validate` finds no `tasks/*/task.json` and cheerfully reports "nothing to
validate" while ignoring all the real state. A rename would produce a `.jeff/`
that looks migrated but carries nothing jeff can act on.

So before anything, look at the store:

```bash
ls .bakehouse/            # tasks-model: has tasks/ . batches-model: has batches/ orders/ runs/
find .bakehouse/tasks -mindepth 2 -maxdepth 2 -name task.json | wc -l   # >0 => tasks-model
```

If you see `batches/`, `orders/`, or `runs/`, it is the **batches model**: do
NOT rename it. It is a different, event-sourced architecture (its records are
orders moving through `order -> measure -> recipe -> prep -> cook -> taste ->
finish -> served`), and a rename produces a `.jeff/` that jeff reads as empty.
Use the **hand re-capture** in "Batches-model stores" near the end instead. The
config `createdBy`/`system` field does **not** tell you the model: the same
`createdBy:"bakehouse-core"` appears on both tasks-model and batches-model
stores. Trust the directory layout.

## Recognising the source generation

bakehouse went through several config shapes. All normalize to the **same** jeff
config. Identify which you have, then apply the one normalization below.

| Generation | `config.json` shape | Extra cleanup |
| --- | --- | --- |
| **v1-lean** | `{schemaVersion, system:"bakehouse", variant:"v1-lean", active, [testCommand]}` | remove `index.json` if present |
| **bakehouse-core (with active)** | `{schemaVersion, createdBy:"bakehouse-core", active}` | remove `index.json`; add `testCommand` if you want `cook verify` |
| **bakehouse-core (no active)** | `{schemaVersion, createdBy:"..."}` (no `active`) | as above, and `active:true` MUST be added or jeff treats the project as inactive |

Two independent axes also vary and matter more than the config shape:

- **`index.json` present?** Older stores carry a `tasks` registry file. jeff
  ignores it; it is dead weight and usually stale (it often lists only an
  early task that was later pruned). Remove it.
- **terminal tasks resting?** If any `task.json` has `status` `done` or
  `abandoned`, see **Reconciling resting terminal tasks** below: full-mode jeff
  refuses them via the `[prune]` invariant. The bakehouse-core generations did
  not prune on completion, so their stores accumulate done/abandoned dirs.

## Full-mode migration (the `.bakehouse/` dir is git-tracked)

Run from the project root. Substitute the path to jeff's CLI for `<cook>`
(the skill's base directory `+ /scripts/cook.sh`).

```bash
# 0. Start from a clean tree. Commit or stash unrelated work first.
git status --short

# 0b. Remove any stale git pre-commit hook. Some older bakehouse setups installed
#     .git/hooks/pre-commit ("bakehouse-validate-hook") that exec's a now-missing
#     bin/bake and BLOCKS every commit. jeff uses NO git hook (it gates via the
#     PreToolUse Claude hook + CI), so delete it. Local-only, never tracked.
grep -ql 'bakehouse-validate-hook\|bin/bake' .git/hooks/pre-commit 2>/dev/null && rm -f .git/hooks/pre-commit

# 1. Rename the store. `git mv` does a filesystem rename, so untracked files
#    inside (e.g. test-runs.jsonl) come along too; tracked files stage as renames.
git mv .bakehouse .jeff

# 2. Drop the dead registry file if present (jeff derives tasks from dirs).
#    -f is needed because it staged as a rename in step 1.
[ -f .jeff/index.json ] && git rm -f .jeff/index.json

# 3. Normalize the config to jeff's shape: force system+active, drop the dead
#    variant/createdBy, preserve schemaVersion / testCommand / mode.
tmp=$(mktemp)
jq '{schemaVersion: (.schemaVersion // 1), system: "jeff", active: true}
    + (if .mode        then {mode}        else {} end)
    + (if .testCommand then {testCommand} else {} end)' .jeff/config.json > "$tmp"
mv "$tmp" .jeff/config.json

# 4. STAGE the config edit and the removal. This step is easy to forget:
#    `git mv` staged config.json with its OLD content, so the step-3 edit is
#    unstaged and would be left out of the commit otherwise.
git add -A .jeff

# 5. Re-point any .bakehouse line in the LOCAL git exclude to .jeff. The run log
#    is git-excluded; once renamed it is no longer matched by the stale line and
#    would show up untracked.
perl -i -pe 's{^\.bakehouse/}{.jeff/}' .git/info/exclude

# 6. Validate with jeff BEFORE committing.
COOK_ROOT="$PWD" <cook> validate     # expect: validation OK (N task(s))
COOK_ROOT="$PWD" <cook> doctor       # expect: mode: full / jeff: ACTIVE

# 7. Commit. (Jeff's own PreToolUse gate will re-validate this commit.)
git commit -m "Migrate bakehouse state to jeff"
```

## Lite-mode migration (the `.bakehouse/` dir is git-excluded)

```bash
mv .bakehouse .jeff                                   # plain mv: nothing is tracked
perl -i -pe 's{^\.bakehouse/}{.jeff/}' .git/info/exclude
<cook> lite                                           # re-stamps mode:lite + active:true,
                                                       # and adds ".jeff/" to the exclude
# optional cosmetic cleanup of the config:
tmp=$(mktemp); jq '.system="jeff" | del(.variant, .createdBy)' .jeff/config.json > "$tmp" && mv "$tmp" .jeff/config.json
<cook> validate && <cook> doctor
```

Remove the now-dead `.bakehouse/...` line from `.git/info/exclude` by hand if
`cook lite` left it (it only adds `.jeff/`, it does not remove the old line).
Also remove any stale git pre-commit hook (full-mode step 0b): it blocks code
commits in lite repos just the same.

## Reconciling resting terminal tasks (the `[prune]` gap)

jeff's model: a task reaching `done`/`abandoned` is **pruned** from the store
(git history is the archive). Full-mode `cook validate` enforces this with the
`[prune]` check, so it will **fail** on any done/abandoned dir left resting. The
bakehouse-core generations did not prune, so their stores hold these dirs.

Reconcile during migration by pruning them. Do it as a verifiable loop, because
removing a task whose id is still listed in a live task's `deps` trips the
separate `[inv5]` "dep does not exist" check:

```bash
# Remove every done/abandoned task dir. -f is needed: `git mv` staged these dirs
# as renames, so a plain `git rm` refuses them.
for d in .jeff/tasks/[0-9]*/; do
  s=$(jq -r '.status' "$d/task.json" 2>/dev/null)
  case "$s" in done|abandoned) git rm -rqf "$d" ;; esac
done

# Validate; if it reports "dep <id> does not exist [inv5]", a surviving task
# still depends on a pruned one. Strip those ids from the survivors' deps:
COOK_ROOT="$PWD" <cook> validate
# for each reported <id>, in each remaining task.json:
#   jq '.deps -= [<id>]' task.json   (then re-stage and re-validate)
```

Repeat validate until clean. For a large store this can remove many dirs in one
migration commit; that is expected and matches how jeff would have pruned them
incrementally. The records remain recoverable from git history.

Lite mode drops `[prune]` (it is registry-only), so a lite project never hits
this. Do **not** switch a project from full to lite just to dodge `[prune]`,
though: lite git-excludes the store, discarding the committed task registry that
a tracked project relies on.

## Batches-model stores (hand re-capture, not rename)

A batches-model store (`batches/`, `orders/`, `runs/`) belongs to a different,
event-sourced runtime (its records are orders moving through `order -> measure ->
recipe -> prep -> cook -> taste -> finish -> served`), not the tasks-model jeff
understands. No mechanical converter exists and the data models do not map. If
you want such a project on jeff, **re-capture by hand**: carry the durable intent
of each open order into a fresh jeff task and let jeff re-plan. The execution
machinery (phase artifacts, proof ledgers, role runs, events) stays in git
history, not carried. This is a **replace**, not a rename:

1. Find the live work. Each order is `orders/<NNNN-slug>/` with a `state.json`
   (`id`, `slug`, `title`, `priority`, `dependsOn`, `flowState`, `disposition`)
   and `01-order.md` (the captured intent: request/outcome, scope, acceptance
   criteria, constraints, definition of done). Re-capture only **open** orders
   (`flowState: active`, `disposition: open`); skip done/abandoned ones.

2. Scaffold a fresh jeff store (leave `.bakehouse/` in place for now so step 3
   can read it):

   ```bash
   mkdir -p .jeff/tasks .jeff/memory
   : > .jeff/tasks/.gitkeep ; : > .jeff/memory/.gitkeep
   jq -n '{schemaVersion:1, system:"jeff", active:true, testCommand:"<your gate cmd>"}' > .jeff/config.json
   ```

3. For each open order, author two files. `task.json`: a jeff `pending` task at
   stage `capture` (copy a known-valid task.json and set `id`/`slug`/`title`/
   `priority`, with `deps` = the `dependsOn` order ids). `task.md`: the order's
   goal, acceptance criteria, scope/non-goals, constraints, and definition of
   done, distilled from `01-order.md` with a one-line provenance note. Preserve
   every acceptance criterion; keep code/paths/commands in backticks. Do not
   carry the order's recipe/prep plan: jeff re-plans from this intent.

4. Remove the old store and validate, then commit:

   ```bash
   git rm -rq .bakehouse          # safe now: intent is carried, history keeps the rest
   git add -A .jeff
   COOK_ROOT="$PWD" <cook> validate   # expect: validation OK (N task(s))
   git commit -m "Migrate bakehouse-core orders to jeff (re-capture)"
   ```

The engine's `memory/project.md` is boilerplate, not project knowledge; do not
carry it. Drop the batch grouping (jeff has no batches); the only real
cross-order constraint is each order's `dependsOn`, preserved as `deps`.

## After migration

- **bakehouse plugin handoff** is automatic: once `.bakehouse/` is gone, the
  bakehouse PreToolUse hook finds no project and stands down, while jeff's hook
  engages on the new `.jeff/`. Disabling the bakehouse plugin is still cleaner
  while both are installed.
- **In-flight branches** (`task/<id>-<slug>` for complex tasks) are unaffected:
  branch names do not reference the state dir.
- `cook validate` is safe to run anywhere; it skips cleanly when the cwd is not
  an active jeff project.

## Compatibility notes (verified against real stores)

- task.json from the v1-lean and bakehouse-core generations is already
  jeff-shaped: `brains` are informational (jeff no longer validates them),
  `convergence` and `tests.gate` are absent-tolerant, and the
  status/stage/priority enums match. No per-task edits are needed.
- `test-runs.jsonl` is keyed on the working-tree hash: jeff writes
  `{treeHash, dirty, result, suite, at, commit}` (the `commit` is informational
  only). `cook verify` / `cook baseline check` match on `treeHash`. Any
  pre-existing commit-keyed lines from a bakehouse store lack a `treeHash`, so
  they are harmlessly ignored: they never false-match a baseline, and no
  migration is needed.
- Numeric ids carry over as-is (full mode wants integer ids). String ids only
  appear in lite ledgers adopted via `cook on`.
