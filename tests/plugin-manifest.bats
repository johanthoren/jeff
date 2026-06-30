#!/usr/bin/env bats
# tests/plugin-manifest.bats: task 0056: plugin.json marketplace metadata guard.
#
# Covers:
#   AC6: .claude-plugin/plugin.json carries valid marketplace discoverability
#         fields: license, repository, homepage are present, non-empty, license
#         equals "Apache-2.0", repository and homepage are https:// URLs with a
#         host segment.
#
# Strategy:
#   Read-only structural assertions on the real committed manifest.
#   jq parse failure on malformed JSON covers AC5 (well-formed JSON) implicitly.
#   Parallel-safe: no shared mutable state, no fixtures, no mktemp usage.
#
# All tests in this file are RED against the current tree:
#   - .claude-plugin/plugin.json (version 0.11.1) has no license, repository,
#     or homepage fields: the presence assertions fail immediately.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }

MANIFEST="$REPO/.claude-plugin/plugin.json"

# ---------------------------------------------------------------------------
# AC6: Structural: marketplace fields present, non-empty, valid shape
#
# RED now: license, repository, and homepage are absent from plugin.json.
# GREEN after implementer adds the three fields with correct values.
# ---------------------------------------------------------------------------

@test "manifest: license, repository, homepage are present and non-empty" {
  # jq exits non-zero on malformed JSON (implicit well-formed check).
  # Each field must exist and must not be the empty string.
  run jq -e '
    .license   and (.license   | length > 0) and
    .repository and (.repository | length > 0) and
    .homepage   and (.homepage   | length > 0)
  ' "$MANIFEST"
  [ "$status" -eq 0 ]
}

@test "manifest: license equals Apache-2.0" {
  run jq -re '.license' "$MANIFEST"
  [ "$status" -eq 0 ]
  [ "$output" = "Apache-2.0" ]
}

@test "manifest: repository and homepage are https:// URLs with a host segment" {
  # Both must start with https:// and have at least one path segment or host
  # character after the scheme (i.e. not bare "https://").
  run jq -re '.repository' "$MANIFEST"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^https://[^/] ]]

  run jq -re '.homepage' "$MANIFEST"
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^https://[^/] ]]
}
