#!/usr/bin/env bats
# tests/control-plane-tui-shape.bats: task #174 — lock standalone TUI client shape.
#
# Covers (see .jeff/tasks/lite-174-2740666983/task.md):
#   AC1: vision locked decisions, §6.3/§6.4, phases, open questions:
#        standalone-first, backlog naming, late Ratatui composition
#   AC2: handoff decided list, startable work, next design-spec deliverable
#        bias to jeff graph (P1a) alone
#   AC3: three-card layout only as optional late combined sketch, not P1
#
# Seam: control-plane vision + handoff prose IS the architecture product.
# Operators and successor agents observe these docs as the locked client shape;
# there is no second runtime seam. Marker discipline matches payload-hygiene
# #117: command names, phase ids, and decision tokens that survive rewording.
#
# Parallel-safe: read-only greps over fixed repo paths; no network/clock/FS writes.
# RED now against the 2026-08-02 three-card-first baseline.

REPO="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
load test_helper
setup_file() { cook_hermetic_git; }

VISION="$REPO/docs/specs/control-plane-vision.md"
HANDOFF="$REPO/docs/specs/control-plane-handoff.md"

vision_section() {
  # Extract from a heading through the line before the next same-or-higher heading.
  # $1 = awk regex for the opening heading line (e.g. '^## 4\. ').
  awk -v re="$1" '
    $0 ~ re { in_section = 1; print; next }
    in_section && /^#{1,2} / { exit }
    in_section { print }
  ' "$VISION"
}

handoff_section() {
  awk -v re="$1" '
    $0 ~ re { in_section = 1; print; next }
    in_section && /^#{1,2} / { exit }
    in_section { print }
  ' "$HANDOFF"
}

# ---------------------------------------------------------------------------
# AC1: vision locks standalone-first client verbs and backlog naming
# ---------------------------------------------------------------------------

@test "#174 AC1: vision names jeff graph and jeff backlog as standalone TUI verbs" {
  # Consumer-observable: locked client shape ships as standalone full-screen
  # verbs, graph first then backlog. Baseline has neither command token.
  grep -qF 'jeff graph' "$VISION" \
    || { echo "vision does not name jeff graph"; return 1; }
  grep -qF 'jeff backlog' "$VISION" \
    || { echo "vision does not name jeff backlog"; return 1; }
  grep -qiE 'standalone' "$VISION" \
    || { echo "vision does not mention standalone client shape"; return 1; }
}

@test "#174 AC1: vision locked decisions prefer standalone TUIs before combined shell" {
  local section compact
  section="$(vision_section '^## 4\. ')"
  [ -n "$section" ] || { echo "vision §4 locked decisions missing"; return 1; }
  compact="$(tr '\n' ' ' <<<"$section")"

  # Standalone-first must appear in the locked table, not only elsewhere.
  grep -qiE 'standalone' <<<"$compact" \
    || { echo "§4 does not lock standalone client shape"; return 1; }
  grep -qF 'jeff graph' <<<"$compact" \
    || { echo "§4 does not lock jeff graph"; return 1; }
  grep -qF 'jeff backlog' <<<"$compact" \
    || { echo "§4 does not lock jeff backlog"; return 1; }

  # Second operator TUI is backlog; locked decisions must not brand it solely
  # as the inbox product name.
  if grep -qiE '\|[[:space:]]*Layout[[:space:]]*\|[^\n]*[Ii]nbox' <<<"$section"; then
    echo "§4 Layout row still brands the client around inbox"
    return 1
  fi
}

