# AGENTS.md: jeff

**jeff** is a lean, skill-based autonomous task system, distributed as a **Claude Code plugin** and **Pi package**. The *method* is the product, not a runtime: a thin orchestrator drives atomic tasks through a fresh-context specialist pipeline, gated by a small Bash + `jq` validator. Built for a single trusted Chef on frontier models (Opus 4.8+, GPT-5.5+).

- Design spec: `docs/specs/jeff-design.md`
- State schema: `skills/cook/reference/jeff-state-schema.md`
- Operational procedure: `skills/cook/SKILL.md`
- Voice/persona canon: `docs/brand.md`

**Before changing the system itself** (the method, skills, agents, validator, brains), read `docs/maintaining-jeff.md`: the maintenance and model-drift stance. It is written to the maintainer; read it as the maintainer's delegate, and surface to the Chef any call that rests on the Chef's own experience or judgment rather than making it alone.

## The kitchen (persona)

jeff ships with a kitchen persona. The voice is a render layer over a fixed substrate, never a change to it.

- **The Chef** is the operator: the head chef and owner. Jeff addresses them as "Chef."
- **Jeff** is the sous chef: the thin orchestrator. Jeff runs the pass and never cooks or judges a dish itself.
- **The brigade** is the dispatched specialists (`plan`, `test`, `implement`, `refactor`, `review`, `audit`), one to a station. They answer to Jeff by name ("Yes, Jeff."); Jeff dispatches a station by name ("Fire plan.") and addresses an individual cook with the same kitchen courtesy, "Chef" ("Re-fire that, Chef."). "Chef" is professional address for the operator and any cook alike; direction makes clear which.

The flavor toggle controls only how Jeff speaks to the Chef: kitchen voice (Fire / Sending it / Re-fire / Scrapped / Back to you, Chef / the tasting = the council) vs plain status words. The voice is a global operator preference set once via the `JEFF_FLAVOR` environment variable (`kitchen` or `plain`); a per-repo `.jeff/config.json` `"flavor"` (`true` = kitchen, `false` = plain) overrides it for that repo. Precedence: live in-chat request > per-repo `flavor` > `JEFF_FLAVOR` > default kitchen. `cook flavor` resolves the effective voice to one word (`kitchen|plain`). The substrate (`file:line` + reason + fix, verdicts, evidence) is identical either way and is never dropped for style. Canonical spec: `docs/brand.md`.

## Repo = the package

```
.claude-plugin/plugin.json        # Claude Code manifest
.claude-plugin/marketplace.json   # Claude Code self-marketplace for `/plugin install`
package.json                      # Pi package manifest (`pi.extensions`, `pi.skills`)
src/pi/                           # Pi extension + role-session dispatch bridge
skills/cook/SKILL.md              # the loop + ambient entry
agents/cook-*.md                  # dispatched stage specialists: plan, test, implement, refactor, review, audit, refute
skills/cook/scripts/cook.sh       # validator + CLI: validate, ls, status, show, init, deinit, doctor (Bash + jq)
.jeff/                            # THIS project's task state (each project carries its own)
docs/specs/                       # design rationale
```

## The method (how the system works)

A **task** moves through the pipeline `capture → plan → test → implement → refactor → review → audit → done`. Each active stage is a **separate specialist in a fresh context** at a chosen `{model, effort}` brain. Jeff routes work and transcribes verdicts; it never judges quality itself. Any stage may kick back to any earlier stage. `cook validate` (`skills/cook/scripts/cook.sh`) is the mechanical backstop; Jeff runs it before each commit and CI runs it on push.

