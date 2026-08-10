#!/usr/bin/env bats
# tests/jeff-graph-p1a-spec.bats: task #184 — lock P1a standalone jeff graph design spec.
#
# Covers (see .jeff/tasks/lite-184-2828362186/task.md):
#   AC1:  design spec exists under docs/specs/ for P1a only
#   AC2:  socket protocol (transport, framing, req/res, events, versioning)
#   AC3:  cook invocation contract (commands, exit codes, parse/skew)
#   AC4:  control/ crate layout (projector + jeff graph client; no combined shell)
#   AC5:  projection/cache + debounce/coalesce + per-project re-snapshot
#   AC6:  viewport math (world, zoom, pan, hit-test)
#   AC7:  layout pipeline (petgraph → layout-rs → canvas; recompute vs cache)
#   AC8:  mechanical acceptance checks for P1a (graph alone)
#   AC9:  claims optional/degraded; forbid side claim systems
#   AC10: standalone jeff graph first; bare jeff help-only until multi-pane
#
# Seam: the design doc IS the architecture product for implementers. Operators
# and successor agents observe these section locks; there is no second runtime
# seam. Marker discipline matches control-plane-tui-shape / payload-hygiene:
# heading tokens and contract nouns that survive rewording inside a section.
#
# Parallel-safe: read-only greps over a fixed repo path; no network/clock/FS writes.
# RED until docs/specs/jeff-graph-p1a.md exists with the locked sections.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }

SPEC="$REPO/docs/specs/jeff-graph-p1a.md"
VISION="$REPO/docs/specs/control-plane-vision.md"

# Extract from a heading through the line before the next same-or-higher heading.
# $1 = awk regex for the opening heading line (e.g. '^## .*[Ss]ocket').
spec_section() {
  awk -v re="$1" '
    $0 ~ re { in_section = 1; print; next }
    in_section && /^#{1,2} / { exit }
    in_section { print }
  ' "$SPEC"
}

require_spec() {
  [ -f "$SPEC" ] || { echo "missing design spec: docs/specs/jeff-graph-p1a.md"; return 1; }
}

# ---------------------------------------------------------------------------
# AC1: design spec path exists (P1a graph alone)
# ---------------------------------------------------------------------------

@test "#184 AC1: docs/specs/jeff-graph-p1a.md exists" {
  require_spec
}

