# 26 — AI Coding Instructions

The operational file is `/AGENTS.md` at the repository root (copy provided in this pack root). This document explains it.

Purpose: let AI coding assistants (Claude Code, Codex, Cursor, Copilot) work safely and cheaply by loading small, correct context and following hard rules.

Key rules enforced by AGENTS.md:
1. Read docs in the stated order; do not load everything.
2. Inspect the repository before writing; follow existing patterns.
3. Never invent endpoints, fields, enums, or permissions not in docs 08, 09, 04.
4. Never weaken authorization or zone scoping; all data access via repositories receiving `AuthContext` (scope = requested ∩ assigned, N zones).
5. Every endpoint change needs an authorization test for SuperAdmin, Admin(A), Admin(A+B) and Admin(none). Work in the lane given in doc 38.
6. Money in integer paise; never floats.
7. Ask before resolving any item marked [ASSUMPTION] or listed Open in doc 03.
8. Small tasks (≤ 5 files), tests first or alongside, run lint, typecheck, tests before declaring done.
9. Never edit migrations that already shipped; add new ones.
10. No secrets in code, logs, or commits.
Update AGENTS.md whenever conventions change (log in doc 32).
