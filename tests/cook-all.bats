#!/usr/bin/env bats

# Item 7 drain primitives plus the model-owned cook-all contract for full and lite.
# The SKILL section is an observable instruction payload. Marker checks follow
# the established Bats prose-contract convention: commands, state names, and
# invariant phrases are checked inside one scoped section, not by line number.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }
COOK="$REPO/src/cli/cook.js"
SKILL="$REPO/skills/cook/SKILL.md"
LITE_MODE="$REPO/skills/cook/reference/lite-mode.md"

setup() {
  TMP="$(mktemp -d)"
  mkdir -p "$TMP/.jeff/tasks"
  jq -n '{schemaVersion:1, system:"jeff", active:true, prunedTaskIds:[]}' > "$TMP/.jeff/config.json"
}

teardown() {
  rm -rf "$TMP"
}

cook() {
  COOK_ROOT="$TMP" "$COOK" "$@"
}

write_task() {
  local id="$1" slug="$2" title="$3" priority="${4:-p2}" status="${5:-pending}" deps="${6:-[]}"
  local dir="$TMP/.jeff/tasks/$(printf '%04d' "$id")-$slug"
  mkdir -p "$dir"
  jq -n \
    --argjson id "$id" \
    --arg slug "$slug" \
    --arg title "$title" \
    --arg priority "$priority" \
    --arg status "$status" \
    --argjson deps "$deps" \
    '{
      schemaVersion: 1,
      id: $id,
      slug: $slug,
      title: $title,
      status: $status,
      stage: (if $status == "done" or $status == "abandoned" then "done" else "capture" end),
      priority: $priority,
      deps: $deps,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      complexity: "simple",
      agents: {
        implementer_agent_id: null,
        reviewer_agent_id: null,
        reviewer2_agent_id: null,
        audit_agent_id: null
      },
      tests: {authored_by_agent_id:null, green:false, evidence:[]},
      review: {verdict:null, reviewer_agent_id:null, evidence:[]},
      review2: null,
      audit: {required:false, verdict:"na", audit_agent_id:null, evidence:[]},
      commits: [],
      kickbacks: [],
      blockedReason: null,
      abandonReason: null
    }' > "$dir/task.json"
  printf '%s\n' "$dir"
}

write_lite_task() {
  local id="$1" slug="$2" title="$3" priority="${4:-p2}" status="${5:-pending}" deps="${6:-[]}" extref="${7:-$1}"
  local dir="$TMP/.jeff/tasks/lite-$slug"
  mkdir -p "$dir"
  jq -n \
    --arg id "$id" \
    --arg slug "$slug" \
    --arg title "$title" \
    --arg priority "$priority" \
    --arg status "$status" \
    --argjson deps "$deps" \
    --arg extref "$extref" \
    '{
      schemaVersion: 1,
      id: $id,
      externalRef: $extref,
      slug: $slug,
      title: $title,
      status: $status,
      stage: (if $status == "done" or $status == "abandoned" then "done" else "capture" end),
      priority: $priority,
      deps: $deps,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      complexity: "simple",
      agents: {
        implementer_agent_id: null,
        reviewer_agent_id: null,
        reviewer2_agent_id: null,
        audit_agent_id: null
      },
      tests: {authored_by_agent_id:null, green:false, evidence:[]},
      review: {verdict:null, reviewer_agent_id:null, evidence:[]},
      review2: null,
      audit: {required:false, verdict:"na", audit_agent_id:null, evidence:[]},
      commits: [],
      kickbacks: [],
      blockedReason: null,
      abandonReason: null
    }' > "$dir/task.json"
  printf '%s\n' "$dir"
}

write_operation_task() {
  local id="$1" slug="$2" title="$3"
  local dir="$TMP/.jeff/tasks/$(printf '%04d' "$id")-$slug"
  mkdir -p "$dir"
  jq -n --argjson id "$id" --arg slug "$slug" --arg title "$title" '{
    schemaVersion: 1,
    operationStateVersion: 1,
    id: $id,
    slug: $slug,
    title: $title,
    category: "operation",
    status: "in_progress",
    stage: "verify",
    priority: "p2",
    deps: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    complexity: "complex",
    agents: {executor_agent_id:"executor", verifier_agent_id:"verifier", audit_agent_id:null},
    plan: {
      result: "plan",
      slices: ["Move the bounded registry entry."],
      runbook: ["Confirm the source entry, then move it to the destination."],
      preconditions: ["The source entry exists exactly once."],
      recoveryBoundary: "Before the shared registry write, restore the captured source entry.",
      approvalBoundary: "Rewrite the shared release registry entry from source to destination.",
      requiresApproval: false,
      postconditions: ["The registry has exactly one destination entry."],
      verificationSeams: ["Read the source and destination entries independently."],
      escalation: null
    },
    execution: {
      result: "executed",
      executor_agent_id: "executor",
      cycle: 0,
      recordedAt: "2026-08-01T00:20:00Z",
      actions: ["Moved the bounded registry entry."],
      evidence: [{command:"inspect registry", output:"entry moved"}],
      approvalRequired: null
    },
    verification: {
      verdict: "pass",
      verifier_agent_id: "verifier",
      postconditions: [{postcondition:"The registry has exactly one destination entry.", ok:true, evidence:"destination present once"}],
      findings: [],
      evidence: [{command:"inspect registry", output:"postconditions satisfied"}]
    },
    audit: {required:false, verdict:"na", audit_agent_id:null, evidence:[]},
    commits: [],
    kickbacks: [],
    blockedReason: null,
    abandonReason: null
  }' > "$dir/task.json"
  printf '%s\n' "$dir"
}

