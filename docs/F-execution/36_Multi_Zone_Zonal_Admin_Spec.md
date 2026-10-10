# 36 — Multi-Zone Zonal Admin Specification (v1.2)

v1.2: scope is no longer one list of zones per admin. Each member × zone assignment carries its own profile, overrides and limits (doc 04, D41). Wherever this document says "assigned zones", read "zones where the member holds the required permission for that module" (`zonesFor(ctx, 'module:view')`, doc 14 §4).

Reverses D3 ("one zone per Zonal Admin"). One Zonal Admin can check, monitor and operate restaurants, homemakers, delivery partners, customers, orders and payments across **all zones assigned to them**, from one login.

## 1. Model
- `admin_zone_assignments`: many-to-many, soft-revoked (doc 08). A zone may have 0..N admins (D7).
- Scope is **resolved from assignments on every request**, never copied into the session.
- `effectiveZoneIds = requestedZoneIds ∩ assignedZoneIds` (omitted request = all assigned). Super Admin: requested or ALL.
- Super Admin is the only actor who changes assignments and access (`PUT /zonal-admins/{id}/access`, `/zones/{id}/team`, Access Profiles; re-auth required; audited into `access_changes` and `audit_logs`).
- **Zone team:** several members may be assigned to the same zone, each with different access. Members do not see each other's access. All actions record the acting member; simultaneous edits resolve through the order `version` check.

## 2. UX behaviour
| Area | Behaviour |
|---|---|
| Scope switcher | Sidebar zone card (Figma chevron). "All my zones (N)" default, or one zone. In URL `?zone=` and saved in `user_preferences`. Hidden chevron when only one zone |
| Header | "Welcome back, <name>" + subtitle "Coimbatore, Madurai + 1 more" or "Coimbatore Zone Overview" |
| Dashboard | KPIs aggregate over scope. Chart "Zone Wise Orders (This Month)": **bars per zone when scope > 1, per area when scope = 1** (Figma chart is area-level) |
| Lists | Same columns as Figma plus a **Zone** column/ZoneChip when scope > 1; Zone filter limited to assigned zones |
| Create vendor/partner/address | Required Zone field (assigned zones only). Single-zone admin: pre-filled and locked |
| Order detail | Zone chip in header; assignment dialog only lists partners of the order's zone |
| Refunds | Limits are per member per zone (D20, v1.2); banner shows remaining for the order's zone |
| Notifications / Socket.IO | New-order and refund alerts from every assigned zone; toast shows zone name; bell badge sums all |
| Super Admin | Zone Management list shows the team avatar stack ("KM +2"); Zone Teams and Member Access editor manage who can do what in each zone |
| Zone with no admin | Allowed; Super Admin dashboard shows "N zones without an admin" |
| Zero assigned zones | `/zone/no-zones` message |

## 3. Behaviour on assignment change
| Event | Result |
|---|---|
| Zone added | Next request includes it; socket joins room on `scope.changed`; switcher updates after `/me` refetch |
| Zone removed while admin is working | Next request for that zone's objects → 404; open detail pages show "no longer available"; socket leaves room; in-flight forms for that zone fail with 404 |
| Last zone removed | Admin lands on `/zone/no-zones` |
| Zone deactivated | Admin keeps read access to history; no new orders/vendors can be created in it |
| Vendor moved to another zone (Super Admin) | Old orders keep their zone; admin of the old zone keeps seeing old orders only |

## 4. Rules that stay single-zone (on purpose)
Vendor, delivery partner, order: exactly one zone. An order can only be assigned to a partner in the order's zone. A partner cannot be shared between zones in v1 (R-DEL-2). Cross-zone partner lending is a future decision, not v1.

