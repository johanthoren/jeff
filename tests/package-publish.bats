#!/usr/bin/env bats

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
WORKFLOW="$REPO/.github/workflows/publish.yml"

assert_workflow_order() {
  local previous=0 marker line
  for marker in "$@"; do
    line="$(grep -nF "$marker" "$WORKFLOW" | head -1 | cut -d: -f1)"
    [ -n "$line" ] && [ "$line" -gt "$previous" ] || return 1
    previous="$line"
  done
}

extract_workflow_step_script() {
  awk -v heading="      - name: $1" '
    $0 == heading { step = 1; next }
    step && /^      - name:/ { exit }
    step && /^        run: \|$/ { run = 1; next }
    run { sub(/^          /, ""); print }
  ' "$WORKFLOW"
}

validate_release_tag() {
  local script fixture
  script="$(extract_workflow_step_script 'Validate release tag')"
  [ -n "$script" ] || return 1
  fixture="$(mktemp -d "$BATS_TEST_TMPDIR/release-tag.XXXXXX")"
  jq -n --arg version "$2" '{ version: $version }' > "$fixture/package.json"
  (cd "$fixture" && GITHUB_REF_NAME="$1" bash -euo pipefail -c "$script")
}

select_dist_tag() {
  local script env_file="$BATS_TEST_TMPDIR/github-env"
  script="$(extract_workflow_step_script 'Select npm dist-tag')"
  [ -n "$script" ] || return 1
  GITHUB_REF_NAME="$1" GITHUB_ENV="$env_file" bash -euo pipefail -c "$script"
  sed -n 's/^NPM_DIST_TAG=//p' "$env_file"
}

@test "publish workflow admits only unprefixed stable and prerelease SemVer tags" {
  [ -f "$WORKFLOW" ]
  grep -F -- "- '[0-9]+.[0-9]+.[0-9]+'" "$WORKFLOW"
  grep -F -- "- '[0-9]+.[0-9]+.[0-9]+-*'" "$WORKFLOW"

  local tag
  for tag in 0.0.0 1.2.3 1.2.3-rc.1 10.20.30-alpha-7; do
    run validate_release_tag "$tag" "$tag"
    [ "$status" -eq 0 ]
  done
  for tag in v1.2.3 1.2 1.2.3+build 01.2.3 1.02.3 1.2.03 1.2.3-01 latest; do
    run validate_release_tag "$tag" "$tag"
    [ "$status" -ne 0 ]
  done
}

@test "publish workflow rejects package version mismatch" {
  [ -f "$WORKFLOW" ]
  run validate_release_tag 1.2.3 1.2.4
  [ "$status" -ne 0 ]
  run validate_release_tag 1.2.3-rc.1 1.2.3-rc.2
  [ "$status" -ne 0 ]
}

@test "publish workflow runs release guard, install, and all quality gates before publication" {
  [ -f "$WORKFLOW" ]
  assert_workflow_order \
    'name: Validate release tag' \
    'npm ci --ignore-scripts' \
    'make typecheck' \
    'make validate' \
    'make test' \
    'make release-check' \
    'npm publish'
}

@test "publish workflow uses only least-privilege OIDC permissions" {
  [ -f "$WORKFLOW" ]
  run bash -c 'awk '\''
    /^permissions:$/ { permissions = 1; next }
    permissions && /^[^ ]/ { exit }
    permissions && NF { sub(/^[[:space:]]*/, ""); print }
  '\'' "$1" | sort' _ "$WORKFLOW"
  [ "$status" -eq 0 ]
  [ "$output" = $'contents: read\nid-token: write' ]
  ! grep -Eqi 'NPM_TOKEN|NODE_AUTH_TOKEN|secrets\.|npm[_-]?token|auth[_-]?token' "$WORKFLOW"
}

@test "stable versions publish with npm dist-tag latest" {
  [ -f "$WORKFLOW" ]
  run select_dist_tag 1.2.3
  [ "$status" -eq 0 ]
  [ "$output" = latest ]
  grep -F 'npm publish --provenance --tag "$NPM_DIST_TAG"' "$WORKFLOW"
}

@test "prerelease versions publish only with npm dist-tag next" {
  [ -f "$WORKFLOW" ]
  run select_dist_tag 1.2.3-rc.1
  [ "$status" -eq 0 ]
  [ "$output" = next ]
  [ "$output" != latest ]
  grep -F 'npm publish --provenance --tag "$NPM_DIST_TAG"' "$WORKFLOW"
}

@test "publish workflow pins every GitHub Action to a full commit SHA" {
  [ -f "$WORKFLOW" ]
  run awk '/^[[:space:]]*uses:/ { print $2 }' "$WORKFLOW"
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  while IFS= read -r action; do
    [[ "$action" =~ ^[^@]+@[0-9a-f]{40}$ ]]
  done <<<"$output"
}

@test "root package manifest provides canonical npm repository links" {
  jq -e '
    .repository == {"type":"git","url":"git+https://github.com/johanthoren/jeff.git"} and
    .homepage == "https://github.com/johanthoren/jeff#readme" and
    .bugs.url == "https://github.com/johanthoren/jeff/issues"
  ' "$REPO/package.json"
}

