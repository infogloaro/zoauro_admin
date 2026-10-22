# ZOAURO (GloAro Food Delivery): Admin Panel documentation

Web admin panel for ZOAURO food delivery: **Super Admin** (all zones) and **Zonal Admin** (only the zones and actions granted), fed by the customer, vendor and partner apps through the Integration API.

## Start here
1. **`FEATURES.md`**: what is built today, module by module, with status.
2. `A-product/03_Business_Rules_and_Decision_Register.md`: every decision (D-numbers) with its status.
3. `F-execution/61_Demo_Script.md`: how to run and present the demo.
4. `E-quality-ops/32_Technical_Debt_and_Change_Log.md`: what changed, when and why.
5. `handoff.md`: the latest state of each work stream.

## Index
| Folder | Documents |
|---|---|
| `A-product` | 01 Project Brief · 02 Product Requirements · **03 Business Rules and Decision Register** · 04 Roles and Permission Matrix · 05 Use Cases and Workflows · `roadmap/` (phase roadmap) |
| `B-architecture` | 06 Architecture and Stack · 07 Repository Structure and Coding Standards · **08 Database Schema** · **09 API Specification** · 10 State Machines and Events · 11 Integrations · 12 Environment and Configuration |
| `C-security` | 13 Security and Threat Model · 14 Authentication and Authorization · 15 Privacy and Retention · 16 Payments and Financial Controls · 17 Incident and Recovery |
| `D-ui` | 18 Information Architecture · 19 Design System · 20 Admin Screens · 21 Zonal Admin and Vendor Screens · 22 Forms, Tables and Components · 23 Frontend State |
| `E-quality-ops` | 24 Test Strategy · 25 Acceptance and Definition of Done · 29 CI/CD · 30 Monitoring and Operations · 31 Release Plan · **32 Change Log** |
| `F-execution` | 34 Super Admin Plan · 35 Zonal Admin Plan · 36 Multi-Zone Spec · 37 Design Reconciliation · 38 Lanes · 39 Modules and Workflows · 40 Developer Allocation · Module guides 50 (Audit), 52 (Auth), 53 (Zones) · **60 Admin Workflow Map and Change Requests** (+ `60_Admin_Workflow_Map.html`) · **61 Demo Script** · **63 Colleague Module Handover** · `specs/` (build specs F1–F5) |
| `G-integration` | 41 Ecosystem and Data Flow · 42 App to Admin Contract · 43 Admin to App Events · 44 Data Ownership · 45 Integration Hub · `contracts/` (OpenAPI, event catalogue, sample payloads) |
| `H-delivery` | 46 Lifecycle Roadmap · 47 Deployment Runbook · 48 Integration Test and UAT Plan · 58 Manual Test Procedure · 62 Colleague Branch Review · `deploy/` |
| `design`, `reference_images` | the designer's PDF, logo, screenshots and reference screens |
| `archive` | finished build plans, one-time prompts and superseded copies, kept for history (see `archive/README.md`) |

Instructions for AI coding sessions: `AGENTS.md` at the repository root.
