# Pi shell initiative

Status: **implemented / historical**. The host expansion shipped before the
3.2.0 baseline. This document records the decisions that produced the current
package; it is not an active proposal or branch plan.

## 1. Outcome

The initiative made Pi a first-class Jeff host from the same repository and
package that serve Claude Code. Codex support subsequently joined the same
architecture. Pi, Claude Code, and Codex are now first-class hosts for Jeff's
model-native quality control plane.

Each host presents the same method: fresh specialist contexts, enforced
separation, durable evidence, and deterministic gates. Host-native adapters
only launch a specialist and return its result; the method, stage contracts,
and validation rules remain shared.

The checked-JS Node core under `src/core/`, exposed through `src/cli/cook.js`,
owns the complete operational CLI. The retired shell implementation served only
as a bounded transition oracle while unchanged behavior moved to Node.
`.jeff/BACKLOG.md` owns the live roadmap.

## 2. Constraints retained in the shipped design

1. **Single repo, single root package.** No per-host repositories or modules.
2. **Native installation.** Each host installs Jeff through its own supported
   package or marketplace flow, with no second runtime installation step.
3. **One model, host-native effort.** Every specialist inherits the
   orchestrator provider and model. Pi and Claude Code apply role-frontmatter
   effort where supported; Codex children inherit orchestrator effort.
4. **One authoritative core.** Checked-JS Node owns CLI and validation truth;
   transition-only shell parity machinery is not shipped.
5. **One stage-effort definition.** `agents/cook-*.md` frontmatter owns role
   effort. There are no model aliases, provider rankings, fallbacks, or
   stage-specific model selectors.

Current dogfood stamp: GPT-5.6 Sol in July 2026. This records operating context,
not a compatibility floor, routing rule, or minimum-version promise.

## 3. Why the package has one root

All three hosts discover their install metadata at the repository root:

- Claude Code reads `.claude-plugin/` and the conventional `agents/`, `hooks/`,
  and `skills/` directories.
- Pi reads the root `package.json` and its `pi.extensions` and `pi.skills`
  entries.
- Codex reads `.agents/plugins/marketplace.json`, `.codex-plugin/plugin.json`,
  and the shared `skills/` tree.

A workspace split would hide at least one host manifest or require an
out-of-band installation step. The single-root layout lets each host ignore the
metadata it does not understand while every host consumes the same shipped
method.

```
/                       one repo and one versioned package
├─ .agents/plugins/     Codex marketplace
├─ .claude-plugin/      Claude Code plugin metadata
├─ .codex-plugin/       Codex plugin metadata
├─ package.json         Pi package metadata
├─ agents/cook-*.md     shared specialist contracts
├─ skills/              shared skills and operational procedure
└─ src/
   ├─ core/             authoritative checked-JS validation and state logic
   ├─ cli/cook.js       host-neutral checked-JS CLI
   └─ pi/               thin Pi dispatch adapter
```

## 4. Thin adapters, shared method

Jeff remains a method rather than an autonomous workflow runtime. The active
host's orchestrator reads `skills/cook/SKILL.md`, routes the pipeline, and
transcribes specialist results. The host adapter supplies only the fresh-context
launch boundary.

| Host | Fresh specialist dispatch | Shared payload |
| --- | --- | --- |
| Pi | `cook_dispatch` through `src/pi/role-session.js` | skills, role briefs, checked-JS core |
| Claude Code | host-native Task/Agent dispatch with `agents/cook-*.md` | skills, role briefs, checked-JS core |
| Codex | native child tasks with the role body injected | skills, role briefs, checked-JS core |

Pi is the only host that needs a shipped dispatch bridge because it does not
provide the same built-in specialist tool. That bridge imports the Pi SDK under
`src/pi/`; `src/core/` and `src/cli/` remain host-neutral.

## 5. Build and dependency result

The core shipped as plain ESM JavaScript with JSDoc types, checked by
`tsc --noEmit --checkJs`. It has zero runtime dependencies, no build step, no
bundler, and no committed `dist/`. Every host runs the checked-in source.

The original proposal expected Bash and `jq` to disappear as part of the same
initiative. The final cutover removed both from the operational path after the
retained differential suites proved unchanged behavior. Host adapters still
own only launch and result collection.

## 6. Historical influences and cuts

The Pi adapter reused the thin role-session shape proven by `pi-bakehouse`, then
rebased it onto Jeff's smaller pipeline and current Pi APIs. The useful idea was
the boundary, not a second runtime: one function starts a fresh role session and
returns the child evidence.

The initiative deliberately excluded provider switching, model ranking,
per-stage model selection, compiled per-OS binaries, and a general portability
framework. Those additions would have braided fast-changing host details into
the slower validation foundation.

## 7. Follow-on work

- `#61`: completed the one-core Node cutover after parity and host smoke tests.
- `#56`: retain the Codex-native UX follow-up without changing model routing or
  the shared method.
