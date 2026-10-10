# 46 — Project Lifecycle: from scratch to production

One page that tells the team what to do in what order and which document to open. Stages map to the sprints of doc 40 (3 developers, 13 sprints, about 26 weeks to pilot).

| Stage | When | What happens | Documents | Exit criteria |
|---|---|---|---|---|
| **0 Decide** | Before sprint 0 (week 0) | Close blocking decisions: **D18** do the three apps exist and have backends (Mode A or B, doc 41 §4), D6 payment gateway choice date, D17 separate repo/DB, D49 team of 3 confirmed, D16 stack confirmed. Contract workshop with the three app teams: they review docs 42–44 and `contracts/` | 03, 41–44, 00 | Decisions recorded in doc 03; app teams signed off the contract or listed changes |
| **1 Set up** | S0 (W1–2) | Monorepo, tokens, Docker Compose, CI, staging host, secrets, domain | 06, 07, 12, 29, 47 §1–4 | New developer runs `docker compose up` and sees login; CI green; staging URL live |
| **2 Foundation** | S1–S2 | Full Prisma schema, auth, scope/access resolver, authorization harness, UI kit, Integration framework (IH-1), simulators skeleton | 08, 09, 14, 33, 45 | Gate 1 (doc 40) |
| **3 Core modules** | S3–S6 | Zones, Access Control, vendors, menu, orders with intake from simulators, customers, partners, real-time | 34, 35, 39, 40 | Gate 2 and Gate 3 |
| **4 Connect the real apps** | S4 onward (sandbox), S11 (full) | Each app team points its backend at the sandbox Integration API, runs the contract suite, fixes mismatches. Admin side adds Integration Hub for monitoring | 42, 43, 44, 45, 48 | Each app passes the contract suite in sandbox |
| **5 Money** | S5–S9 | Gateway adapter, webhooks, ledger, refunds, COD, payouts, reconciliation | 16, 34 SA-6 | Gate 3, TC-PAY, TC-REF |
| **6 Harden** | S9–S10 | Security tests, load test, accessibility, restore drill, UAT | 13, 24, 25, 31 | Gate 5 |
| **7 Integrate end-to-end** | S11 | Real apps against staging with real-looking data, full order journeys, admin training | 48 | UAT script passed with all three real apps |
| **8 Deploy and pilot** | S12 | Production setup, data import if needed, pilot zone, hyper-care | 47, 31, 30 | Pilot live, no Sev-1/2 for 7 days |
| **9 Operate and grow** | after pilot | Monitoring, support, extras (Analytics, Offers, Reviews, Support), more zones | 30, 17, 32, 34 SA-8 | Next-phase plan |

## Roles
Product owner (you): decisions, UAT sign-off. Dev 1/2/3: doc 40. App teams (3): contract, sandbox testing. Designer: missing frames (D47). DevOps (can be Dev 3 part-time): staging/production setup.

## Weekly cadence
Mon plan, daily 15-minute sync, Thursday integration check (app teams join from S4), Friday demo against the gate line and update of `docs/handoff.md` and doc 32 change log.
