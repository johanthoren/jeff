#!/usr/bin/env bats

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }

@test "npm pack dry-run exposes a publishable Pi package payload" {
  run jq -e '
    .private != true and
    ((.keywords // []) | index("pi-package")) and
    (.pi.extensions == ["./src/pi/extension.js"]) and
    (.pi.skills == ["./skills"])
  ' "$REPO/package.json"
  [ "$status" -eq 0 ]

  run bash -c 'cd "$1" && npm pack --dry-run --json' _ "$REPO"
  [ "$status" -eq 0 ]

  jq -e '.[0].files | map(.path) as $files | (["package.json","src/pi/extension.js","skills/cook/SKILL.md","agents/cook-plan.md",".claude-plugin/plugin.json"] | all(. as $p | $files | index($p)))' <<<"$output" >/dev/null
}

@test "README Pi install prefers npm and labels git as dev edge" {
  install_section="$(awk '
    /^## Install$/ { in_install=1; next }
    in_install && /^## / { exit }
    in_install { print }
  ' "$REPO/README.md")"

  first_pi_install="$(printf '%s\n' "$install_section" | grep -m1 '^[[:space:]]*pi install ')"
  [[ "$first_pi_install" != *"git:"* ]]

  if printf '%s\n' "$install_section" | grep -q '^[[:space:]]*pi install git:'; then
    lower="$(printf '%s\n' "$install_section" | tr '[:upper:]' '[:lower:]')"
    [[ "$lower" == *"dev"* || "$lower" == *"edge"* ]]
  fi
}
