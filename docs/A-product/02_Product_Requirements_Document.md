# 02 — Product Requirements Document (PRD)

## 1. Personas
- **Super Admin (platform operations head):** global picture, creates zones and admins, controls money.
- **Zonal Admin (zone manager, e.g. Coimbatore, possibly several zones such as Coimbatore + Tiruppur):** approves vendors, watches live orders across all assigned zones, fixes delivery problems, refunds customers.

## 2. Functional requirements (P0 launch-critical, P1 launch, P2 later)

### AUTH
| ID | Requirement | P |
|---|---|---|
| AUTH-1 | Email and password login, show/hide password | P0 |
| AUTH-2 | Remember me, forgot password, validation errors | P0 |
| AUTH-3 | Role-based routing after login | P0 |
| AUTH-4 | 2FA (TOTP, email OTP fallback) | P1 |
| AUTH-5 | Session timeout, login history, active sessions, revoke | P1 |
| AUTH-6 | Lockout after N failed attempts | P0 |

### DASH
| ID | Requirement | P |
|---|---|---|
| DASH-1 | Super Admin: total orders, customers, restaurants, active restaurants, delivery partners, revenue, commission, refunds, order overview, order status, zone performance, recent activity | P0 |
| DASH-2 | Zonal Admin: zone name header, total orders, active restaurants, homemakers, delivery partners, customers, today's revenue, order status | P0 |

### ORD Orders
ORD-1 list with search; ORD-2 filters (date, vendor, customer, delivery partner, payment, status); ORD-3 detail with timeline; ORD-4 status actions per state machine; ORD-5 cancel with reason; ORD-6 assign/reassign delivery partner; ORD-7 CSV export (P1). Others P0.

### VEN Restaurants and Homemakers (separate modules)
VEN-1 create with address, contact, cuisine/speciality; VEN-2 document upload and verification; VEN-3 status Pending/Active/Inactive/Suspended; VEN-4 commission percentage; VEN-5 operating hours; VEN-6 search, filter, bulk status. P0.

### MENU Menu / Food Items
MENU-1 CRUD with name, description, category, vendor mapping, price, stock, availability, featured (P0); MENU-2 images (P1); MENU-3 bulk actions (P1).

### CUS / DEL
CUS-1 list, profile, history, status. DEL-1 create, verify, availability, assignments, performance. DEL-2 cash-in-hand tracking. P0.

### PAY Payments
PAY-1 transaction list and detail; PAY-2 COD collection status; PAY-3 refunds (Zonal Admin up to limit, Super Admin unlimited); PAY-4 commission and payouts view; PAY-5 reconciliation report (P1).

### ZONE / ZADM / ROLE (Super Admin)
ZONE-1 zone CRUD: name, city, pincode range, delivery charge, status, description. ZADM-1 Zonal Admin CRUD: name, email, phone, **assign one or more zones**, password, status. ZADM-2 Zone scope switcher for Zonal Admins (All my zones / single zone) (P0). ZADM-3 Per-zone and cross-zone aggregates respect the switcher (P0). ROLE-1 permission matrix editor. P0.

### SET Settings (Super Admin, P1)
General; Business and Operations; Payment and Commission; Order Settings; User Management; Security; Notifications; Integrations; System Logs.

### EXTRA (P2)
Analytics, Offers and Coupons, Reviews and Ratings, Support, Notifications.

## 3. User stories
- As a Super Admin I create a zone and a Zonal Admin so a new city operates independently.
- As a Zonal Admin I see orders from all the zones assigned to me, and only those, so I cannot disturb other zones.
- As a Zonal Admin with several zones I switch between "All my zones" and one zone without logging out.
- As a Zonal Admin I refund a customer within my limit so complaints close quickly.
- As a Super Admin I approve large refunds so money leaves only with oversight.

## 4. Non-functional requirements
| Area | Requirement |
|---|---|
| Performance | Dashboard p95 < 2 s; API p95 < 500 ms on indexed queries |
| Availability | 99.5% monthly; Multi-AZ database |
| Security | OWASP ASVS L2 targets (doc 13) |
| Scalability | 50 concurrent admins, 100k orders/month initial |
| Accessibility | WCAG 2.1 AA for core flows |
| Browsers | Latest two versions of Chrome, Edge, Safari, Firefox; desktop first (1280px+), tablet usable |
| Auditability | Every write recorded |
| Localisation | English first, i18n-ready strings |
| Time | Stored UTC, shown in configured timezone |

## 5. Acceptance criteria
Features meet doc 25. Example: Given a Zonal Admin of zones A and B, When they request an order of zone C, Then the API returns 404 and the attempt is logged; when they request an order of zone B, it is returned.

## 6. Data sources (v2.0)
The panels do not hold the master copy of consumer-app activity. Customers, vendors, delivery partners, menus and orders **arrive automatically from the customer app, the vendor (restaurant/homemaker/shop) app and the delivery-partner app** through the Integration API, and admin decisions flow back to those apps. See `G-integration/41–45`. Building the three apps is out of scope.