write_claim() {
  local task_dir="$1" by="$2" at="$3"
  mkdir -p "$task_dir/.claim"
  jq -n --arg by "$by" --arg at "$at" '{by:$by, at:$at}' > "$task_dir/.claim/claim.json"
}

cook_all_section() {
  awk '
    /^#{2,6}[[:space:]]/ {
      match($0, /^#+/)
      depth = RLENGTH
      if (found && depth <= found_depth) exit
      lowered = tolower($0)
      if (!found && lowered ~ /cook all/) {
        found = 1
        found_depth = depth
      }
    }
    found { print }
    END { if (!found) exit 1 }
  ' "$SKILL"
}

request_routing_table() {
  awk '
    /^### Request routing$/ { in_section = 1; next }
    in_section && /^\|/ { found = 1; print; next }
    in_section && found { exit }
    END { if (!found) exit 1 }
  ' "$SKILL"
}

cook_all_completion_step() {
  cook_all_section | awk '
    /^[[:space:]]*4\./ { found = 1 }
    found && /^[[:space:]]*5\./ { exit }
    found { print }
    END { if (!found) exit 1 }
  '
}

lite_drain_landing() {
  cook_all_section | awk '
    /^[[:space:]]*[0-9]+\./ { exit }
    { print }
  '
}

loop_terminal_step() {
  awk '
    /^## The loop/ { in_loop = 1 }
    in_loop && /^[[:space:]]*6\. \*\*Handle the terminal/ {
      print
      found = 1
      exit
    }
    END { if (!found) exit 1 }
  ' "$SKILL"
}

refuses_sha_ancestor_land_proof() {
  local content="$1" label="$2"
  if grep -qF 'merge-base --is-ancestor' <<<"$content"; then
    printf '%s treats SHA-ancestor as land proof\n' "$label"
    return 1
  fi
  if grep -qF 'gated head is on the base branch' <<<"$content"; then
    printf '%s waits for gated head on the base branch\n' "$label"
    return 1
  fi
  if grep -qF 'tests.gate.hash is on the base branch' <<<"$content"; then
    printf '%s waits for tests.gate.hash on the base branch\n' "$label"
    return 1
  fi
}

lite_integration_section() {
  awk '
    /^## Running the pipeline/ { in_section = 1 }
    in_section && /^## / && !/^## Running the pipeline/ { exit }
    in_section { print }
    END { if (!in_section) exit 1 }
  ' "$LITE_MODE"
}

activation_section() {
  awk '
    /^## Activation/ { in_section = 1 }
    in_section && /^## Entry$/ { exit }
    in_section { print }
    END { if (!in_section) exit 1 }
  ' "$SKILL"
}

contract_paragraph() {
  local content="$1" marker="$2"
  awk -v marker="$marker" '
    BEGIN { RS = ""; ORS = "\n\n" }
    index($0, marker) { found = 1; print }
    END { if (!found) exit 1 }
  ' <<<"$content"
}

require_fixed() {
  local content="$1" marker="$2"
  grep -qF -- "$marker" <<<"$content" || {
    printf "missing cook all contract marker: %s\n" "$marker"
    return 1
  }
}

require_regex() {
  local content="$1" pattern="$2" label="$3"
  grep -qEi -- "$pattern" <<<"$content" || {
    printf "missing cook all contract: %s\n" "$label"
    return 1
  }
}

require_before() {
  local content="$1" earlier="$2" later="$3" label="$4"
  local earlier_line later_line
  earlier_line="$(awk -v marker="$earlier" 'index($0, marker) { print NR; exit }' <<<"$content")"
  later_line="$(awk -v marker="$later" 'index($0, marker) { print NR; exit }' <<<"$content")"
  if [ -z "$earlier_line" ] || [ -z "$later_line" ] || [ "$earlier_line" -ge "$later_line" ]; then
    printf "invalid cook all contract order: %s\n" "$label"
    return 1
  fi
}

require_success() {
  if [ "$status" -ne 0 ]; then
    printf '%s\n' "$output"
    return 1
  fi
}

@test "ready CLI emits exact task projections in priority then id order" {
  write_task 11 first "First" p0 >/dev/null
  write_task 2 second "Second" p1 >/dev/null
  write_task 3 terminal "Terminal" p0 done >/dev/null

  run cook ready

  require_success
  [ "$(printf '%s\n' "$output" | jq -cs 'length')" -eq 2 ]
  jq -ecs '
    . == [
      {id:11, slug:"first", title:"First", priority:"p0", deps:[]},
      {id:2, slug:"second", title:"Second", priority:"p1", deps:[]}
    ]
  ' <<<"$output" >/dev/null
}

