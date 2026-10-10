# 45 — Integration Hub (admin module M21) and Pending Registrations

What the admin panels need so that data coming from the three apps is visible, controllable and debuggable. Super Admin only, except the Pending registrations inbox and the order "source" labels, which zone members use.

## 1. Screens
### 1.1 Settings > Integrations (Super Admin; Figma has the tab, content is a gap, D47)
Route `/super-admin/settings/integrations`, permission `integrations:view/edit` (not grantable to Zonal Admin).
| Section | Content | Actions |
|---|---|---|
| **App connections** | One card per client (Customer app, Vendor app, Partner app) × environment: status dot, last request time, 24 h success rate, p95 latency, requests today, scopes, IP allow-list, webhook URL status | Create client, rotate secret (shown once, 24 h overlap), edit scopes/IP list, **Disable (kill switch)** with re-auth, delete |
| **Webhook endpoints** | URL, subscribed event types (checklist from doc 43 §4), signing secret (rotate), last delivery result | Add/edit, Send test event, pause/resume |
| **Event monitor** | Two tabs: Inbound (from apps) and Outbound (to apps). Columns: time, app, type, entity id, zone, result (APPLIED / REJECTED(code) / DUPLICATE / FAILED), latency, attempts. Filters: app, type, result, zone, order/vendor/partner id, date. Row drawer shows the redacted payload and response | Outbound: **Retry** (single or all dead-letter), **Replay** an event; Inbound: view reason, copy `requestId` for the app team |
| **Needs attention** | Dead letters, clients silent > 15 min, signature-failure spikes, unresolved reconciliation differences | Acknowledge with note |
| **Sandbox** | Sandbox client credentials and a "send sample event" button (staging only) | |

### 1.2 Pending registrations inbox (new vendors, partners from the apps)
- Route `/super-admin/registrations` and `/zone/registrations`; also reachable from the Restaurants, Homemakers and Delivery Partners lists as a "Pending verification" filter/tab (Figma already shows "Pending Verification" KPI and badges).
- Zone members see pending items **in their zones** (permission `restaurants:view` / `homemakers:view` / `delivery:view`); verifying needs `…:status`.
- **Needs a zone** tab (Super Admin only): vendors/partners whose address matched no zone. Action: assign to a zone (with team notified) or reject as "not serviceable". Until assigned they have no zone and are invisible to Zonal Admins.
- Each item shows: submitted data, documents with preview, address on a small map link, source app and time, SLA age (amber > 24 h, red > 48 h).

### 1.3 "Source" visibility for all admins
Order timeline rows show the actor and source: `CUSTOMER_APP`, `VENDOR_APP`, `PARTNER_APP`, `ADMIN (member name)`, `SYSTEM`. Customer, vendor and partner detail pages show "Registered via app on <date>". Needs only existing view permissions.

## 2. Permissions
| Key | Meaning | Grantable to Zonal Admin |
|---|---|---|
| `integrations:view/edit` | Hub screens, clients, webhooks, monitor | **No** |
| `registrations:view` | derived: allowed if the member can view the module (restaurants/homemakers/delivery) in that zone | yes (derived) |
Retry/replay and client changes need re-authentication and are audited.

## 3. Tables (added in doc 08 v2.0)
`api_clients` (extended), `api_client_secrets`, `external_refs`, `integration_inbound_log`, `webhook_subscriptions`, `webhook_deliveries`, `integration_alerts`, plus `zone_id` nullable on `restaurants`, `homemakers`, `delivery_partners` while `zone_assignment_status='UNASSIGNED'`, and `source`/`source_app` columns on order history rows.

## 4. Backend tasks (see doc 34 phase SA-10)
IH-1 framework, IH-2 registrations and zone resolver, IH-3 order intake, IH-4 menu and availability, IH-5 outbound, IH-6 Hub UI, IH-7 simulators and contract tests, IH-8 broadcast outbound, IH-9 pending registrations UI.

## 5. Acceptance (extra to doc 25)
- Given a vendor registers from the app with a pincode in zone A, then it appears in zone A's Pending list within 5 seconds for members with `restaurants:view` in A, and not for members of zone B.
- Given a registration with an unknown pincode, then only Super Admin sees it under Needs a zone; assigning it makes it visible to zone A's team.
- Given Super Admin disables the Vendor-app client, then its next request returns `CLIENT_DISABLED`, and re-enabling restores service; both are audited.
- Given the Customer-app webhook is down, then deliveries retry on schedule, the Hub shows them failing, and after recovery the pull feed returns every missed event once.
- Given a vendor-app event for another vendor's order, then `403 ENTITY_MISMATCH` and an inbound-log row with the reason.
- A member without `integrations` rights gets 403/404 on every Hub route.