@test "#174 AC1: vision §6.3/§6.4 describe standalone graph then backlog, late composition" {
  local tui cli compact
  tui="$(vision_section '^### 6\.3 ')"
  cli="$(vision_section '^### 6\.4 ')"
  [ -n "$tui" ] || { echo "vision §6.3 missing"; return 1; }
  [ -n "$cli" ] || { echo "vision §6.4 missing"; return 1; }
  compact="$(tr '\n' ' ' <<<"$tui $cli")"

  grep -qF 'jeff graph' <<<"$compact" \
    || { echo "§6.3/§6.4 omit jeff graph"; return 1; }
  grep -qF 'jeff backlog' <<<"$compact" \
    || { echo "§6.3/§6.4 omit jeff backlog"; return 1; }
  grep -qiE 'standalone' <<<"$compact" \
    || { echo "§6.3/§6.4 omit standalone"; return 1; }

  # Kitty composition valid early; Ratatui multi-pane composition is late.
  grep -qiE '[Kk]itty' <<<"$compact" \
    || { echo "§6.3/§6.4 omit Kitty composition path"; return 1; }
  grep -qiE '([Rr]atatui[^.]{0,80}compos)|compos[^.]{0,80}[Rr]atatui|late[^.]{0,40}compos|compos[^.]{0,40}later' <<<"$compact" \
    || { echo "§6.3/§6.4 do not defer Ratatui composition"; return 1; }
}

@test "#174 AC1: vision phases put P1a standalone graph before combined client" {
  local section
  section="$(vision_section '^## 16\. ')"
  [ -n "$section" ] || { echo "vision §16 phases missing"; return 1; }

  grep -qE '\|[[:space:]]*P1a[[:space:]]*\|' <<<"$section" \
    || { echo "§16 has no P1a phase row"; return 1; }
  grep -qiE 'P1a[^|]{0,120}(jeff graph|graph)|standalone[^|]{0,80}graph|graph[^|]{0,80}standalone' <<<"$section" \
    || { echo "§16 P1a is not standalone graph"; return 1; }

  # Combined / multi-pane shell must not be the first client ship phase.
  if grep -qiE '\|[[:space:]]*P1[[:space:]]*\|[^|]*(three[[:space:]-]?cards?|combined)' <<<"$section"; then
    echo "§16 still ships three-card/combined as P1"
    return 1
  fi
}