@test "claim CLI accepts --by and persists a complete ISO-dated claim" {
  local task_dir
  task_dir="$(write_task 1 claimable "Claimable")"

  run cook claim 1 --by lane-a

  require_success
  jq -e '
    keys == ["at", "by"]
    and .by == "lane-a"
    and (.at | type == "string")
    and (.at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$"))
  ' "$task_dir/.claim/claim.json" >/dev/null
}

@test "claim CLI supplies a nonempty holder when --by is omitted" {
  local task_dir
  task_dir="$(write_task 1 default-holder "Default holder")"

  run cook claim 1

  require_success
  jq -e '.by | type == "string" and length > 0' "$task_dir/.claim/claim.json" >/dev/null
}

@test "claims CLI emits each holder with a numeric age" {
  local task_dir
  task_dir="$(write_task 1 held "Held")"
  write_claim "$task_dir" lane-a "2000-01-01T00:00:00.000Z"

  run cook claims

  require_success
  jq -ecs '
    length == 1
    and .[0].id == 1
    and .[0].by == "lane-a"
    and .[0].at == "2000-01-01T00:00:00.000Z"
    and (.[0].ageSeconds | type == "number" and . >= 0)
  ' <<<"$output" >/dev/null
  [ -f "$task_dir/.claim/claim.json" ]
}

@test "rebuild CLI archives stale checkpoint judgments and re-gates" {
  local task_dir
  task_dir="$(write_task 1 stale "Stale checkpoint" p2 in_progress)"
  jq '
    .stage = "review"
    | .tests = {authored_by_agent_id:"agent-t", green:true, evidence:[], gate:{green:true, clean:true, hash:"deadbeef"}}
    | .agents.reviewer_agent_id = "agent-r"
    | .review = {verdict:"pass", reviewer_agent_id:"agent-r", findings:[], evidence:[]}
  ' "$task_dir/task.json" > "$task_dir/task.json.tmp"
  mv "$task_dir/task.json.tmp" "$task_dir/task.json"

  run cook rebuild 1

  require_success
  jq -e '
    .stage == "refactor"
    and .tests.green == false
    and (.tests | has("gate") | not)
    and .review.verdict == null
    and .agents.reviewer_agent_id == null
    and (.judgmentHistory | length == 1)
  ' "$task_dir/task.json" >/dev/null
}

@test "rebuild CLI resets an operation lane to a fresh verification" {
  local task_dir
  task_dir="$(write_operation_task 2 op-stale "Operation stale checkpoint")"

  run cook rebuild 2

  require_success
  jq -e '
    .stage == "verify"
    and (has("tests") | not)
    and .verification.verdict == null
    and .agents.verifier_agent_id == null
    and (.judgmentHistory | length == 1)
  ' "$task_dir/task.json" >/dev/null
}

@test "rebuild CLI refuses a task that is not in progress" {
  write_task 1 pending-task "Pending" >/dev/null

  run cook rebuild 1

  [ "$status" -ne 0 ]
  [[ "$output" == *"in-progress"* ]]
}

@test "rebuild CLI refuses to archive a live needs-work verdict" {
  local task_dir
  task_dir="$(write_task 1 kicked "Kicked back" p2 in_progress)"
  jq '
    .stage = "review"
    | .tests = {authored_by_agent_id:"agent-t", green:true, evidence:[], gate:{green:true, clean:true, hash:"deadbeef"}}
    | .agents.reviewer_agent_id = "agent-r"
    | .review = {verdict:"needs-work", reviewer_agent_id:"agent-r", findings:[], evidence:[]}
  ' "$task_dir/task.json" > "$task_dir/task.json.tmp"
  mv "$task_dir/task.json.tmp" "$task_dir/task.json"

  run cook rebuild 1

  [ "$status" -ne 0 ]
  [[ "$output" == *"needs-work"* ]]
  jq -e '.review.verdict == "needs-work" and .stage == "review"' "$task_dir/task.json" >/dev/null
}

@test "rebuild CLI refuses a task that never reached a checkpoint" {
  write_task 1 early "Early stage" p2 in_progress >/dev/null

  run cook rebuild 1

  [ "$status" -ne 0 ]
  [[ "$output" == *"checkpoint"* ]]
}

@test "claims CLI reads the store under the shared record lock" {
  local task_dir
  task_dir="$(write_task 1 held "Held")"
  write_claim "$task_dir" lane-a "2000-01-01T00:00:00.000Z"
  mkdir "$TMP/.jeff/.record-lock"

  run cook claims

  [ "$status" -ne 0 ]
  [[ "$output" == *"record-lock"* ]]
}

@test "release CLI removes an active claim and refuses an unclaimed task" {
  local task_dir
  task_dir="$(write_task 1 releasable "Releasable")"
  write_claim "$task_dir" lane-a "2026-08-05T10:00:00.000Z"

  run cook release 1
  require_success
  [ ! -e "$task_dir/.claim" ]

  run cook release 1
  [ "$status" -ne 0 ]
  [[ "$output" == *"unclaimed"* ]]
}

@test "validate and task collection ignore operational claim state" {
  local task_dir
  task_dir="$(write_task 1 claimed "Claimed")"
  write_claim "$task_dir" lane-a "2026-08-05T10:00:00.000Z"

  run cook validate

  require_success
}

@test "drain primitives work in lite against string ids and issue refs" {
  local first_dir second_dir
  jq -n '{schemaVersion:1, system:"jeff", mode:"lite", active:true}' > "$TMP/.jeff/config.json"
  first_dir="$(write_lite_task '#11' first "First" p0 pending '[]' '#11')"
  second_dir="$(write_lite_task '#2' second "Second" p0 pending '[]' 'https://github.com/johanthoren/jeff/issues/2')"

  run cook ready
  require_success
  jq -ecs '
    . == [
      {id:"#11", slug:"first", title:"First", priority:"p0", deps:[]},
      {id:"#2", slug:"second", title:"Second", priority:"p0", deps:[]}
    ]
  ' <<<"$output" >/dev/null

  run cook claim '#11' --by lane-a
  require_success
  [ -f "$first_dir/.claim/claim.json" ]

  run cook claim 'https://github.com/johanthoren/jeff/issues/2' --by lane-b
  require_success
  [ -f "$second_dir/.claim/claim.json" ]
  [[ "$first_dir" == *".jeff/tasks/"* ]]
  [[ "$second_dir" == *".jeff/tasks/"* ]]

  run cook claims
  require_success
  jq -ecs '
    length == 2
    and (.[0].id == "#11" or .[0].id == "#2")
    and (.[1].id == "#11" or .[1].id == "#2")
    and (.[0].id != .[1].id)
  ' <<<"$output" >/dev/null

  run cook release '#11'
  require_success
  [ ! -e "$first_dir/.claim" ]
}


@test "cook all contract replaces the reserved line and keeps orchestration model-owned" {
  local section
  section="$(cook_all_section)" || {
    echo "skills/cook/SKILL.md has no scoped cook all section"
    return 1
  }

  ! grep -qF -- 'v1.1: reserved; not yet a control verb' "$SKILL"
  ! grep -qE -- 'full-mode-only|full mode only' "$SKILL"
  require_regex "$section" 'lite.*cook all|cook all.*lite' 'lite cook all'
  require_regex "$section" 'lite.*(claim|drain)|drain.*lite' 'lite drain'
  require_fixed "$section" 'cook ready'
  require_fixed "$section" 'cook claim'
  require_fixed "$section" 'cook release'
  require_fixed "$section" 'cook claims'
  require_fixed "$section" 'maxParallelTasks'
  require_regex "$section" 'model.*runtime|runtime.*model' 'the orchestrating model is the runtime'
  require_regex "$section" 'no scheduler' 'no scheduler process'
}


@test "explicit cook all routes to the drain before task-id fallback" {
  local routing cook_all_row
  routing="$(request_routing_table)" || {
    echo "skills/cook/SKILL.md has no request-routing table"
    return 1
  }

  cook_all_row="$(printf '%s\n' "$routing" | grep -i 'cook all' | head -n 1)"
  [ -n "$cook_all_row" ]
  [[ "$cook_all_row" != *full-mode-only* && "$cook_all_row" != *"full mode only"* ]]
  require_regex "$cook_all_row" 'lite' 'lite mentioned in cook all routing'
  require_regex "$cook_all_row" 'drain' 'drain mentioned in cook all routing'
  require_before "$routing" 'cook all' 'unrecognized explicit `cook <arg>`' 'explicit cook all row must precede task-id fallback'
}

@test "lite landing auto-merges after CI without trunk CAS" {
  local section landing loop_step restated
  section="$(cook_all_section)" || return 1
  landing="$(lite_drain_landing)" || return 1
  loop_step="$(loop_terminal_step)" || {
    echo "skills/cook/SKILL.md has no loop step 6 terminal hold"
    return 1
  }

  require_regex "$section" 'auto-merge after CI' 'lite auto-merge after CI'
  require_regex "$section" 'Integration:|live request' 'Integration or live request can forbid landing'
  require_regex "$section" 'wait-for-land' 'wait-for-land before done'
  require_regex "$section" 'lite.*(feature branch|open PR)|feature branch.*lite|open PR.*lite' 'lite feature-branch PR landing'
  require_regex "$section" 'multiple PRs' 'multiple lite PRs may be open'
  require_regex "$section" 'lite landing does not use trunk compare-and-swap|lite[^.]{0,80}(does not|never|not)[^.]{0,80}(compare-and-swap|update-ref)' 'lite landing is not trunk CAS'
  if grep -qiE 'Merge or protected-base push still requires explicit per-change operator approval' <<<"$section"; then
    printf 'lite landing still requires per-change operator approval\n'
    return 1
  fi
  refuses_sha_ancestor_land_proof "$landing" 'cook-all lite landing summary'
  require_regex "$loop_step" 'wait-for-land' 'loop step 6 names wait-for-land'
  refuses_sha_ancestor_land_proof "$loop_step" 'loop step 6'
  require_regex "$landing" 'post-land checkout' 'cook-all lite landing names post-land checkout'
  require_regex "$loop_step" 'post-land checkout' 'loop step 6 names post-land checkout'
  for restated in 'git fetch' 'git pull --ff-only' 'git branch -d' 'git branch -D' '--delete-branch' 'git checkout'; do
    if grep -qF -- "$restated" <<<"$landing"; then
      printf 'cook-all lite landing restates post-land command: %s\n' "$restated"
      return 1
    fi
    if grep -qF -- "$restated" <<<"$loop_step"; then
      printf 'loop step 6 restates post-land command: %s\n' "$restated"
      return 1
    fi
  done
  case "$(tr '\n' ' ' <<<"$landing")" in
    *wait-for-land*restore-if-needed*record*held\ return*post-land\ checkout*) ;;
    *)
      printf 'cook-all lite landing must restore-if-needed, then record done, then post-land checkout\n'
      return 1
      ;;
  esac
  case "$(tr '\n' ' ' <<<"$loop_step")" in
    *wait-for-land*restore-if-needed*record*held\ return*post-land\ checkout*) ;;
    *)
      printf 'loop step 6 must restore-if-needed, then record done, then post-land checkout\n'
      return 1
      ;;
  esac
  if grep -qiE 'post-land checkout.{0,80}before recording' <<<"$landing"; then
    printf 'cook-all lite landing still records done after post-land checkout\n'
    return 1
  fi
  if grep -qiE 'post-land checkout.{0,80}before recording' <<<"$loop_step"; then
    printf 'loop step 6 still records done after post-land checkout\n'
    return 1
  fi
}

