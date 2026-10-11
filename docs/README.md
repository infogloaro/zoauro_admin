# ZOAURO (GloAro Food Delivery) — Admin Panel: Dev-Ready Documentation Pack v2.3 (full development pack)

Scope: Super Admin + Zonal Admin web panel. A Zonal Admin can operate **multiple zones**, a zone can have **several members**, and the Super Admin controls exactly what each member can do in each zone (Access Control panel). v1.1 = v1.0 pre-dev pack, verified against the designer PDF and Figma screenshots, aligned to the GloAro CRM stack, plus separate phase plans for Super Admin and Zonal Admin.

**v2.0:** the panels are fed by the customer, vendor and partner apps. New: `G-integration/` (docs 41–45 + `contracts/`: OpenAPI, event catalogue, sample payloads) and `H-delivery/` (docs 46–48 + `deploy/`: lifecycle, step-by-step deployment, integration test and UAT plan).

## Start here
1. `00-review/00_Alignment_Review.md` — what was verified, what did not match, what you must decide.
2. `A-product/03_Business_Rules_and_Decision_Register.md` — every decision with status (Decided / Changed / Assumed / Open).
3. **Integration with the apps:** `G-integration/41` (data flow) → `42` (inbound contract for app teams) → `43` (outbound events) → `44` (field ownership) → `45` (admin Integration Hub). **Lifecycle and deployment:** `H-delivery/46` → `47` → `48`. **To start coding today:** `H-delivery/49` (setup steps and copy-paste Claude Code prompts).
4. `F-execution/39` modules and workflows, **`40` three-developer allocation and module-by-module plan**, `33…35` phase plans, `36` multi-zone and access tests, `37` design reconciliation, `38` Claude Code lanes.
5. Copy `AGENTS.md` and this folder (as `docs/`) into the repository root.

## Index
| # | Document | Folder | v1.1 |
|---|---|---|---|
| 00 | Alignment Review | 00-review | new |
| 01 Project Brief · 02 PRD | A-product | patched |
| 03 Business Rules and Decision Register · 04 Roles and Permission Matrix | A-product | rewritten |
| 05 Use Cases | A-product | patched (UC-11, UC-12) |
| 06 Architecture and Stack · 07 Repo Structure · 08 Schema · 09 API · 12 Environment | B-architecture | rewritten |
| 10 State Machines · 11 Integrations | B-architecture | patched |
| 13 Security · 16 Payments · 17 Recovery | C-security | patched |
| 14 Authentication and Authorization | C-security | rewritten |
| 15 Privacy and Retention | C-security | unchanged |
| 18 Information Architecture | D-ui | rewritten |
| 19 Design System · 20 Admin Screens · 21 Zonal/Vendor Screens · 22 Forms/Tables · 23 Frontend State | D-ui | patched |
| 24 Test Strategy · 25 Acceptance · 26 AI Instructions · 28 AI Context · 29 CI/CD · 30 Operations · 31 Release | E-quality-ops | patched |
| 27 Backlog (now a pointer) · 32 Tech Debt and Change Log | E-quality-ops | rewritten |
| 33 Shared Foundation Plan · 34 Super Admin Plan · 35 Zonal Admin Plan | F-execution | new |
| 36 Multi-Zone Zonal Admin Spec · 37 Design Reconciliation · 38 Lanes and Prompts | F-execution | new |
| **41 Ecosystem and Data Flow · 42 App→Admin Contract · 43 Admin→App Control and Events · 44 Data Ownership and Sync · 45 Integration Hub** (+ `contracts/`) | G-integration | **new in v2.0** |
| **50 Module Guide M04 Audit and Logs (v1.1, with verified code bundle `Zoauro-M04-Audit-Bundle/`)** | F-execution | **new** (first module guide) |
| **46 Lifecycle Roadmap · 47 Deployment Runbook · 48 Integration Test and UAT Plan · 49 Claude Code Kickoff Steps and Prompts** (+ `deploy/`) | H-delivery | **new in v2.0** |
| **39 Modules and Workflows · 40 Three-Developer Allocation and Module Plan** | F-execution | **new in v1.2** |

v1.2 changes: access model D41–D49 (docs 03, 04, 08, 09, 14, 18, 20, 22, 36), plans 34/35/37/38 patched, timeline corrected to about 24 weeks with 3 developers (superseded by v2.0: about 26 weeks).

v2.2 changes: contradictions found by the Claude Code orientation read-out fixed (AGENTS.md open-decision list, D18 timing, pnpm audit, scaffold exemption from the 5-file rule, doc 33 pointer to doc 40). No new documents.

v2.0 changes: D50–D58 (apps feed the panels; HMAC-signed Integration API; signed webhooks; field ownership; Integration Hub), docs 03, 04, 06, 08–14, 20, 24, 25, 30–32, 34, 35, 39, 40 patched; timeline now about 26 weeks (13 sprints) with 3 developers.

Items marked Assumed in doc 03 use a default so work can start; change the register first, then the documents that cite it.

Reading note (v1.2): wherever a document says "assigned zones", read it as "zones where the member holds the required permission for that module" (doc 36 header, doc 14 §4).

v2.3 changes: doc 50 (Audit and Logs) rewritten as v1.1 after building and testing a reference implementation (`Zoauro-M04-Audit-Bundle`, delivered separately): third database role for retention (D64), extra indexes, diff-before-redact, customer zone rule (D63, Assumed), build status in §18, new Phase 0.6 prompt to adopt the bundle. Doc 07 route list now says `access` instead of `roles`.