@test "#174 AC1: vision open questions reflect standalone-first and late composition" {
  local section compact
  section="$(vision_section '^## 17\. ')"
  [ -n "$section" ] || { echo "vision §17 open questions missing"; return 1; }
  compact="$(tr '\n' ' ' <<<"$section")"

  # Product intent is settled: standalone first, combined/Ratatui composition late.
  # §17 must not leave three-card-first as the implied default; it should either
  # drop layout-as-open or frame combined multi-pane composition as optional/late.
  grep -qiE 'standalone|jeff graph|jeff backlog|compos|combined|three[[:space:]-]?cards?' <<<"$compact" \
    || { echo "§17 never mentions client shape / composition after the lock"; return 1; }

  # Positive lock: composition or combined shell is optional, late, or open only
  # as taste after standalone ships — not an unresolved "what is v1 layout".
  grep -qiE \
    '(optional|later|late)[^.]{0,80}(compos|combined|three[[:space:]-]?cards?|multi-?pane)|(compos|combined|three[[:space:]-]?cards?|multi-?pane)[^.]{0,80}(optional|later|late)|standalone[^.]{0,80}(first|before)|P1a' \
    <<<"$compact" \
    || { echo "§17 lacks standalone-first / late-composition framing"; return 1; }

  if grep -qiE 'three[[:space:]-]?cards?[^.]{0,80}(default|first|P1|required)|by default[^.]{0,40}three[[:space:]-]?cards?' <<<"$section"; then
    echo "§17 still presents three-card as the default first layout"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# AC2: handoff decided list and next deliverable bias jeff graph alone
# ---------------------------------------------------------------------------

@test "#174 AC2: handoff decided list locks standalone TUIs first" {
  local section compact
  section="$(handoff_section '^## 2\. ')"
  [ -n "$section" ] || { echo "handoff §2 decided list missing"; return 1; }
  compact="$(tr '\n' ' ' <<<"$section")"

  grep -qiE 'standalone' <<<"$compact" \
    || { echo "handoff §2 omits standalone TUIs"; return 1; }
  grep -qF 'jeff graph' <<<"$compact" \
    || { echo "handoff §2 omits jeff graph"; return 1; }
  grep -qF 'jeff backlog' <<<"$compact" \
    || { echo "handoff §2 omits jeff backlog"; return 1; }

  # Locked decisions must not present three-card as the required first layout.
  if grep -qiE '\*\*Layout:\*\*[[:space:]]*three[[:space:]-]?cards?' <<<"$section"; then
    echo "handoff §2 still locks three-card as the layout decision"
    return 1
  fi
}

@test "#174 AC2: handoff startable work and next deliverable bias jeff graph (P1a) alone" {
  local dep next compact
  dep="$(handoff_section '^## 3\. ')"
  next="$(handoff_section '^## 5\. ')"
  [ -n "$dep" ] || { echo "handoff §3 dependency state missing"; return 1; }
  [ -n "$next" ] || { echo "handoff §5 next deliverable missing"; return 1; }
  compact="$(tr '\n' ' ' <<<"$dep $next")"

  grep -qF 'jeff graph' <<<"$compact" \
    || { echo "handoff startable/next omits jeff graph"; return 1; }
  grep -qiE 'P1a' <<<"$compact" \
    || { echo "handoff startable/next omits P1a"; return 1; }

  # Next design-spec deliverable must bias the graph verb alone, not the full
  # three-card / inbox-combined shell up front.
  grep -qiE 'jeff graph|graph TUI|standalone graph' <<<"$next" \
    || { echo "handoff §5 does not bias the next deliverable to graph alone"; return 1; }
  if grep -qiE 'three[[:space:]-]?cards?|viewport math for the graph pane' <<<"$next" \
    && ! grep -qiE 'optional|later|late|not first|P1a' <<<"$next"; then
    echo "handoff §5 still scopes the first design spec as full combined graph pane"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# AC3: three-card only optional late; backlog not inbox-branded as second TUI
# ---------------------------------------------------------------------------

@test "#174 AC3: three-card is optional late combined sketch, not first-ship requirement" {
  # Across vision + handoff: if three-card language remains, it must be framed
  # as optional / late / combined, never as the P1 or default first ship.
  local hits
  hits="$(grep -nEi 'three[[:space:]-]?cards?' "$VISION" "$HANDOFF" || true)"
  [ -n "$hits" ] || {
    # Absence is acceptable (sketch dropped entirely).
    return 0
  }

  # Every remaining hit must sit near optional/late/combined framing on the
  # same line or be outside locked-first-ship rows. Fail closed on locked
  # first-ship phrasings that the baseline still uses.
  if grep -nEi \
    'Three cards by default|Layout \(2026-08-02 follow-up\)[[:space:]]*\|[[:space:]]*Three cards|\*\*Layout:\*\*[[:space:]]*three[[:space:]-]?cards?' \
    "$VISION" "$HANDOFF"; then
    echo "three-card remains a first-ship / default locked requirement"
    return 1
  fi
}

@test "#174 AC3: locked decisions use backlog language for the second TUI verb" {
  # Operator-facing second TUI is backlog. Disk .jeff/inbox/ may remain later
  # plumbing; locked client-shape decisions must name backlog, not brand the
  # second TUI solely as inbox.
  local vision_locked handoff_decided
  vision_locked="$(vision_section '^## 4\. ')"
  handoff_decided="$(handoff_section '^## 2\. ')"

  grep -qF 'jeff backlog' <<<"$vision_locked"$'\n'"$handoff_decided" \
    || { echo "locked decisions omit jeff backlog"; return 1; }

  # Fail if the only second-surface product name in locked client rows is inbox.
  if grep -qiE 'second TUI|second verb|client shape|standalone TUI' <<<"$vision_locked"$'\n'"$handoff_decided"; then
    grep -qiE 'backlog' <<<"$vision_locked"$'\n'"$handoff_decided" \
      || { echo "client-shape lock mentions second TUI without backlog naming"; return 1; }
  fi
}
