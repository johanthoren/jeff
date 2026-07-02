# pi-shell initiative

Status: proposal (2026-07-01). Branch: `pi-shell`, local-only. `main` continues to
ship the current Bash+jq jeff until this branch reaches parity. This document is
the anchor for the initiative; it is not a claim that any of it is built yet.

## 1. Goal

Make **pi** (`@mariozechner/pi-coding-agent`) a second first-class shell for jeff,
alongside Claude Code. A "shell" is an agent host (Claude Code, pi, opencode,
Cursor, ...). Today jeff is first-class only in Claude Code. After this work jeff
runs natively in both, from **one repo**, installed by each host's native method,
with the same Chef-facing feel.

Reference project: **ponytail** (`DietrichGebert/ponytail`), which already ships to
many shells including pi. Closest prior art: **pi-bakehouse**, a full TypeScript
pi-native port of jeff's frozen predecessor (bakehouse), last touched 2026-05-07 on
pi-coding-agent `^0.11.0`. We reuse its structure, slimmed to jeff's leaner design
and rebased onto current pi (`0.71`).

## 2. Hard constraints

1. **Single repo, single root package.** No per-shell repos, no separate modules.
2. **Transparent native install, no external step.** Claude Code installs via the
   `johanthoren/jeff` marketplace exactly as today. pi installs via
   `git:github.com/johanthoren/jeff` in `~/.pi/agent/settings.json` packages. No
   "also run brew/npm install jeff" step for either. Existing `jeff@jeff` users
   change nothing in usage.
3. **No regression, per-chef brains.** Every stage runs at its own `{model, effort}`
   on every supported shell. No one-size-fits-all, no session-default fallback.
4. **One core, not two.** A single shared implementation of the validator, state,
   gates, and dispatch. No parallel Bash and TS systems to keep in sync.
5. **Single brain definition.** Model and effort live in one place and resolve per
   provider. jeff is native on both Claude and gpt models.

## 3. Why single-root-package (constraint 1 + 2)

Both hosts read their manifest from the repo root:

- Claude Code reads `.claude-plugin/plugin.json` at the plugin root (`marketplace.json`
  `source: "./"`), plus `agents/`, `hooks/`, `skills/` at conventional paths.
- pi clones the repo and reads the root `package.json` `"pi": { extensions, skills }`.
  pi package refs have no subpath syntax; they take the repo root.

A workspaces monorepo would hide each manifest from its host's native installer and
force the out-of-band step constraint 2 forbids. So the layout is one package at the
root; each host reads only the files it understands and ignores the rest.

```
/                       one repo = Claude Code plugin AND pi package
├─ .claude-plugin/      Claude Code reads (ignores package.json#pi)
├─ package.json         pi reads "pi": {extensions, skills} (Claude Code ignores)
├─ agents/cook-*.md     Claude Code subagents, GENERATED from the brain table
├─ hooks/hooks.json     Claude Code hooks
├─ skills/              shared SKILL.md, both hosts
├─ dist/                COMMITTED prebuilt bundles (built in CI, never at install)
│   ├─ cli/cook.js      validator/state CLI
│   └─ pi/extension.js  pi extension
└─ src/                 TS source: core + cli + pi extension
```

## 4. Architecture: thin shared core, host drives orchestration

jeff's philosophy holds: the method is the product, not a runtime. The shared core is
**not** an autonomous runtime. It is the validator, the state/registry model, the
gates, the single brain table, and one dispatch primitive. The host's orchestrator
model still drives the pipeline in-loop, calling dispatch once per stage. This keeps
both shells feeling identical and the core small.

| Concern | Claude Code | pi |
| --- | --- | --- |
| Orchestrator | main-loop model reads `skills/cook/SKILL.md` | same SKILL.md |
| Fire a stage | built-in Task tool + generated `agents/cook-*.md` | jeff-registered dispatch tool -> `core.runRoleSession` -> `createAgentSession` |
| Validator/state | `node dist/cli/cook.js <verb>` via Bash | same CLI (`bin: cook`) + extension imports core in-process |
| Skills | `skills/` | `skills/` (same files) |
| Activation / flavor | plugin + hooks | extension `session_start` / `before_agent_start` |

