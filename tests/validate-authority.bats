#!/usr/bin/env bats
# Live validator ownership and the retained Bash transition-oracle seam.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
COOK="$REPO/skills/cook/scripts/cook.sh"
ORACLE="$REPO/tests/parity-cook.sh"

setup() {
  TMP="$(mktemp -d)"
  BK="$TMP/.jeff"
  mkdir -p "$BK/tasks/0001-invalid-date"
  jq -n '{schemaVersion:1, mode:"lite", active:true}' > "$BK/config.json"
  jq -n '{
    schemaVersion: 1,
    id: "#27",
    externalRef: "#27",
    slug: "invalid-date",
    title: "Invalid date",
    status: "in_progress",
    stage: "review",
    priority: "p2",
    deps: [],
    complexity: "complex",
    createdAt: "2026-02-31T00:00:00Z",
    updatedAt: "2026-02-28T00:00:00Z",
    agents: {
      implementer_agent_id: "implementer",
      reviewer_agent_id: null,
      reviewer2_agent_id: null,
      audit_agent_id: null
    },
    tests: {authored_by_agent_id:"plan", green:false, evidence:[]},
    review: {verdict:null, reviewer_agent_id:null, evidence:[]},
    review2: null,
    audit: {required:true, verdict:"na", audit_agent_id:null, evidence:[]},
    commits: [],
    kickbacks: [],
    blockedReason: null,
    abandonReason: null
  }' > "$BK/tasks/0001-invalid-date/task.json"
}

teardown() {
  rm -rf "$TMP"
}

@test "authority: shipped cook validate uses the Node verdict while Bash remains callable as an oracle" {
  run env COOK_ROOT="$TMP" "$COOK" validate
  [ "$status" -eq 1 ]
  [[ "$output" == *"[schema] createdAt"* ]]

  run env COOK_ROOT="$TMP" "$ORACLE" _validate-oracle
  [ "$status" -eq 0 ]
  [[ "$output" == *"validation OK"* ]]
}

@test "authority: make validate exposes the Node verdict" {
  run env COOK_ROOT="$TMP" make -s -C "$REPO" validate
  [ "$status" -eq 2 ]
  [[ "$output" == *"[schema] createdAt"* ]]
}