## 5. Security requirements
1. No endpoint trusts a zone id from the client without intersecting with assignments.
2. Counts, aggregates, exports, search, global search, Socket.IO rooms, notifications and audit Activity tabs all use the same `ctx.effectiveZoneIds`.
3. Forged zone ids in body, query, path or bulk lists → 404 / ignored with count of rejected ids (never partial leak).
4. Cache keys include the sorted effective zone set (`dashboard:{userRole}:{zoneSetHash}:{range}`) so one admin's cached aggregate is never served to a different scope.
5. Customer visibility rule D25 evaluated in SQL (exists address/order in scope), with aggregates filtered by scope.

## 6. Required tests (all run on every PR)
| ID | Case | Expected |
|---|---|---|
| TC-MZ-1 | Admin of A+B lists orders without filter | Only A and B rows; total = A+B |
| TC-MZ-2 | Same admin requests `?zoneId=C` | 404 ZONE_NOT_FOUND |
| TC-MZ-3 | Same admin GET order in C | 404 |
| TC-MZ-4 | Same admin bulk menu update with ids from A, B and C | C ids rejected, none changed |
| TC-MZ-5 | Dashboard KPIs for A+B | Equal DB counts for A+B; excludes C |
| TC-MZ-6 | Cache isolation: admin(A) then admin(A+B) request dashboard | Different results, no reuse |
| TC-MZ-7 | Super Admin removes B mid-session | Next request on B object = 404; socket left room |
| TC-MZ-8 | Create restaurant with zoneId=C by admin(A+B) | 404 |
| TC-MZ-9 | Assign partner of zone B to an order of zone A | 422/409, no change |
| TC-MZ-10 | Refund daily limit in A and B | Counted separately per zone (see TC-AC-10) |
| TC-MZ-11 | Socket connect by admin(A+B) | Joins zone:A, zone:B only; cannot join zone:C |
| TC-MZ-12 | Customer with address in A and orders only in C | Visible to admin(A) with 0 orders/₹0 spent |
| TC-MZ-13 | Admin with 0 zones | All list endpoints return empty, `/zone/no-zones` shown |
| TC-MZ-14 | Zonal Admin calls PUT own access | 403 |
| TC-MZ-15 | Global search term matching records in A and C | Only A results |

## 6b. Access-control tests (v1.2)
| ID | Case | Expected |
|---|---|---|
| TC-AC-1 | Member Read Only in B, full in A: PATCH order in B | 403; same in A 200 |
| TC-AC-2 | Same member lists orders with scope All | A rows and B rows (orders:view in both) |
| TC-AC-3 | `payments:view` denied by override in A and B | Payments endpoints return empty/404; sidebar item and revenue tiles hidden |
| TC-AC-4 | Super Admin removes `orders:edit` from profile used by 3 members | All 3 get 403 on next request; `scope.changed` emitted |
| TC-AC-5 | Deny override vs profile grant | Deny wins |
| TC-AC-6 | Try to grant `zones:edit`, `access:edit`, `settings:edit`, `commission:edit` to a profile or override | 422 |
| TC-AC-7 | Zonal member calls any `/access*`, `/access-profiles*`, `/zones/{id}/team` | 403 |
| TC-AC-8 | Two members of zone A act on one order | one 200, one 409; both audited with own id |
| TC-AC-9 | Refund of ₹800 by member with per-refund limit ₹500 | PENDING_APPROVAL |
| TC-AC-10 | Daily limit per assignment: member refunds in A and B | counted separately per zone |
| TC-AC-11 | Access Preview for member vs actual API results | identical effective permissions |
| TC-AC-12 | Access change without re-auth | 401 REAUTH_REQUIRED |
| TC-AC-13 | Access change writes audit + access_changes + member email | all three exist |
| TC-AC-14 | Member loses only zone B | B objects 404, A unchanged, socket leaves B rooms |

## 7. Design changes needed from the designer
Access Control panel screens (Zone Teams, Access Profiles, Member Access editor with Access Preview, Access Change History, doc 20); team avatar stack in Zone Management; Zone column/chip in all zonal lists; switcher dropdown states; `/zone/no-zones` screen; "no longer available" state; Zone field in create forms.
