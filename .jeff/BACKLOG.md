# Backlog

Closed. Jeff is frozen at its final release and no longer takes new work.

The forward-looking sections that used to live here are gone. Every item they
listed is closed on GitHub, and keeping them made finished work read as
pending. The graph and control-plane track moved to
[jeff-control](https://github.com/johanthoren/jeff-control) and is likewise
not being continued.

What remains below is the record of what shipped, kept because the per-arc
judgment, kickback, and size numbers are the evidence for how the method
performed on its own repository.

## RELEASED 3.8.0 (2026-07-30)

The context-engineering arc shipped as one release. `#131` via PR #133 (`afd0a73`) made the bundled-skill lock a property of adding a pointer, after finding that seven pointer sites existed and exactly one was locked. `#123`, `#134` and `#136` shipped together via PR #138 (`a07cb7b`): one base-directory recipe for every payload path, scoped to payload paths after the `#123` audit found the generalization pulled project state into the plugin root (CWE-706), then shrunk after `#134`'s reviewers found 412 of its 432 added bytes were enumeration and argument rather than rule. `#126` via PR #139 (`f42df9e`) cleared both npm advisories, which `npm audit fix` cannot do: they are pinned under `pi-coding-agent`'s own `node_modules` and need `overrides` plus a lockfile rebuilt from scratch.

Arc totals: `skills/cook/SKILL.md` 310 to 227 lines and 47530 to 30638 bytes, a 35.5% cut on the file that loads in full on every activation; payload structural guards 7 to 22; `skills/cook/reference/` 2 files to 6. Twenty-one independent judgments across the seven tasks, fourteen reviews and seven required audits, every task under dual review, zero blocking findings and zero kickbacks throughout.

Two things the arc found that its issues did not predict: `#120`'s latent broken pointer had survived in two more files (`code-standards` and `security-auditor` both named reference files in a form no guard could see), and each pass reproduced the same pattern one level down until `#136` made the lock a property of the change rather than something the next task must remember. Follow-ups tracked as `#132`, `#135` and `#137`.

## CLOSED EARLIER (2026-07-29)

`#120` and `#128` merged together via PR #127 (`67753bb`). `#120` cut prescriptive rules the declared frontier tier no longer needs; `#128` finished the bundled-skill pointer mechanism those cuts depend on and absorbed `#129`. Payload prose net -1176 bytes after paying for the pointer mechanism and the fail-closed rule. Six judgments across the two tasks (four reviews, two required audits), zero blocking findings, zero kickbacks, both gates green on a clean tree. Three of the issue's own cut candidates came back as argued keeps: `cook-implement.md:12-15`, `cook-audit.md:16`, and two of the six review smells. The deletion exposed a latent defect, a relative `load-bearing-vs-liturgy.md` pointer that resolved to a nonexistent path while the cut ledger leaned on it for coverage. Follow-ups split out as `#130` and `#131`.

## CLOSED PREVIOUS PASS (2026-07-28)

`#117` merged via PR #119: harness right-sized for a declared frontier-tier target (Opus 5 / GPT-5.6 Sol / Grok 4.5), `SKILL.md` 311 to 228 lines, four branch-gated blocks moved to `skills/cook/reference/`. Zero blocking findings from two reviewers and a forced audit, zero kickbacks. Version deliberately not bumped; decided at release. `#107` merged via PR #114. `#109` merged via PR #115. `#112` added the terminal abandonment path and reconciled local ledgers `#101` and `#105` to `abandoned` with their council history intact. Pruned as superseded or satisfied: `#102` (met by `#107`, pinned at `src/pi/extension.test.js:283`), `#103` (docs aligned by `#105`/`#107`), `#104` (verifier query-kind architecture never shipped; `SKILL.md:242` settles the premise the other way), `#71` and `#111` (see DEFERRED above). The abandoned `codex/task-80-pi-human-returns` branch and both stale worktrees were removed.
