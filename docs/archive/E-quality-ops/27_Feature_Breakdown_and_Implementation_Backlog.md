# 27 — Feature Breakdown and Implementation Backlog (v1.1)

v1.0's single backlog is **replaced** by three plans in `F-execution/`, so Super Admin and Zonal Admin can be planned, assigned and gated separately:

| Plan | File | Phases |
|---|---|---|
| Shared foundation | `F-execution/33_Shared_Foundation_Plan.md` | F0 setup, F1 platform core, F2 UI foundation |
| Super Admin | `F-execution/34_Super_Admin_Execution_Plan.md` | SA-1 … SA-9 |
| Zonal Admin | `F-execution/35_Zonal_Admin_Execution_Plan.md` | ZA-1 … ZA-7 |
Supporting: `36` multi-zone spec, `37` design reconciliation and screen inventory, `38` Claude Code lanes and prompt guide.

Sizes: S ≤ 1 day, M 2–3 days, L 4–5 days (one developer with AI assistance). Priority P0/P1/P2.

## Mapping from v1.0 task ids
| v1.0 | v1.1 |
|---|---|
| F0-1…F0-6 | F0.1…F0.7 (Terraform task F0-6 replaced by single-host baseline F0.7, D31) |
| F1-1…F1-7 | F1.1…F1.7 and F2.1…F2.7 |
| F2-1, F2-2, F2-3 | SA-1.1, SA-1.2/1.3, SA-1.4 |
| F2-4, F2-5, F2-6 | SA-2.2, SA-2.3, SA-2.1 |
| F3-1, F3-2, F3-3 | SA-2.4, SA-3.1, SA-3.2 |
| F4-1…F4-5 | SA-4.1…SA-4.6 (+ Integration API: SA-10 / IH-1…IH-9) |
| F5-1…F5-3 | ZA-5, SA-5 |
| F6-1…F6-6 | SA-6.1…SA-6.7, ZA-6 |
| F7-1…F7-3 | SA-7.1…SA-7.6 |
| Phase 8 extras | SA-8 |
| Phase 9 hardening | SA-9 / ZA-7 |

## Critical path
F1.3 (scope resolver) → SA-1.2/1.3 (multi-zone admins) → ZA-1 → SA-4.1 → SA-6.2 → SA-6.4 → ZA-6 → launch. **D18** (existing backend?) must be answered before F1; **D6** (gateway) before SA-6 (week 15).

## Totals
About 26 calendar weeks to pilot with two developers for P0+P1 (calendar in doc 35). P2 extras (SA-8) follow the pilot. Re-estimate after the first two sprints.