@test "#184 AC1: spec titles P1a standalone jeff graph (not P1b / combined shell)" {
  require_spec
  # Title / lead must name P1a and jeff graph; must not brand this file as P1b.
  head -n 40 "$SPEC" | grep -qiE 'P1a' \
    || { echo "spec lead omits P1a"; return 1; }
  head -n 40 "$SPEC" | grep -qF 'jeff graph' \
    || { echo "spec lead omits jeff graph"; return 1; }
  if head -n 40 "$SPEC" | grep -qiE 'P1b|three[[:space:]-]?cards?|combined shell'; then
    echo "spec lead scopes P1b or combined shell into the P1a title region"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# AC2: socket protocol
# ---------------------------------------------------------------------------

@test "#184 AC2: socket protocol section covers transport framing request response events versioning" {
  require_spec
  local section compact
  section="$(spec_section '^## .*[Ss]ocket [Pp]rotocol')"
  [ -n "$section" ] || { echo "missing ## Socket protocol heading"; return 1; }
  compact="$(tr '\n' ' ' <<<"$section")"

  grep -qiE 'transport' <<<"$compact" \
    || { echo "socket section omits transport"; return 1; }
  grep -qiE 'fram' <<<"$compact" \
    || { echo "socket section omits framing"; return 1; }
  grep -qiE 'request' <<<"$compact" \
    || { echo "socket section omits request"; return 1; }
  grep -qiE 'response' <<<"$compact" \
    || { echo "socket section omits response"; return 1; }
  grep -qiE 'event' <<<"$compact" \
    || { echo "socket section omits events"; return 1; }
  grep -qiE 'version' <<<"$compact" \
    || { echo "socket section omits versioning"; return 1; }
  # Graph projection is the P1a payload class on the wire.
  grep -qiE 'graph|projection|snapshot' <<<"$compact" \
    || { echo "socket section never ties protocol to graph projection"; return 1; }
}

# ---------------------------------------------------------------------------
# AC3: cook invocation contract
# ---------------------------------------------------------------------------

@test "#184 AC3: cook invocation contract names snapshot --json, exit codes, parse and version skew" {
  require_spec
  local section compact
  section="$(spec_section '^## .*[Cc]ook [Ii]nvocation')"
  [ -n "$section" ] || { echo "missing ## cook invocation contract heading"; return 1; }
  compact="$(tr '\n' ' ' <<<"$section")"

  # Real item-8 surface from skills/cook/reference/jeff-state-schema.md.
  grep -qF 'cook snapshot --json' <<<"$compact" \
    || { echo "cook contract omits cook snapshot --json"; return 1; }
  grep -qiE 'exit code|non-?zero|exit status' <<<"$compact" \
    || { echo "cook contract omits exit codes"; return 1; }
  grep -qiE 'parse' <<<"$compact" \
    || { echo "cook contract omits parse failure"; return 1; }
  grep -qiE 'schemaVersion|version skew|older jeff|older than' <<<"$compact" \
    || { echo "cook contract omits version skew / older jeff handling"; return 1; }
}

# ---------------------------------------------------------------------------
# AC4: control/ crate layout
# ---------------------------------------------------------------------------

@test "#184 AC4: control/ crate layout covers projector backend and jeff graph client" {
  require_spec
  local section compact
  section="$(spec_section '^## .*[Cc]rate [Ll]ayout|^## .*control/')"
  [ -n "$section" ] || { echo "missing ## Crate layout (control/) heading"; return 1; }
  compact="$(tr '\n' ' ' <<<"$section")"

  grep -qF 'control/' <<<"$compact" \
    || { echo "crate layout omits control/"; return 1; }
  grep -qiE 'project|backend|jeffd' <<<"$compact" \
    || { echo "crate layout omits projector/backend"; return 1; }
  grep -qF 'jeff graph' <<<"$compact" \
    || { echo "crate layout omits jeff graph client"; return 1; }
  # P1a must not require a combined multi-pane shell crate.
  if grep -qiE 'required[^.]{0,40}(combined|three[[:space:]-]?cards?|multi-?pane)|(combined|three[[:space:]-]?cards?)[^.]{0,40}required' <<<"$compact"; then
    echo "crate layout requires combined shell for P1a"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# AC5: projection and cache model
# ---------------------------------------------------------------------------

@test "#184 AC5: projection and cache section locks debounce coalesce and per-project re-snapshot" {
  require_spec
  local section compact
  section="$(spec_section '^## .*[Pp]rojection')"
  [ -n "$section" ] || { echo "missing ## Projection and cache model heading"; return 1; }
  compact="$(tr '\n' ' ' <<<"$section")"

  grep -qiE 'debounc' <<<"$compact" \
    || { echo "projection section omits debounce"; return 1; }
  grep -qiE 'coalesc' <<<"$compact" \
    || { echo "projection section omits coalesce"; return 1; }
  # Handoff §6: 100 to 200 ms window.
  grep -qiE '100|200' <<<"$compact" \
    || { echo "projection section omits 100-200 ms debounce window"; return 1; }
  grep -qiE 'per-?project|project whose|only the project' <<<"$compact" \
    || { echo "projection section omits per-project re-snapshot"; return 1; }
  # Disk is truth / do not parse ledgers in Rust (handoff §6).
  grep -qiE 'disk|cook snapshot|not[^.]{0,40}pars[^.]{0,40}ledger' <<<"$compact" \
    || { echo "projection section omits disk-via-cook boundary"; return 1; }
}

# ---------------------------------------------------------------------------
# AC6: viewport math
# ---------------------------------------------------------------------------

@test "#184 AC6: viewport math section covers world coords zoom pan bounds hit-test" {
  require_spec
  local section compact
  section="$(spec_section '^## .*[Vv]iewport')"
  [ -n "$section" ] || { echo "missing ## Viewport math heading"; return 1; }
  compact="$(tr '\n' ' ' <<<"$section")"

  grep -qiE 'world' <<<"$compact" \
    || { echo "viewport section omits world coordinates"; return 1; }
  grep -qiE 'zoom' <<<"$compact" \
    || { echo "viewport section omits zoom"; return 1; }
  grep -qiE 'pan' <<<"$compact" \
    || { echo "viewport section omits pan"; return 1; }
  grep -qiE 'hit-?test|hit test' <<<"$compact" \
    || { echo "viewport section omits hit-test"; return 1; }
  grep -qiE 'mouse|cell|node' <<<"$compact" \
    || { echo "viewport section omits mouse/cell → node mapping"; return 1; }
}

# ---------------------------------------------------------------------------
# AC7: layout pipeline
# ---------------------------------------------------------------------------

@test "#184 AC7: layout pipeline section names petgraph layout-rs canvas and recompute rules" {
  require_spec
  local section compact
  section="$(spec_section '^## .*[Ll]ayout [Pp]ipeline')"
  [ -n "$section" ] || { echo "missing ## Layout pipeline heading"; return 1; }
  compact="$(tr '\n' ' ' <<<"$section")"

  grep -qF 'petgraph' <<<"$compact" \
    || { echo "layout section omits petgraph"; return 1; }
  grep -qF 'layout-rs' <<<"$compact" \
    || { echo "layout section omits layout-rs"; return 1; }
  grep -qiE 'canvas' <<<"$compact" \
    || { echo "layout section omits canvas"; return 1; }
  grep -qiE 'recomput|cache' <<<"$compact" \
    || { echo "layout section omits recompute vs cache rules"; return 1; }
  # Handoff: recompute on topology change, not pan/zoom/selection/status-only.
  grep -qiE 'topolog' <<<"$compact" \
    || { echo "layout section omits topology-triggered recompute"; return 1; }
}

# ---------------------------------------------------------------------------
# AC8: mechanical acceptance checks
# ---------------------------------------------------------------------------

@test "#184 AC8: mechanical acceptance section lists P1a graph-alone checks" {
  require_spec
  local section compact
  section="$(spec_section '^## .*[Mm]echanical [Aa]cceptance')"
  [ -n "$section" ] || { echo "missing ## Mechanical acceptance checks heading"; return 1; }
  compact="$(tr '\n' ' ' <<<"$section")"

  grep -qiE 'P1a|graph alone|standalone' <<<"$compact" \
    || { echo "acceptance section omits P1a / graph-alone scope"; return 1; }
  # Must not smuggle P1b backlog file-format acceptance into this section as required.
  if grep -qiE 'backlog file format|multi-writer append' <<<"$section"; then
    if ! grep -qiE 'non-?goal|out of scope|wait|defer|P1b' <<<"$section"; then
      echo "acceptance section requires P1b backlog formats without deferral"
      return 1
    fi
  fi
}

# ---------------------------------------------------------------------------
# AC9: claims degraded; no side claim system
# ---------------------------------------------------------------------------

@test "#184 AC9: claims section locks optional degraded display and forbids side claims" {
  require_spec
  local section compact
  section="$(spec_section '^## .*[Cc]laim')"
  [ -n "$section" ] || { echo "missing ## Claims heading"; return 1; }
  compact="$(tr '\n' ' ' <<<"$section")"

  grep -qiE 'optional|degraded|absent|missing' <<<"$compact" \
    || { echo "claims section omits optional/degraded handling"; return 1; }
  grep -qiE 'side claim|no side|must not|forbid|never[^.]{0,40}claim' <<<"$compact" \
    || { echo "claims section does not forbid side claim systems"; return 1; }
  # Snapshot projects claim from .claim/claim.json when present (item 8).
  grep -qiE 'claim\.json|snapshot|\.claim' <<<"$compact" \
    || { echo "claims section never ties display to snapshot claim projection"; return 1; }
}

# ---------------------------------------------------------------------------
# AC10: standalone client shape lock
# ---------------------------------------------------------------------------

@test "#184 AC10: scope locks standalone jeff graph first; bare jeff not combined shell" {
  require_spec
  local section compact
  # Prefer an explicit scope / non-goals / client-shape section; fall back to full doc.
  section="$(spec_section '^## .*([Ss]cope|[Nn]on-?[Gg]oals|[Cc]lient [Ss]hape|[Ss]tandalone)')"
  if [ -z "$section" ]; then
    section="$(cat "$SPEC")"
  fi
  compact="$(tr '\n' ' ' <<<"$section")"

  grep -qF 'jeff graph' <<<"$compact" \
    || { echo "scope omits jeff graph"; return 1; }
  grep -qiE 'standalone' <<<"$compact" \
    || { echo "scope omits standalone"; return 1; }
  # Bare jeff is help-only or deferred until multi-pane; not the P1a ship vehicle.
  grep -qiE 'bare `?jeff`?' <<<"$compact" \
    || { echo "scope never mentions bare jeff"; return 1; }
  grep -qiE '(help-?only|not first|later|defer|optional|late).{0,40}(combined|multi-?pane|bare)|bare.{0,40}(help-?only|not first|later|defer|combined)' <<<"$compact" \
    || { echo "scope does not keep bare jeff / combined shell out of P1a first ship"; return 1; }
  # Kitty composition may be named as early OK; combined Ratatui shell must not be required.
  if grep -qiE 'P1a[^.]{0,80}(requires|must).{0,40}(combined|three[[:space:]-]?cards?|multi-?pane)' <<<"$compact"; then
    echo "scope requires combined multi-pane for P1a"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# #219: durable P1a gate decision
# ---------------------------------------------------------------------------

@test "#219 P1a gate record dates the narrow operator exception at its single owner" {
  require_spec
  local record compact binding planning
  record="$(awk 'BEGIN { RS = ""; ORS = "\n" } /2026-08-10/ { print }' "$VISION")"
  [ -n "$record" ] || {
    echo "control-plane vision has no 2026-08-10 P1a gate decision"
    return 1
  }
  compact="$(tr '\n' ' ' <<<"$record")"

  grep -qiE 'operator[^.]{0,80}(explicitly[[:space:]]+)?reopen(ed)?[^.]{0,80}(P1a[^.]{0,80}gate|gate[^.]{0,80}P1a)' <<<"$compact" \
    || { echo "dated record does not explicitly reopen the P1a gate"; return 1; }
  grep -qiE 'replac(es|ed)[^.]{0,80}only[^.]{0,160}(dogfood|prerequisite)[^.]{0,160}(in this repo(sitory)?|occur in this repo(sitory)?)' <<<"$compact" \
    || { echo "dated record does not replace only the in-repository prerequisite"; return 1; }

  binding="$(spec_section '^## .*[Bb]inding [Ss]ources')"
  grep -qF 'docs/specs/control-plane-vision.md' <<<"$binding" \
    || { echo "P1a spec does not defer to the governing control-plane record"; return 1; }
  grep -qiE '^Status:.*approved.*P1a' "$SPEC" \
    || { echo "P1a planning is not approved after the locality exception"; return 1; }
  if grep -qF '2026-08-10' "$SPEC"; then
    echo "P1a spec duplicates the governing gate rationale"
    return 1
  fi

  # Limit the ownership scan to P1a planning docs; pointer-only references lack
  # the combined gate-reopening and repository-locality rationale.
  while IFS= read -r planning; do
    [ "$planning" = "$VISION" ] && continue
    if ! awk '
      BEGIN { RS = "" }
      {
        paragraph = tolower($0)
        if (paragraph ~ /reopen[a-z]*/ &&
            paragraph ~ /p1a/ &&
            paragraph ~ /gate/ &&
            paragraph ~ /(dogfood|prerequisite)/ &&
            paragraph ~ /(repo(sitory)?|localit)/) {
          exit 1
        }
      }
    ' "$planning"; then
      echo "P1a gate locality rationale appears outside the governing vision"
      return 1
    fi
  done < <(grep -ilF 'P1a' "$REPO"/docs/specs/*.md)
}
