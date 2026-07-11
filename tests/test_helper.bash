# tests/test_helper.bash: shared bats helper: hermetic fixture git.
#
# Why: fixture `git commit`/`git tag` calls otherwise inherit the operator's
# *global* git config. With `commit.gpgsign=true` set globally, every fixture
# commit shells out to gpg+pinentry; under `bats --jobs N` up to N concurrent
# commits contend on the single GPG agent and nondeterministically fail with
# `gpg: signing failed: Cannot allocate memory` (git commit exits 128). The
# suite is otherwise parallel-safe (per-test `mktemp -d`).
#
# Fix: make each fixture repo hermetic. Point git at a throwaway global config
# (with signing OFF and a default identity) and disable the system config, so
# fixtures never inherit host git state and never sign. No test asserts on
# signatures, so disabling signing is behavior-preserving.
#
# Usage: each `tests/*.bats` file sources this at load time and calls
#   `cook_hermetic_git`. Sourcing/calling at file scope means the env vars are
#   exported in the file's bats process before any test (or inline `git`) runs,
#   covering every git-init site: including files with no `setup()`.
#
# This NEVER touches the operator's real/global git config. It only sets
# GIT_CONFIG_GLOBAL / GIT_CONFIG_SYSTEM env vars scoped to the bats process,
# pointing at a temp file under the bats-managed (auto-cleaned) BATS_FILE_TMPDIR.

cook_hermetic_git() {
  local cfg="${BATS_FILE_TMPDIR:?BATS_FILE_TMPDIR not set}/hermetic.gitconfig"

  cat >"$cfg" <<'EOF'
[commit]
	gpgsign = false
[tag]
	gpgsign = false
[user]
	name = Jeff Test
	email = test@jeff.example
[init]
	defaultBranch = master
EOF

  export GIT_CONFIG_GLOBAL="$cfg"
  export GIT_CONFIG_SYSTEM=/dev/null
}

# Create a committed repository and a real detached linked worktree beneath one
# isolated temp directory. Exports LINKED_TMP, LINKED_MAIN, and LINKED_ROOT.
make_linked_worktree() {
  LINKED_TMP="$(mktemp -d)"
  LINKED_MAIN="$LINKED_TMP/main"
  LINKED_ROOT="$LINKED_TMP/worktree"
  mkdir -p "$LINKED_MAIN"
  git -C "$LINKED_MAIN" init -q
  printf 'seed\n' > "$LINKED_MAIN/seed.txt"
  git -C "$LINKED_MAIN" add seed.txt
  git -C "$LINKED_MAIN" commit -q -m seed
  git -C "$LINKED_MAIN" worktree add --detach -q "$LINKED_ROOT" HEAD
}
