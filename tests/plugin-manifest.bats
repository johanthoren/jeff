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
CLAUDE_MARKETPLACE="$REPO/.claude-plugin/marketplace.json"
CODEX_MANIFEST="$REPO/.codex-plugin/plugin.json"
CODEX_MARKETPLACE="$REPO/.agents/plugins/marketplace.json"
PACKAGE_MANIFEST="$REPO/package.json"

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

@test "Codex manifest exposes the validated native plugin contract" {
  jq -e '
    .name == "jeff" and
    (.version | test("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-((0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(\\.(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$")) and
    (.description | type == "string" and length > 0) and
    (.author.name | type == "string" and length > 0) and
    .skills == "./skills/" and
    (.interface | type == "object") and
    ([.interface.displayName, .interface.shortDescription, .interface.longDescription,
      .interface.developerName, .interface.category] | all(type == "string" and length > 0)) and
    (.interface.capabilities | type == "array") and
    (.interface.defaultPrompt | type == "array" and length > 0 and length <= 3)
  ' "$CODEX_MANIFEST"
}

@test "Codex marketplace installs the repository root without duplicating the plugin payload" {
  jq -e --slurpfile plugin "$CODEX_MANIFEST" '
    .name == "jeff" and
    (.interface.displayName | type == "string" and length > 0) and
    (.plugins | length == 1) and
    .plugins[0].name == $plugin[0].name and
    .plugins[0].source == {"source":"local","path":"./"} and
    .plugins[0].policy == {"installation":"AVAILABLE","authentication":"ON_INSTALL"} and
    (.plugins[0].category | type == "string" and length > 0)
  ' "$CODEX_MARKETPLACE"
}

@test "all package manifests publish one lockstep version" {
  local version
  version="$(jq -r '.version' "$MANIFEST")"
  [ "$(jq -r '.version' "$CODEX_MANIFEST")" = "$version" ]
  [ "$(jq -r '.version' "$REPO/package.json")" = "$version" ]
  [ "$(jq -r '.version' "$REPO/package-lock.json")" = "$version" ]
  [ "$(jq -r '.packages[""].version' "$REPO/package-lock.json")" = "$version" ]
}

@test "marketplace copy presents Jeff as a model-native quality control plane" {
  jq -e -s '
    def require($condition; $message):
      if $condition then true else error($message) end;

    [
      .[0].description,
      .[1].plugins[0].description,
      .[2].interface.longDescription
    ]
    | map(ascii_downcase) as $copy
    | require(
        ($copy | all(contains("model-native quality control plane")));
        "marketplace descriptions must name the model-native quality control plane"
      ) and
      require(
        (($copy | join(" ")) |
          contains("checked-js node validation") and
          contains("authoritative") and
          contains("bash") and
          contains("transition oracle") and
          contains("fresh specialist contexts") and
          contains("enforced separation") and
          contains("durable evidence") and
          contains("deterministic gates"));
        "marketplace descriptions must explain the current validation and quality-control architecture"
      )
  ' "$PACKAGE_MANIFEST" "$CLAUDE_MARKETPLACE" "$CODEX_MANIFEST"
}
