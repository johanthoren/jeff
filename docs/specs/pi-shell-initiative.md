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
   `npm:@johanthoren/jeff` in `~/.pi/agent/settings.json` packages for normal semver releases.
   The `git:github.com/johanthoren/jeff` package ref remains dev/edge only. No
   "also run brew/npm install jeff" step for either. Existing `jeff@jeff` users
   change nothing in usage.
3. **One model, per-stage effort.** On both hosts, specialists inherit the
   orchestrator provider/model and role frontmatter supplies only `effort`.
4. **One core, not two.** A single shared implementation of the validator, state,
   gates, and dispatch. No parallel Bash and JS systems to keep in sync.
5. **Single stage-effort definition.** Agent frontmatter is the source for stage
   effort. No provider ranking, alias mapping, or cross-provider switching exists.

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
├─ package.json         pi reads "pi": {extensions, skills}; also "type": "module"
├─ agents/cook-*.md     shared role briefs with hand-authored effort
├─ hooks/hooks.json     Claude Code hooks
├─ skills/              shared SKILL.md, both hosts
└─ src/                 plain ESM JS, run directly by both hosts (no build, no dist)
    ├─ core/            validator/state/gates (imports no pi SDK)
    ├─ cli/cook.js      CLI entry (imports no pi SDK)
    └─ pi/extension.js  pi extension: the only module that imports the pi SDK
```

## 4. Architecture: thin shared core, host drives orchestration

jeff's philosophy holds: the method is the product, not a runtime. The shared core is
**not** an autonomous runtime. It is the validator, the state/registry model, the
gates, and one dispatch primitive. The host's orchestrator
model still drives the pipeline in-loop, calling dispatch once per stage. This keeps
both shells feeling identical and the core small.

| Concern | Claude Code | pi |
| --- | --- | --- |
| Orchestrator | main-loop model reads `skills/cook/SKILL.md` | same SKILL.md |
| Fire a stage | built-in Task tool + `agents/cook-*.md` | jeff-registered dispatch tool -> `core.runRoleSession` -> `createAgentSession` |
| Validator/state | `node src/cli/cook.js <verb>` via Bash | same CLI (`bin: cook`) + extension imports core in-process |
| Skills | `skills/` | `skills/` (same files) |
| Activation / flavor | plugin + hooks | extension `session_start` / `before_agent_start` |

The one real asymmetry: pi ships **no** built-in subagent/Task tool, so jeff provides
the dispatch primitive on pi (a thin wrapper over `createAgentSession`, the modern
in-process replacement for pi-bakehouse's subprocess adapter). Claude Code's dispatch
stays its native Task tool. Chef-facing behavior is identical on both: order in, line
fired, fresh cook per station, plate back.

## 5. Inherit model, apply effort (constraint 3 + 5)

Both hosts follow one rule: every specialist inherits the orchestrator's provider/model unchanged, and `agents/cook-*.md` frontmatter supplies only stage `effort`. There is no provider abstraction, alias mapping, ranking, fallback, elevation, or cross-provider switching. Pi passes the current model directly to `createAgentSession`, applies `effort` as `thinkingLevel`, fails closed if no orchestrator model exists, and returns the child session's actual `{provider, model, effort}` when exposed (falling back only to requested effort when the host omits it).

## 6. Build and dependency policy (constraint 2 + 4)

- The core is plain ESM JavaScript with **zero runtime dependencies**. No build step,
  no bundler, no committed `dist/`, no rebuild-diff guard: both hosts run `src/`
  directly. Claude Code installs are git-only (no npm step), which is exactly why
  zero-deps enables direct execution; pi's git install runs `npm install --omit=dev`,
  a no-op here. This deletes the stale-bundle failure class instead of guarding it.
- Types via JSDoc, enforced with `tsc --noEmit --checkJs` in CI; the pi SDK is a
  devDependency for its type declarations only. Hard import boundary: `src/core/` and
  `src/cli/` import nothing from the pi SDK (its module alias exists only under pi's
  jiti extension loader); only `src/pi/` may. Validation that a schema library would
  have done is hand-rolled field checks, a 1:1 port of what `cook.sh` does in jq today.
- Runtime dependency shifts from **jq to node**. This is a swap, not a new category
  (jeff already requires jq today; `cook doctor` checks it). node is safe for this
  audience: pi runs on node, Claude Code runs on node, and jq is dropped. `cook doctor`
  checks for node with a clear message.
- Cut: a per-OS compiled self-contained binary (YAGNI; multiple platform binaries
  bloat the repo, node is ambient).

### How Claude Code calls the CLI

Mechanical substitution of the current `cook.sh` invocations:

- SKILL.md: `node "<skill-base-dir>/src/cli/cook.js" <verb>`, cwd in the target repo
  (the CLI keeps deriving repo root from cwd/git).
- `hooks.json`: adopt ponytail's guarded-direct-node pattern (no wrapper file):
  `command`: `command -v node >/dev/null 2>&1 && node "${CLAUDE_PLUGIN_ROOT}/src/cli/cook.js" <gate-verb> || exit 0`,
  a `commandWindows` PowerShell variant, and a `timeout`. This **fails open** on a
  missing node (exit 0 = allow): if node is absent the whole CLI is dead and no jeff
  task is running, so blocking every commit would be hostile; `cook doctor` reports the
  real problem.

pi calls the same file as the package `bin` (`#!/usr/bin/env node`) and imports the
same core in-process from the extension.

