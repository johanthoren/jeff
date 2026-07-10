#!/usr/bin/env bats

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }

@test "npm pack dry-run exposes a publishable Pi package payload" {
  run bash -c 'jq -e '\''
    .private != true and
    ((.keywords // []) | index("pi-package")) and
    (.peerDependencies["@earendil-works/pi-coding-agent"] == "*") and
    (.pi.extensions == ["./src/pi/extension.js"]) and
    (.pi.skills == ["./skills"])
  '\'' "$1" >/dev/null || { echo "package.json is missing Pi package metadata or peerDependency @earendil-works/pi-coding-agent:*"; exit 1; }' _ "$REPO/package.json"
  [ "$status" -eq 0 ] || { printf '%s\n' "$output"; false; }

  run bash -c 'cd "$1" && npm pack --dry-run --json' _ "$REPO"
  [ "$status" -eq 0 ]

  jq -e '.[0].files | map(.path) as $files | (["package.json","src/pi/extension.js","skills/cook/SKILL.md","agents/cook-plan.md",".claude-plugin/plugin.json"] | all(. as $p | $files | index($p)))' <<<"$output" >/dev/null
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
}