@test "lite integration terminal enables gh pr merge --auto unless Integration forbids it" {
  local section compact
  section="$(lite_integration_section)" || {
    echo "skills/cook/reference/lite-mode.md has no pipeline / integration terminal section"
    return 1
  }
  compact="$(tr '\n' ' ' <<<"$section")"

  require_fixed "$section" 'gh pr merge --auto'
  require_fixed "$section" '--match-head-commit'
  require_regex "$compact" 'absent[^.]{0,80}Integration|silent[^.]{0,80}Integration|Integration[^.]{0,80}(absent|silent|missing)' 'absent or silent Integration is named'
  require_regex "$compact" '(does not|do not|not)[^.]{0,60}forbid' 'absent Integration does not forbid landing'
  require_regex "$compact" 'team merge|team owns merge|team-owns-merge' 'team-merge profile still forbids landing'
  require_regex "$compact" 'confirm-first' 'confirm-first merge still forbids landing'
  require_regex "$compact" 'never push[^.]{0,40}protected base' 'never-push-protected-base still forbids landing'
  require_regex "$compact" '(stop|print)[^.]{0,80}(command|merge)|(print)[^.]{0,40}command' 'forbidden profiles stop and print the command'
  if grep -qF -- '--admin' <<<"$section"; then
    printf 'lite merge path must not use --admin\n'
    return 1
  fi
}

