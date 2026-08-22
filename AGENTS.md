# AGENTS.md: jeff

**jeff** is a model-native quality control plane, distributed as **Claude Code, Codex, and Cursor plugins** and a **Pi package**. **Grok Build** consumes the Claude Code-compatible plugin surface directly. The *method* is the product, not a runtime: a thin orchestrator drives atomic tasks through fresh specialist contexts, with enforced separation, durable evidence, and deterministic gates. It is a cooperative workflow protocol for one trusted Chef and friendly frontier agents, not a security sandbox; host tool isolation is not a cross-host invariant.

Claude Code, Codex, Cursor, Grok Build, and Pi are first-class hosts over the same
method and checked core; Oh My Pi installs the Pi package and uses its dispatch
bridge. Grok Build is the coding client, while Grok is also a model family
alongside Claude and GPT. Host mechanics differ; the method semantics stay
shared.

Jeff 6.0 adds Graph Engineering at the work layer: fake-edge decomposition,
task-DAG ready sets and atomic claims, isolated parallel lanes, facts-only
context packets, write-ahead journaling, typed targeted repair,
evidence-scaled convergence, and a versioned read-only projection. The
implementation record and adjacent-system survey live in the
[6.0 Graph Engineering slate](https://github.com/johanthoren/jeff/blob/main/docs/specs/graph-slate-6.0.md).

- Design spec: `docs/specs/jeff-design.md`
- State schema: `skills/cook/reference/jeff-state-schema.md`
- Operational procedure: `skills/cook/SKILL.md`
- Voice/persona canon: `docs/brand.md`

**Before changing the system itself** (the method, skills, agents, validator, dispatch policy), read `docs/maintaining-jeff.md`: the maintenance and model-drift stance. It is written to the maintainer; read it as the maintainer's delegate, and surface to the Chef any call that rests on the Chef's own experience or judgment rather than making it alone.

## Model expectation

jeff is built for a frontier-tier model: Claude Opus 5, GPT-5.6 Sol, Grok 4.5, or a successor of that class. That is a design target, not a gate. The harness assumes that tier's judgment and carries no scaffolding to prop up less.

jeff never detects, checks, or refuses a model. There is no capability probe, no allowlist, and no refusal path anywhere in the method, and a weaker model may still run the whole pipeline.

Below the tier, judgment degrades before mechanism. The first things to slip are finding classification (blocking vs follow-up), drift out of a stage's strict return contract, and refute calibration. The mechanical gates keep holding, because they are checked rather than trusted: `cook validate`, the done-gate, builder/judge separation, and the single full-suite run are enforced against recorded state, not taken on a specialist's word.

Re-thickening the harness so a weaker model can carry the judgment is not a maintenance goal. Model drift runs the other way here; see `docs/maintaining-jeff.md`, which asks what a stronger model lets us delete next.

## The kitchen (persona)

jeff ships with a kitchen persona. The voice is a render layer over a fixed substrate, never a change to it. The roles (Chef, Jeff, the brigade), the flavor toggle and its precedence, the substrate-first rule, the Chef-facing grounder, and the assess→fork gate before the first durable write are owned by `skills/cook/SKILL.md` (§The kitchen, §Entry), the surface every host loads. Canonical voice spec: `docs/brand.md`.

## Repo = the package

```
.claude-plugin/plugin.json        # Claude Code manifest
.cursor-plugin/plugin.json        # Cursor manifest
.claude-plugin/marketplace.json   # Claude Code self-marketplace for `/plugin install`
package.json                      # Pi package manifest (`pi.extensions`, `pi.skills`)
src/pi/                           # Pi extension + role-session dispatch bridge
src/core/                         # authoritative checked-JS schema + validation core
src/cli/cook.js                   # host-neutral checked-JS CLI entry
skills/cook/SKILL.md              # the loop + ambient entry
agents/cook-*.md                  # dispatched specialists: plan, implement, refactor, execute, review, verify, audit, refute
.jeff/                            # THIS project's task state (each project carries its own)
docs/specs/                       # design rationale
```

## The method (how the system works)

A task locks `category` at capture by its primary outcome. `code` is the default for historical omission and keeps `capture → plan → implement → conditional refactor → review → conditional audit → done`. `operation` is only for a bounded state transition whose acceptance criteria are postconditions; it uses `capture → plan → execute → verify → conditional audit → done`. Incidental code or configuration edits do not change the category. Each active stage is a separate specialist in a fresh context.

**Verification protocol.** Code tasks keep the full test protocol in `skills/cook/SKILL.md`: stages run targeted tests, then Jeff runs the full suite exactly once after the last code-changing stage. Operation tasks do not manufacture tests or code review. Their plan declares deterministic verification methods and, when needed, an exact operator-facing approval boundary. `skills/cook/reference/operations.md` owns the approval, execution, and independent verification sequence.

## Iron rules (non-advisory)

1. **Thin orchestrator.** Route + transcribe; never self-judge; never override a `needs-work`. Every judgment happens in a fresh specialist context. Only `capture` is orchestrator-led; every other active stage is dispatched.
2. **Separation.** The party that builds a thing never signs it off. The binding identity invariants for both categories are owned by `skills/cook/reference/jeff-state-schema.md` (separation invariants) and enforced by `cook validate`.
3. **Model is the orchestrator's judgment; effort is host-native.** Specialist model selection follows the dispatch rules owned by `skills/cook/SKILL.md` (§Dispatch), default inherit. Pi and Claude Code apply role-frontmatter effort where supported; Grok Build consumes the Claude Code-compatible agent definitions through its native subagent runtime; Codex inherits orchestrator effort. The settled per-stage values are owned by `agents/cook-*.md` frontmatter.
4. **State on disk.** Write `.jeff/**` as plain files. `cook validate` gates (orchestrator before each commit; CI on push). No external state service.
5. **Git.** Unverified task work never reaches trunk, and a completed task lands there as one green task commit. The gate order, the checkpoint contract, the commit-message shape, the `complexity` call, and the mode-specific terminal are owned by `skills/cook/SKILL.md` (§Git).
6. **Standards.** jeff's bundled first-party skills are the portable baseline quality floor for all code, and no third-party skill or built-in tool drives behavior. The floor and its override precedence are owned by `skills/cook/SKILL.md` (§Standards).
7. **Convergence.** Code `review`/`audit` and operation `verify`/`audit` reuse one bounded convergence mechanism: self-classified findings, a source-bound refute per blocker, a per-source cap, one task-wide council, and at most one scoped recovery cycle. The exact counts, membership, and terminal outcomes are owned by `skills/cook/SKILL.md` (§Council, §Kickbacks).

## Contributing to jeff itself

- `src/cli/cook.js` is the sole operational CLI. Keep host-specific launch and result collection under their host adapters, outside `src/core/` and `src/cli/`.
- Follow semver and consider a version cut for every user-visible shipped payload or behavior change. Task boundaries are not automatically release boundaries: before a major, inspect the immediate accepted roadmap and, when coherent and safe, consolidate adjacent known breaking changes rather than publish rapidly successive majors. Escalate commercial, marketing, model-number, and platform-contract significance to the Chef. Keep the horizon bounded; never create an open-ended release train or delay an urgent independent safety fix. Published versions and tags are immutable, and every subsequent release still obeys semver. Prefer landing the version bump in the same commit as the releasable change; use a separate bump-only commit only for catch-up or release metadata cleanup. Do not bump for README-only/docs-only churn unless those docs are the released payload.
- Skills and agents are prose. Keep them tight: frontier models supply the craft; the briefs convey role, separation, output contract, and which standards to honor.
