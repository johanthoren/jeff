# Capture interview

Read this at the start of every Jeff-run `capture`. It does not apply to
Explore, Remember, or Record-pending. No schema or validator change. Capture
still writes category, ACs, and non-goals. It locks only the confirmed now
increment.

Influence (ideas only, no vendored files): Matt Pocock's grilling design-tree
and recommended-answer discipline, and his project glossary / ADR split. See
`NOTICE`. Jeff keeps one question at a time and the host ask tool when it
is available. It does not batch the frontier.

## Interview

Keep an internal design tree of unsettled decisions. The frontier is every
question whose prerequisites are already settled. Ask only the next frontier
question. Dependent questions wait.

One question at a time. Use the host ask tool when it is available: Cursor
`AskQuestion`, Claude Code `AskUserQuestion`, Codex `request_user_input`,
Grok Build `ask_user_question`, Oh My Pi `ask`. Short options, one
recommended answer, grounder first. If that tool is not available this
turn, ask the same shape in chat. Never a bundled questionnaire.

Give a recommended answer unless two options are genuinely tied and nothing in
the Chef's stated prefs, this repo, or the locked task so far breaks the tie.
Try to always pick. When you skip a recommendation, say that it is a true tie.

Keep the existing capture push-back: does this need to exist, is it speculative,
does a bug hit users or risk a security or data-loss incident, and is the gap
knowledge/instruction rather than a missing capability? Apply the fake-edge
test.

Stay on goals and outcomes unless you label a question increment-bounded.
Destination answers are welcome and default; translate them onto increments.

Two phases live inside this one capture stage.

**Phase A** records destination decisions. Phase A does not lock a task.

**Phase B** reads the live graph, files the destination onto existing or new
nodes, and states now versus later in product language. File later work as
pending siblings. Retarget existing nodes. Do not recreate or renumber the
graph.

Always stop for one confirm of that outcome split, not the topology. If now is
the whole ask, the confirm is one line. Do not present a Chef-facing graph or
DAG. After confirm, lock only the now slice.

## `task.md`

Write the usual Goal, Category, Acceptance criteria, Non-goals, and Audit
sections. Also write:

- **Locked decisions:** settled design calls the lanes must not re-open.
- **Rejected branches:** options considered and refused, with one line why.

Those two sections are the durable design tree. Plan and later stages read
them. They are not a glossary.

## Project glossary and ADRs

`CONTEXT.md` at the repo root is a project glossary. Terms only. No
implementation, no spec, no task ACs. It is not
`.jeff/tasks/<dir>/context.md` (that file stays the optional facts-only repo
map that plan owns).

`docs/adr/` holds architecture decision records. Write an ADR only when all
three are true:

1. Hard to reverse: changing your mind later is costly.
2. Surprising later: a future reader will wonder why it is this way.
3. A real trade-off: genuine alternatives, picked for named reasons.

Skip the ADR if any test fails. Glossary the term instead when it is only
vocabulary.

Create `CONTEXT.md` or `docs/adr/` only when the first term or ADR is actually
owed. Do not scaffold empty files.

**Who writes.** Only capture, and only before any `cook all` lane starts. Plan,
implement, refactor, execute, review, verify, audit, refute, and council never
edit `CONTEXT.md` or `docs/adr/`. A term discovered mid-drain is a note or
follow-up, not a shared-file edit.

### Full mode

When a term or ADR is owed, create or update the files.

### Lite mode

Never introduce the convention silently. The first capture that would write a
term or ADR asks once, via the host ask tool when it is available,
whether to create `CONTEXT.md` /
`docs/adr/`. After yes, maintain them under existing write-back consent. After
no, do not create them later in this repo unless the Chef reverses that.
Existing files are updates, not creates: still honor write-back consent.

## Glossary shape

```markdown
# Domain

## Glossary

### Term

One or two sentences. Ubiquitous language. No file paths, APIs, or tickets.
```

Challenge a Chef term that conflicts with the glossary. Sharpen overloaded
words before they land in ACs.

## ADR shape

```markdown
# <decision>

- Status: accepted
- Date: YYYY-MM-DD

## Context

What forced the choice.

## Decision

What we picked.

## Consequences

What we accepted.

## Rejected

What we did not pick, and why.
```

Filename: `docs/adr/NNNN-slug.md`, next integer in that directory.