@test "lite integration terminal names merge methods --merge --squash --rebase" {
  local section compact
  section="$(lite_integration_section)" || return 1
  compact="$(tr '\n' ' ' <<<"$section")"

  require_fixed "$section" '--merge'
  require_fixed "$section" '--squash'
  require_fixed "$section" '--rebase'
  require_regex "$compact" '(silent|absent)[^.]{0,120}--merge|--merge[^.]{0,80}(default|silent|absent)' 'silent Integration uses --merge'
  require_fixed "$section" 'gh pr merge --auto'
  require_fixed "$section" '--match-head-commit'
  require_fixed "$section" 'tests.gate.hash'
  require_regex "$compact" '(--merge|--squash|--rebase)[^.]{0,80}--auto|--auto[^.]{0,80}(--merge|--squash|--rebase)' 'method flag is passed with --auto'
}

@test "lite integration terminal waits for land as PR MERGED and stops when --auto fails" {
  local section compact
  section="$(lite_integration_section)" || return 1
  compact="$(tr '\n' ' ' <<<"$section")"

  require_fixed "$section" 'gh pr merge --auto'
  require_fixed "$section" '--match-head-commit'
  require_fixed "$section" 'tests.gate.hash'
  require_fixed "$section" 'gh pr view --json state'
  require_regex "$compact" 'MERGED' 'wait-for-land succeeds when the PR is MERGED'
  refuses_sha_ancestor_land_proof "$section" 'lite integration terminal'
  require_regex "$compact" '(--auto[^.]{0,80}fail|fail[^.]{0,80}--auto)' '--auto failure is named'
  require_regex "$compact" '(stop|print)[^.]{0,100}command' '--auto failure stops and prints the command'
  require_regex "$compact" '(do not|does not|never|not)[^.]{0,80}(fall back|fallback|immediate)' 'no immediate-merge fallback when --auto fails'
}

