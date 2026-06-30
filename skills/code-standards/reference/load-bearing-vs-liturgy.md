# Load-bearing vs liturgy: keep or cut

Read this when deciding whether to keep, shrink, or remove any part of a system
you build or maintain: a process step (a stage, gate, test, review), a mechanism
(a guardrail, permission, config), a doc, a ritual. The test is the same for all
of them; the development process is just where you'll meet it most.

## The test

A step is **load-bearing** if it produces a protective outcome: prevents data
loss, closes a security hole, or catches a wrong result before it ships
(including catching a premature "done"). It is **liturgy** if it produces none of
those here and only resembles rigor.

To drop a step, do both:

1. **Name the outcome it protects**, in one sentence. "This audit catches a
   path-escape before it reaches a shared repo." If you can't name one, you don't
   understand the step yet: keep it.
2. **Show the step isn't needed here.** Any of: another step already guarantees
   the outcome; this task can't trigger the failure; or the conditions it guarded
   against are gone (the world moved, and a weaker-era guardrail is outliving its
   era; see design-for-deletion). The last is the strongest claim and needs the
   most proof: name the specific change, don't assert it, and treat era-scoped
   retirement as a deliberate maintenance call, not a casual in-task cut. If none
   holds, keep the step.

Name the outcome and show the step isn't needed, and it's liturgy here. Cut it.

## Why this is hard for an agent

Models tend to push toward completing the task and toward output that looks
thorough. Those pulls run in opposite directions:

- **Over-cutting steering.** Tests, independent review, and the done-gate stand
  between you and "done," so the pull toward completion treats them as obstacles
  ("the code obviously works").
- **Over-keeping liturgy.** Ceremony pattern-matches as rigor, so the pull toward
  thorough-looking output keeps rituals that protect nothing.

Weight against both: raise the bar to cut verification, lower it to cut ceremony.
An assessment that the work is "done," or that a step "looks rigorous," comes from
the same tendency and is not evidence. Decide on a named, defensible outcome, not
on apparent sufficiency.

## "Here" is the whole point

A step is liturgy *in this task*, not forever, and load-bearing elsewhere. Judge
the step against the task in front of you, every time.

## Worked examples

- **Refactor stage on a 5-line markdown doc → liturgy here.** Refactor protects
  "dedup and regression-proof a substantive code change." Prose has nothing to
  dedup and no behavior to regress. Named, absent: cut.
- **A doc that makes claims about the code → verify it, always.** Incorrect
  documentation is a bug (OpenBSD). When a change touches docs that describe the
  system, the outcome "the claims are true against the code as it stands now" is
  at risk by definition. "It's only markdown" does not make it safe. (Refactoring
  prose for style is liturgy; verifying its claims is load-bearing.)
- **Audit stage on a remote-touching handoff → load-bearing.** It protects "catch
  a path-escape, an arbitrary write, or a push to a protected base before it
  reaches a shared repo." That task can trigger all three; the audit found four
  live ones. Named, at-risk: keep.
- **A guardrail built for a weaker-model era → retire it when the era ends.** The
  brain-tiering floors stopped a weak model from under-thinking a hard task. We
  run a strong model by default now, so the conditions they guarded are gone. Not
  a process step, and not "not at risk in this task" but "not at risk anymore."
  Named, world-changed: retire, deliberately.
- **Citing DRY/SRP/immutability in a standards doc → liturgy.** A citation
  protects "give the reader depth they lack to decide." The reader already has
  the canon; the citation changes no decision. (Depth the reader genuinely
  *lacks* goes in a reference file at the decision point, like this one.)
- **Tests before implement on a substantive change → load-bearing.** It protects
  "steer the work and catch a premature done." Always at risk for an agent. This
  is the step most often cut wrongly; don't.