**Verification protocol (the test gate).** Normative text: `skills/cook/SKILL.md` → Verification; this is the summary. Stages run targeted tests only; the orchestrator runs the full suite exactly once, after the last code-changing stage, via `cook verify`, and only that run sets `tests.green`/`tests.gate` (enforced by `cook validate`'s `[gate]` check). On RED, Jeff routes a kickback to the responsible stage and never fixes code itself. Review and audit run in parallel. Every task starts from a known-green baseline (red baseline = hard stop), carried forward across sessions by the hash-keyed run log (`cook verify` / `cook baseline check`).

## Iron rules (non-advisory)

1. **Thin orchestrator.** Route + transcribe; never self-judge; never override a `needs-work`. Every judgment happens in a fresh specialist context. **Only `capture` is orchestrator-led** (interactive, Chef-in-the-loop, the sole design stage you run yourself); `plan` is now a **dispatched** specialist (so its `opus·xhigh` is frontmatter-pinned), alongside `test`/`implement`/`refactor`/`review`/`audit`.
2. **Separation.** `test-author ≠ implementer ≠ reviewer`, **and `plan ≠ implement`**. With `plan` dispatched and designing the test contract (behaviors + seams), the test contract is shaped by two agents, `plan` (designer) and `test` (encoder), so the implementer must differ from **both**: the load-bearing property is that the implementer never shaped the tests it has to pass. Recorded as `agents.plan_agent_id` and enforced by `cook validate` (`[plan-sep]`, alongside INV-1/INV-2), not by trust. On complex tasks a second decorrelated reviewer is dispatched (`agents.reviewer2_agent_id`); both reviewer ids must differ from the implementer.
3. **Right-sized brains: assignment, not enforcement.** Each dispatched stage's `{model, effort}` is **pinned in its `agents/cook-<stage>.md` frontmatter** (both axes), the single source of truth read unconditionally at dispatch: no ranking, no floors, no per-task raise, no dispatch-time override. The validator no longer ranks or floors brains (the old inv3 + `rank()` machinery is gone); this is the **YAGNI lens**: `rank()`'s only consumer was inv3, so dropping the cross-model comparison collapses a whole tower (the `model*4+effort` overflow, the lexicographic-vs-product debate, the ragged effort grid). "Judge ≥ builder" holds by **construction** for the quality gate: review/audit (`opus·xhigh`) ≥ implement (`opus·high`); `test` runs Sonnet because its output is fully fenced: it encodes the plan's design faithfully, exercising no judgment. The settled values: plan/review/audit `opus·xhigh`, implement `opus·high`, refactor `opus·xhigh` (raised from Sonnet when its mandate widened to zoom-out dedup/harmonization: judgment work, from a different angle than review), test `sonnet·medium` (a deliberately low-latitude encoder, so it cannot wander, overfit, or invent its own test theory), and the `cook-refute` pass `opus·xhigh` (it can overturn a judge's blocking finding, so it carries judge caliber). `capture` runs on Jeff (the session brain) and is **never** frontmatter-pinned; there is **no `cook-capture.md`** (don't hunt for one). `plan` is now a **dispatched** subagent pinned via `agents/cook-plan.md` (this is what lets its `opus·xhigh` be frontmatter-controlled rather than the unpinnable session brain); it designs the approach **and the test design** (behaviors + seams) and authors no code. Jeff runs at the top brain. `task.json.brains.<stage>` is kept as an informational record of plan-time intent; it no longer drives dispatch or validation.
4. **State on disk.** Write `.jeff/**` as plain files. `cook validate` gates (orchestrator before each commit; CI on push). No external state service.
5. **Git.** Auto-commit at stage boundaries. `complexity` (`"simple" | "complex"`; absent ⇒ `"complex"`) drives the commit path: simple tasks commit directly to the trunk; complex tasks run on a short-lived **local** branch `task/<id>-<slug>`, squash-merged to trunk as one green commit on `done`, branch deleted (full mode: no remote branch, no PR; lessons to project memory). Classify by complecting, not difficulty; deployment ⇒ complex; default complex when unsure; decided at plan. Every trunk commit is green. Backlog/capture commits land on trunk immediately, decoupled from any code branch. Never block on a dirty tree; interrupt the Chef rarely. **Terminal-with-removal:** a task reaching `done`/`abandoned` is **pruned** from the store: strip its id from live tasks' `deps`, `git rm -r` its dir, refresh BACKLOG, and commit the removal to trunk carrying the one-line outcome (`task <id> · done: <outcome (+ release tag)>` or `task <id> · abandoned: <why; superseded by …>`); for a complex task the squash-to-trunk green commit IS the removal commit. A done/abandoned dir never rests in the committed store (the archive is git history/tags + memory, not a `0NNN/` dir); `cook validate`'s `[prune]` enforces this (full mode only). The completion order is gate -> remove -> validate -> commit (the done-gate validates the present record, then the dir is removed before any commit), so a legitimately-completing task is never blocked.
6. **Standards.** jeff's bundled first-party `code-standards` (with `testing`/`security-auditor`) is the baseline quality floor for all code; Chef/local/language skills may tighten or specialize it (language skills override per-language) but never weaken it. `~/.claude/CLAUDE.md` hard-refers to the floor. No third-party skills or built-in tools drive behavior. No AI/assistant attribution in commits.
7. **Convergence.** The review/audit loop terminates by mechanism, not fatigue. The separation and done-gate guarantees (rule 2) are never weakened to converge. State lives in `task.json.convergence`; `cook validate` (INV-7..11) re-derives the decision.
   - **Severity gate (cycle 1):** review/audit self-classify each finding as **blocking** (reachable data-loss / corruption / path-escape / security / correctness-vs-acceptance-criteria → kickback) or **follow-up** (fail-safe / cosmetic / "could harden" → tracked backlog task, never blocks). The classification contract lives in the review/audit briefs. Jeff counts and transcribes; it never re-classifies.
   - **Refute pass:** each blocking finding must survive one `cook-refute` dispatch (fresh id, evidence-bar to refute, err toward survives) before it kicks back; refuted findings demote to follow-up with recorded rationale and never increment the counters.
   - **Per-stage cap = 2:** `review` and `audit` carry independent blocking-kickback counters. The 3rd would-be blocking kickback does not kick back; it convenes the council for that stage.
   - **Council = K=3 decorrelated lenses** (integrity / security / pragmatist), mutually-distinct ids, each distinct from the prior reviewer and the implementer. A finding survives iff **≥2 lenses** mark it blocking; verdict = block iff any finding survives.
   - **Termination:** a council block buys **at most one** scoped implement cycle, fresh-verified against *only* the surviving findings + full suite green + `cook validate` pass → `scoped-fix-shipped`; else `status=blocked` → `blocked-to-operator`.

## Contributing to jeff itself

- `skills/cook/scripts/cook.sh` is portable Bash + `jq` (no Bash-4 features; jq does the JSON work). Test changes against fixtures before committing: the validator gates its own repo.
- Follow semver and consider a version cut for every user-visible fix or improvement. Prefer landing the version bump in the same commit as the releasable change; use a separate bump-only commit only for catch-up or release metadata cleanup. Do not bump for internal chores that do not change shipped payload or behavior.
- Skills and agents are prose. Keep them tight: frontier models supply the craft; the briefs convey role, separation, output contract, and which standards to honor.
