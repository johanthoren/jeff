# jeff

> Nothing leaves the kitchen until Jeff says so.

![jeff](assets/jeff.png)

Meet your new sous chef. The brigade quivers; Jeff delivers.

Jeff is a **model-native quality control plane** for software work. Fresh
specialist contexts carry each stage; enforced separation keeps builders from
signing off their own work; durable evidence records what happened; and
deterministic gates decide whether the plate can leave the pass.

You run the kitchen: you call the order, you get the last word. Jeff works the
pass: takes the order, fires the line, holds the standard, lets nothing out
until it's worthy. A plan, a failing test, the smallest change to green. A
named plan opportunity or surviving review/audit finding can owe refactor; an
older plan without an explicit disposition conservatively owes it. Then an
independent review, and an audit when the dish calls for it. The cooks answer
to him; he answers to you, Chef.

## The brigade

You give the order. Jeff runs it down the line, one specialist to a station,
and brings back the plate only when it's worthy.

```
Capture > Plan + Tests > Implement > (Refactor if owed) > Review > (Audit if risky) > Done
```

- **Capture:** Jeff pins the order down with you: what *done* means, what's out
  of scope, before a pan gets hot.
- **Plan + tests:** one fresh cook designs the approach and proof, then puts the
  tests on the line first, all red. On purpose.
- **Implement:** the smallest change that turns them green. Nothing fancier.
- **Refactor:** a named plan opportunity or surviving review/audit finding can
  owe refactor; an older plan without an explicit disposition conservatively
  owes it. Tidy the station while the tests stay green: simpler, deduped, up to
  standard.
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

**Model-era stamp (July 2026):** current dogfood runs on GPT-5.6 Sol. That is
execution evidence, not a compatibility floor, routing rule, alias, or fallback.

Full method in [AGENTS.md](AGENTS.md).

## Install

Jeff is one versioned package with separate host install paths. Its operational
commands run through the bundled Node CLI and require no `jq`. The Pi install
also brings the dispatch SDK used when the host does not inject `pi.pi`.
Node.js `>=22.19.0` is required by the bundled Pi dispatch SDK.

### Pi — recommended stable path

Use the npm package for normal Pi installs. This gives you semver releases.

```
pi install npm:@johanthoren/jeff
```

Update the stable package with the same source id:

```
pi update npm:@johanthoren/jeff
```

To pin a release:

```
pi install npm:@johanthoren/jeff@X.Y.Z
```

For dogfooding or dev/edge installs from the live repository:

```
pi install git:github.com/johanthoren/jeff
```

Use the git path only when you intentionally want latest commit behavior instead
of a stable release.

### Oh My Pi

Install the same npm package through OMP's plugin command:

```
omp plugin install @johanthoren/jeff
```

Jeff specialists inherit the exact active model and only their stage tools. They
do not inherit OMP orchestration, extensions, custom or MCP tools, advisor,
memory/autolearn, or model fallback behavior.

### Claude Code — recommended path

Use Claude Code's plugin CLI flow:

```
claude plugin marketplace add johanthoren/jeff
claude plugin install jeff@jeff
```

Update the installed plugin, then restart Claude Code:

```
claude plugin update jeff@jeff
```

### Codex — recommended path

Add the Git marketplace, then install Jeff:

```
codex plugin marketplace add johanthoren/jeff
codex plugin add jeff@jeff
```

To update, refresh the marketplace snapshot and reinstall:

```
codex plugin marketplace upgrade jeff
codex plugin add jeff@jeff
```

Restart Codex Desktop and start a new task so it loads the updated skills.

Plain `npm install @johanthoren/jeff` only downloads the artifact into
`node_modules`; it does not activate Jeff in Pi, Claude Code, or Codex.

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

Just say what you want done. In an active project, the normal host agent handles
ordinary intent as ad hoc work in the current context under your usual project
instructions, with no task or specialist. Experiment freely, then choose what
deserves durability:

- **Explore:** keep quick, reversible work in the current context.
- **Remember:** preserve a finding without creating work. Full mode uses
  `.jeff/memory/`; elsewhere Jeff prefers a suitable existing tracked memory,
  decisions, learnings, or handoff file, then falls back to local
  `.jeff/memory/`.
- **Record:** create pending future work without starting it. In lite mode, the
  external item is also registered as an idempotent local pending ledger; this
  is adoption for bookkeeping, not execution.
- **Start:** explicitly ask Jeff to begin capture on a recorded item and run it
  through the pipeline.

Jeff suggests tracking only when a meaningful obligation emerges, and explains
what to track, why structure helps, and how to record or start it. Recording and
starting are separate choices. Once tracked work starts, Jeff becomes the thin
orchestrator and every quality gate above still applies.

Re-fire until it's worthy.

---

Prefer plain talk? Set your voice once with the `JEFF_FLAVOR` environment
variable (`plain` or `kitchen`); it applies to every jeff repo. A per-repo
`"flavor"` in `.jeff/config.json` overrides it. Precedence: a live in-chat
request > per-repo `flavor` > `JEFF_FLAVOR` > the default kitchen voice. Either
way the work is identical.