@test "package Node floor and hosted Node 24 runtimes stay aligned" {
  local minimum='>=22.19.0' node_version='24' actual workflow
  local failed=0

  actual="$(jq -r '.engines.node // "<missing>"' "$REPO/package.json")"
  if [ "$actual" != "$minimum" ]; then
    printf 'package.json engines.node: expected %s, found %s\n' "$minimum" "$actual"
    failed=1
  fi

  actual="$(jq -r '.packages[""].engines.node // "<missing>"' "$REPO/package-lock.json")"
  if [ "$actual" != "$minimum" ]; then
    printf 'package-lock.json root engines.node: expected %s, found %s\n' "$minimum" "$actual"
    failed=1
  fi

  for workflow in "$REPO/.github/workflows/ci.yml" "$REPO/.github/workflows/publish.yml"; do
    if ! grep -Fq "node-version: '$node_version'" "$workflow"; then
      actual="$(sed -n 's/^[[:space:]]*node-version:[[:space:]]*//p' "$workflow")"
      printf '%s setup-node version: expected %s, found %s\n' \
        "${workflow#"$REPO/"}" "$node_version" "${actual:-<missing>}"
      failed=1
    else
      printf '%s setup-node version: already correct (%s)\n' \
        "${workflow#"$REPO/"}" "$node_version"
    fi
  done

  actual="$(awk '/^## Install$/ { publish = 1 } /^## Use$/ { publish = 0 } publish' "$REPO/README.md")"
  if [[ "$actual" != *'Node.js `>=22.19.0`'* ]]; then
    printf 'README install/setup guidance must state Node.js `%s`\n' "$minimum"
    failed=1
  fi

  [ "$failed" -eq 0 ]
}

@test "npm pack dry-run exposes a publishable Pi package payload" {
  local npm_cache="$BATS_TEST_TMPDIR/npm-cache"
  mkdir -p "$npm_cache"

  run bash -c 'jq -e '\''
    .name == "@johanthoren/jeff" and
    .private != true and
    .publishConfig.access == "public" and
    ((.keywords // []) | index("pi-package")) and
    ((.dependencies["@earendil-works/pi-coding-agent"] // "") | length > 0) and
    ((.peerDependencies // {}) | has("@earendil-works/pi-coding-agent") | not) and
    ((.peerDependenciesMeta // {}) | has("@earendil-works/pi-coding-agent") | not) and
    (.pi.extensions == ["./src/pi/extension.js"]) and
    (.pi.skills == ["./skills"]) and
    ((.dependencies // {}) | length == 1)
  '\'' "$1/package.json" >/dev/null &&
  jq -e '\''
    .name == "@johanthoren/jeff" and
    .packages[""].name == "@johanthoren/jeff" and
    (((.packages[""].dependencies // {})["@earendil-works/pi-coding-agent"] // "") | length > 0) and
    ((.packages[""].peerDependencies // {}) | has("@earendil-works/pi-coding-agent") | not) and
    ((.packages[""].peerDependenciesMeta // {}) | has("@earendil-works/pi-coding-agent") | not)
  '\'' "$1/package-lock.json" >/dev/null || { echo "package metadata must install the Pi dispatch SDK when the host does not inject pi.pi"; exit 1; }' _ "$REPO"
  [ "$status" -eq 0 ] || { printf '%s\n' "$output"; false; }

  run env npm_config_cache="$npm_cache" bash -c 'cd "$1" && npm pack --dry-run --json' _ "$REPO"
  [ "$status" -eq 0 ]

  jq -e '.[0].files | map(.path) as $files | (["package.json","src/pi/extension.js","skills/cook/SKILL.md","agents/cook-plan.md",".claude-plugin/plugin.json",".codex-plugin/plugin.json",".agents/plugins/marketplace.json"] | all(. as $p | $files | index($p)))' <<<"$output" >/dev/null
}

@test "Pi-facing docs prefer npm and label git as dev edge" {
  run bash -c '
    cd "$1"
    awk '\''
      {
        line = tolower($0)
        prev = tolower(lines[FILENAME, FNR - 1])
        context = tolower(lines[FILENAME, FNR - 4] "\n" lines[FILENAME, FNR - 3] "\n" lines[FILENAME, FNR - 2] "\n" prev "\n" $0)
        is_npm = line ~ /pi install[[:space:]]+npm:/ || (prev ~ /pi installs via/ && line ~ /npm:/)
        is_git = line ~ /pi install[[:space:]]+git:/ || (prev ~ /pi installs via/ && line ~ /git:/)

        if ((is_npm || is_git) && !(FILENAME in first)) first[FILENAME] = is_git ? "git" : "npm"
        if (is_git && context !~ /dev|edge/) {
          print FILENAME ":" FNR ": git Pi install is not labeled dev/edge"
          bad = 1
        }
        lines[FILENAME, FNR] = $0
      }
      END {
        for (file in first) {
          if (first[file] == "git") {
            print file ": first Pi install source is git"
            bad = 1
          }
        }
        exit bad
      }
    '\'' $(git ls-files "*.md")
  ' _ "$REPO"
  [ "$status" -eq 0 ] || { printf '%s\n' "$output"; false; }

  run bash -c '
    cd "$1"
    ! grep -R "npm:jeff" $(git ls-files "*.md")
    grep -R "npm:@johanthoren/jeff" README.md docs/specs/pi-shell-initiative.md
    grep -F "npm:@johanthoren/jeff@X.Y.Z" README.md
  ' _ "$REPO"
  [ "$status" -eq 0 ] || { printf '%s\n' "$output"; false; }
}

@test "README publishes verified install and update commands for every first-class host" {
  local command
  local commands=(
    'pi install npm:@johanthoren/jeff'
    'pi update npm:@johanthoren/jeff'
    'omp plugin install @johanthoren/jeff'
    'claude plugin marketplace add johanthoren/jeff'
    'claude plugin install jeff@jeff'
    'claude plugin update jeff@jeff'
    'codex plugin marketplace add johanthoren/jeff'
    'codex plugin add jeff@jeff'
    'codex plugin marketplace upgrade jeff'
  )

  for command in "${commands[@]}"; do
    grep -Fxq -- "$command" "$REPO/README.md" || {
      printf 'README missing verified command: %s\n' "$command"
      return 1
    }
  done
}