The one real asymmetry: pi ships **no** built-in subagent/Task tool, so jeff provides
the dispatch primitive on pi (a thin wrapper over `createAgentSession`, the modern
in-process replacement for pi-bakehouse's subprocess adapter). Claude Code's dispatch
stays its native Task tool. Chef-facing behavior is identical on both: order in, line
fired, fresh cook per station, plate back.

## 5. Brains: one table, resolved per provider (constraint 3 + 5)

Model and effort are defined once, provider-abstract, and resolved by the active
provider family of the shell/session (not hardcoded per shell; pi with an anthropic
provider still picks the anthropic column).

Stage -> semantic tier + effort (one definition):

| stage | tier | effort |
| --- | --- | --- |
| capture | top (session brain) | (session) |
| plan | judge | xhigh |
| test | encode | medium |
| implement | build | high |
| refactor | tidy | high |
| review | judge | xhigh |
| audit | judge | xhigh |

Tier x provider -> concrete model. jeff ships an `anthropic` and an `openai` column
natively; other providers get an effort-only fallback until a column is added.

| tier | anthropic | openai | fallback (untuned provider) |
| --- | --- | --- | --- |
| judge | opus · xhigh | gpt-5.5 · xhigh (TBD, bench) | session model · xhigh |
| build | opus · high | gpt-5.5 · high (TBD, bench) | session model · high |
| tidy | sonnet · high | gpt-5.x mid · high (TBD, bench) | session model · high |
| encode | sonnet · medium | gpt-5.x small · medium (TBD, bench) | session model · low |

Effort is one shared axis: Claude `effort` and pi `thinkingLevel` use the same ladder
(`low/medium/high/xhigh`). The openai column's concrete models are a bench follow-up,
not a structural blocker. The **anthropic column is the current jeff values reused
verbatim**, so running pi on an Anthropic key gives brains identical to Claude Code
(zero new tuning). `[[pin-tuning-kickback-economics]]` becomes a per-provider judgement.

"Judge >= builder" still holds by construction within each provider column.

### 5.1 Resolution: provider is a runtime property, model is best-available

A pi user may have several providers authed at once (Anthropic + OpenAI + other), and
may not have every model within a column. So:

- **`tier -> effort` is the durable invariant** (always applies, provider-agnostic).
  **Model is a best-available lookup**, never a hard pin.
- **Which column: the session's active provider.** This respects the user's explicit
  provider choice (pi `defaultProvider` or a per-session switch) and matches Claude
  Code (Anthropic-locked). jeff does not silently reach across providers. Resolution is
  `(sessionProvider, tier) -> model`, `tier -> effort`.
- **Availability fallback within a column:** if a tier's model is not authed, degrade to
  the nearest available model in that provider (else the session model), effort
  preserved. A dispatch never hard-fails on availability; effort never silently flattens.
- **Record the resolved `{provider, model, effort}` actually used** per stage in the
  existing informational `brains.<stage>` record (point 3). This is the audit trail the
  no-regression gate (§7) checks, and it matters more now that provider is runtime-variable.

Cross-provider best-of-breed selection (e.g. opus for judge + a cheap OpenAI model for
encode in one task, ignoring the session provider) is deferred (§9). The resolver
signature stays clean so it becomes an additive `(providers[], tier) -> model` later,
not a rewrite.

### 5.1 Source of truth and generation

The brain table is authoritative. This changes jeff's current stance that the
`agents/cook-*.md` frontmatter is the source of truth: the frontmatter becomes
**generated** from the table, guarded by a drift check (as ponytail does with
`check-rule-copies.js`). pi reads the table at runtime. AGENTS.md / SKILL.md language
updates to match.

Flip only when the resolution gate is green (see §7). If generation cannot reproduce
the exact per-stage brains and prove Claude Code honors them, frontmatter stays
hand-authored and only pi is driven from the table. The table stays the single
definition either way.

## 6. Build and dependency policy (constraint 2 + 4)

- The core is TypeScript, bundled with tsup to plain ESM JS, pi's peer dependency
  excluded, other deps inlined.
- `dist/` is **committed**. Built in CI (release workflow `npm run build`), never at
  user install time. Claude Code cannot build on install; pi should not need to. A CI
  guard rebuilds and diffs against committed `dist/` so a stale bundle cannot ship.
- Runtime dependency shifts from **jq to node**. This is a swap, not a new category
  (jeff already requires jq today; `cook doctor` checks it). node is safe for this
  audience: pi runs on node, Claude Code runs on node, and jq is dropped. `cook doctor`
  checks for node with a clear message.
- Cut: a per-OS compiled self-contained binary (YAGNI; multiple platform binaries
  bloat the repo, node is ambient).

### How Claude Code calls the CLI

Mechanical substitution of the current `cook.sh` invocations:

- SKILL.md: `node "<skill-base-dir>/dist/cli/cook.js" <verb>`, cwd in the target repo
  (the CLI keeps deriving repo root from cwd/git).
- `hooks.json`: adopt ponytail's guarded-direct-node pattern (no wrapper file):
  `command`: `command -v node >/dev/null 2>&1 && node "${CLAUDE_PLUGIN_ROOT}/dist/cli/cook.js" <gate-verb> || exit 0`,
  a `commandWindows` PowerShell variant, and a `timeout`. This **fails open** on a
  missing node (exit 0 = allow): if node is absent the whole CLI is dead and no jeff
  task is running, so blocking every commit would be hostile; `cook doctor` reports the
  real problem.

pi calls the same file as the package `bin` (`#!/usr/bin/env node`) and imports the
same core in-process from the extension.

## 7. No-regression gate (constraint 3)

Turn "if it works" into machine-checkable gates, not a promise:

- **Resolution test:** with a fully-authed provider column, every stage resolves to the
  exact table cell (`model` + `effort`). Claude Code side asserts generated frontmatter
  carries the right `model` + `effort` per stage; pi side asserts `createAgentSession`
  receives the right `model` + `thinkingLevel`. Effort always matches the tier regardless
  of model availability (it never flattens); model falls back to nearest-available only
  when the tier's model is not authed, and that fallback is itself recorded (§5.1).
- **Drift check:** generated `agents/cook-*.md` must match what the table produces or CI
  fails.
- **Parity check:** the TS validator reproduces the current Bash+jq validator's verdicts
  on the existing `tests/*.bats` fixtures before `main`'s validator is retired on this
  branch.

## 8. Reuse from pi-bakehouse, slimmed

Reuse (rebased to jeff's phases + pi 0.71):

- `runRoleSession(...)` role-session abstraction and role permission/purity model.
- `runtime/gates/*`, the filesystem store, and `.jeff/` state-as-code layout.
- Extension `commands.ts` / `tools.ts` structure (commands call core functions, no
  duplicated workflow logic; tools cannot bypass gates).
- Role-result ingestion, kickback routing, and adversarial panel + synthesis model
  from `role-orchestration-architecture.md`.

Modernize: subprocess adapter -> in-process `createAgentSession`.

Trim: `statusline/` (7 files), `migrations/forge`, `clarification/`, and bakehouse's
8-phase set (`order..served`). Remap to jeff's phases
`capture -> plan -> test -> implement -> refactor -> review -> audit -> done`.

Attribution: pi-bakehouse is the author's own code (Apache-2.0); still record any
close adaptation in `NOTICE` / `THIRD_PARTY_NOTICES` as pi-bakehouse's own order #17
process required.

## 9. Non-goals / deferred (ponytail-cut)

- Arbitrary model/effort override config (swap any stage to any model). Revisit only
  if the fixed table proves insufficient.
- Cross-provider best-of-breed dispatch (picking each tier's model across all authed
  providers, overriding the session provider). Resolver is structured for it (§5.1);
  behavior deferred, adjacent to the override config above.
- Per-OS compiled binary.
- Instruction-tier adapters for other shells (Cursor, Windsurf, ...). Out of scope;
  this initiative is pi as a first-class shell, not a portability sweep.

## 10. Open decisions

1. Sequencing only: which provider to bench first. Anthropic needs none (§5 column is
   reused verbatim); the openai column's concrete `tidy`/`encode` models need bench data
   and confirmation that a low-effort frontier model stays a faithful encoder.

Settled: gate hook uses ponytail's guarded-direct-node pattern (§6); `.jeff/` needs no
new structure, only the resolved-`{provider, model, effort}` field on the existing
`brains.<stage>` record (§5.1), and no `role-runs/` directories.

## 11. Decomposition sketch (into jeff tasks)

1. Scaffold the TS core skeleton (types, zod schemas, store) + tsup build + committed
   `dist/` + CI build-diff guard.
2. Port the validator (`cook validate` and friends) to TS; parity check vs `tests/*.bats`.
3. Port the remaining CLI verbs (`ls`, `status`, `show`, `verify`, `init`, `doctor`,
   `plan section/check/append`).
4. Brain table module + resolution API + generator for `agents/cook-*.md` + drift check.
5. Swap Claude Code SKILL.md / hooks invocations from `cook.sh` to `node dist/cli/cook.js`;
   retire `cook.sh` on this branch; `doctor` checks node.
6. pi package manifest (`package.json#pi`) + extension entrypoint (commands + activation).
7. `runRoleSession` + dispatch tool on pi (in-process `createAgentSession`), per-stage
   brain wiring, role permissions.
8. Resolution + no-regression gates green on both shells; end-to-end smoke on a sample
   task in each shell.