@test "lite integration terminal checks out the PR base and git branch -d after MERGED" {
  local section compact
  section="$(lite_integration_section)" || {
    echo "skills/cook/reference/lite-mode.md has no pipeline / integration terminal section"
    return 1
  }
  compact="$(tr '\n' ' ' <<<"$section")"

  require_regex "$section" 'post-land checkout' 'lite-mode.md names post-land checkout'
  require_regex "$compact" 'wait-for-land' 'post-land checkout lives next to wait-for-land'
  require_fixed "$section" 'MERGED'
  require_regex "$compact" 'checkout[^.]{0,80}PR base|PR base[^.]{0,80}checkout' 'checkout the PR base branch'
  require_fixed "$section" 'git fetch'
  require_fixed "$section" 'git pull --ff-only'
  require_fixed "$section" 'git branch -d'
  require_regex "$compact" 'never[^.]{0,20}-D|-D[^.]{0,20}never' 'never git branch -D'
  if grep -qE -- 'git branch[[:space:]]+-D' <<<"$section"; then
    printf 'post-land cleanup must not use git branch -D\n'
    return 1
  fi
  require_regex "$compact" '-d[^.]{0,100}(refus|refuse)|(refus|refuse)[^.]{0,100}-d' 'if -d refuses'
  require_regex "$compact" '(refus|refuse)[^.]{0,160}(stop|print)[^.]{0,40}command|(stop|print)[^.]{0,80}command[^.]{0,80}(refus|refuse|-d)' '-d refuse stops and prints the command'
  require_regex "$compact" 'HEAD.{0,80}is not.{0,40}tests\.gate\.hash' 'restore when HEAD is not tests.gate.hash'
  require_regex "$compact" 'checkout.{0,20}tests\.gate\.hash' 'checkout tests.gate.hash if HEAD moved'
  case "$compact" in
    *MERGED*HEAD*tests.gate.hash*checkout*tests.gate.hash*record\ that\ held\ return*checkout*PR\ base*git\ fetch*git\ pull\ --ff-only*git\ branch\ -d*) ;;
    *)
      printf 'post-land checkout must follow MERGED, restore tests.gate.hash, record done, then PR base, git fetch, git pull --ff-only, git branch -d\n'
      return 1
      ;;
  esac
}

@test "lite gh pr merge includes --delete-branch unless keep-branch or repo already deletes" {
  local section compact
  section="$(lite_integration_section)" || return 1
  compact="$(tr '\n' ' ' <<<"$section")"

  require_fixed "$section" '--delete-branch'
  require_regex "$compact" 'gh pr merge[^.]{0,80}--delete-branch|--delete-branch[^.]{0,80}gh pr merge' 'default gh pr merge includes --delete-branch'
  require_regex "$compact" 'keep the remote[^.]{0,40}(task )?branch|keep[^.]{0,40}remote task branch' 'Integration may keep the remote task branch'
  require_regex "$compact" 'already deletes on merge|repository already deletes' 'skip --delete-branch when the repo already deletes on merge'
  require_regex "$compact" '(silent|absent)[^.]{0,100}delete[^.]{0,40}(remote|branch)|delete[^.]{0,40}(remote|branch)[^.]{0,100}(silent|absent)' 'silent Integration deletes the remote branch'
}

@test "team-owns-merge confirm-first and never-push-protected-base do not delete the feature branch" {
  local section compact
  section="$(lite_integration_section)" || return 1
  compact="$(tr '\n' ' ' <<<"$section")"

  require_regex "$compact" 'team merge|team owns merge|team-owns-merge' 'team-merge profile still forbids landing'
  require_regex "$compact" 'confirm-first' 'confirm-first merge still forbids landing'
  require_regex "$compact" 'never push[^.]{0,40}protected base' 'never-push-protected-base still forbids landing'
  require_regex "$compact" '(do not|does not|never)[^.]{0,40}merge' 'forbidden profiles still do not merge'
  require_regex "$compact" '(do not|does not)[^.]{0,60}delete the feature branch' 'forbidden profiles do not delete the feature branch'
}

@test "lite integration terminal names GitHub allow_auto_merge and required checks" {
  local section compact
  section="$(lite_integration_section)" || return 1
  compact="$(tr '\n' ' ' <<<"$section")"

  require_fixed "$section" 'allow_auto_merge'
  require_regex "$compact" 'required (status )?checks' 'required status checks are named'
  require_regex "$compact" 'without[^.]{0,80}required|--auto[^.]{0,80}immediate|merge immediately' 'without required checks --auto may merge immediately'
}

@test "activation asks auto-merge vs team-owns-merge before cook lite and profile init" {
  local section compact
  section="$(activation_section)" || {
    echo "skills/cook/SKILL.md has no Activation section"
    return 1
  }
  compact="$(tr '\n' ' ' <<<"$section")"

  require_fixed "$section" 'cook lite'
  require_fixed "$section" 'cook profile init'
  require_regex "$compact" 'auto-merge after CI' 'ask names auto-merge after CI'
  require_regex "$compact" 'team owns merge|team-owns-merge' 'ask names team-owns-merge'
  require_regex "$compact" 'Integration' 'the answer is written into Integration'
  require_regex "$compact" 'non-interactive' 'CLI stays non-interactive'
  require_regex "$compact" 'no new flag' 'no new CLI flag'
  require_regex "$compact" 'overwrite|writes that answer|write[^.]{0,80}Integration' 'Jeff writes the chat answer into Integration'
  require_regex "$compact" 'asks only land policy|only land policy|merge method is not a second' 'init asks only land policy'
}

