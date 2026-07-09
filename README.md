# jeff

> Nothing leaves the kitchen until Jeff says so.

![jeff](assets/jeff.png)

Meet your new sous chef. The brigade quivers; Jeff delivers.

You run the kitchen: you call the order, you get the last word. Jeff works the
pass: takes the order, fires the line, holds the standard, lets nothing out
until it's worthy. A plan, a failing test, the smallest change to green, a
refactor, an independent review, an audit when the dish calls for it. The cooks
answer to him; he answers to you, Chef.

## The brigade

You give the order. Jeff runs it down the line, one specialist to a station,
and brings back the plate only when it's worthy.

```
Capture > Plan > Test > Implement > Refactor > Review > (Audit) > Done
```

- **Capture:** Jeff pins the order down with you: what *done* means, what's out
  of scope, before a pan gets hot.
- **Plan:** the approach and the test design: what to prove, and where, traced
  to your acceptance criteria.
- **Test:** the tests go on the line first, all red. On purpose.
- **Implement:** the smallest change that turns them green. Nothing fancier.
- **Refactor:** tidy the station while the tests stay green: simpler, deduped,
  up to standard.
- **Review:** a fresh cook who never touched the dish checks it against your
  standard.
- **Audit:** when the dish is risky, a security pass before it leaves.
- **Done:** only when the full suite is green and the order is met. Not "should
  work." Does work.

Every station is a fresh cook: no one works off a half-remembered chat. The cook
who plated a dish never reviews it, and the palate on the pass outranks the one
on the line. When review and the line can't agree, Jeff calls a tasting: three
palates, blind, two to sustain or the plate goes back. Nothing leaves the
kitchen until it's worthy, and the last word is always yours, Chef.

Full method in [AGENTS.md](AGENTS.md).

## Install

### Pi

```
pi install npm:jeff
```

To pin a release, include the semver version:

```
pi install npm:jeff@X.Y.Z
```

For dev/edge installs from the live repository:

```
pi install git:github.com/johanthoren/jeff
```

### Claude Code

```
/plugin marketplace add johanthoren/jeff
/plugin install jeff@jeff
```

## Set up

Activate Jeff per repo, once. Two modes:

- **Full:** your own repo. "Jeff, set up here." The task registry lives in a
  committed `.jeff/`, and the full pipeline runs with its registry checks.
  (`cook init`.)
- **Lite:** a shared or public repo whose work already lives elsewhere, in
  GitHub issues or a plan file. "Jeff, set up lite here." The registry stays
  local and git-excluded; your tracker owns the work. Adopt an issue with
  "Jeff, work issue #42." (`cook lite`, then `cook on #42`.)

## Use

Just say what you want done. "Add rate limiting to the upload endpoint." "Chef,
I've found a bug in the parser." He takes it from there: confirms the order with
you, then runs it down the line. Open with "Chef," or "Jeff," or just the work;
intent is the trigger, not a command.

Re-fire until it's worthy.

---

Prefer plain talk? Set your voice once with the `JEFF_FLAVOR` environment
variable (`plain` or `kitchen`); it applies to every jeff repo. A per-repo
`"flavor"` in `.jeff/config.json` overrides it. Precedence: a live in-chat
request > per-repo `flavor` > `JEFF_FLAVOR` > the default kitchen voice. Either
way the work is identical.
