# 28 — AI Context and Token-Efficiency Guide

## 1. Context loading order
1. `AGENTS.md` (always, short).
2. The single module doc section relevant to the task (e.g., doc 08 table for `refunds`).
3. Doc 09 section for the endpoints touched.
4. Doc 04 permission rows touched.
5. Only the source files to change plus their tests.
Do not paste whole documents. Use headings and grep.

See doc 38 for lane ownership (parallel sessions) and the task id format (docs 33–35).

## 2. Task prompt template
```
Task: <one sentence>
Module: <name>   Docs: 08 §refunds, 09 §refunds, 04 matrix
Change: <files to create/edit, max 5>
Rules: scope via repository (effectiveZoneIds); Zod schema from packages/shared; audit; tests incl. authz and multi-zone.
Done when: <acceptance criteria>; lint, typecheck, tests pass.
```

## 3. File and scope limits
≤ 5 files per task; ≤ 400 changed lines; one module per task; no refactors mixed with features; if more is needed split the task.

## 4. Reusable context pack
Maintain `/docs/context/` with 1-page summaries: `zone-isolation.md` (includes multi-zone, doc 36), `order-state-machine.md`, `money-and-refunds.md`, `api-conventions.md`, `ui-conventions.md`. Each under 60 lines; AI loads these instead of full docs.

## 5. Checkpoints
After each task: run `pnpm lint && pnpm typecheck && pnpm test`; commit with conventional message; update `/docs/handoff.md`.

## 6. Handoff summary format
```
Date / task id:
Done:
Files changed:
Decisions made (and where logged):
Open questions / [ASSUMPTION]s touched:
Next step:
Commands to verify:
```

## 7. Efficiency habits
Ask for a plan before code on L tasks; request diffs not full files; reuse existing components; generate tests from the OpenAPI matrix; keep conversation per task and start fresh after merge; never ask the AI to "read the whole repo".

## 8. Guardrails
AI output is reviewed like human code; security-sensitive modules (auth, payments, authz) require human review of every line.