@test "one-off start claims at cap while cook all refuses a new autonomous claim" {
  local section
  section="$(cook_all_section)" || return 1

  require_regex "$section" 'cook <id>|named start|cook on' 'named start forms'
  require_regex "$section" 'even when.*maxParallelTasks|already equal.*maxParallelTasks|named start.*cap|claims it even when' 'named start ignores the drain cap'
  require_regex "$section" 'main is occupied|another claim|occupied.*worktree|worktree.*occupied' 'occupied main uses a worktree'
  require_regex "$section" 'cook all.*refuses|refuses.*autonomous|autonomous claim.*cap|cap is full' 'cook all refuses a new claim at cap'
}

@test "help describes drain verbs without calling them full-mode-only" {
  local ready_line claim_line release_line claims_line
  run cook help
  require_success
  ready_line="$(printf '%s\n' "$output" | grep -E '^  ready ')"
  claim_line="$(printf '%s\n' "$output" | grep -E '^  claim ')"
  release_line="$(printf '%s\n' "$output" | grep -E '^  release ')"
  claims_line="$(printf '%s\n' "$output" | grep -E '^  claims ')"
  [ -n "$ready_line" ]
  [ -n "$claim_line" ]
  [ -n "$release_line" ]
  [ -n "$claims_line" ]
  [[ "$ready_line" != *full-mode* ]]
  [[ "$claim_line" != *full-mode* ]]
  [[ "$release_line" != *full-mode* ]]
  [[ "$claims_line" != *full-mode* ]]
}



@test "cook all contract refreshes capacity and isolates simultaneous lanes" {
  local section
  section="$(cook_all_section)" || return 1

  require_regex "$section" 'ready.*claims.*fresh from disk|fresh from disk.*ready.*claims' 'fresh ready set and claims'
  require_regex "$section" 'active claims.*maxParallelTasks|maxParallelTasks.*active claims' 'capacity comparison'
  require_regex "$section" 'claim.*next task' 'claim the next ready task'
  require_regex "$section" 'journal.*drain intent|drain intent.*journal' 'journal drain intent before opening a lane'
  require_regex "$section" 'two or more.*claimed.*linked git worktree|linked git worktree.*two or more.*claimed' 'one linked worktree per simultaneous claim'
  require_regex "$section" 'own task branch|task branch.*own' 'one task branch per lane'
  require_regex "$section" 'single claimed task.*main checkout|main checkout.*single claimed task' 'single-lane main checkout allowance'
  require_regex "$section" 'default.*1.*serial|capacity 1.*serial|1.*preserves serial' 'default capacity one preserves serial behavior'
}

@test "cook all binds every lane state operation to one main store root" {
  local section root_contract command
  section="$(cook_all_section)" || return 1
  root_contract="$(contract_paragraph "$section" 'COOK_ROOT')" || {
    echo "missing cook all contract: authoritative COOK_ROOT data flow"
    return 1
  }

  require_regex "$root_contract" 'COOK_ROOT.*authoritative.*main.*root|authoritative.*main.*root.*COOK_ROOT' 'one authoritative main store root'
  require_regex "$root_contract" 'export.*COOK_ROOT|COOK_ROOT.*inherit' 'COOK_ROOT inherited by lane commands'
  for command in 'cook ready' 'cook claims' 'cook claim' 'cook journal' 'cook record' 'cook approve' 'cook reverify' 'cook verify' 'cook validate' 'cook release'; do
    require_fixed "$root_contract" "$command"
  done
  require_regex "$root_contract" 'same.*record-lock|record-lock.*same' 'one shared store lock'
}

@test "cook all contract preserves lane gates and serialized completion-order landing" {
  local section
  section="$(cook_all_section)" || return 1

  require_regex "$section" 'each lane.*independent|independently.*lane' 'independent task loops'
  require_regex "$section" 'different lanes.*concurrent|concurrent.*different lanes' 'cross-lane concurrent dispatch'
  require_regex "$section" 'record-lock.*serial|serial.*record-lock' 'serialized store writes'
  require_regex "$section" 'integration.*serial.*main checkout|serial.*integration.*main checkout' 'serialized integration at the main checkout'
  require_regex "$section" 'completion order' 'completion-order landing'
  require_regex "$section" 'merge or rebase.*trunk|trunk.*merge or rebase' 'merge or rebase onto trunk'
  require_fixed "$section" 'cook verify --task <id>'
  require_regex "$section" 'main root|root.*HEAD' 'root HEAD gate location'
  require_regex "$section" 'HEAD match|HEAD.*match' 'done requires the gated HEAD'
  require_regex "$section" 'clean tree|tree.*clean' 'done requires a clean tree'
  require_regex "$section" 'record done.*release.*remove.*worktree' 'done, release, and worktree cleanup order'
}

