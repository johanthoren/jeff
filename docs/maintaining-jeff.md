# Maintaining jeff

Read this before changing the system itself: the method, the skills, the agents,
the validator, the dispatch policy. `code-standards` is the baseline for any code change
and `AGENTS.md` is the operating iron-rules; this is the slower layer they don't
carry: how jeff is meant to age, and the model-drift lens for deciding what
to add, keep, or retire.

## Maintenance is the work

The method is the product, and the interesting part is not the day it ships, it
is every day after. A deployed system decays by default: model eras shift,
conventions drift, the ground moves. Construction gets the credit; upkeep is
invisible until it fails, which is why it is the first thing deferred. Treat
upkeep as named work, not "if there's time." Working assumption for everything
here: **the system will outlive the assumptions it was built on.** Plan for them
to be falsified.

## jeff's pace layers

Durable systems are several layers that change at very different rates, loosely
coupled so each can move without tearing the others apart. Sort every part of
jeff by how its change is governed, fast to slow:

- **Output**: a task run and its ledger. Per-task, disposable.
- **Harness**: the skills, agents, prompts, and role settings. Reviewed per model-era;
  built for deletion.
- **Structure**: the validator's invariants, the task schema, stable ids.
  Changed only by recorded migration.
- **Foundation**: the quality guarantees: separation (the party that builds a
  thing does not sign it off), the done-gate, the inspectable evidence trail.
  Never relaxed to converge.

**The rule: never weld a fast layer into a slow one.** It is why task state lives
in its store and not in a model's memory, and why knowledge lives in files the
harness reasons over rather than baked into prompts. Bolt a fast-changing concern
into a slow-changing store and every small change becomes a demolition.

## Two drifts; watch model drift

A long-lived agent system is squeezed between two moving things. **World drift**
you already catch: products change, conventions move, a doc goes stale. **Model
drift** is the one that's missed: the model underneath improves, and the system
can break *because the model got better*. A harness that helped a weaker model
holds back a stronger one (under-use); a permission that was harmless for a weaker
model lets a stronger, more proactive one take many plausible-but-wrong actions
before you can intervene (over-reach).

Treat this as a **lens, not a cadence.** There is no scheduled review here. When
you move to a new model and feel the harness fighting it, or notice it could now
do more than the harness allows, re-right-size it then. The signal is your own
experience with the new model, not a calendar.

## Design for deletion

The beginner instinct is to add; the maintenance instinct is to ask what to
remove. Subtraction is a first-class move, not a tidy-up. Two habits make later
deletion possible:

- **Keep swap points thin.** Decide where a future replacement would cut in and
  keep that boundary small (the plan-store adapter seam, the validator's mode
  gate). You can then replace a layer without demolishing its neighbors.
- **Inspectable over clever.** One simple form anyone can read and fix beats five
  clever ones nobody dares touch, and is what lets a future maintainer, or a
  future model, cut a layer safely.

For anything you build or touch, keep asking: **what will a stronger model let you
delete later?**

## Model-stamp model-conditional decisions

When a choice rests on how the current model behaves, record the model alongside
it: "chose X on Opus 4.8, which tends to Y." A future reader then sees *why*,
given what that model did that a later one may not. This is the whole
model-assumptions apparatus reduced to one habit: a stamp in the task note,
commit, or memory, not a ledger to maintain.

## Plan releases across task boundaries

Task boundaries are not automatically release boundaries. Before cutting a major,
inspect the immediate accepted roadmap for adjacent known breaking changes. When
it is coherent and safe, consolidate them into one major instead of publishing
rapidly successive majors. Keep that horizon bounded: do not create an open-ended
release train or delay an urgent, independent safety fix.

A major number can carry commercial, marketing, model-number, or
platform-contract significance beyond API compatibility. Surface that judgment
to the Chef instead of making it alone. Once a version and tag are published,
they are immutable; subsequent changes ship under a new version that still obeys
semver.

## Our own history is the proof

jeff has already lived this. **forge → lean** shed a weaker-era harness once
the models no longer needed it; the **brain-ranking removal** retires a guardrail
built to stop a weak model under-thinking, now that a strong model is the default.
Those are model-drift maintenance: deleting machinery the era outgrew.

**Lite mode is a dashed line off that path, not the next step on it.** It is not
more weight shed for a stronger model; it is a *variant of working* for when
jeff runs inside a repo it does not own, where co-existence with the team's
conventions matters more than absolute adherence to the system. Different axis,
different reason.

---

The keep-or-cut call for any one part is the unit test in
`skills/code-standards/reference/load-bearing-vs-liturgy.md`; this doc is that
test applied at the system level, the deliberate maintenance-grade version.

Influences: Stewart Brand (pace layering, maintenance as design-for-reparability,
"all predictions are wrong"); the agent-specific application (the harness around
the model, breaking when the model improves, deletion as maintenance) after Nate
B Jones.