## 7. No-regression gate (constraint 3)

Turn "if it works" into machine-checkable gates, not a promise:

- **pi dispatch test:** `createAgentSession` receives the current pi model unchanged
  and the stage `effort:` as `thinkingLevel`; returned results include the child
  session's actual `{provider, model, effort}` when pi reports it.
- **Frontmatter contract:** focused tests assert every role omits `model` and pins its settled effort.
- **Parity check:** the JS validator reproduces the current Bash+jq validator's verdicts
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

Reuse is structure-and-logic transcription, not file reuse: pi-bakehouse is TypeScript,
this core is plain JS, and the code needed the 0.11 -> 0.71 rebase and slimming anyway.

Trim: `statusline/` (7 files), `migrations/forge`, `clarification/`, and bakehouse's
8-phase set (`order..served`). Remap to jeff's phases
`capture -> plan -> implement -> refactor -> review -> audit -> done` (plan also designs and authors the targeted-red tests).

Attribution: pi-bakehouse is the author's own code (Apache-2.0); still record any
close adaptation in `NOTICE` / `THIRD_PARTY_NOTICES` as pi-bakehouse's own order #17
process required.

## 9. Non-goals / deferred (ponytail-cut)

- Arbitrary model/effort override config. Revisit only if operator experience proves the fixed stage efforts insufficient.
- Cross-provider best-of-breed dispatch. pi dispatch deliberately inherits the active
  pi model/provider; selecting different providers per stage is out of scope.
- Per-OS compiled binary.
- Instruction-tier adapters for other shells (Cursor, Windsurf, ...). Out of scope;
  this initiative is pi as a first-class shell, not a portability sweep.

## 10. Settled decisions

- pi dispatch inherits the active pi model/provider and only applies stage effort.
- The core is plain zero-dependency ESM JS, no build step and no committed `dist/` (§6).
- Frontmatter stays hand-authored with effort-only contract tests, no generator (§5).
- `.jeff/` needs no new structure and no `role-runs/` directories.
- The gate hook uses ponytail's guarded-direct-node pattern (§6).

## 11. Decomposition sketch (into jeff tasks)

1. Scaffold the plain-JS core skeleton (JSDoc types, store, hand-rolled validation
   helpers) + `tsc --checkJs` and `node:test` wiring in CI.
2. Port the validator (`cook validate` and friends) to JS; parity check vs `tests/*.bats`.
3. Port the remaining CLI verbs (`ls`, `status`, `show`, `verify`, `init`, `doctor`,
   `plan section/check/append`).
4. Frontmatter effort reader; pi inherits the active model/provider.
5. Swap Claude Code SKILL.md / hooks invocations from `cook.sh` to `node src/cli/cook.js`;
   retire `cook.sh` on this branch; `doctor` checks node.
6. pi package manifest (`package.json#pi`) + extension entrypoint (commands + activation).
7. `runRoleSession` + dispatch tool on pi (in-process `createAgentSession`), stage
   effort wiring, role permissions.
8. Dispatch + no-regression gates green on both shells; end-to-end smoke on a sample
   task in each shell.