@test "cook all orders one integrated checkpoint through terminal recording" {
  local completion
  completion="$(cook_all_completion_step)" || {
    echo "skills/cook/SKILL.md has no cook all completion step"
    return 1
  }

  require_fixed "$completion" 'private integration checkpoint'
  require_fixed "$completion" 'capture the old trunk OID as O'
  require_regex "$completion" 'trunk.*unchanged.*judgment|judgment.*trunk.*unchanged' 'trunk stays unchanged during judgments'
  require_regex "$completion" 'one.*gate|gate.*once' 'one full-suite gate'
  require_regex "$completion" 'non-terminal.*judgment.*record.*immediate|record.*non-terminal.*judgment.*immediate' 'non-terminal judgment returns are recorded immediately'
  require_regex "$completion" 'hold only.*final passing|only.*final passing.*unrecorded' 'only the terminal passing return is briefly held'
  require_regex "$completion" 'gate\.hash.*current.*HEAD|current.*HEAD.*gate\.hash' 'terminal gate hash equals main-root HEAD'
  require_fixed "$completion" 'record the gated hash as G'
  require_regex "$completion" 'git merge-base --is-ancestor.*O.*G' 'ancestry check from old trunk O to gated checkpoint G'
  require_regex "$completion" 'git update-ref.*G.*O' 'atomic update-ref uses gated G with expected-old O'
  require_regex "$completion" 'expected[- ]old.*O|compare-and-swap.*O.*G|CAS.*O.*G' 'expected-old ref CAS from O to G'
  require_regex "$completion" 'mismatch.*trunk.*unchanged.*recovery|mismatch.*recovery.*trunk.*unchanged' 'CAS mismatch leaves trunk untouched and routes recovery'
  require_regex "$completion" 'mismatch.*(do not|without).*record.*final|mismatch.*final.*(not|unrecorded)' 'CAS mismatch does not record the terminal return'
  require_fixed "$completion" 'cook rebuild <id>'
  require_regex "$completion" 'archives every judgment earned against the stale checkpoint' 'rebuild archives the stale checkpoint judgments'
  require_regex "$completion" 'gate, review, and audit' 'code lane judgment set'
  require_regex "$completion" "verification and audit" 'operation lane judgment set'
  require_regex "$completion" 'fresh identities' 'a rebuilt checkpoint re-dispatches with fresh identities'
  require_regex "$completion" 'never satisfy its successor|can never satisfy its successor' 'a discarded checkpoint judgment cannot satisfy the rebuilt one'
  require_regex "$completion" 'refuses.*live needs-work|live needs-work.*refuse' 'rebuild refuses an ordinary kickback'
  require_regex "$completion" 'never reached a checkpoint' 'rebuild refuses a lane with no checkpoint'
  require_before "$completion" 'capture the old trunk OID as O' 'private integration checkpoint' 'capture old trunk before integration'
  require_before "$completion" 'private integration checkpoint' 'cook verify --task <id>' 'checkpoint before its gate'
  require_before "$completion" 'cook verify --task <id>' 'dispatch review and required audit' 'gate before judgments'
  require_before "$completion" 'cook verify --task <id>' 'record the gated hash as G' 'gate before naming G'
  require_before "$completion" 'dispatch review and required audit' 'advance trunk to the exact gated hash' 'judgments before trunk'
  require_before "$completion" 'dispatch review and required audit' 'git merge-base --is-ancestor' 'judgments before ancestry check'
  require_before "$completion" 'git merge-base --is-ancestor' 'git update-ref' 'ancestry check before trunk CAS'
  require_before "$completion" 'git update-ref' 'record the final passing return' 'successful trunk CAS before terminal record'
  require_before "$completion" 'advance trunk to the exact gated hash' 'record the final passing return' 'trunk before terminal record'
  require_before "$completion" 'record the final passing return' 'release the claim' 'done before release'
}

@test "cook all contract handles hidden edges, lane-local stops, drain completion, and resume" {
  local section
  section="$(cook_all_section)" || return 1

  require_regex "$section" 'merge conflict.*hidden edge|hidden edge.*merge conflict' 'merge conflict is a discovered hidden edge'
  require_regex "$section" 'landing or rebase conflict|rebase conflict.*hidden edge|hidden edge.*rebase' 'landing or rebase conflict is a hidden edge'

  require_regex "$section" 'kickback.*implement|implement.*kickback' 'conflict kickback to implement'
  require_regex "$section" 'same area.*sequence|sequence.*same area' 'obvious overlap runs in sequence'
  require_regex "$section" 'capture lock.*approval.*escalation.*blocked' 'lane-local stop classes'
  require_regex "$section" 'stops only.*own lane|only its own lane' 'a stop affects only its lane'
  require_regex "$section" 'continues.*rest|rest.*continues' 'other lanes continue'
  require_regex "$section" 'no ready.*claim.*resolved|claim.*resolved.*no ready' 'drain completion condition'
  require_regex "$section" 'resolved or retained' 'a stopped lane retains its claim without blocking drain completion'
  require_regex "$section" 'summary.*terminal.*cycles.*kickbacks|terminal.*cycles.*kickbacks' 'drain summary fields'
  require_regex "$section" 'never.*break.*claim.*automatic|never.*automatically.*break.*claim' 'claims are never auto-broken'
  require_regex "$section" 'older than 24h.*journal|24h.*journal' 'stale claim journal check'
  require_regex "$section" 'ask the operator' 'operator decides stale claims'
  require_regex "$section" 'resume.*claims.*journals|claims.*journals.*resume' 'resume from claims and journals'
  require_regex "$section" 'recorded stage' 'resume at the recorded stage'
  require_regex "$section" 'dangling intents' 'dangling intent semantics'
}
