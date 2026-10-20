// GENERATED from apps/api/openapi/openapi.json by `pnpm openapi:generate`. Do not edit by hand.
export interface paths {
    "/access-changes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Access change history, newest first; filters member, zone, actor, type, date; cursor paging */
        get: operations["listAccessChanges"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-profiles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Access profiles (templates) with defaults and how many members use them */
        get: operations["listAccessProfiles"];
        put?: never;
        /** Create a profile (PASSWORD re-auth). Name unique ignoring case (409); never-grantable actions 422 listing every offender */
        post: operations["createAccessProfile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-profiles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One profile with its permission matrix */
        get: operations["getAccessProfile"];
        put?: never;
        post?: never;
        /** Delete a profile (PASSWORD re-auth); refused with 409 while any active assignment uses it (meta.members, meta.assignments) */
        delete: operations["deleteAccessProfile"];
        options?: never;
        head?: never;
        /** Rename or describe a profile (PASSWORD re-auth); name unique ignoring case (409) */
        patch: operations["updateAccessProfile"];
        trace?: never;
    };
    "/access-profiles/{id}/permissions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The permission matrix and default limits of a profile */
        get: operations["getAccessProfilePermissions"];
        /** Replace the matrix and default limits (PASSWORD re-auth). One PROFILE_EDITED access change per affected member, their caches cleared; never-grantable actions 422 */
        put: operations["putAccessProfilePermissions"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The Super Admin queue, newest first; meta.pendingCount feeds the badge */
        get: operations["listAccessRequests"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-requests/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One request (the current access of the member in the zone: GET /zonal-admins/{id}/access/preview) */
        get: operations["getAccessRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-requests/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve (PASSWORD re-auth) with a reason; a ZONE request needs profileId (D115). Applied with the access editor rules and caps in the same transaction; no self-approval; stale version 409 */
        post: operations["approveAccessRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/access-requests/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject with a reason; stale version 409 */
        post: operations["rejectAccessRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit-logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Audit rows, newest first (cursor = id). Super Admin: every filter. Zonal Admin: entity mode only (entityType + entityId); other filters except limit, after, from, to are ignored; nothing visible on the first page is 404. */
        get: operations["listAuditLogs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit-logs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One audit row with changes[]. A row the caller cannot see is 404. ip, userAgent and requestId only for Super Admin. */
        get: operations["getAuditLog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit-logs/actors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Admins whose name starts with q (case-insensitive, up to 20), for the System Logs actor typeahead. Soft-deleted admins included. */
        get: operations["searchAuditActors"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit-logs/catalogue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Audit modules and action keys with labels, for the filter UI */
        get: operations["getAuditCatalogue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit-logs/zones": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every zone (soft-deleted included), for the System Logs zone filter */
        get: operations["listAuditZones"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/change-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Change the password (also the forced first-login change). A wrong current password counts toward the lockout; success signs out the other sessions */
        post: operations["changePassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/csrf": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Pre-session CSRF token: sets the zo_csrf cookie and returns the same token for X-CSRF-Token on login, password reset and 2-step POSTs */
        get: operations["getCsrfToken"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/forgot-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Request a password reset link. Always answers the same way. */
        post: operations["forgotPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign in. The tab (SUPER_ADMIN or ZONAL_ADMIN) must match the account; a mismatch gets the generic error. */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign out and revoke the session */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/mfa/challenge": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send an email (or SMS) code for the pending sign-in, to the address or number on the account only. 429 with Retry-After on cooldown or caps; 409 when the method is not available */
        post: operations["challengeMfa"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/mfa/enrol/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** End of first-time 2-step set-up during sign-in (pending cookie, stage ENROL): needs a confirmed allowed method and the backup codes acknowledged (409 otherwise); starts the session */
        post: operations["completeEnrolment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/mfa/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Second step of sign-in with the pending cookie zo_mfa: an authenticator code or a backup code. Creates the session */
        post: operations["verifyMfa"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/reauth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Step-up before a high-risk action: the password (PASSWORD, 10 minutes) or the password and a second-step code (STRONG, 5 minutes, one action) */
        post: operations["reauth"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/reset-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set a new password with a single-use reset token; revokes all sessions */
        post: operations["resetPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Global categories plus the zone categories of the zones the caller can view (?kind=global|zone), with live item counts in scope */
        get: operations["listCategories"];
        put?: never;
        /** Add a category: zoneId null = global (Super Admin only, 403 for a Zonal Admin). Names are unique per zone, ignoring case (409) */
        post: operations["createCategory"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/categories/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Soft delete; refused with CATEGORY_IN_USE while live items use it */
        delete: operations["deleteCategory"];
        options?: never;
        head?: never;
        /** Rename or reorder a category (global ones: Super Admin only) */
        patch: operations["updateCategory"];
        trace?: never;
    };
    "/customers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Customers with an address or an order in the zones the caller can view (D25, ?zoneId repeatable): search q (name, phone, email), status, source, sort, pages, tab counts. Orders and total spent are scope-filtered; phone and email masked (D26) */
        get: operations["listCustomers"];
        put?: never;
        /** Add a customer (D28: source ADMIN, unique phone, no login) with a first address in a zone the caller can add customers to */
        post: operations["createCustomer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/customers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One customer: in-scope addresses, the 10 latest in-scope orders, scope-filtered figures (D25). 404 when not visible */
        get: operations["getCustomer"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Edit name, phone (unique) or email */
        patch: operations["updateCustomer"];
        trace?: never;
    };
    "/customers/{id}/block": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Block with a reason (kept in the audit trail) */
        post: operations["blockCustomer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/customers/{id}/reveal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The unmasked phone and email (D26): the reveal flag in a zone where the customer is visible (Super Admin always), audited, 30 per hour */
        get: operations["revealCustomerContact"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/customers/{id}/unblock": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Unblock (back to ACTIVE) */
        post: operations["unblockCustomer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboard/new-registrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** New customers, vendors and delivery partners in the range, with the latest five of each. ?range=today|7d|30d|month (IST days, default 7d) */
        get: operations["getDashboardNewRegistrations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboard/order-overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Orders and delivered orders per IST hour (today) or day, every bucket present. ?range=today|7d|30d|month (IST days, default 7d) */
        get: operations["getDashboardOrderOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboard/order-status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Orders in the range by status (the donut). ?range=today|7d|30d|month (IST days, default 7d) */
        get: operations["getDashboardOrderStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboard/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** KPIs: orders in the range (unpaid online orders excluded, D52) with the cancellation rate; restaurants, home kitchens, delivery partners (incl. on duty) and customers all-time; Super Admin also zones without a team and platform health (D34). ?range=today|7d|30d|month (IST days, default 7d) */
        get: operations["getDashboardSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboard/top-categories": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Top 5 food categories by item quantity of delivered orders. ?range=today|7d|30d|month (IST days, default 7d) */
        get: operations["getDashboardTopCategories"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboard/top-restaurants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Top 5 restaurants and home kitchens by delivered orders. ?range=today|7d|30d|month (IST days, default 7d) */
        get: operations["getDashboardTopRestaurants"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/dashboard/zone-orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Orders per zone when the scope has more than one zone, per vendor area for one zone. ?range=today|7d|30d|month (IST days, default 7d) */
        get: operations["getDashboardZoneOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/delivery-partners": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Partners in the zones the caller can view (?zoneId repeatable): filters status, verification (PENDING = the R12 Partner Requests queue), assignment, online, vehicleType, area, available (D133 picker: online, ACTIVE, VERIFIED, not forced offline) with currentOrders and the zone cap; counts per tab incl. On Duty. Contacts masked (D26) */
        get: operations["listPartners"];
        put?: never;
        /** Add a partner to one of the caller’s zones (R-ACC-6, R-DEL-2); phone unique (409 CONFLICT) */
        post: operations["createPartner"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/delivery-partners/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One partner: documents, D97 checklist, open orders, cash in hand (read-only), rating */
        get: operations["getPartner"];
        put?: never;
        post?: never;
        /** Soft delete (PASSWORD re-auth): not ACTIVE and carrying no orders */
        delete: operations["deletePartner"];
        options?: never;
        head?: never;
        /** Edit profile fields (version required, 409 STALE_VERSION); zone moves use /move-zone */
        patch: operations["updatePartner"];
        trace?: never;
    };
    "/delivery-partners/{id}/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Attach a confirmed upload (purpose PARTNER_DOC) as a partner document (D131) */
        post: operations["attachPartnerDocument"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/delivery-partners/{id}/documents/{docId}/url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A 300 s signed link to the document; every link is an audited view */
        get: operations["getPartnerDocumentUrl"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/delivery-partners/{id}/documents/{docId}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Verify, or reject with a note, one pending document */
        post: operations["verifyPartnerDocument"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/delivery-partners/{id}/force-offline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Force offline until a time (at most 30 days) with a reason; event partner.force_offline */
        post: operations["forcePartnerOffline"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/delivery-partners/{id}/move-zone": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Move to another zone or place an unzoned sign-up (Super Admin, PASSWORD); refused while carrying orders; event partner.updated */
        post: operations["movePartnerZone"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/delivery-partners/{id}/reveal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Unmasked phone and email (D123): audited, canReveal in the partner’s zone, 30 per hour */
        post: operations["revealPartnerContact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/delivery-partners/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate (needs VERIFIED), deactivate or suspend (from ACTIVE; takes the partner off duty). Event partner.status_changed */
        post: operations["setPartnerStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/delivery-partners/{id}/verification": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Decide a pending partner (R12): VERIFIED, or REJECTED with a note (= "send more information"; back to PENDING when the app resubmits) */
        post: operations["verifyPartner"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/homemakers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Home Food vendors in the zones the caller can view (?zoneId repeatable): filters, search q (name, phone, area), sort, pages, tab counts. Phone and email masked (D26) */
        get: operations["listHomemakers"];
        put?: never;
        /** Add a Home Food vendor in a zone (body zoneId). Refused with ZONE_SERVICE_DISABLED when the service is off there (D92); commissionPct is Super Admin only */
        post: operations["createHomemaker"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/homemakers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One Home Food vendor with its documents and the D97 checklist (null when not configured, D113). 404 outside the caller's view scope */
        get: operations["getHomemaker"];
        put?: never;
        post?: never;
        /** Soft delete (PASSWORD re-auth); an active Home Food vendor is deactivated first */
        delete: operations["deleteHomemaker"];
        options?: never;
        head?: never;
        /** Edit the profile; the zone changes only by move-zone. commissionPct: Super Admin only (emits vendor.updated) */
        patch: operations["updateHomemaker"];
        trace?: never;
    };
    "/homemakers/{id}/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Attach a confirmed upload (POST /uploads/presign, PUT, /uploads/confirm) as a document; the key must name this vendor */
        post: operations["attachHomemakerDocument"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/homemakers/{id}/documents/{docId}/url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A 300 s signed view link (D120); every link is an audited view (document_viewed) */
        get: operations["getHomemakerDocumentUrl"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/homemakers/{id}/documents/{docId}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Verify or reject a pending document (reject needs a note, D120). Audited as document_verified or document_rejected */
        post: operations["verifyHomemakerDocument"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/homemakers/{id}/move-zone": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Move to another zone, or assign an app sign-up that has none (R-VEN-3: Super Admin, PASSWORD re-auth); emits vendor.updated */
        post: operations["moveHomemakerZone"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/homemakers/{id}/reveal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** The unmasked phone and email (D123): needs the reveal flag in the vendor zone (Super Admin always), audited, 30 per hour */
        post: operations["revealHomemakerContact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/homemakers/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate (only once verified), deactivate or suspend (doc 10 section 4); emits vendor.status_changed. Audited as activated, deactivated or suspended */
        post: operations["setHomemakerStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/homemakers/{id}/verification": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Verify or reject a pending vendor (reject needs a note); emits vendor.status_changed. Audited as verified or rejected */
        post: operations["verifyHomemaker"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hotels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Hotels in the zones the caller can view (?zoneId repeatable): status, verification, area, search q (name, owner, area), sort, pages, tab counts, rooms occupied tonight. Phone and email masked (D26) */
        get: operations["listHotels"];
        put?: never;
        /** Add a hotel in a zone (body zoneId). Refused with ZONE_SERVICE_DISABLED when Hotel Booking is off there (D92); commissionPct is Super Admin only */
        post: operations["createHotel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hotels/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One hotel. 404 outside the caller’s view scope */
        get: operations["getHotel"];
        put?: never;
        post?: never;
        /** Soft delete; an active hotel is deactivated first */
        delete: operations["deleteHotel"];
        options?: never;
        head?: never;
        /** Edit the hotel; the zone is fixed. commissionPct: Super Admin only (audited hotel.commission_changed) */
        patch: operations["updateHotel"];
        trace?: never;
    };
    "/hotels/{id}/bookings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Room bookings of one hotel (bookings:view in its zone, else 404) */
        get: operations["listHotelRoomBookings"];
        put?: never;
        /** Book a stay [checkIn, checkOut) at an active hotel; the hotel row is locked and the stay must fit total_rooms on every night (409 NO_ROOMS_AVAILABLE, D127). Needs Hotel Booking on (D92); payment status is informational */
        post: operations["createRoomBooking"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hotels/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate (only once verified), deactivate or suspend (doc 10 section 4). Audited as activated, deactivated or suspended */
        post: operations["setHotelStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hotels/{id}/verification": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Verify or reject (note required). Audited as hotel.verified or hotel.rejected */
        post: operations["verifyHotel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hotels/bookings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Room bookings in the zones the caller can view with bookings:view; customer phone masked (D26) */
        get: operations["listRoomBookings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hotels/bookings/{bookingId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One room booking. 404 outside the caller’s view scope */
        get: operations["getRoomBooking"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hotels/bookings/{bookingId}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm, check in, check out or cancel at the version seen (PENDING -> CONFIRMED -> CHECKED_IN -> CHECKED_OUT; cancel before check-in). A cancel never changes the payment status (D127) */
        post: operations["setRoomBookingStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hotels/dining": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Dining reservations in the zones the caller can view with dining:view; customer phone masked (D26) */
        get: operations["listDiningReservations"];
        put?: never;
        /** Reserve a table at exactly one venue, a hotel or a restaurant; the zone is the venue’s (404 outside the caller’s zones). Needs Hotel Booking on in that zone (D92) */
        post: operations["createDiningReservation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hotels/dining/{diningId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One dining reservation. 404 outside the caller’s view scope */
        get: operations["getDiningReservation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/hotels/dining/{diningId}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm, complete, cancel or mark a no-show at the version seen (PENDING -> CONFIRMED -> COMPLETED | NO_SHOW; cancel before completion) */
        post: operations["setDiningReservationStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/login-history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Sign-in attempts of all users, newest first (cursor = id); emails masked */
        get: operations["listLoginHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The signed-in user, CSRF token and (stub) permissions */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/access-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** My access requests and what I may ask for (requestable zones and grantable permissions) */
        get: operations["listMyAccessRequests"];
        put?: never;
        /** A Zonal Admin asks for a zone (ACTIVE or UPCOMING, not theirs yet) or a grantable permission in one of their zones; Super Admin 403; one open request per zone and permission (409) */
        post: operations["createAccessRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/access-requests/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel my open request (404 for a request of someone else, 409 when already decided) */
        post: operations["cancelAccessRequest"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/login-history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The caller’s own last 50 sign-in attempts */
        get: operations["listMyLoginHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/mfa": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** My 2-step methods (hints only), backup codes left and what my policy allows. Also during sign-in enrolment (pending cookie) */
        get: operations["getMyMfa"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/mfa/{type}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove one of my 2-step methods. Needs a STRONG re-authentication; 409 LAST_METHOD_REQUIRED when the policy requires one */
        delete: operations["mfaRemoveMethod"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/mfa/authenticator/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm the authenticator with one valid code; backup codes when it is the first method */
        post: operations["mfaAuthenticatorConfirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/mfa/authenticator/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A new authenticator secret, shown once. During enrolment only after the mailbox proof; signed in, after a PASSWORD re-authentication */
        post: operations["mfaAuthenticatorStart"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/mfa/backup-codes/regenerate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** New backup codes (shown once); the old ones stop working. Needs a STRONG re-authentication */
        post: operations["mfaRegenerateBackupCodes"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/mfa/email/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm the emailed code: proves the mailbox and, where the policy allows, adds email codes as a method */
        post: operations["mfaEmailConfirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/mfa/email/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send a code to my account address: the mailbox proof during enrolment, or to add email codes as a method */
        post: operations["mfaEmailStart"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/mfa/primary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Choose the method offered first at sign-in */
        put: operations["mfaSetPrimary"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/mfa/sms/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm the SMS code: the number is verified and SMS codes become a method */
        post: operations["mfaSmsConfirm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/mfa/sms/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send a code to the mobile number on my account (never another): 409 SMS_NOT_AVAILABLE or PHONE_MISSING */
        post: operations["mfaSmsStart"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** My live sessions (device, IP, created, last seen, current) */
        get: operations["listMySessions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Sign out one of my sessions (the current one too); a session of another user or an ended one is 404 */
        delete: operations["revokeSession"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/sessions/revoke-others": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sign out all my other sessions */
        post: operations["revokeOtherSessions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/zone-scope": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** The zone switcher preference (doc 09, D116): {zoneIds: []} = all my zones, or one of my zones (404 ZONE_NOT_FOUND otherwise). A view filter, never authorization */
        put: operations["putZoneScope"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/members/{id}/mfa/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reset a member's 2-step verification (Super Admin, STRONG re-authentication, reason required): methods and backup codes removed, sessions revoked, member emailed */
        post: operations["resetMemberMfa"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/menu-items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Menu items in the zones the caller can view (?zoneId repeatable): vendor, category, availability (live = available, in stock, not admin-disabled), featured, dietary, search q (item or vendor), sort, pages, tab counts */
        get: operations["listMenuItems"];
        put?: never;
        /** Add an item to exactly one vendor; its zone is the vendor’s (404 outside the scope, 409 while the vendor waits for a zone). The category is global or of that zone */
        post: operations["createMenuItem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/menu-items/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One menu item. 404 outside the caller’s view scope */
        get: operations["getMenuItem"];
        put?: never;
        post?: never;
        /** Soft delete */
        delete: operations["deleteMenuItem"];
        options?: never;
        head?: never;
        /** Edit an item (applies at once; a vendor-owned field sets admin_override_at, doc 44). adminDisabled (with a reason to disable) is the admin toggle and emits menu_item.admin_changed (D126); audited as menu_item.updated, admin_disabled or admin_enabled */
        patch: operations["updateMenuItem"];
        trace?: never;
    };
    "/menu-items/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Apply a bulk action, all or nothing (D124): any id outside the caller’s zones rejects the request with 404 and nothing changes. Prices round half-up to paise; availability writes admin_disabled (D126) and emits menu_item.admin_changed */
        post: operations["applyMenuBulk"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/menu-items/bulk/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Dry run of a bulk action (availability, category, price): before/after per item and the skipped ids. Any id outside the caller’s zones is 404 (D124) */
        post: operations["previewMenuBulk"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/menu-items/change-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Vendor item-change requests (R09) in the zones the caller can view; default status PENDING */
        get: operations["listMenuChangeRequests"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/menu-items/change-requests/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One change request with base (at submission), live (now) and proposed values */
        get: operations["getMenuChangeRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/menu-items/change-requests/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve at the version seen: applies only name, description, price, category, dietary and image (CREATE inserts, DELETE soft-deletes); emits menu_item.change_decided (D125) */
        post: operations["approveMenuChange"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/menu-items/change-requests/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject at the version seen, with a reason the vendor receives (menu_item.change_decided, D125) */
        post: operations["rejectMenuChange"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** History of notifications naming a zone the caller can view (?zoneId repeatable); all-zones ones are the Super Admin’s. Filters status, kind, audience, q, from/to */
        get: operations["listNotifications"];
        put?: never;
        /** Compose (D135). A Zonal Admin’s PROMOTION waits for a Super Admin (D94); others are scheduled at once, one send per zone, a PROMOTION held to each zone’s window (D100, D136). Channels gated by Platform Settings; SMS refused until a provider is ready */
        post: operations["createNotification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One notification with its per-zone sends (time, status, emails sent/failed) */
        get: operations["getNotification"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Edit before any zone is sent (version). A Zonal Admin’s edit sends a promotion back to approval */
        patch: operations["updateNotification"];
        trace?: never;
    };
    "/notifications/{id}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Approve a pending promotion (Super Admin, never the requester; D94, D134) */
        post: operations["approveNotification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel before any zone is sent (the delete action, D137) */
        post: operations["cancelNotification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reject a pending promotion with a note (Super Admin; D134) */
        post: operations["rejectNotification"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/openapi.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** This OpenAPI document */
        get: operations["getOpenApiDocument"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Orders in the zones the caller can view (?zoneId repeatable): filters, search q (order no, customer, vendor), sort, pages. Customer phone masked (D26) */
        get: operations["listOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One order: items, timeline and payments. 404 outside the caller’s view scope */
        get: operations["getOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{id}/assign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Assign (READY) or reassign (ASSIGNED) a delivery partner of the same zone: verified, online, under delivery.maxConcurrentOrders (D121). Partner row locked */
        post: operations["assignOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancel with a reason (If-Match: version); a captured payment sets refundExpected */
        post: operations["cancelOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{id}/transition": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Move an order along doc 10 (If-Match: version). Cancel and assign have their own routes; REFUNDED comes from refunds (D40). Guards: vendor active, COD collected */
        post: operations["transitionOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/restaurants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Restaurants in the zones the caller can view (?zoneId repeatable): filters, search q (name, phone, area), sort, pages, tab counts. Phone and email masked (D26) */
        get: operations["listRestaurants"];
        put?: never;
        /** Add a restaurant in a zone (body zoneId). Refused with ZONE_SERVICE_DISABLED when the service is off there (D92); commissionPct is Super Admin only */
        post: operations["createRestaurant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/restaurants/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One restaurant with its documents and the D97 checklist (null when not configured, D113). 404 outside the caller's view scope */
        get: operations["getRestaurant"];
        put?: never;
        post?: never;
        /** Soft delete (PASSWORD re-auth); an active restaurant is deactivated first */
        delete: operations["deleteRestaurant"];
        options?: never;
        head?: never;
        /** Edit the profile; the zone changes only by move-zone. commissionPct: Super Admin only (emits vendor.updated) */
        patch: operations["updateRestaurant"];
        trace?: never;
    };
    "/restaurants/{id}/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Attach a confirmed upload (POST /uploads/presign, PUT, /uploads/confirm) as a document; the key must name this vendor */
        post: operations["attachRestaurantDocument"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/restaurants/{id}/documents/{docId}/url": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A 300 s signed view link (D120); every link is an audited view (document_viewed) */
        get: operations["getRestaurantDocumentUrl"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/restaurants/{id}/documents/{docId}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Verify or reject a pending document (reject needs a note, D120). Audited as document_verified or document_rejected */
        post: operations["verifyRestaurantDocument"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/restaurants/{id}/move-zone": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Move to another zone, or assign an app sign-up that has none (R-VEN-3: Super Admin, PASSWORD re-auth); emits vendor.updated */
        post: operations["moveRestaurantZone"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/restaurants/{id}/reveal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** The unmasked phone and email (D123): needs the reveal flag in the vendor zone (Super Admin always), audited, 30 per hour */
        post: operations["revealRestaurantContact"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/restaurants/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activate (only once verified), deactivate or suspend (doc 10 section 4); emits vendor.status_changed. Audited as activated, deactivated or suspended */
        post: operations["setRestaurantStatus"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/restaurants/{id}/verification": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Verify or reject a pending vendor (reject needs a note); emits vendor.status_changed. Audited as verified or rejected */
        post: operations["verifyRestaurant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Header search (q ≥ 2 characters; types = orders,customers,restaurants,homemakers,partners, default all): up to 5 rows per group in the caller’s view zones, contacts masked; a typed mobile is matched exactly. 60 per minute */
        get: operations["globalSearch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every registered setting: default, platform value, effective value with its source (DEFAULT / PLATFORM) and effect state (D109) */
        get: operations["listSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/{group}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The settings of one group; with ?zoneId= the effective values in that zone (source ZONE / PLATFORM / DEFAULT). Group security is answered by GET /settings/security */
        get: operations["getSettingsGroup"];
        /** Save platform values with a reason (re-auth PASSWORD; STRONG for refund limits and the SMS provider, D112). Stale version 409 */
        put: operations["putSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/{group}/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Reset to the default rule (deletes the saved platform value), with a reason; re-auth as for saving */
        delete: operations["resetSetting"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/{group}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Dry run: validates, diffs against the current values, lists members a new refund cap would clamp (D110) and shows an example order number */
        post: operations["previewSettings"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Settings History: the audit rows of module settings with the reason; filters key, group, zone, actor, date */
        get: operations["getSettingsHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/security": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Settings > Security: the 2-step policy (as stored, or the doc 52 defaults) and the password, lockout and session values in effect */
        get: operations["getSecurityPolicy"];
        /** Change the 2-step policy (STRONG re-authentication). SMS only with a real provider; members left without a usable method lose their sessions */
        put: operations["updateSecurityPolicy"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/security/sms/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume SMS one-time codes after the hourly cap paused them (STRONG re-authentication) */
        post: operations["resumeSms"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/security/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Security Status card: members enrolled by role, method mix, active Super Admins (warning below 2), SMS state, failed second steps in 24 h */
        get: operations["getSecurityStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/uploads/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Checks an uploaded file: it exists, its type and size are allowed and its content matches its type (doc 13 T9) */
        post: operations["confirmUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/uploads/presign": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A 300 s pre-signed PUT for a private file of a vendor (D120: zoneId and entityId). JPEG/PNG/WebP up to 5 MB, PDF up to 10 MB; the caller must be able to edit the vendor (menu:edit for MENU_IMAGE) */
        post: operations["presignUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zonal-admins": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Zonal Admin accounts (not deleted) with their zones; filters q, status, zoneId */
        get: operations["listZonalAdmins"];
        put?: never;
        /** Create a Zonal Admin with a temporary password (must be changed at first sign-in; never emailed, D103). Zones are given with PUT /access. Email in use 409 */
        post: operations["createZonalAdmin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zonal-admins/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One Zonal Admin with zones and the number of open sessions */
        get: operations["getZonalAdmin"];
        put?: never;
        post?: never;
        /** Soft delete (PASSWORD re-auth): every assignment and session ends (D102). Never a Super Admin or oneself (404 for a non-member id) */
        delete: operations["deleteZonalAdmin"];
        options?: never;
        head?: never;
        /** Change name, phone, email or status. An email change needs STRONG re-auth (401 REAUTH_REQUIRED otherwise, D107); SUSPENDED ends every session (D102). Email in use 409 */
        patch: operations["updateZonalAdmin"];
        trace?: never;
    };
    "/zonal-admins/{id}/access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The member's assignments: zone, profile, overrides, stored and effective limits, permissions, version */
        get: operations["getMemberAccess"];
        /** Replace the member's assignments (PASSWORD re-auth). Diff → access_changes + audit in one transaction, cache cleared, admin.zones_changed, email to the member. Never-grantable GRANT or zone not ACTIVE/UPCOMING 422; stale version 409 */
        put: operations["putMemberAccess"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zonal-admins/{id}/access/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Effective permissions, limits, per-cell explanation and visible modules of the member in one zone (same resolver as every request, TC-AC-11) */
        get: operations["previewMemberAccess"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zonal-admins/{id}/reset-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** New temporary password (PASSWORD re-auth): forced change at next sign-in, every session ends, email without the password (D103) */
        post: operations["resetZonalAdminPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zonal-admins/{id}/revoke-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** End every open session of the member (PASSWORD re-auth); one session.revoked row each */
        post: operations["revokeZonalAdminSessions"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Zones with colour, place, status, pincode count, per-module counts and team avatars (cursor = id). partial=true while a counting module is not built */
        get: operations["listZones"];
        put?: never;
        /** Create a zone (default UPCOMING). 409 ZONE_NAME_TAKEN, ZONE_CODE_TAKEN, PINCODE_OVERLAP (error.meta.conflicts); creating as ACTIVE needs the activation preconditions */
        post: operations["createZone"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One zone with its pincodes (paged), counts and team summary */
        get: operations["getZone"];
        put?: never;
        post?: never;
        /** Soft-delete a pristine zone that is not live (PASSWORD re-authentication); its pincodes are released, the code stays reserved. 409 ZONE_HAS_HISTORY with error.meta.counts */
        delete: operations["deleteZone"];
        options?: never;
        head?: never;
        /** Edit name, city, state, charge, colour, description with `version`. 422 CODE_IMMUTABLE for `code`; 409 STALE_VERSION with error.meta.current. A charge change is audited as zone.delivery_charge_changed */
        patch: operations["updateZone"];
        trace?: never;
    };
    "/zones/{id}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** UPCOMING or INACTIVE to ACTIVE (PASSWORD re-authentication). 422 ZONE_NOT_ACTIVATABLE with error.meta.missing */
        post: operations["activateZone"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones/{id}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** ACTIVE or UPCOMING to INACTIVE (PASSWORD re-authentication) with a reason and the impactVersion shown; no other record changes. 409 IMPACT_CHANGED, 422 REASON_REQUIRED */
        post: operations["deactivateZone"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones/{id}/impact": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** What deactivation would affect (open orders, vendors, partners, members, pending work) and impactVersion for the deactivate call. partial=true while a counting module is not built */
        get: operations["getZoneImpact"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones/{id}/pincodes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Change coverage: a range (recomputes only RANGE rows), add, remove. ?preview=true is a dry run listing conflicts and mismatches; otherwise 409 PINCODE_OVERLAP. Vendors and partners are never moved (mismatches) */
        put: operations["updateZonePincodes"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones/{id}/services": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** D92 service switches of the zone, with defaults marked and who last changed each */
        get: operations["getZoneServices"];
        /** Switch services on or off in the zone (PASSWORD re-auth, D92). Off: new onboarding and new orders for it are refused (ZONE_SERVICE_DISABLED); the apps are not told yet */
        put: operations["putZoneServices"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones/{id}/settings/{group}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Zone overrides of zone-overridable settings (422 NO_ZONE_OVERRIDE otherwise), with a reason; re-auth as for saving */
        put: operations["putZoneSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones/{id}/settings/{group}/{key}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a zone's override (the platform value applies again), with a reason */
        delete: operations["resetZoneSetting"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones/{id}/team": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Members with an active assignment in the zone: profile, overrides count, effective limits (M03) */
        get: operations["getZoneTeam"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones/{id}/team/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add a Zonal Admin to the zone with a profile (PASSWORD re-auth). Zone ACTIVE or UPCOMING, member a Zonal Admin (422); already in the zone 409 */
        post: operations["addZoneTeamMember"];
        /** Remove a member from the zone (PASSWORD re-auth): the assignment ends; the member's next request no longer sees the zone */
        delete: operations["removeZoneTeamMember"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones/lookup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The zone that owns a pincode, or null (live overlap hint of the zone form) */
        get: operations["lookupZonePincode"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/zones/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** KPI cards: total, active, inactive, upcoming and zones without a team */
        get: operations["getZoneSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ErrorBody: {
            error: {
                /** @enum {string} */
                code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "ZONE_NOT_FOUND" | "VALIDATION_ERROR" | "CONFLICT" | "RATE_LIMITED" | "INVALID_STATE_TRANSITION" | "REFUND_LIMIT_EXCEEDED" | "REAUTH_REQUIRED" | "PASSWORD_CHANGE_REQUIRED" | "SMS_NOT_AVAILABLE" | "PHONE_MISSING" | "LAST_METHOD_REQUIRED" | "STALE_VERSION" | "ZONE_NAME_TAKEN" | "ZONE_CODE_TAKEN" | "PINCODE_OVERLAP" | "RANGE_TOO_LARGE" | "CODE_IMMUTABLE" | "ZONE_NOT_ACTIVATABLE" | "IMPACT_CHANGED" | "REASON_REQUIRED" | "ZONE_HAS_HISTORY" | "ZONE_SERVICE_DISABLED" | "CATEGORY_IN_USE" | "NO_ROOMS_AVAILABLE" | "SERVICE_UNAVAILABLE" | "INTERNAL";
                details?: {
                    field: string;
                    issue: string;
                }[];
                message: string;
                meta?: {
                    [key: string]: unknown;
                };
                requestId?: string;
            };
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    listAccessChanges: {
        parameters: {
            query?: {
                actorId?: string;
                after?: string;
                changeType?: "PROFILE_SET" | "OVERRIDE_SET" | "LIMIT_SET" | "ZONE_ADDED" | "ZONE_REMOVED" | "PROFILE_EDITED";
                from?: string;
                limit?: number;
                memberId?: string;
                to?: string;
                zoneId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description History */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            actor: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                            after?: unknown;
                            before?: unknown;
                            /** @enum {string} */
                            changeType: "PROFILE_SET" | "OVERRIDE_SET" | "LIMIT_SET" | "ZONE_ADDED" | "ZONE_REMOVED" | "PROFILE_EDITED";
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: uuid */
                            id: string;
                            member: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                            zone: {
                                /** Format: uuid */
                                id: string;
                                name: string | null;
                            } | null;
                        }[];
                        meta: {
                            limit: number;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listAccessProfiles: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Profiles */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            assignmentsCount: number;
                            defaults: {
                                canExport: boolean;
                                canReveal: boolean;
                                dailyRefund: number | null;
                                perRefund: number | null;
                            };
                            description: string | null;
                            /** Format: uuid */
                            id: string;
                            isSeed: boolean;
                            membersCount: number;
                            name: string;
                            /** Format: date-time */
                            updatedAt: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createAccessProfile: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @default {
                     *       "perRefund": null,
                     *       "dailyRefund": null,
                     *       "canReveal": false,
                     *       "canExport": false
                     *     }
                     */
                    defaults?: {
                        canExport: boolean;
                        canReveal: boolean;
                        dailyRefund: number | null;
                        perRefund: number | null;
                    };
                    description?: string | null;
                    name: string;
                    /** @default [] */
                    permissions?: {
                        actions: ("view" | "add" | "edit" | "delete" | "status")[];
                        /** @enum {string} */
                        module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                    }[];
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        assignmentsCount: number;
                        defaults: {
                            canExport: boolean;
                            canReveal: boolean;
                            dailyRefund: number | null;
                            perRefund: number | null;
                        };
                        description: string | null;
                        /** Format: uuid */
                        id: string;
                        isSeed: boolean;
                        membersCount: number;
                        name: string;
                        permissions: {
                            actions: ("view" | "add" | "edit" | "delete" | "status")[];
                            /** @enum {string} */
                            module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                        }[];
                        /** Format: date-time */
                        updatedAt: string;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getAccessProfile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Profile */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        assignmentsCount: number;
                        defaults: {
                            canExport: boolean;
                            canReveal: boolean;
                            dailyRefund: number | null;
                            perRefund: number | null;
                        };
                        description: string | null;
                        /** Format: uuid */
                        id: string;
                        isSeed: boolean;
                        membersCount: number;
                        name: string;
                        permissions: {
                            actions: ("view" | "add" | "edit" | "delete" | "status")[];
                            /** @enum {string} */
                            module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                        }[];
                        /** Format: date-time */
                        updatedAt: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    deleteAccessProfile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    updateAccessProfile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    description?: string | null;
                    name?: string;
                };
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        assignmentsCount: number;
                        defaults: {
                            canExport: boolean;
                            canReveal: boolean;
                            dailyRefund: number | null;
                            perRefund: number | null;
                        };
                        description: string | null;
                        /** Format: uuid */
                        id: string;
                        isSeed: boolean;
                        membersCount: number;
                        name: string;
                        permissions: {
                            actions: ("view" | "add" | "edit" | "delete" | "status")[];
                            /** @enum {string} */
                            module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                        }[];
                        /** Format: date-time */
                        updatedAt: string;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getAccessProfilePermissions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Permissions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        defaults: {
                            canExport: boolean;
                            canReveal: boolean;
                            dailyRefund: number | null;
                            perRefund: number | null;
                        };
                        permissions: {
                            actions: ("view" | "add" | "edit" | "delete" | "status")[];
                            /** @enum {string} */
                            module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                        }[];
                        /** Format: uuid */
                        profileId: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    putAccessProfilePermissions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    defaults: {
                        canExport: boolean;
                        canReveal: boolean;
                        dailyRefund: number | null;
                        perRefund: number | null;
                    };
                    permissions: {
                        actions: ("view" | "add" | "edit" | "delete" | "status")[];
                        /** @enum {string} */
                        module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                    }[];
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        defaults: {
                            canExport: boolean;
                            canReveal: boolean;
                            dailyRefund: number | null;
                            perRefund: number | null;
                        };
                        permissions: {
                            actions: ("view" | "add" | "edit" | "delete" | "status")[];
                            /** @enum {string} */
                            module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                        }[];
                        /** Format: uuid */
                        profileId: string;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listAccessRequests: {
        parameters: {
            query?: {
                after?: string;
                limit?: number;
                requesterId?: string;
                status?: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
                zoneId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Requests */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string|null} */
                            action: "view" | "add" | "edit" | "delete" | "status" | null;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            decidedAt: string | null;
                            decidedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                            decisionReason: string | null;
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "ZONE" | "PERMISSION";
                            /** @enum {string|null} */
                            module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty" | null;
                            reason: string;
                            requester: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                            /** @enum {string} */
                            status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
                            version: number;
                            zone: {
                                code: string;
                                colorHex: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        meta: {
                            limit: number;
                            nextCursor: string | null;
                            pendingCount: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getAccessRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Request */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string|null} */
                        action: "view" | "add" | "edit" | "delete" | "status" | null;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionReason: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "ZONE" | "PERMISSION";
                        /** @enum {string|null} */
                        module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty" | null;
                        reason: string;
                        requester: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                        /** @enum {string} */
                        status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
                        version: number;
                        zone: {
                            code: string;
                            colorHex: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    approveAccessRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    profileId?: string;
                    reason: string;
                    version: number;
                };
            };
        };
        responses: {
            /** @description Approved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string|null} */
                        action: "view" | "add" | "edit" | "delete" | "status" | null;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionReason: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "ZONE" | "PERMISSION";
                        /** @enum {string|null} */
                        module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty" | null;
                        reason: string;
                        requester: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                        /** @enum {string} */
                        status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
                        version: number;
                        zone: {
                            code: string;
                            colorHex: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    rejectAccessRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                    version: number;
                };
            };
        };
        responses: {
            /** @description Rejected */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string|null} */
                        action: "view" | "add" | "edit" | "delete" | "status" | null;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionReason: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "ZONE" | "PERMISSION";
                        /** @enum {string|null} */
                        module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty" | null;
                        reason: string;
                        requester: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                        /** @enum {string} */
                        status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
                        version: number;
                        zone: {
                            code: string;
                            colorHex: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listAuditLogs: {
        parameters: {
            query?: {
                action?: string;
                actorId?: string;
                actorType?: "USER" | "APP_CLIENT" | "SYSTEM" | "WEBHOOK";
                after?: string;
                entityId?: string;
                entityType?: string;
                from?: string;
                limit?: number;
                module?: "auth" | "zones" | "admins" | "access" | "restaurants" | "homemakers" | "menu" | "customers" | "delivery" | "orders" | "payments" | "refunds" | "settlements" | "payouts" | "settings" | "integrations" | "notifications" | "audit" | "system" | "hotels" | "support";
                outcome?: "SUCCESS" | "DENIED";
                q?: string;
                sensitivity?: "NORMAL" | "HIGH";
                to?: string;
                zoneId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of audit rows */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            action: string;
                            actionLabel: string;
                            actor: {
                                /** Format: uuid */
                                id: string | null;
                                name: string;
                                role: string | null;
                                /** @enum {string} */
                                type: "USER" | "APP_CLIENT" | "SYSTEM" | "WEBHOOK";
                            };
                            changedFields: string[];
                            createdAt: string;
                            entity: {
                                /** Format: uuid */
                                id: string | null;
                                label: string | null;
                                type: string;
                            };
                            /** Format: uuid */
                            id: string;
                            ip?: string | null;
                            module: string;
                            note: string | null;
                            /** @enum {string} */
                            outcome: "SUCCESS" | "DENIED";
                            requestId?: string | null;
                            /** @enum {string} */
                            sensitivity: "NORMAL" | "HIGH";
                            userAgent?: string | null;
                            zone: {
                                /** Format: uuid */
                                id: string;
                                name: string | null;
                            } | null;
                        }[];
                        meta: {
                            limit: number;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getAuditLog: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The audit row */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        action: string;
                        actionLabel: string;
                        actor: {
                            /** Format: uuid */
                            id: string | null;
                            name: string;
                            role: string | null;
                            /** @enum {string} */
                            type: "USER" | "APP_CLIENT" | "SYSTEM" | "WEBHOOK";
                        };
                        changedFields: string[];
                        changes: {
                            after?: unknown;
                            before?: unknown;
                            field: string;
                        }[];
                        createdAt: string;
                        entity: {
                            /** Format: uuid */
                            id: string | null;
                            label: string | null;
                            type: string;
                        };
                        /** Format: uuid */
                        id: string;
                        ip?: string | null;
                        module: string;
                        note: string | null;
                        /** @enum {string} */
                        outcome: "SUCCESS" | "DENIED";
                        requestId?: string | null;
                        /** @enum {string} */
                        sensitivity: "NORMAL" | "HIGH";
                        userAgent?: string | null;
                        zone: {
                            /** Format: uuid */
                            id: string;
                            name: string | null;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    searchAuditActors: {
        parameters: {
            query?: {
                limit?: number;
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Matching admins */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            role: string | null;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getAuditCatalogue: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The audit catalogue */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        actions: {
                            key: string;
                            label: string;
                            /** @enum {string} */
                            module: "auth" | "zones" | "admins" | "access" | "restaurants" | "homemakers" | "menu" | "customers" | "delivery" | "orders" | "payments" | "refunds" | "settlements" | "payouts" | "settings" | "integrations" | "notifications" | "audit" | "system" | "hotels" | "support";
                        }[];
                        modules: ("auth" | "zones" | "admins" | "access" | "restaurants" | "homemakers" | "menu" | "customers" | "delivery" | "orders" | "payments" | "refunds" | "settlements" | "payouts" | "settings" | "integrations" | "notifications" | "audit" | "system" | "hotels" | "support")[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listAuditZones: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Zone options */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    changePassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    current: string;
                    new: string;
                };
            };
        };
        responses: {
            /** @description Password changed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getCsrfToken: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Token issued; cookie set */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        token: string;
                    };
                };
            };
        };
    };
    forgotPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: string;
                };
            };
        };
        responses: {
            /** @description Generic confirmation */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message: string;
                    };
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Too many requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: string;
                    password: string;
                    /** @default false */
                    remember?: boolean;
                    /** @enum {string} */
                    tab: "SUPER_ADMIN" | "ZONAL_ADMIN";
                };
            };
        };
        responses: {
            /** @description Signed in; session cookie set */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        csrfToken: string;
                        mustChangePassword: boolean;
                        redirect: string;
                        /** @enum {string} */
                        status: "OK";
                        user: {
                            email: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                            /** @enum {string} */
                            role: "SUPER_ADMIN" | "ZONAL_ADMIN";
                        };
                    } | {
                        methods: {
                            hint: string;
                            /** @enum {string} */
                            type: "AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP";
                        }[];
                        /** @enum {string} */
                        preferred?: "AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP";
                        /** @enum {string} */
                        status: "MFA_REQUIRED";
                    } | {
                        /** @enum {string} */
                        status: "ENROLMENT_REQUIRED";
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Too many requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Signed out; cookie cleared */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    challengeMfa: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    method: "EMAIL_OTP" | "SMS_OTP";
                };
            };
        };
        responses: {
            /** @description Code sent (or delivery failed: sent=false) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        expiresInSeconds: number;
                        hint: string;
                        resendAfterSeconds: number;
                        sent: boolean;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Too many requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    completeEnrolment: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    backupCodesAcknowledged: boolean;
                };
            };
        };
        responses: {
            /** @description Signed in */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        csrfToken: string;
                        mustChangePassword: boolean;
                        redirect: string;
                        /** @enum {string} */
                        status: "OK";
                        user: {
                            email: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                            /** @enum {string} */
                            role: "SUPER_ADMIN" | "ZONAL_ADMIN";
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    verifyMfa: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    code: string;
                    /** @enum {string} */
                    method: "AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP";
                } | {
                    code: string;
                    /** @enum {string} */
                    method: "BACKUP_CODE";
                };
            };
        };
        responses: {
            /** @description Signed in; session cookie set, pending cookie cleared */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        csrfToken: string;
                        mustChangePassword: boolean;
                        redirect: string;
                        /** @enum {string} */
                        status: "OK";
                        user: {
                            email: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                            /** @enum {string} */
                            role: "SUPER_ADMIN" | "ZONAL_ADMIN";
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Too many requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    reauth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    code?: string;
                    /** @enum {string} */
                    method?: "AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP" | "BACKUP_CODE";
                    password: string;
                };
            };
        };
        responses: {
            /** @description Re-authenticated: PASSWORD (10 minutes) or STRONG (5 minutes, one action) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        level: "PASSWORD" | "STRONG";
                        /** Format: date-time */
                        validUntil: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    resetPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    newPassword: string;
                    token: string;
                };
            };
        };
        responses: {
            /** @description Password updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        message: string;
                    };
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listCategories: {
        parameters: {
            query?: {
                kind?: "global" | "zone";
                page?: number;
                pageSize?: number;
                q?: string;
                sort?: string;
                zoneId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: uuid */
                            id: string;
                            itemCount: number;
                            name: string;
                            sortOrder: number;
                            /** Format: date-time */
                            updatedAt: string;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createCategory: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    /** @default 0 */
                    sortOrder?: number;
                    /** Format: uuid */
                    zoneId: string | null;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: uuid */
                        id: string;
                        itemCount: number;
                        name: string;
                        sortOrder: number;
                        /** Format: date-time */
                        updatedAt: string;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    deleteCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description The category still has live menu items */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    updateCategory: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    sortOrder?: number;
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: uuid */
                        id: string;
                        itemCount: number;
                        name: string;
                        sortOrder: number;
                        /** Format: date-time */
                        updatedAt: string;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listCustomers: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
                q?: string;
                sort?: string;
                source?: "APP" | "ADMIN" | "REFERRAL" | "OTHER" | "IMPORT";
                status?: "ACTIVE" | "INACTIVE" | "BLOCKED";
                zoneId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            createdAt: string;
                            email: string | null;
                            /** Format: uuid */
                            id: string;
                            /** Format: date-time */
                            lastOrderAt: string | null;
                            name: string;
                            orderCount: number;
                            phone: string;
                            source: string | null;
                            /** @enum {string} */
                            status: "ACTIVE" | "INACTIVE" | "BLOCKED";
                            totalSpentPaise: number;
                            zones: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            }[];
                        }[];
                        meta: {
                            counts: {
                                active: number;
                                blocked: number;
                                inactive: number;
                                total: number;
                            };
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createCustomer: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    address: {
                        address: string;
                        area?: string;
                        label?: string;
                        pincode?: string;
                        /** Format: uuid */
                        zoneId: string;
                    };
                    /** Format: email */
                    email?: string;
                    name: string;
                    phone: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        addresses: {
                            address: string;
                            area: string | null;
                            /** Format: uuid */
                            id: string;
                            isDefault: boolean;
                            label: string | null;
                            pincode: string | null;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        /** Format: date-time */
                        createdAt: string;
                        email: string | null;
                        /** Format: uuid */
                        id: string;
                        /** Format: date-time */
                        lastOrderAt: string | null;
                        name: string;
                        orderCount: number;
                        phone: string;
                        recentOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                            totalPaise: number;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        source: string | null;
                        /** @enum {string} */
                        status: "ACTIVE" | "INACTIVE" | "BLOCKED";
                        totalSpentPaise: number;
                        /** Format: date-time */
                        updatedAt: string;
                        walletBalancePaise: number;
                        zones: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getCustomer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The customer */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        addresses: {
                            address: string;
                            area: string | null;
                            /** Format: uuid */
                            id: string;
                            isDefault: boolean;
                            label: string | null;
                            pincode: string | null;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        /** Format: date-time */
                        createdAt: string;
                        email: string | null;
                        /** Format: uuid */
                        id: string;
                        /** Format: date-time */
                        lastOrderAt: string | null;
                        name: string;
                        orderCount: number;
                        phone: string;
                        recentOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                            totalPaise: number;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        source: string | null;
                        /** @enum {string} */
                        status: "ACTIVE" | "INACTIVE" | "BLOCKED";
                        totalSpentPaise: number;
                        /** Format: date-time */
                        updatedAt: string;
                        walletBalancePaise: number;
                        zones: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    updateCustomer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: email */
                    email?: string | null;
                    name?: string;
                    phone?: string;
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        addresses: {
                            address: string;
                            area: string | null;
                            /** Format: uuid */
                            id: string;
                            isDefault: boolean;
                            label: string | null;
                            pincode: string | null;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        /** Format: date-time */
                        createdAt: string;
                        email: string | null;
                        /** Format: uuid */
                        id: string;
                        /** Format: date-time */
                        lastOrderAt: string | null;
                        name: string;
                        orderCount: number;
                        phone: string;
                        recentOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                            totalPaise: number;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        source: string | null;
                        /** @enum {string} */
                        status: "ACTIVE" | "INACTIVE" | "BLOCKED";
                        totalSpentPaise: number;
                        /** Format: date-time */
                        updatedAt: string;
                        walletBalancePaise: number;
                        zones: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    blockCustomer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Blocked */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        addresses: {
                            address: string;
                            area: string | null;
                            /** Format: uuid */
                            id: string;
                            isDefault: boolean;
                            label: string | null;
                            pincode: string | null;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        /** Format: date-time */
                        createdAt: string;
                        email: string | null;
                        /** Format: uuid */
                        id: string;
                        /** Format: date-time */
                        lastOrderAt: string | null;
                        name: string;
                        orderCount: number;
                        phone: string;
                        recentOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                            totalPaise: number;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        source: string | null;
                        /** @enum {string} */
                        status: "ACTIVE" | "INACTIVE" | "BLOCKED";
                        totalSpentPaise: number;
                        /** Format: date-time */
                        updatedAt: string;
                        walletBalancePaise: number;
                        zones: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    revealCustomerContact: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Contact details */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        email: string | null;
                        phone: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Too many requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    unblockCustomer: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Unblocked */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        addresses: {
                            address: string;
                            area: string | null;
                            /** Format: uuid */
                            id: string;
                            isDefault: boolean;
                            label: string | null;
                            pincode: string | null;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        /** Format: date-time */
                        createdAt: string;
                        email: string | null;
                        /** Format: uuid */
                        id: string;
                        /** Format: date-time */
                        lastOrderAt: string | null;
                        name: string;
                        orderCount: number;
                        phone: string;
                        recentOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                            totalPaise: number;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        source: string | null;
                        /** @enum {string} */
                        status: "ACTIVE" | "INACTIVE" | "BLOCKED";
                        totalSpentPaise: number;
                        /** Format: date-time */
                        updatedAt: string;
                        walletBalancePaise: number;
                        zones: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getDashboardNewRegistrations: {
        parameters: {
            query?: {
                range?: "today" | "7d" | "30d" | "month";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The tabs */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        customers: {
                            count: number;
                            latest: {
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            }[];
                        } | null;
                        deliveryPartners: {
                            count: number;
                            latest: {
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            }[];
                        } | null;
                        /** @enum {string} */
                        range: "today" | "7d" | "30d" | "month";
                        vendors: {
                            count: number;
                            latest: {
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                                /** @enum {string} */
                                vendorType: "RESTAURANT" | "HOMEMAKER";
                            }[];
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getDashboardOrderOverview: {
        parameters: {
            query?: {
                range?: "today" | "7d" | "30d" | "month";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The series */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        bucket: "hour" | "day";
                        data: {
                            /** Format: date-time */
                            at: string;
                            delivered: number;
                            orders: number;
                        }[] | null;
                        /** @enum {string} */
                        range: "today" | "7d" | "30d" | "month";
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getDashboardOrderStatus: {
        parameters: {
            query?: {
                range?: "today" | "7d" | "30d" | "month";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Counts per status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            count: number;
                            /** @enum {string} */
                            status: "PLACED" | "ACCEPTED" | "PREPARING" | "READY" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED" | "REFUNDED";
                        }[] | null;
                        /** @enum {string} */
                        range: "today" | "7d" | "30d" | "month";
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getDashboardSummary: {
        parameters: {
            query?: {
                range?: "today" | "7d" | "30d" | "month";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The KPIs */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        customers: number | null;
                        deliveryPartners: {
                            active: number;
                            onDuty: number;
                            pendingVerification: number;
                            total: number;
                        } | null;
                        homemakers: {
                            active: number;
                            pendingVerification: number;
                            suspended: number;
                            total: number;
                        } | null;
                        orders: {
                            cancellationRate: number;
                            cancelled: number;
                            delivered: number;
                            total: number;
                        } | null;
                        platformHealth: {
                            activeSessions: number;
                            pendingVerifications: number;
                        } | null;
                        /** @enum {string} */
                        range: "today" | "7d" | "30d" | "month";
                        restaurants: {
                            active: number;
                            pendingVerification: number;
                            suspended: number;
                            total: number;
                        } | null;
                        zonesWithoutTeam: number | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getDashboardTopCategories: {
        parameters: {
            query?: {
                range?: "today" | "7d" | "30d" | "month";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The top 5 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            quantity: number;
                        }[] | null;
                        /** @enum {string} */
                        range: "today" | "7d" | "30d" | "month";
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getDashboardTopRestaurants: {
        parameters: {
            query?: {
                range?: "today" | "7d" | "30d" | "month";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The top 5 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            deliveredOrders: number;
                            /** Format: uuid */
                            id: string;
                            name: string;
                            /** @enum {string} */
                            vendorType: "RESTAURANT" | "HOMEMAKER";
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[] | null;
                        /** @enum {string} */
                        range: "today" | "7d" | "30d" | "month";
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getDashboardZoneOrders: {
        parameters: {
            query?: {
                range?: "today" | "7d" | "30d" | "month";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The bars */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        by: "zone" | "area";
                        data: {
                            key: string;
                            label: string;
                            orders: number;
                        }[] | null;
                        /** @enum {string} */
                        range: "today" | "7d" | "30d" | "month";
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listPartners: {
        parameters: {
            query?: {
                area?: string;
                assignment?: "ASSIGNED" | "UNASSIGNED";
                available?: "true" | "false";
                online?: "true" | "false";
                page?: number;
                pageSize?: number;
                q?: string;
                sort?: string;
                status?: "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                vehicleType?: string;
                verification?: "PENDING" | "VERIFIED" | "REJECTED";
                zoneId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of partners */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            area: string | null;
                            assignable: boolean;
                            /** @enum {string} */
                            assignment: "ASSIGNED" | "UNASSIGNED";
                            cashInHand: number;
                            /** Format: date-time */
                            createdAt: string;
                            currentOrders: number;
                            deliveriesCount: number;
                            email: string | null;
                            /** Format: date-time */
                            forceOfflineUntil: string | null;
                            /** Format: uuid */
                            id: string;
                            isOnline: boolean;
                            maxConcurrentOrders: number | null;
                            name: string;
                            phone: string | null;
                            ratingAvg: number | null;
                            /** @enum {string} */
                            source: "APP" | "ADMIN" | "IMPORT";
                            /** @enum {string} */
                            status: "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                            /** Format: date-time */
                            updatedAt: string;
                            vehicleNo: string | null;
                            vehicleType: string | null;
                            /** @enum {string} */
                            verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                            version: number;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        meta: {
                            counts: {
                                active: number;
                                inactive: number;
                                onDuty: number;
                                pendingVerification: number;
                                rejected: number;
                                suspended: number;
                                total: number;
                            };
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createPartner: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    area?: string;
                    /** Format: email */
                    email?: string;
                    name: string;
                    phone: string;
                    vehicleNo?: string;
                    vehicleType?: string;
                    /** Format: uuid */
                    zoneId: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        area: string | null;
                        assignable: boolean;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        cashInHand: number;
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        /** Format: date-time */
                        createdAt: string;
                        currentOrders: number;
                        deliveriesCount: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        /** Format: date-time */
                        forceOfflineUntil: string | null;
                        /** Format: uuid */
                        id: string;
                        isOnline: boolean;
                        maxConcurrentOrders: number | null;
                        name: string;
                        openOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                        }[];
                        phone: string | null;
                        ratingAvg: number | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        vehicleNo: string | null;
                        vehicleType: string | null;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getPartner: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The partner */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        area: string | null;
                        assignable: boolean;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        cashInHand: number;
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        /** Format: date-time */
                        createdAt: string;
                        currentOrders: number;
                        deliveriesCount: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        /** Format: date-time */
                        forceOfflineUntil: string | null;
                        /** Format: uuid */
                        id: string;
                        isOnline: boolean;
                        maxConcurrentOrders: number | null;
                        name: string;
                        openOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                        }[];
                        phone: string | null;
                        ratingAvg: number | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        vehicleNo: string | null;
                        vehicleType: string | null;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    deletePartner: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    updatePartner: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    area?: string | null;
                    /** Format: email */
                    email?: string | null;
                    name?: string;
                    phone?: string;
                    vehicleNo?: string | null;
                    vehicleType?: string | null;
                    version: number;
                };
            };
        };
        responses: {
            /** @description The partner */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        area: string | null;
                        assignable: boolean;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        cashInHand: number;
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        /** Format: date-time */
                        createdAt: string;
                        currentOrders: number;
                        deliveriesCount: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        /** Format: date-time */
                        forceOfflineUntil: string | null;
                        /** Format: uuid */
                        id: string;
                        isOnline: boolean;
                        maxConcurrentOrders: number | null;
                        name: string;
                        openOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                        }[];
                        phone: string | null;
                        ratingAvg: number | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        vehicleNo: string | null;
                        vehicleType: string | null;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    attachPartnerDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    docType: string;
                    fileKey: string;
                };
            };
        };
        responses: {
            /** @description Attached */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        area: string | null;
                        assignable: boolean;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        cashInHand: number;
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        /** Format: date-time */
                        createdAt: string;
                        currentOrders: number;
                        deliveriesCount: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        /** Format: date-time */
                        forceOfflineUntil: string | null;
                        /** Format: uuid */
                        id: string;
                        isOnline: boolean;
                        maxConcurrentOrders: number | null;
                        name: string;
                        openOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                        }[];
                        phone: string | null;
                        ratingAvg: number | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        vehicleNo: string | null;
                        vehicleType: string | null;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getPartnerDocumentUrl: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                docId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The link */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        expiresInSec: number;
                        url: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    verifyPartnerDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                docId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    decision: "VERIFIED" | "REJECTED";
                    note?: string;
                };
            };
        };
        responses: {
            /** @description The partner */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        area: string | null;
                        assignable: boolean;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        cashInHand: number;
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        /** Format: date-time */
                        createdAt: string;
                        currentOrders: number;
                        deliveriesCount: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        /** Format: date-time */
                        forceOfflineUntil: string | null;
                        /** Format: uuid */
                        id: string;
                        isOnline: boolean;
                        maxConcurrentOrders: number | null;
                        name: string;
                        openOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                        }[];
                        phone: string | null;
                        ratingAvg: number | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        vehicleNo: string | null;
                        vehicleType: string | null;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    forcePartnerOffline: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                    /** Format: date-time */
                    until: string;
                };
            };
        };
        responses: {
            /** @description The partner */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        area: string | null;
                        assignable: boolean;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        cashInHand: number;
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        /** Format: date-time */
                        createdAt: string;
                        currentOrders: number;
                        deliveriesCount: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        /** Format: date-time */
                        forceOfflineUntil: string | null;
                        /** Format: uuid */
                        id: string;
                        isOnline: boolean;
                        maxConcurrentOrders: number | null;
                        name: string;
                        openOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                        }[];
                        phone: string | null;
                        ratingAvg: number | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        vehicleNo: string | null;
                        vehicleType: string | null;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    movePartnerZone: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                    /** Format: uuid */
                    zoneId: string;
                };
            };
        };
        responses: {
            /** @description The partner */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        area: string | null;
                        assignable: boolean;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        cashInHand: number;
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        /** Format: date-time */
                        createdAt: string;
                        currentOrders: number;
                        deliveriesCount: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        /** Format: date-time */
                        forceOfflineUntil: string | null;
                        /** Format: uuid */
                        id: string;
                        isOnline: boolean;
                        maxConcurrentOrders: number | null;
                        name: string;
                        openOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                        }[];
                        phone: string | null;
                        ratingAvg: number | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        vehicleNo: string | null;
                        vehicleType: string | null;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    revealPartnerContact: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The contact */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        email: string | null;
                        phone: string | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    setPartnerStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason?: string;
                    /** @enum {string} */
                    status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
                };
            };
        };
        responses: {
            /** @description The partner */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        area: string | null;
                        assignable: boolean;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        cashInHand: number;
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        /** Format: date-time */
                        createdAt: string;
                        currentOrders: number;
                        deliveriesCount: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        /** Format: date-time */
                        forceOfflineUntil: string | null;
                        /** Format: uuid */
                        id: string;
                        isOnline: boolean;
                        maxConcurrentOrders: number | null;
                        name: string;
                        openOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                        }[];
                        phone: string | null;
                        ratingAvg: number | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        vehicleNo: string | null;
                        vehicleType: string | null;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    verifyPartner: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    decision: "VERIFIED" | "REJECTED";
                    note?: string;
                };
            };
        };
        responses: {
            /** @description The partner */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        area: string | null;
                        assignable: boolean;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        cashInHand: number;
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        /** Format: date-time */
                        createdAt: string;
                        currentOrders: number;
                        deliveriesCount: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        /** Format: date-time */
                        forceOfflineUntil: string | null;
                        /** Format: uuid */
                        id: string;
                        isOnline: boolean;
                        maxConcurrentOrders: number | null;
                        name: string;
                        openOrders: {
                            /** Format: uuid */
                            id: string;
                            orderNo: string;
                            /** Format: date-time */
                            placedAt: string;
                            status: string;
                        }[];
                        phone: string | null;
                        ratingAvg: number | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        vehicleNo: string | null;
                        vehicleType: string | null;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listHomemakers: {
        parameters: {
            query?: {
                area?: string;
                assignment?: "ASSIGNED" | "UNASSIGNED";
                page?: number;
                pageSize?: number;
                q?: string;
                sort?: string;
                status?: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                tag?: string;
                verification?: "PENDING" | "VERIFIED" | "REJECTED";
                zoneId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            area: string | null;
                            /** @enum {string} */
                            assignment: "ASSIGNED" | "UNASSIGNED";
                            /** Format: date-time */
                            createdAt: string;
                            dailyCapacity: number;
                            email: string | null;
                            foodCategory: string | null;
                            /** Format: uuid */
                            id: string;
                            isAvailable: boolean;
                            isOpen: boolean;
                            name: string;
                            phone: string | null;
                            /** @enum {string} */
                            source: "APP" | "ADMIN" | "IMPORT";
                            specialityTags: string[];
                            /** @enum {string} */
                            status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                            /** Format: date-time */
                            updatedAt: string;
                            /** @enum {string} */
                            verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        meta: {
                            counts: {
                                active: number;
                                inactive: number;
                                pendingVerification: number;
                                rejected: number;
                                suspended: number;
                                total: number;
                            };
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createHomemaker: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    address: string;
                    area?: string;
                    commissionPct?: number;
                    /** @default 1 */
                    dailyCapacity?: number;
                    /** Format: email */
                    email?: string;
                    experienceYears?: number;
                    foodCategory?: string;
                    fssaiNo?: string;
                    /** @default true */
                    isAvailable?: boolean;
                    lat?: number;
                    lng?: number;
                    minOrderPaise?: number;
                    name: string;
                    openingHours?: {
                        closes?: string;
                        /** @enum {string} */
                        day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                        isOpen: boolean;
                        opens?: string;
                    }[];
                    phone: string;
                    /** @default [] */
                    specialityTags?: string[];
                    /** Format: uuid */
                    zoneId: string;
                };
            };
        };
        responses: {
            /** @description Created (status PENDING, verification PENDING) */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        dailyCapacity: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        experienceYears: number | null;
                        foodCategory: string | null;
                        fssaiNo: string | null;
                        hasPhoto: boolean;
                        /** Format: uuid */
                        id: string;
                        isAvailable: boolean;
                        isOpen: boolean;
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        specialityTags: string[];
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description The service is switched off in this zone (error.meta.service, D92) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getHomemaker: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The Home Food vendor */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        dailyCapacity: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        experienceYears: number | null;
                        foodCategory: string | null;
                        fssaiNo: string | null;
                        hasPhoto: boolean;
                        /** Format: uuid */
                        id: string;
                        isAvailable: boolean;
                        isOpen: boolean;
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        specialityTags: string[];
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    deleteHomemaker: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    updateHomemaker: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    address?: string;
                    area?: string | null;
                    commissionPct?: number;
                    dailyCapacity?: number;
                    /** Format: email */
                    email?: string | null;
                    experienceYears?: number | null;
                    foodCategory?: string | null;
                    fssaiNo?: string | null;
                    isAvailable?: boolean;
                    lat?: number | null;
                    lng?: number | null;
                    minOrderPaise?: number;
                    name?: string;
                    openingHours?: {
                        closes?: string;
                        /** @enum {string} */
                        day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                        isOpen: boolean;
                        opens?: string;
                    }[] | null;
                    phone?: string;
                    specialityTags?: string[];
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        dailyCapacity: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        experienceYears: number | null;
                        foodCategory: string | null;
                        fssaiNo: string | null;
                        hasPhoto: boolean;
                        /** Format: uuid */
                        id: string;
                        isAvailable: boolean;
                        isOpen: boolean;
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        specialityTags: string[];
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    attachHomemakerDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    docType: string;
                    fileKey: string;
                };
            };
        };
        responses: {
            /** @description Attached */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        dailyCapacity: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        experienceYears: number | null;
                        foodCategory: string | null;
                        fssaiNo: string | null;
                        hasPhoto: boolean;
                        /** Format: uuid */
                        id: string;
                        isAvailable: boolean;
                        isOpen: boolean;
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        specialityTags: string[];
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getHomemakerDocumentUrl: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                docId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Signed link */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        expiresInSec: number;
                        url: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    verifyHomemakerDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                docId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    decision: "VERIFIED" | "REJECTED";
                    note?: string;
                };
            };
        };
        responses: {
            /** @description Reviewed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        dailyCapacity: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        experienceYears: number | null;
                        foodCategory: string | null;
                        fssaiNo: string | null;
                        hasPhoto: boolean;
                        /** Format: uuid */
                        id: string;
                        isAvailable: boolean;
                        isOpen: boolean;
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        specialityTags: string[];
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    moveHomemakerZone: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                    /** Format: uuid */
                    zoneId: string;
                };
            };
        };
        responses: {
            /** @description Moved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        dailyCapacity: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        experienceYears: number | null;
                        foodCategory: string | null;
                        fssaiNo: string | null;
                        hasPhoto: boolean;
                        /** Format: uuid */
                        id: string;
                        isAvailable: boolean;
                        isOpen: boolean;
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        specialityTags: string[];
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    revealHomemakerContact: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Contact details */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        email: string | null;
                        phone: string | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    setHomemakerStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason?: string;
                    /** @enum {string} */
                    status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
                };
            };
        };
        responses: {
            /** @description Changed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        dailyCapacity: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        experienceYears: number | null;
                        foodCategory: string | null;
                        fssaiNo: string | null;
                        hasPhoto: boolean;
                        /** Format: uuid */
                        id: string;
                        isAvailable: boolean;
                        isOpen: boolean;
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        specialityTags: string[];
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    verifyHomemaker: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    decision: "VERIFIED" | "REJECTED";
                    note?: string;
                };
            };
        };
        responses: {
            /** @description Decided */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        dailyCapacity: number;
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        experienceYears: number | null;
                        foodCategory: string | null;
                        fssaiNo: string | null;
                        hasPhoto: boolean;
                        /** Format: uuid */
                        id: string;
                        isAvailable: boolean;
                        isOpen: boolean;
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        specialityTags: string[];
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listHotels: {
        parameters: {
            query?: {
                area?: string;
                page?: number;
                pageSize?: number;
                q?: string;
                sort?: string;
                status?: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                verification?: "PENDING" | "VERIFIED" | "REJECTED";
                zoneId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            area: string | null;
                            /** Format: date-time */
                            createdAt: string;
                            email: string | null;
                            /** Format: uuid */
                            id: string;
                            name: string;
                            occupiedRooms: number;
                            ownerName: string;
                            phone: string;
                            /** @enum {string} */
                            status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                            totalRooms: number;
                            /** Format: date-time */
                            updatedAt: string;
                            /** @enum {string} */
                            verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        meta: {
                            counts: {
                                active: number;
                                pendingVerification: number;
                                suspended: number;
                                total: number;
                            };
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createHotel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    address: string;
                    area?: string;
                    commissionPct?: number;
                    /** Format: email */
                    email?: string;
                    gstNo?: string;
                    name: string;
                    ownerName: string;
                    phone: string;
                    totalRooms: number;
                    /** Format: uuid */
                    zoneId: string;
                };
            };
        };
        responses: {
            /** @description Created (status and verification PENDING) */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string;
                        area: string | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        email: string | null;
                        gstNo: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        occupiedRooms: number;
                        ownerName: string;
                        phone: string;
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        totalRooms: number;
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description The service is switched off in this zone (error.meta.service, D92) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getHotel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The hotel */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string;
                        area: string | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        email: string | null;
                        gstNo: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        occupiedRooms: number;
                        ownerName: string;
                        phone: string;
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        totalRooms: number;
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    deleteHotel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    updateHotel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    address?: string;
                    area?: string | null;
                    commissionPct?: number;
                    /** Format: email */
                    email?: string | null;
                    gstNo?: string | null;
                    name?: string;
                    ownerName?: string;
                    phone?: string;
                    totalRooms?: number;
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string;
                        area: string | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        email: string | null;
                        gstNo: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        occupiedRooms: number;
                        ownerName: string;
                        phone: string;
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        totalRooms: number;
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listHotelRoomBookings: {
        parameters: {
            query?: {
                checkInFrom?: string;
                checkInTo?: string;
                hotelId?: string;
                page?: number;
                pageSize?: number;
                paymentStatus?: "PENDING" | "PAID" | "REFUNDED" | "FAILED";
                q?: string;
                sort?: string;
                status?: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
                zoneId?: string[];
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            amount: number;
                            /** Format: date */
                            checkIn: string;
                            /** Format: date */
                            checkOut: string;
                            /** Format: date-time */
                            createdAt: string;
                            customerName: string;
                            customerPhone: string;
                            guests: number;
                            hotel: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                            /** Format: uuid */
                            id: string;
                            note: string | null;
                            /** @enum {string} */
                            paymentStatus: "PENDING" | "PAID" | "REFUNDED" | "FAILED";
                            roomType: string;
                            /** @enum {string} */
                            status: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createRoomBooking: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    amount: number;
                    /** Format: date */
                    checkIn: string;
                    /** Format: date */
                    checkOut: string;
                    customerName: string;
                    customerPhone: string;
                    guests: number;
                    note?: string;
                    /**
                     * @default PENDING
                     * @enum {string}
                     */
                    paymentStatus?: "PENDING" | "PAID" | "REFUNDED" | "FAILED";
                    roomType: string;
                };
            };
        };
        responses: {
            /** @description Created (PENDING) */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        amount: number;
                        /** Format: date */
                        checkIn: string;
                        /** Format: date */
                        checkOut: string;
                        /** Format: date-time */
                        createdAt: string;
                        customerName: string;
                        customerPhone: string;
                        guests: number;
                        hotel: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                        /** Format: uuid */
                        id: string;
                        note: string | null;
                        /** @enum {string} */
                        paymentStatus: "PENDING" | "PAID" | "REFUNDED" | "FAILED";
                        roomType: string;
                        /** @enum {string} */
                        status: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
                        /** Format: date-time */
                        updatedAt: string;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state; No room is free for every night of the stay (D127); The service is switched off in this zone (error.meta.service, D92) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    setHotelStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason?: string;
                    /** @enum {string} */
                    status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
                };
            };
        };
        responses: {
            /** @description Moved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string;
                        area: string | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        email: string | null;
                        gstNo: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        occupiedRooms: number;
                        ownerName: string;
                        phone: string;
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        totalRooms: number;
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    verifyHotel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    decision: "VERIFIED" | "REJECTED";
                    note?: string;
                };
            };
        };
        responses: {
            /** @description Decided */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string;
                        area: string | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        email: string | null;
                        gstNo: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        occupiedRooms: number;
                        ownerName: string;
                        phone: string;
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        totalRooms: number;
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listRoomBookings: {
        parameters: {
            query?: {
                checkInFrom?: string;
                checkInTo?: string;
                hotelId?: string;
                page?: number;
                pageSize?: number;
                paymentStatus?: "PENDING" | "PAID" | "REFUNDED" | "FAILED";
                q?: string;
                sort?: string;
                status?: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
                zoneId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            amount: number;
                            /** Format: date */
                            checkIn: string;
                            /** Format: date */
                            checkOut: string;
                            /** Format: date-time */
                            createdAt: string;
                            customerName: string;
                            customerPhone: string;
                            guests: number;
                            hotel: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                            /** Format: uuid */
                            id: string;
                            note: string | null;
                            /** @enum {string} */
                            paymentStatus: "PENDING" | "PAID" | "REFUNDED" | "FAILED";
                            roomType: string;
                            /** @enum {string} */
                            status: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getRoomBooking: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                bookingId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The booking */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        amount: number;
                        /** Format: date */
                        checkIn: string;
                        /** Format: date */
                        checkOut: string;
                        /** Format: date-time */
                        createdAt: string;
                        customerName: string;
                        customerPhone: string;
                        guests: number;
                        hotel: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                        /** Format: uuid */
                        id: string;
                        note: string | null;
                        /** @enum {string} */
                        paymentStatus: "PENDING" | "PAID" | "REFUNDED" | "FAILED";
                        roomType: string;
                        /** @enum {string} */
                        status: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
                        /** Format: date-time */
                        updatedAt: string;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    setRoomBookingStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                bookingId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    note?: string;
                    /** @enum {string} */
                    status: "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
                    version: number;
                };
            };
        };
        responses: {
            /** @description Moved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        amount: number;
                        /** Format: date */
                        checkIn: string;
                        /** Format: date */
                        checkOut: string;
                        /** Format: date-time */
                        createdAt: string;
                        customerName: string;
                        customerPhone: string;
                        guests: number;
                        hotel: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                        /** Format: uuid */
                        id: string;
                        note: string | null;
                        /** @enum {string} */
                        paymentStatus: "PENDING" | "PAID" | "REFUNDED" | "FAILED";
                        roomType: string;
                        /** @enum {string} */
                        status: "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
                        /** Format: date-time */
                        updatedAt: string;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listDiningReservations: {
        parameters: {
            query?: {
                hotelId?: string;
                page?: number;
                pageSize?: number;
                q?: string;
                reservedDate?: string;
                restaurantId?: string;
                sort?: string;
                status?: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
                zoneId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            amount: number | null;
                            /** Format: date-time */
                            createdAt: string;
                            customerName: string;
                            customerPhone: string;
                            guests: number;
                            hotel: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                            /** Format: uuid */
                            id: string;
                            note: string | null;
                            /** @enum {string} */
                            paymentStatus: "PENDING" | "PAID" | "REFUNDED" | "FAILED";
                            /** Format: date */
                            reservedDate: string;
                            reservedTime: string;
                            restaurant: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                            /** @enum {string} */
                            status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
                            tableArea: string | null;
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createDiningReservation: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    amount?: number;
                    customerName: string;
                    customerPhone: string;
                    guests: number;
                    /** Format: uuid */
                    hotelId?: string;
                    note?: string;
                    /**
                     * @default PENDING
                     * @enum {string}
                     */
                    paymentStatus?: "PENDING" | "PAID" | "REFUNDED" | "FAILED";
                    /** Format: date */
                    reservedDate: string;
                    reservedTime: string;
                    /** Format: uuid */
                    restaurantId?: string;
                    tableArea?: string;
                };
            };
        };
        responses: {
            /** @description Created (PENDING) */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        amount: number | null;
                        /** Format: date-time */
                        createdAt: string;
                        customerName: string;
                        customerPhone: string;
                        guests: number;
                        hotel: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        /** Format: uuid */
                        id: string;
                        note: string | null;
                        /** @enum {string} */
                        paymentStatus: "PENDING" | "PAID" | "REFUNDED" | "FAILED";
                        /** Format: date */
                        reservedDate: string;
                        reservedTime: string;
                        restaurant: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        /** @enum {string} */
                        status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
                        tableArea: string | null;
                        /** Format: date-time */
                        updatedAt: string;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; The service is switched off in this zone (error.meta.service, D92) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getDiningReservation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                diningId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The reservation */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        amount: number | null;
                        /** Format: date-time */
                        createdAt: string;
                        customerName: string;
                        customerPhone: string;
                        guests: number;
                        hotel: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        /** Format: uuid */
                        id: string;
                        note: string | null;
                        /** @enum {string} */
                        paymentStatus: "PENDING" | "PAID" | "REFUNDED" | "FAILED";
                        /** Format: date */
                        reservedDate: string;
                        reservedTime: string;
                        restaurant: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        /** @enum {string} */
                        status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
                        tableArea: string | null;
                        /** Format: date-time */
                        updatedAt: string;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    setDiningReservationStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                diningId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    note?: string;
                    /** @enum {string} */
                    status: "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
                    version: number;
                };
            };
        };
        responses: {
            /** @description Moved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        amount: number | null;
                        /** Format: date-time */
                        createdAt: string;
                        customerName: string;
                        customerPhone: string;
                        guests: number;
                        hotel: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        /** Format: uuid */
                        id: string;
                        note: string | null;
                        /** @enum {string} */
                        paymentStatus: "PENDING" | "PAID" | "REFUNDED" | "FAILED";
                        /** Format: date */
                        reservedDate: string;
                        reservedTime: string;
                        restaurant: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        /** @enum {string} */
                        status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
                        tableArea: string | null;
                        /** Format: date-time */
                        updatedAt: string;
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listLoginHistory: {
        parameters: {
            query?: {
                after?: string;
                from?: string;
                limit?: number;
                success?: "true" | "false";
                to?: string;
                userId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of sign-in attempts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            createdAt: string;
                            emailAttempted: string;
                            /** Format: uuid */
                            id: string;
                            ip: string | null;
                            reason: string | null;
                            success: boolean;
                            userAgent: string | null;
                            /** Format: uuid */
                            userId: string | null;
                        }[];
                        meta: {
                            limit: number;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current user */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        csrfToken: string;
                        mfa: {
                            enabled: boolean;
                            enrolmentNeeded: boolean;
                            required: boolean;
                        };
                        mustChangePassword: boolean;
                        permissions: {
                            /** @enum {boolean} */
                            global: true;
                        } | {
                            /** @enum {boolean} */
                            global: false;
                            zones: {
                                code: string;
                                colorHex: string;
                                limits: {
                                    canExport: boolean;
                                    canReveal: boolean;
                                    dailyRefund: number;
                                    perRefund: number;
                                };
                                name: string;
                                permissions: ("dashboard:view" | "dashboard:add" | "dashboard:edit" | "dashboard:delete" | "dashboard:status" | "orders:view" | "orders:add" | "orders:edit" | "orders:delete" | "orders:status" | "restaurants:view" | "restaurants:add" | "restaurants:edit" | "restaurants:delete" | "restaurants:status" | "homemakers:view" | "homemakers:add" | "homemakers:edit" | "homemakers:delete" | "homemakers:status" | "menu:view" | "menu:add" | "menu:edit" | "menu:delete" | "menu:status" | "delivery:view" | "delivery:add" | "delivery:edit" | "delivery:delete" | "delivery:status" | "customers:view" | "customers:add" | "customers:edit" | "customers:delete" | "customers:status" | "payments:view" | "payments:add" | "payments:edit" | "payments:delete" | "payments:status" | "refunds:view" | "refunds:add" | "refunds:edit" | "refunds:delete" | "refunds:status" | "settlements:view" | "settlements:add" | "settlements:edit" | "settlements:delete" | "settlements:status" | "payouts:view" | "payouts:add" | "payouts:edit" | "payouts:delete" | "payouts:status" | "commission:view" | "commission:add" | "commission:edit" | "commission:delete" | "commission:status" | "zones:view" | "zones:add" | "zones:edit" | "zones:delete" | "zones:status" | "admins:view" | "admins:add" | "admins:edit" | "admins:delete" | "admins:status" | "access:view" | "access:add" | "access:edit" | "access:delete" | "access:status" | "offers:view" | "offers:add" | "offers:edit" | "offers:delete" | "offers:status" | "notifications:view" | "notifications:add" | "notifications:edit" | "notifications:delete" | "notifications:status" | "analytics:view" | "analytics:add" | "analytics:edit" | "analytics:delete" | "analytics:status" | "reviews:view" | "reviews:add" | "reviews:edit" | "reviews:delete" | "reviews:status" | "support:view" | "support:add" | "support:edit" | "support:delete" | "support:status" | "settings:view" | "settings:add" | "settings:edit" | "settings:delete" | "settings:status" | "integrations:view" | "integrations:add" | "integrations:edit" | "integrations:delete" | "integrations:status" | "audit:view" | "audit:add" | "audit:edit" | "audit:delete" | "audit:status" | "hotels:view" | "hotels:add" | "hotels:edit" | "hotels:delete" | "hotels:status" | "bookings:view" | "bookings:add" | "bookings:edit" | "bookings:delete" | "bookings:status" | "dining:view" | "dining:add" | "dining:edit" | "dining:delete" | "dining:status" | "loyalty:view" | "loyalty:add" | "loyalty:edit" | "loyalty:delete" | "loyalty:status")[];
                                services?: {
                                    HOME_FOOD: boolean;
                                    HOTEL_BOOKING: boolean;
                                    RESTAURANTS: boolean;
                                };
                                /** @enum {string} */
                                status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                                /** Format: uuid */
                                zoneId: string;
                            }[];
                        };
                        user: {
                            email: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                            /** @enum {string} */
                            role: "SUPER_ADMIN" | "ZONAL_ADMIN";
                        };
                        zoneScope?: string[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listMyAccessRequests: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description My requests */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string|null} */
                            action: "view" | "add" | "edit" | "delete" | "status" | null;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            decidedAt: string | null;
                            decidedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                            decisionReason: string | null;
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "ZONE" | "PERMISSION";
                            /** @enum {string|null} */
                            module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty" | null;
                            reason: string;
                            requester: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                            /** @enum {string} */
                            status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
                            version: number;
                            zone: {
                                code: string;
                                colorHex: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        requestable: {
                            permissions: {
                                /** @enum {string} */
                                action: "view" | "add" | "edit" | "delete" | "status";
                                /** @enum {string} */
                                module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                            }[];
                            zones: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                                /** @enum {string} */
                                status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                            }[];
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createAccessRequest: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    kind: "ZONE";
                    reason: string;
                    /** Format: uuid */
                    zoneId: string;
                } | {
                    /** @enum {string} */
                    action: "view" | "add" | "edit" | "delete" | "status";
                    /** @enum {string} */
                    kind: "PERMISSION";
                    /** @enum {string} */
                    module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                    reason: string;
                    /** Format: uuid */
                    zoneId: string;
                };
            };
        };
        responses: {
            /** @description Requested */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string|null} */
                        action: "view" | "add" | "edit" | "delete" | "status" | null;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionReason: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "ZONE" | "PERMISSION";
                        /** @enum {string|null} */
                        module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty" | null;
                        reason: string;
                        requester: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                        /** @enum {string} */
                        status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
                        version: number;
                        zone: {
                            code: string;
                            colorHex: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    cancelAccessRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cancelled */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string|null} */
                        action: "view" | "add" | "edit" | "delete" | "status" | null;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionReason: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "ZONE" | "PERMISSION";
                        /** @enum {string|null} */
                        module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty" | null;
                        reason: string;
                        requester: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                        /** @enum {string} */
                        status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
                        version: number;
                        zone: {
                            code: string;
                            colorHex: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listMyLoginHistory: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Own sign-ins */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            createdAt: string;
                            emailAttempted: string;
                            /** Format: uuid */
                            id: string;
                            ip: string | null;
                            reason: string | null;
                            success: boolean;
                            userAgent: string | null;
                            /** Format: uuid */
                            userId: string | null;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getMyMfa: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 2-step overview */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        authenticatorPending: boolean;
                        backupCodesRemaining: number;
                        mailboxProved?: boolean;
                        methods: {
                            hint: string;
                            primary: boolean;
                            /** @enum {string} */
                            type: "AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP";
                        }[];
                        policy: {
                            allowed: ("AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP")[];
                            required: boolean;
                            smsAvailable: boolean;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    mfaRemoveMethod: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                type: "AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description The 2-step policy requires at least one method; this is the last one */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    mfaAuthenticatorConfirm: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    code: string;
                };
            };
        };
        responses: {
            /** @description Confirmed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        backupCodes?: string[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    mfaAuthenticatorStart: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Secret and otpauth URI */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        otpauthUri: string;
                        secretBase32: string;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    mfaRegenerateBackupCodes: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Ten new codes */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        codes: string[];
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    mfaEmailConfirm: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    code: string;
                };
            };
        };
        responses: {
            /** @description Confirmed; backup codes when this is the first method */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        backupCodes?: string[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    mfaEmailStart: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Code sent */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        expiresInSeconds: number;
                        hint: string;
                        resendAfterSeconds: number;
                        sent: boolean;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Too many requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    mfaSetPrimary: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    type: "AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP";
                };
            };
        };
        responses: {
            /** @description Saved */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    mfaSmsConfirm: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    code: string;
                };
            };
        };
        responses: {
            /** @description Confirmed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        backupCodes?: string[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    mfaSmsStart: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Code sent */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        expiresInSeconds: number;
                        hint: string;
                        resendAfterSeconds: number;
                        sent: boolean;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description There is no mobile number on the account; SMS codes are switched off, paused or have no provider */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Too many requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listMySessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Live sessions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            createdAt: string;
                            current: boolean;
                            /** Format: date-time */
                            expiresAt: string;
                            /** Format: uuid */
                            id: string;
                            ip: string | null;
                            /** Format: date-time */
                            lastSeenAt: string;
                            remember: boolean;
                            userAgent: string | null;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    revokeSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    revokeOtherSessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Number of sessions signed out */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        revoked: number;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    putZoneScope: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    zoneIds: string[];
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        zoneIds: string[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    resetMemberMfa: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Reset done */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        methodsRemoved: number;
                        sessionsRevoked: number;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listMenuItems: {
        parameters: {
            query?: {
                availability?: "live" | "out_of_stock" | "vendor_off" | "admin_disabled";
                categoryId?: string;
                dietary?: "VEGETARIAN" | "NON_VEG" | "EGG";
                featured?: boolean;
                page?: number;
                pageSize?: number;
                q?: string;
                sort?: string;
                vendorId?: string;
                vendorKind?: "RESTAURANT" | "HOMEMAKER";
                zoneId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            adminDisabled: boolean;
                            /** @enum {string} */
                            availability: "live" | "out_of_stock" | "vendor_off" | "admin_disabled";
                            category: {
                                global: boolean;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                            /** Format: date-time */
                            createdAt: string;
                            description: string | null;
                            /** @enum {string|null} */
                            dietary: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                            hasImage: boolean;
                            hasPendingChange: boolean;
                            /** Format: uuid */
                            id: string;
                            isAvailable: boolean;
                            isFeatured: boolean;
                            name: string;
                            price: number;
                            stock: number;
                            /** Format: date-time */
                            updatedAt: string;
                            vendor: {
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                kind: "RESTAURANT" | "HOMEMAKER";
                                name: string;
                            };
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        meta: {
                            counts: {
                                adminDisabled: number;
                                live: number;
                                outOfStock: number;
                                pendingChanges: number;
                                total: number;
                                vendorOff: number;
                            };
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createMenuItem: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    categoryId: string;
                    description?: string;
                    /** @enum {string} */
                    dietary?: "VEGETARIAN" | "NON_VEG" | "EGG";
                    imageKey?: string;
                    /** @default true */
                    isAvailable?: boolean;
                    /** @default false */
                    isFeatured?: boolean;
                    name: string;
                    price: number;
                    /** @default 0 */
                    stock?: number;
                    /** Format: uuid */
                    vendorId: string;
                    /** @enum {string} */
                    vendorKind: "RESTAURANT" | "HOMEMAKER";
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        adminDisabled: boolean;
                        /** Format: date-time */
                        adminOverrideAt: string | null;
                        /** @enum {string} */
                        availability: "live" | "out_of_stock" | "vendor_off" | "admin_disabled";
                        category: {
                            global: boolean;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                        /** Format: date-time */
                        createdAt: string;
                        description: string | null;
                        /** @enum {string|null} */
                        dietary: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                        hasImage: boolean;
                        hasPendingChange: boolean;
                        /** Format: uuid */
                        id: string;
                        isAvailable: boolean;
                        isFeatured: boolean;
                        name: string;
                        /** Format: uuid */
                        pendingChangeRequestId: string | null;
                        price: number;
                        stock: number;
                        /** Format: date-time */
                        updatedAt: string;
                        vendor: {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "RESTAURANT" | "HOMEMAKER";
                            name: string;
                        };
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getMenuItem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The item */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        adminDisabled: boolean;
                        /** Format: date-time */
                        adminOverrideAt: string | null;
                        /** @enum {string} */
                        availability: "live" | "out_of_stock" | "vendor_off" | "admin_disabled";
                        category: {
                            global: boolean;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                        /** Format: date-time */
                        createdAt: string;
                        description: string | null;
                        /** @enum {string|null} */
                        dietary: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                        hasImage: boolean;
                        hasPendingChange: boolean;
                        /** Format: uuid */
                        id: string;
                        isAvailable: boolean;
                        isFeatured: boolean;
                        name: string;
                        /** Format: uuid */
                        pendingChangeRequestId: string | null;
                        price: number;
                        stock: number;
                        /** Format: date-time */
                        updatedAt: string;
                        vendor: {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "RESTAURANT" | "HOMEMAKER";
                            name: string;
                        };
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    deleteMenuItem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    updateMenuItem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    adminDisabled?: boolean;
                    /** Format: uuid */
                    categoryId?: string;
                    description?: string | null;
                    /** @enum {string|null} */
                    dietary?: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                    imageKey?: string | null;
                    isFeatured?: boolean;
                    name?: string;
                    price?: number;
                    reason?: string;
                    stock?: number;
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        adminDisabled: boolean;
                        /** Format: date-time */
                        adminOverrideAt: string | null;
                        /** @enum {string} */
                        availability: "live" | "out_of_stock" | "vendor_off" | "admin_disabled";
                        category: {
                            global: boolean;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                        /** Format: date-time */
                        createdAt: string;
                        description: string | null;
                        /** @enum {string|null} */
                        dietary: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                        hasImage: boolean;
                        hasPendingChange: boolean;
                        /** Format: uuid */
                        id: string;
                        isAvailable: boolean;
                        isFeatured: boolean;
                        name: string;
                        /** Format: uuid */
                        pendingChangeRequestId: string | null;
                        price: number;
                        stock: number;
                        /** Format: date-time */
                        updatedAt: string;
                        vendor: {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "RESTAURANT" | "HOMEMAKER";
                            name: string;
                        };
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    applyMenuBulk: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    action: "availability";
                    adminDisabled: boolean;
                    ids: string[];
                    reason?: string;
                } | {
                    /** @enum {string} */
                    action: "category";
                    /** Format: uuid */
                    categoryId: string;
                    ids: string[];
                } | {
                    /** @enum {string} */
                    action: "price";
                    ids: string[];
                    /** @enum {string} */
                    mode: "percent" | "amount";
                    value: number;
                };
            };
        };
        responses: {
            /** @description Applied */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        action: "availability" | "category" | "price";
                        changes: {
                            after: number | boolean | string;
                            before: number | boolean | string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        skipped: {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            reason: "UNCHANGED" | "PRICE_BELOW_MINIMUM" | "PRICE_ABOVE_MAXIMUM" | "CATEGORY_OTHER_ZONE";
                        }[];
                        updated: number;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    previewMenuBulk: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    action: "availability";
                    adminDisabled: boolean;
                    ids: string[];
                    reason?: string;
                } | {
                    /** @enum {string} */
                    action: "category";
                    /** Format: uuid */
                    categoryId: string;
                    ids: string[];
                } | {
                    /** @enum {string} */
                    action: "price";
                    ids: string[];
                    /** @enum {string} */
                    mode: "percent" | "amount";
                    value: number;
                };
            };
        };
        responses: {
            /** @description What would change */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        action: "availability" | "category" | "price";
                        changes: {
                            after: number | boolean | string;
                            before: number | boolean | string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                        skipped: {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            reason: "UNCHANGED" | "PRICE_BELOW_MINIMUM" | "PRICE_ABOVE_MAXIMUM" | "CATEGORY_OTHER_ZONE";
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listMenuChangeRequests: {
        parameters: {
            query?: {
                kind?: "CREATE" | "UPDATE" | "DELETE";
                menuItemId?: string;
                page?: number;
                pageSize?: number;
                sort?: string;
                status?: "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED";
                vendorId?: string;
                vendorKind?: "RESTAURANT" | "HOMEMAKER";
                zoneId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            decidedAt: string | null;
                            decidedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                            decisionReason: string | null;
                            fields: ("name" | "description" | "price" | "categoryId" | "dietary" | "imageKey")[];
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "CREATE" | "UPDATE" | "DELETE";
                            menuItem: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                            name: string;
                            /** @enum {string} */
                            status: "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED";
                            vendor: {
                                /** Format: uuid */
                                id: string;
                                /** @enum {string} */
                                kind: "RESTAURANT" | "HOMEMAKER";
                                name: string;
                            };
                            version: number;
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getMenuChangeRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The request */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        base: {
                            /** Format: uuid */
                            categoryId?: string;
                            description?: string | null;
                            /** @enum {string|null} */
                            dietary?: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                            imageKey?: string | null;
                            isAvailable?: boolean;
                            name?: string;
                            price?: number;
                            stock?: number;
                        } | null;
                        changes: {
                            base: string | number | boolean | null;
                            /** @enum {string} */
                            field: "name" | "description" | "price" | "categoryId" | "dietary" | "imageKey";
                            live: string | number | boolean | null;
                            liveChanged: boolean;
                            proposed: string | number | boolean | null;
                        }[];
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionReason: string | null;
                        fields: ("name" | "description" | "price" | "categoryId" | "dietary" | "imageKey")[];
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "CREATE" | "UPDATE" | "DELETE";
                        live: {
                            /** Format: uuid */
                            categoryId?: string;
                            description?: string | null;
                            /** @enum {string|null} */
                            dietary?: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                            imageKey?: string | null;
                            isAvailable?: boolean;
                            name?: string;
                            price?: number;
                            stock?: number;
                        } | null;
                        menuItem: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        name: string;
                        proposed: {
                            /** Format: uuid */
                            categoryId?: string;
                            description?: string | null;
                            /** @enum {string|null} */
                            dietary?: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                            imageKey?: string | null;
                            isAvailable?: boolean;
                            name?: string;
                            price?: number;
                            stock?: number;
                        };
                        /** @enum {string} */
                        status: "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED";
                        vendor: {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "RESTAURANT" | "HOMEMAKER";
                            name: string;
                        };
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    approveMenuChange: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                };
            };
        };
        responses: {
            /** @description Approved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        base: {
                            /** Format: uuid */
                            categoryId?: string;
                            description?: string | null;
                            /** @enum {string|null} */
                            dietary?: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                            imageKey?: string | null;
                            isAvailable?: boolean;
                            name?: string;
                            price?: number;
                            stock?: number;
                        } | null;
                        changes: {
                            base: string | number | boolean | null;
                            /** @enum {string} */
                            field: "name" | "description" | "price" | "categoryId" | "dietary" | "imageKey";
                            live: string | number | boolean | null;
                            liveChanged: boolean;
                            proposed: string | number | boolean | null;
                        }[];
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionReason: string | null;
                        fields: ("name" | "description" | "price" | "categoryId" | "dietary" | "imageKey")[];
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "CREATE" | "UPDATE" | "DELETE";
                        live: {
                            /** Format: uuid */
                            categoryId?: string;
                            description?: string | null;
                            /** @enum {string|null} */
                            dietary?: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                            imageKey?: string | null;
                            isAvailable?: boolean;
                            name?: string;
                            price?: number;
                            stock?: number;
                        } | null;
                        menuItem: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        name: string;
                        proposed: {
                            /** Format: uuid */
                            categoryId?: string;
                            description?: string | null;
                            /** @enum {string|null} */
                            dietary?: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                            imageKey?: string | null;
                            isAvailable?: boolean;
                            name?: string;
                            price?: number;
                            stock?: number;
                        };
                        /** @enum {string} */
                        status: "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED";
                        vendor: {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "RESTAURANT" | "HOMEMAKER";
                            name: string;
                        };
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Not allowed from the current state; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    rejectMenuChange: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                    version: number;
                };
            };
        };
        responses: {
            /** @description Rejected */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        base: {
                            /** Format: uuid */
                            categoryId?: string;
                            description?: string | null;
                            /** @enum {string|null} */
                            dietary?: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                            imageKey?: string | null;
                            isAvailable?: boolean;
                            name?: string;
                            price?: number;
                            stock?: number;
                        } | null;
                        changes: {
                            base: string | number | boolean | null;
                            /** @enum {string} */
                            field: "name" | "description" | "price" | "categoryId" | "dietary" | "imageKey";
                            live: string | number | boolean | null;
                            liveChanged: boolean;
                            proposed: string | number | boolean | null;
                        }[];
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionReason: string | null;
                        fields: ("name" | "description" | "price" | "categoryId" | "dietary" | "imageKey")[];
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "CREATE" | "UPDATE" | "DELETE";
                        live: {
                            /** Format: uuid */
                            categoryId?: string;
                            description?: string | null;
                            /** @enum {string|null} */
                            dietary?: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                            imageKey?: string | null;
                            isAvailable?: boolean;
                            name?: string;
                            price?: number;
                            stock?: number;
                        } | null;
                        menuItem: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        name: string;
                        proposed: {
                            /** Format: uuid */
                            categoryId?: string;
                            description?: string | null;
                            /** @enum {string|null} */
                            dietary?: "VEGETARIAN" | "NON_VEG" | "EGG" | null;
                            imageKey?: string | null;
                            isAvailable?: boolean;
                            name?: string;
                            price?: number;
                            stock?: number;
                        };
                        /** @enum {string} */
                        status: "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED";
                        vendor: {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "RESTAURANT" | "HOMEMAKER";
                            name: string;
                        };
                        version: number;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listNotifications: {
        parameters: {
            query?: {
                audience?: "CUSTOMERS" | "VENDORS" | "PARTNERS" | "ALL";
                from?: string;
                kind?: "MESSAGE" | "PROMOTION";
                page?: number;
                pageSize?: number;
                q?: string;
                sort?: string;
                status?: "PENDING_APPROVAL" | "SCHEDULED" | "SENT" | "CANCELLED" | "FAILED" | "REJECTED";
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of notifications */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** @enum {string} */
                            audience: "CUSTOMERS" | "VENDORS" | "PARTNERS" | "ALL";
                            body: string;
                            channels: ("IN_APP" | "PUSH" | "EMAIL" | "SMS")[];
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            decidedAt: string | null;
                            decidedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                            decisionNote: string | null;
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "MESSAGE" | "PROMOTION";
                            requestedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                            /** Format: date-time */
                            scheduledAt: string | null;
                            /** Format: date-time */
                            sentAt: string | null;
                            /** @enum {string} */
                            status: "PENDING_APPROVAL" | "SCHEDULED" | "SENT" | "CANCELLED" | "FAILED" | "REJECTED";
                            title: string;
                            version: number;
                            zones: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            }[];
                        }[];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createNotification: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    audience: "CUSTOMERS" | "VENDORS" | "PARTNERS" | "ALL";
                    body: string;
                    channels: ("IN_APP" | "PUSH" | "EMAIL" | "SMS")[];
                    /** @enum {string} */
                    kind: "MESSAGE" | "PROMOTION";
                    /** Format: date-time */
                    scheduledAt?: string;
                    title: string;
                    zoneIds: string[];
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        audience: "CUSTOMERS" | "VENDORS" | "PARTNERS" | "ALL";
                        body: string;
                        channels: ("IN_APP" | "PUSH" | "EMAIL" | "SMS")[];
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionNote: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "MESSAGE" | "PROMOTION";
                        requestedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        /** Format: date-time */
                        scheduledAt: string | null;
                        sends: {
                            emailsFailed: number;
                            emailsSent: number;
                            /** Format: date-time */
                            sendAt: string;
                            /** Format: date-time */
                            sentAt: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "SENT" | "FAILED" | "CANCELLED";
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        /** Format: date-time */
                        sentAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_APPROVAL" | "SCHEDULED" | "SENT" | "CANCELLED" | "FAILED" | "REJECTED";
                        title: string;
                        version: number;
                        zones: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getNotification: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The notification */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        audience: "CUSTOMERS" | "VENDORS" | "PARTNERS" | "ALL";
                        body: string;
                        channels: ("IN_APP" | "PUSH" | "EMAIL" | "SMS")[];
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionNote: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "MESSAGE" | "PROMOTION";
                        requestedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        /** Format: date-time */
                        scheduledAt: string | null;
                        sends: {
                            emailsFailed: number;
                            emailsSent: number;
                            /** Format: date-time */
                            sendAt: string;
                            /** Format: date-time */
                            sentAt: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "SENT" | "FAILED" | "CANCELLED";
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        /** Format: date-time */
                        sentAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_APPROVAL" | "SCHEDULED" | "SENT" | "CANCELLED" | "FAILED" | "REJECTED";
                        title: string;
                        version: number;
                        zones: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    updateNotification: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    audience?: "CUSTOMERS" | "VENDORS" | "PARTNERS" | "ALL";
                    body?: string;
                    channels?: ("IN_APP" | "PUSH" | "EMAIL" | "SMS")[];
                    /** Format: date-time */
                    scheduledAt?: string | null;
                    title?: string;
                    version: number;
                    zoneIds?: string[];
                };
            };
        };
        responses: {
            /** @description The notification */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        audience: "CUSTOMERS" | "VENDORS" | "PARTNERS" | "ALL";
                        body: string;
                        channels: ("IN_APP" | "PUSH" | "EMAIL" | "SMS")[];
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionNote: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "MESSAGE" | "PROMOTION";
                        requestedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        /** Format: date-time */
                        scheduledAt: string | null;
                        sends: {
                            emailsFailed: number;
                            emailsSent: number;
                            /** Format: date-time */
                            sendAt: string;
                            /** Format: date-time */
                            sentAt: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "SENT" | "FAILED" | "CANCELLED";
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        /** Format: date-time */
                        sentAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_APPROVAL" | "SCHEDULED" | "SENT" | "CANCELLED" | "FAILED" | "REJECTED";
                        title: string;
                        version: number;
                        zones: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    approveNotification: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                };
            };
        };
        responses: {
            /** @description The notification */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        audience: "CUSTOMERS" | "VENDORS" | "PARTNERS" | "ALL";
                        body: string;
                        channels: ("IN_APP" | "PUSH" | "EMAIL" | "SMS")[];
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionNote: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "MESSAGE" | "PROMOTION";
                        requestedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        /** Format: date-time */
                        scheduledAt: string | null;
                        sends: {
                            emailsFailed: number;
                            emailsSent: number;
                            /** Format: date-time */
                            sendAt: string;
                            /** Format: date-time */
                            sentAt: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "SENT" | "FAILED" | "CANCELLED";
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        /** Format: date-time */
                        sentAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_APPROVAL" | "SCHEDULED" | "SENT" | "CANCELLED" | "FAILED" | "REJECTED";
                        title: string;
                        version: number;
                        zones: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    cancelNotification: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                };
            };
        };
        responses: {
            /** @description The notification */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        audience: "CUSTOMERS" | "VENDORS" | "PARTNERS" | "ALL";
                        body: string;
                        channels: ("IN_APP" | "PUSH" | "EMAIL" | "SMS")[];
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionNote: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "MESSAGE" | "PROMOTION";
                        requestedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        /** Format: date-time */
                        scheduledAt: string | null;
                        sends: {
                            emailsFailed: number;
                            emailsSent: number;
                            /** Format: date-time */
                            sendAt: string;
                            /** Format: date-time */
                            sentAt: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "SENT" | "FAILED" | "CANCELLED";
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        /** Format: date-time */
                        sentAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_APPROVAL" | "SCHEDULED" | "SENT" | "CANCELLED" | "FAILED" | "REJECTED";
                        title: string;
                        version: number;
                        zones: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    rejectNotification: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    note: string;
                    version: number;
                };
            };
        };
        responses: {
            /** @description The notification */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        audience: "CUSTOMERS" | "VENDORS" | "PARTNERS" | "ALL";
                        body: string;
                        channels: ("IN_APP" | "PUSH" | "EMAIL" | "SMS")[];
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        decidedAt: string | null;
                        decidedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        decisionNote: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        kind: "MESSAGE" | "PROMOTION";
                        requestedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        /** Format: date-time */
                        scheduledAt: string | null;
                        sends: {
                            emailsFailed: number;
                            emailsSent: number;
                            /** Format: date-time */
                            sendAt: string;
                            /** Format: date-time */
                            sentAt: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "SENT" | "FAILED" | "CANCELLED";
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                        }[];
                        /** Format: date-time */
                        sentAt: string | null;
                        /** @enum {string} */
                        status: "PENDING_APPROVAL" | "SCHEDULED" | "SENT" | "CANCELLED" | "FAILED" | "REJECTED";
                        title: string;
                        version: number;
                        zones: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getOpenApiDocument: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OpenAPI 3.1 document */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        info: {
                            title: string;
                        };
                        openapi: string;
                    } & {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
    listOrders: {
        parameters: {
            query?: {
                customerId?: string;
                deliveryPartnerId?: string;
                from?: string;
                homemakerId?: string;
                page?: number;
                pageSize?: number;
                paymentMethod?: ("ONLINE" | "COD" | "WALLET")[];
                paymentStatus?: ("PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED")[];
                q?: string;
                restaurantId?: string;
                sort?: string;
                status?: ("PLACED" | "ACCEPTED" | "PREPARING" | "READY" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED" | "REFUNDED")[];
                to?: string;
                vendorType?: "RESTAURANT" | "HOMEMAKER";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of orders */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            customerName: string;
                            customerPhoneMasked: string;
                            /** Format: uuid */
                            deliveryPartnerId: string | null;
                            /** Format: uuid */
                            id: string;
                            itemCount: number;
                            orderNo: string;
                            /** @enum {string} */
                            paymentMethod: "ONLINE" | "COD" | "WALLET";
                            /** @enum {string} */
                            paymentStatus: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
                            placedAt: string;
                            /** @enum {string} */
                            status: "PLACED" | "ACCEPTED" | "PREPARING" | "READY" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED" | "REFUNDED";
                            total: number;
                            /** Format: uuid */
                            vendorId: string;
                            vendorName: string;
                            /** @enum {string} */
                            vendorType: "RESTAURANT" | "HOMEMAKER";
                            version: number;
                            /** Format: uuid */
                            zoneId: string;
                        }[];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The order */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        acceptedAt: string | null;
                        cancelledAt: string | null;
                        cancelReason: string | null;
                        customer: {
                            emailMasked: string | null;
                            /** Format: uuid */
                            id: string;
                            name: string;
                            phoneMasked: string;
                        };
                        customerName: string;
                        customerPhoneMasked: string;
                        deliveredAt: string | null;
                        deliveryCharge: number;
                        deliveryPartner: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        /** Format: uuid */
                        deliveryPartnerId: string | null;
                        discount: number;
                        /** Format: uuid */
                        id: string;
                        itemCount: number;
                        items: {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            menuItemId: string;
                            name: string;
                            price: number;
                            qty: number;
                        }[];
                        orderNo: string;
                        /** @enum {string} */
                        paymentMethod: "ONLINE" | "COD" | "WALLET";
                        payments: {
                            amount: number;
                            createdAt: string;
                            /** Format: uuid */
                            id: string;
                            method: string | null;
                            provider: string;
                            /** @enum {string} */
                            status: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
                        }[];
                        /** @enum {string} */
                        paymentStatus: "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
                        placedAt: string;
                        readyAt: string | null;
                        /** @enum {string} */
                        status: "PLACED" | "ACCEPTED" | "PREPARING" | "READY" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED" | "REFUNDED";
                        subtotal: number;
                        tax: number;
                        timeline: {
                            actorType: string;
                            at: string;
                            /** @enum {string|null} */
                            from: "PLACED" | "ACCEPTED" | "PREPARING" | "READY" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED" | "REFUNDED" | null;
                            /** Format: uuid */
                            id: string;
                            note: string | null;
                            /** @enum {string} */
                            to: "PLACED" | "ACCEPTED" | "PREPARING" | "READY" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED" | "REFUNDED";
                        }[];
                        total: number;
                        /** Format: uuid */
                        vendorId: string;
                        vendorName: string;
                        /** @enum {string} */
                        vendorType: "RESTAURANT" | "HOMEMAKER";
                        version: number;
                        /** Format: uuid */
                        zoneId: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    assignOrder: {
        parameters: {
            query?: never;
            header: {
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    deliveryPartnerId: string;
                };
            };
        };
        responses: {
            /** @description Assigned */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        deliveryPartnerId: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        status: "PLACED" | "ACCEPTED" | "PREPARING" | "READY" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED" | "REFUNDED";
                        version: number;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    cancelOrder: {
        parameters: {
            query?: never;
            header: {
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    note?: string;
                    reasonCode: string;
                };
            };
        };
        responses: {
            /** @description Cancelled */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        deliveryPartnerId: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        status: "PLACED" | "ACCEPTED" | "PREPARING" | "READY" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED" | "REFUNDED";
                        version: number;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description A reason is required; Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    transitionOrder: {
        parameters: {
            query?: never;
            header: {
                "If-Match": string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    note?: string;
                    /** @enum {string} */
                    to: "PLACED" | "ACCEPTED" | "PREPARING" | "READY" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED" | "REFUNDED";
                };
            };
        };
        responses: {
            /** @description Moved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        deliveryPartnerId: string | null;
                        /** Format: uuid */
                        id: string;
                        /** @enum {string} */
                        status: "PLACED" | "ACCEPTED" | "PREPARING" | "READY" | "ASSIGNED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED" | "REFUNDED";
                        version: number;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listRestaurants: {
        parameters: {
            query?: {
                area?: string;
                assignment?: "ASSIGNED" | "UNASSIGNED";
                page?: number;
                pageSize?: number;
                q?: string;
                sort?: string;
                status?: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                tag?: string;
                verification?: "PENDING" | "VERIFIED" | "REJECTED";
                zoneId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            area: string | null;
                            /** @enum {string} */
                            assignment: "ASSIGNED" | "UNASSIGNED";
                            /** Format: date-time */
                            createdAt: string;
                            cuisineTags: string[];
                            email: string | null;
                            /** Format: uuid */
                            id: string;
                            isOpen: boolean;
                            /** @enum {string} */
                            kind: "RESTAURANT" | "SHOP";
                            name: string;
                            ownerName: string | null;
                            phone: string | null;
                            /** @enum {string} */
                            source: "APP" | "ADMIN" | "IMPORT";
                            /** @enum {string} */
                            status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                            /** Format: date-time */
                            updatedAt: string;
                            /** @enum {string} */
                            verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                            zone: {
                                code: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        meta: {
                            counts: {
                                active: number;
                                inactive: number;
                                pendingVerification: number;
                                rejected: number;
                                suspended: number;
                                total: number;
                            };
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see); A requested zone is not assigned to the caller */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createRestaurant: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    address: string;
                    area?: string;
                    commissionPct?: number;
                    cuisineTags: string[];
                    /** Format: email */
                    email?: string;
                    fssaiNo?: string;
                    gstNo?: string;
                    /**
                     * @default RESTAURANT
                     * @enum {string}
                     */
                    kind?: "RESTAURANT" | "SHOP";
                    lat?: number;
                    lng?: number;
                    minOrderPaise?: number;
                    name: string;
                    openingHours?: {
                        closes?: string;
                        /** @enum {string} */
                        day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                        isOpen: boolean;
                        opens?: string;
                    }[];
                    ownerName: string;
                    phone: string;
                    /** Format: uuid */
                    zoneId: string;
                };
            };
        };
        responses: {
            /** @description Created (status PENDING, verification PENDING) */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        cuisineTags: string[];
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        fssaiNo: string | null;
                        gstNo: string | null;
                        hasLogo: boolean;
                        /** Format: uuid */
                        id: string;
                        isOpen: boolean;
                        /** @enum {string} */
                        kind: "RESTAURANT" | "SHOP";
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        ownerName: string | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description The service is switched off in this zone (error.meta.service, D92) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getRestaurant: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The restaurant */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        cuisineTags: string[];
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        fssaiNo: string | null;
                        gstNo: string | null;
                        hasLogo: boolean;
                        /** Format: uuid */
                        id: string;
                        isOpen: boolean;
                        /** @enum {string} */
                        kind: "RESTAURANT" | "SHOP";
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        ownerName: string | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    deleteRestaurant: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    updateRestaurant: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    address?: string;
                    area?: string | null;
                    commissionPct?: number;
                    cuisineTags?: string[];
                    /** Format: email */
                    email?: string | null;
                    fssaiNo?: string | null;
                    gstNo?: string | null;
                    /** @enum {string} */
                    kind?: "RESTAURANT" | "SHOP";
                    lat?: number | null;
                    lng?: number | null;
                    minOrderPaise?: number;
                    name?: string;
                    openingHours?: {
                        closes?: string;
                        /** @enum {string} */
                        day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                        isOpen: boolean;
                        opens?: string;
                    }[] | null;
                    ownerName?: string;
                    phone?: string;
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        cuisineTags: string[];
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        fssaiNo: string | null;
                        gstNo: string | null;
                        hasLogo: boolean;
                        /** Format: uuid */
                        id: string;
                        isOpen: boolean;
                        /** @enum {string} */
                        kind: "RESTAURANT" | "SHOP";
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        ownerName: string | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    attachRestaurantDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    docType: string;
                    fileKey: string;
                };
            };
        };
        responses: {
            /** @description Attached */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        cuisineTags: string[];
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        fssaiNo: string | null;
                        gstNo: string | null;
                        hasLogo: boolean;
                        /** Format: uuid */
                        id: string;
                        isOpen: boolean;
                        /** @enum {string} */
                        kind: "RESTAURANT" | "SHOP";
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        ownerName: string | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getRestaurantDocumentUrl: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                docId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Signed link */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        expiresInSec: number;
                        url: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    verifyRestaurantDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                docId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    decision: "VERIFIED" | "REJECTED";
                    note?: string;
                };
            };
        };
        responses: {
            /** @description Reviewed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        cuisineTags: string[];
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        fssaiNo: string | null;
                        gstNo: string | null;
                        hasLogo: boolean;
                        /** Format: uuid */
                        id: string;
                        isOpen: boolean;
                        /** @enum {string} */
                        kind: "RESTAURANT" | "SHOP";
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        ownerName: string | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    moveRestaurantZone: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                    /** Format: uuid */
                    zoneId: string;
                };
            };
        };
        responses: {
            /** @description Moved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        cuisineTags: string[];
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        fssaiNo: string | null;
                        gstNo: string | null;
                        hasLogo: boolean;
                        /** Format: uuid */
                        id: string;
                        isOpen: boolean;
                        /** @enum {string} */
                        kind: "RESTAURANT" | "SHOP";
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        ownerName: string | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    revealRestaurantContact: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Contact details */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        email: string | null;
                        phone: string | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    setRestaurantStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason?: string;
                    /** @enum {string} */
                    status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
                };
            };
        };
        responses: {
            /** @description Changed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        cuisineTags: string[];
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        fssaiNo: string | null;
                        gstNo: string | null;
                        hasLogo: boolean;
                        /** Format: uuid */
                        id: string;
                        isOpen: boolean;
                        /** @enum {string} */
                        kind: "RESTAURANT" | "SHOP";
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        ownerName: string | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    verifyRestaurant: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    decision: "VERIFIED" | "REJECTED";
                    note?: string;
                };
            };
        };
        responses: {
            /** @description Decided */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        address: string | null;
                        area: string | null;
                        /** @enum {string} */
                        assignment: "ASSIGNED" | "UNASSIGNED";
                        checklist: {
                            docType: string;
                            label: string;
                            mandatory: boolean;
                            /** @enum {string} */
                            state: "MISSING" | "PENDING" | "VERIFIED" | "REJECTED";
                        }[] | null;
                        commissionPct: number;
                        /** Format: date-time */
                        createdAt: string;
                        cuisineTags: string[];
                        documents: {
                            /** Format: date-time */
                            createdAt: string;
                            docType: string;
                            /** Format: uuid */
                            id: string;
                            rejectionNote: string | null;
                            /** @enum {string} */
                            status: "PENDING" | "VERIFIED" | "REJECTED";
                            /** Format: date-time */
                            updatedAt: string;
                            verifiedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        email: string | null;
                        fssaiNo: string | null;
                        gstNo: string | null;
                        hasLogo: boolean;
                        /** Format: uuid */
                        id: string;
                        isOpen: boolean;
                        /** @enum {string} */
                        kind: "RESTAURANT" | "SHOP";
                        lat: number | null;
                        lng: number | null;
                        minOrderPaise: number;
                        name: string;
                        openingHours: {
                            closes: string | null;
                            /** @enum {string} */
                            day: "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
                            isOpen: boolean;
                            opens: string | null;
                        }[] | null;
                        ownerName: string | null;
                        phone: string | null;
                        /** @enum {string} */
                        source: "APP" | "ADMIN" | "IMPORT";
                        /** Format: date-time */
                        sourceUpdatedAt: string | null;
                        /** @enum {string} */
                        status: "PENDING" | "ACTIVE" | "INACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        verificationNote: string | null;
                        /** @enum {string} */
                        verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
                        /** Format: date-time */
                        verifiedAt: string | null;
                        verifiedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict; Not allowed from the current state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    globalSearch: {
        parameters: {
            query: {
                q: string;
                types?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The groups */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        groups: {
                            customers: {
                                href: string;
                                /** Format: uuid */
                                id: string;
                                subtitle: string | null;
                                title: string;
                                zone: {
                                    code: string;
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                            }[] | null;
                            homemakers: {
                                href: string;
                                /** Format: uuid */
                                id: string;
                                subtitle: string | null;
                                title: string;
                                zone: {
                                    code: string;
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                            }[] | null;
                            orders: {
                                href: string;
                                /** Format: uuid */
                                id: string;
                                subtitle: string | null;
                                title: string;
                                zone: {
                                    code: string;
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                            }[] | null;
                            partners: {
                                href: string;
                                /** Format: uuid */
                                id: string;
                                subtitle: string | null;
                                title: string;
                                zone: {
                                    code: string;
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                            }[] | null;
                            restaurants: {
                                href: string;
                                /** Format: uuid */
                                id: string;
                                subtitle: string | null;
                                title: string;
                                zone: {
                                    code: string;
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                            }[] | null;
                        };
                        q: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Too many requests */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            default?: unknown;
                            description: string;
                            editable: boolean;
                            effect: {
                                module: string | null;
                                /** @enum {string} */
                                state: "ENFORCED" | "PENDING_MODULE" | "NOT_CONFIGURED";
                            };
                            effective?: unknown;
                            /** @enum {string} */
                            group: "refunds" | "onboarding" | "support" | "notifications" | "orders" | "sms" | "loyalty" | "security" | "payouts" | "zones" | "access" | "sessions";
                            key: string;
                            label: string;
                            platform: {
                                /** Format: date-time */
                                updatedAt: string;
                                updatedBy: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                                value?: unknown;
                                version: number;
                            } | null;
                            /** @enum {string} */
                            reauth: "PASSWORD" | "STRONG";
                            /** @enum {string} */
                            source: "DEFAULT" | "PLATFORM" | "ZONE";
                            zone: {
                                /** Format: date-time */
                                updatedAt: string;
                                updatedBy: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                                value?: unknown;
                                version: number;
                            } | null;
                            zoneOverride: boolean;
                        }[];
                        /** Format: uuid */
                        zoneId: string | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getSettingsGroup: {
        parameters: {
            query?: {
                zoneId?: string;
            };
            header?: never;
            path: {
                group: "refunds" | "onboarding" | "support" | "notifications" | "orders" | "sms" | "loyalty" | "security" | "payouts" | "zones" | "access" | "sessions";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Settings */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            default?: unknown;
                            description: string;
                            editable: boolean;
                            effect: {
                                module: string | null;
                                /** @enum {string} */
                                state: "ENFORCED" | "PENDING_MODULE" | "NOT_CONFIGURED";
                            };
                            effective?: unknown;
                            /** @enum {string} */
                            group: "refunds" | "onboarding" | "support" | "notifications" | "orders" | "sms" | "loyalty" | "security" | "payouts" | "zones" | "access" | "sessions";
                            key: string;
                            label: string;
                            platform: {
                                /** Format: date-time */
                                updatedAt: string;
                                updatedBy: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                                value?: unknown;
                                version: number;
                            } | null;
                            /** @enum {string} */
                            reauth: "PASSWORD" | "STRONG";
                            /** @enum {string} */
                            source: "DEFAULT" | "PLATFORM" | "ZONE";
                            zone: {
                                /** Format: date-time */
                                updatedAt: string;
                                updatedBy: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                                value?: unknown;
                                version: number;
                            } | null;
                            zoneOverride: boolean;
                        }[];
                        /** Format: uuid */
                        zoneId: string | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    putSettings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                group: "refunds" | "onboarding" | "support" | "notifications" | "orders" | "sms" | "loyalty" | "security" | "payouts" | "zones" | "access" | "sessions";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                    values: {
                        [key: string]: unknown;
                    };
                    versions?: {
                        [key: string]: number;
                    };
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            default?: unknown;
                            description: string;
                            editable: boolean;
                            effect: {
                                module: string | null;
                                /** @enum {string} */
                                state: "ENFORCED" | "PENDING_MODULE" | "NOT_CONFIGURED";
                            };
                            effective?: unknown;
                            /** @enum {string} */
                            group: "refunds" | "onboarding" | "support" | "notifications" | "orders" | "sms" | "loyalty" | "security" | "payouts" | "zones" | "access" | "sessions";
                            key: string;
                            label: string;
                            platform: {
                                /** Format: date-time */
                                updatedAt: string;
                                updatedBy: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                                value?: unknown;
                                version: number;
                            } | null;
                            /** @enum {string} */
                            reauth: "PASSWORD" | "STRONG";
                            /** @enum {string} */
                            source: "DEFAULT" | "PLATFORM" | "ZONE";
                            zone: {
                                /** Format: date-time */
                                updatedAt: string;
                                updatedBy: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                                value?: unknown;
                                version: number;
                            } | null;
                            zoneOverride: boolean;
                        }[];
                        /** Format: uuid */
                        zoneId: string | null;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    resetSetting: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                group: "refunds" | "onboarding" | "support" | "notifications" | "orders" | "sms" | "loyalty" | "security" | "payouts" | "zones" | "access" | "sessions";
                key: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Reset */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            default?: unknown;
                            description: string;
                            editable: boolean;
                            effect: {
                                module: string | null;
                                /** @enum {string} */
                                state: "ENFORCED" | "PENDING_MODULE" | "NOT_CONFIGURED";
                            };
                            effective?: unknown;
                            /** @enum {string} */
                            group: "refunds" | "onboarding" | "support" | "notifications" | "orders" | "sms" | "loyalty" | "security" | "payouts" | "zones" | "access" | "sessions";
                            key: string;
                            label: string;
                            platform: {
                                /** Format: date-time */
                                updatedAt: string;
                                updatedBy: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                                value?: unknown;
                                version: number;
                            } | null;
                            /** @enum {string} */
                            reauth: "PASSWORD" | "STRONG";
                            /** @enum {string} */
                            source: "DEFAULT" | "PLATFORM" | "ZONE";
                            zone: {
                                /** Format: date-time */
                                updatedAt: string;
                                updatedBy: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                                value?: unknown;
                                version: number;
                            } | null;
                            zoneOverride: boolean;
                        }[];
                        /** Format: uuid */
                        zoneId: string | null;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    previewSettings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                group: "refunds" | "onboarding" | "support" | "notifications" | "orders" | "sms" | "loyalty" | "security" | "payouts" | "zones" | "access" | "sessions";
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    values: {
                        [key: string]: unknown;
                    };
                    /** Format: uuid */
                    zoneId?: string;
                };
            };
        };
        responses: {
            /** @description Preview */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        changes: {
                            after?: unknown;
                            before?: unknown;
                            key: string;
                        }[];
                        membersAboveCap: {
                            dailyRefundPaise: number;
                            /** Format: uuid */
                            memberId: string;
                            name: string;
                            perRefundPaise: number;
                            /** Format: uuid */
                            zoneId: string;
                            zoneName: string;
                        }[];
                        orderNumberExample: string | null;
                        /** Format: uuid */
                        zoneId: string | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getSettingsHistory: {
        parameters: {
            query?: {
                actorId?: string;
                after?: string;
                from?: string;
                group?: "refunds" | "onboarding" | "support" | "notifications" | "orders" | "sms" | "loyalty" | "security" | "payouts" | "zones" | "access" | "sessions";
                key?: string;
                limit?: number;
                to?: string;
                zoneId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description History */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            action: string;
                            actionLabel: string;
                            actor: {
                                /** Format: uuid */
                                id: string | null;
                                name: string;
                            };
                            after?: unknown;
                            before?: unknown;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: uuid */
                            id: string;
                            key: string | null;
                            reason: string | null;
                            zone: {
                                /** Format: uuid */
                                id: string;
                                name: string | null;
                            } | null;
                        }[];
                        meta: {
                            limit: number;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getSecurityPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The security policy */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        lockout: {
                            lockMinutes: number;
                            maxAttempts: number;
                        };
                        mfa: {
                            allowed: {
                                SUPER_ADMIN: ("AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP")[];
                                ZONAL_ADMIN: ("AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP")[];
                            };
                            otpMaxAttempts: number;
                            otpTtlSeconds: number;
                            required: {
                                /** @enum {boolean} */
                                SUPER_ADMIN: true;
                                ZONAL_ADMIN: boolean;
                            };
                            resendCooldownSeconds: number;
                            sendsPerDay: number;
                            sendsPerHour: number;
                            smsEnabled: boolean;
                            smsHourlyGlobalCap: number;
                        };
                        password: {
                            denylist: boolean;
                            maxAgeDays: number | null;
                            minLength: number;
                        };
                        session: {
                            absoluteHours: number;
                            idleMinutes: number;
                            maxSessions: number;
                            rememberDays: number;
                            rememberIdleHours: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    updateSecurityPolicy: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    mfa: {
                        allowed: {
                            SUPER_ADMIN: ("AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP")[];
                            ZONAL_ADMIN: ("AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP")[];
                        };
                        otpMaxAttempts: number;
                        otpTtlSeconds: number;
                        required: {
                            /** @enum {boolean} */
                            SUPER_ADMIN: true;
                            ZONAL_ADMIN: boolean;
                        };
                        resendCooldownSeconds: number;
                        sendsPerDay: number;
                        sendsPerHour: number;
                        smsEnabled: boolean;
                        smsHourlyGlobalCap: number;
                    };
                };
            };
        };
        responses: {
            /** @description The policy now in effect */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        lockout: {
                            lockMinutes: number;
                            maxAttempts: number;
                        };
                        mfa: {
                            allowed: {
                                SUPER_ADMIN: ("AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP")[];
                                ZONAL_ADMIN: ("AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP")[];
                            };
                            otpMaxAttempts: number;
                            otpTtlSeconds: number;
                            required: {
                                /** @enum {boolean} */
                                SUPER_ADMIN: true;
                                ZONAL_ADMIN: boolean;
                            };
                            resendCooldownSeconds: number;
                            sendsPerDay: number;
                            sendsPerHour: number;
                            smsEnabled: boolean;
                            smsHourlyGlobalCap: number;
                        };
                        password: {
                            denylist: boolean;
                            maxAgeDays: number | null;
                            minLength: number;
                        };
                        session: {
                            absoluteHours: number;
                            idleMinutes: number;
                            maxSessions: number;
                            rememberDays: number;
                            rememberIdleHours: number;
                        };
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    resumeSms: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Resumed (or was not paused) */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getSecurityStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Security status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        activeSuperAdmins: number;
                        failedSecondStepsLast24h: number;
                        members: {
                            enrolled: number;
                            notEnrolled: number;
                            /** @enum {string} */
                            role: "SUPER_ADMIN" | "ZONAL_ADMIN";
                        }[];
                        methods: {
                            count: number;
                            /** @enum {string} */
                            type: "AUTHENTICATOR" | "EMAIL_OTP" | "SMS_OTP";
                        }[];
                        sms: {
                            enabled: boolean;
                            paused: boolean;
                            /** @enum {string} */
                            provider: "none" | "console" | "msg91";
                        };
                        superAdminWarning: boolean;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    confirmUpload: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    fileKey: string;
                };
            };
        };
        responses: {
            /** @description File accepted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        contentType: string;
                        fileKey: string;
                        sizeBytes: number;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    presignUpload: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    contentType: string;
                    /** Format: uuid */
                    entityId: string;
                    /** @enum {string} */
                    purpose: "VENDOR_DOC" | "PARTNER_DOC" | "MENU_IMAGE";
                    sizeBytes: number;
                    /** Format: uuid */
                    zoneId: string;
                };
            };
        };
        responses: {
            /** @description Upload link */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        expiresInSec: number;
                        fileKey: string;
                        uploadUrl: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listZonalAdmins: {
        parameters: {
            query?: {
                page?: number;
                pageSize?: number;
                q?: string;
                sort?: "name" | "-name" | "createdAt" | "-createdAt" | "lastLoginAt" | "-lastLoginAt";
                status?: "ACTIVE" | "SUSPENDED";
                zoneId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Members */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            createdAt: string;
                            email: string;
                            /** Format: uuid */
                            id: string;
                            /** Format: date-time */
                            lastLoginAt: string | null;
                            /** Format: date-time */
                            lockedUntil: string | null;
                            mfaEnabled: boolean;
                            mustChangePassword: boolean;
                            name: string;
                            phone: string | null;
                            /** @enum {string} */
                            status: "ACTIVE" | "SUSPENDED";
                            /** Format: date-time */
                            updatedAt: string;
                            zones: {
                                code: string;
                                colorHex: string;
                                name: string;
                                /** Format: uuid */
                                profileId: string;
                                profileName: string;
                                /** @enum {string} */
                                status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                                /** Format: uuid */
                                zoneId: string;
                            }[];
                        }[];
                        meta: {
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createZonalAdmin: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: string;
                    name: string;
                    phone?: string;
                    /**
                     * @default ACTIVE
                     * @enum {string}
                     */
                    status?: "ACTIVE" | "SUSPENDED";
                    temporaryPassword: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        activeSessions: number;
                        /** Format: date-time */
                        createdAt: string;
                        email: string;
                        /** Format: uuid */
                        id: string;
                        /** Format: date-time */
                        lastLoginAt: string | null;
                        /** Format: date-time */
                        lockedUntil: string | null;
                        mfaEnabled: boolean;
                        mustChangePassword: boolean;
                        name: string;
                        phone: string | null;
                        /** @enum {string} */
                        status: "ACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        zones: {
                            code: string;
                            colorHex: string;
                            name: string;
                            /** Format: uuid */
                            profileId: string;
                            profileName: string;
                            /** @enum {string} */
                            status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                            /** Format: uuid */
                            zoneId: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getZonalAdmin: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Member */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        activeSessions: number;
                        /** Format: date-time */
                        createdAt: string;
                        email: string;
                        /** Format: uuid */
                        id: string;
                        /** Format: date-time */
                        lastLoginAt: string | null;
                        /** Format: date-time */
                        lockedUntil: string | null;
                        mfaEnabled: boolean;
                        mustChangePassword: boolean;
                        name: string;
                        phone: string | null;
                        /** @enum {string} */
                        status: "ACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        zones: {
                            code: string;
                            colorHex: string;
                            name: string;
                            /** Format: uuid */
                            profileId: string;
                            profileName: string;
                            /** @enum {string} */
                            status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                            /** Format: uuid */
                            zoneId: string;
                        }[];
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    deleteZonalAdmin: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    updateZonalAdmin: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email?: string;
                    name?: string;
                    phone?: string | null;
                    /** @enum {string} */
                    status?: "ACTIVE" | "SUSPENDED";
                };
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        activeSessions: number;
                        /** Format: date-time */
                        createdAt: string;
                        email: string;
                        /** Format: uuid */
                        id: string;
                        /** Format: date-time */
                        lastLoginAt: string | null;
                        /** Format: date-time */
                        lockedUntil: string | null;
                        mfaEnabled: boolean;
                        mustChangePassword: boolean;
                        name: string;
                        phone: string | null;
                        /** @enum {string} */
                        status: "ACTIVE" | "SUSPENDED";
                        /** Format: date-time */
                        updatedAt: string;
                        zones: {
                            code: string;
                            colorHex: string;
                            name: string;
                            /** Format: uuid */
                            profileId: string;
                            profileName: string;
                            /** @enum {string} */
                            status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                            /** Format: uuid */
                            zoneId: string;
                        }[];
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getMemberAccess: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Access */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        assignments: {
                            /** Format: date-time */
                            assignedAt: string;
                            assignedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                            /** Format: uuid */
                            assignmentId: string;
                            effectiveLimits: {
                                canExport: boolean;
                                canReveal: boolean;
                                dailyRefund: number;
                                perRefund: number;
                            };
                            limits: {
                                canExport: boolean | null;
                                canReveal: boolean | null;
                                dailyRefund: number | null;
                                perRefund: number | null;
                            };
                            note: string | null;
                            overrides: {
                                /** @enum {string} */
                                action: "view" | "add" | "edit" | "delete" | "status";
                                /** @enum {string} */
                                effect: "GRANT" | "DENY";
                                /** @enum {string} */
                                module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                            }[];
                            permissions: ("dashboard:view" | "dashboard:add" | "dashboard:edit" | "dashboard:delete" | "dashboard:status" | "orders:view" | "orders:add" | "orders:edit" | "orders:delete" | "orders:status" | "restaurants:view" | "restaurants:add" | "restaurants:edit" | "restaurants:delete" | "restaurants:status" | "homemakers:view" | "homemakers:add" | "homemakers:edit" | "homemakers:delete" | "homemakers:status" | "menu:view" | "menu:add" | "menu:edit" | "menu:delete" | "menu:status" | "delivery:view" | "delivery:add" | "delivery:edit" | "delivery:delete" | "delivery:status" | "customers:view" | "customers:add" | "customers:edit" | "customers:delete" | "customers:status" | "payments:view" | "payments:add" | "payments:edit" | "payments:delete" | "payments:status" | "refunds:view" | "refunds:add" | "refunds:edit" | "refunds:delete" | "refunds:status" | "settlements:view" | "settlements:add" | "settlements:edit" | "settlements:delete" | "settlements:status" | "payouts:view" | "payouts:add" | "payouts:edit" | "payouts:delete" | "payouts:status" | "commission:view" | "commission:add" | "commission:edit" | "commission:delete" | "commission:status" | "zones:view" | "zones:add" | "zones:edit" | "zones:delete" | "zones:status" | "admins:view" | "admins:add" | "admins:edit" | "admins:delete" | "admins:status" | "access:view" | "access:add" | "access:edit" | "access:delete" | "access:status" | "offers:view" | "offers:add" | "offers:edit" | "offers:delete" | "offers:status" | "notifications:view" | "notifications:add" | "notifications:edit" | "notifications:delete" | "notifications:status" | "analytics:view" | "analytics:add" | "analytics:edit" | "analytics:delete" | "analytics:status" | "reviews:view" | "reviews:add" | "reviews:edit" | "reviews:delete" | "reviews:status" | "support:view" | "support:add" | "support:edit" | "support:delete" | "support:status" | "settings:view" | "settings:add" | "settings:edit" | "settings:delete" | "settings:status" | "integrations:view" | "integrations:add" | "integrations:edit" | "integrations:delete" | "integrations:status" | "audit:view" | "audit:add" | "audit:edit" | "audit:delete" | "audit:status" | "hotels:view" | "hotels:add" | "hotels:edit" | "hotels:delete" | "hotels:status" | "bookings:view" | "bookings:add" | "bookings:edit" | "bookings:delete" | "bookings:status" | "dining:view" | "dining:add" | "dining:edit" | "dining:delete" | "dining:status" | "loyalty:view" | "loyalty:add" | "loyalty:edit" | "loyalty:delete" | "loyalty:status")[];
                            profile: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                            zone: {
                                code: string;
                                colorHex: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                                /** @enum {string} */
                                status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                            };
                        }[];
                        /** Format: uuid */
                        memberId: string;
                        version: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    putMemberAccess: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    assignments: {
                        /**
                         * @default {
                         *       "perRefund": null,
                         *       "dailyRefund": null,
                         *       "canReveal": null,
                         *       "canExport": null
                         *     }
                         */
                        limits?: {
                            canExport: boolean | null;
                            canReveal: boolean | null;
                            dailyRefund: number | null;
                            perRefund: number | null;
                        };
                        note?: string | null;
                        /** @default [] */
                        overrides?: {
                            /** @enum {string} */
                            action: "view" | "add" | "edit" | "delete" | "status";
                            /** @enum {string} */
                            effect: "GRANT" | "DENY";
                            /** @enum {string} */
                            module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                        }[];
                        /** Format: uuid */
                        profileId: string;
                        /** Format: uuid */
                        zoneId: string;
                    }[];
                    version?: string;
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        assignments: {
                            /** Format: date-time */
                            assignedAt: string;
                            assignedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                            /** Format: uuid */
                            assignmentId: string;
                            effectiveLimits: {
                                canExport: boolean;
                                canReveal: boolean;
                                dailyRefund: number;
                                perRefund: number;
                            };
                            limits: {
                                canExport: boolean | null;
                                canReveal: boolean | null;
                                dailyRefund: number | null;
                                perRefund: number | null;
                            };
                            note: string | null;
                            overrides: {
                                /** @enum {string} */
                                action: "view" | "add" | "edit" | "delete" | "status";
                                /** @enum {string} */
                                effect: "GRANT" | "DENY";
                                /** @enum {string} */
                                module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                            }[];
                            permissions: ("dashboard:view" | "dashboard:add" | "dashboard:edit" | "dashboard:delete" | "dashboard:status" | "orders:view" | "orders:add" | "orders:edit" | "orders:delete" | "orders:status" | "restaurants:view" | "restaurants:add" | "restaurants:edit" | "restaurants:delete" | "restaurants:status" | "homemakers:view" | "homemakers:add" | "homemakers:edit" | "homemakers:delete" | "homemakers:status" | "menu:view" | "menu:add" | "menu:edit" | "menu:delete" | "menu:status" | "delivery:view" | "delivery:add" | "delivery:edit" | "delivery:delete" | "delivery:status" | "customers:view" | "customers:add" | "customers:edit" | "customers:delete" | "customers:status" | "payments:view" | "payments:add" | "payments:edit" | "payments:delete" | "payments:status" | "refunds:view" | "refunds:add" | "refunds:edit" | "refunds:delete" | "refunds:status" | "settlements:view" | "settlements:add" | "settlements:edit" | "settlements:delete" | "settlements:status" | "payouts:view" | "payouts:add" | "payouts:edit" | "payouts:delete" | "payouts:status" | "commission:view" | "commission:add" | "commission:edit" | "commission:delete" | "commission:status" | "zones:view" | "zones:add" | "zones:edit" | "zones:delete" | "zones:status" | "admins:view" | "admins:add" | "admins:edit" | "admins:delete" | "admins:status" | "access:view" | "access:add" | "access:edit" | "access:delete" | "access:status" | "offers:view" | "offers:add" | "offers:edit" | "offers:delete" | "offers:status" | "notifications:view" | "notifications:add" | "notifications:edit" | "notifications:delete" | "notifications:status" | "analytics:view" | "analytics:add" | "analytics:edit" | "analytics:delete" | "analytics:status" | "reviews:view" | "reviews:add" | "reviews:edit" | "reviews:delete" | "reviews:status" | "support:view" | "support:add" | "support:edit" | "support:delete" | "support:status" | "settings:view" | "settings:add" | "settings:edit" | "settings:delete" | "settings:status" | "integrations:view" | "integrations:add" | "integrations:edit" | "integrations:delete" | "integrations:status" | "audit:view" | "audit:add" | "audit:edit" | "audit:delete" | "audit:status" | "hotels:view" | "hotels:add" | "hotels:edit" | "hotels:delete" | "hotels:status" | "bookings:view" | "bookings:add" | "bookings:edit" | "bookings:delete" | "bookings:status" | "dining:view" | "dining:add" | "dining:edit" | "dining:delete" | "dining:status" | "loyalty:view" | "loyalty:add" | "loyalty:edit" | "loyalty:delete" | "loyalty:status")[];
                            profile: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            };
                            zone: {
                                code: string;
                                colorHex: string;
                                /** Format: uuid */
                                id: string;
                                name: string;
                                /** @enum {string} */
                                status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                            };
                        }[];
                        /** Format: uuid */
                        memberId: string;
                        version: string;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    previewMemberAccess: {
        parameters: {
            query: {
                zoneId: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Preview */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        assigned: boolean;
                        limits: {
                            canExport: boolean;
                            canReveal: boolean;
                            dailyRefund: number;
                            perRefund: number;
                        };
                        matrix: {
                            /** @enum {string} */
                            action: "view" | "add" | "edit" | "delete" | "status";
                            effective: boolean;
                            fromProfile: boolean;
                            grantable: boolean;
                            /** @enum {string} */
                            module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                            /** @enum {string|null} */
                            override: "GRANT" | "DENY" | null;
                        }[];
                        /** Format: uuid */
                        memberId: string;
                        permissions: ("dashboard:view" | "dashboard:add" | "dashboard:edit" | "dashboard:delete" | "dashboard:status" | "orders:view" | "orders:add" | "orders:edit" | "orders:delete" | "orders:status" | "restaurants:view" | "restaurants:add" | "restaurants:edit" | "restaurants:delete" | "restaurants:status" | "homemakers:view" | "homemakers:add" | "homemakers:edit" | "homemakers:delete" | "homemakers:status" | "menu:view" | "menu:add" | "menu:edit" | "menu:delete" | "menu:status" | "delivery:view" | "delivery:add" | "delivery:edit" | "delivery:delete" | "delivery:status" | "customers:view" | "customers:add" | "customers:edit" | "customers:delete" | "customers:status" | "payments:view" | "payments:add" | "payments:edit" | "payments:delete" | "payments:status" | "refunds:view" | "refunds:add" | "refunds:edit" | "refunds:delete" | "refunds:status" | "settlements:view" | "settlements:add" | "settlements:edit" | "settlements:delete" | "settlements:status" | "payouts:view" | "payouts:add" | "payouts:edit" | "payouts:delete" | "payouts:status" | "commission:view" | "commission:add" | "commission:edit" | "commission:delete" | "commission:status" | "zones:view" | "zones:add" | "zones:edit" | "zones:delete" | "zones:status" | "admins:view" | "admins:add" | "admins:edit" | "admins:delete" | "admins:status" | "access:view" | "access:add" | "access:edit" | "access:delete" | "access:status" | "offers:view" | "offers:add" | "offers:edit" | "offers:delete" | "offers:status" | "notifications:view" | "notifications:add" | "notifications:edit" | "notifications:delete" | "notifications:status" | "analytics:view" | "analytics:add" | "analytics:edit" | "analytics:delete" | "analytics:status" | "reviews:view" | "reviews:add" | "reviews:edit" | "reviews:delete" | "reviews:status" | "support:view" | "support:add" | "support:edit" | "support:delete" | "support:status" | "settings:view" | "settings:add" | "settings:edit" | "settings:delete" | "settings:status" | "integrations:view" | "integrations:add" | "integrations:edit" | "integrations:delete" | "integrations:status" | "audit:view" | "audit:add" | "audit:edit" | "audit:delete" | "audit:status" | "hotels:view" | "hotels:add" | "hotels:edit" | "hotels:delete" | "hotels:status" | "bookings:view" | "bookings:add" | "bookings:edit" | "bookings:delete" | "bookings:status" | "dining:view" | "dining:add" | "dining:edit" | "dining:delete" | "dining:status" | "loyalty:view" | "loyalty:add" | "loyalty:edit" | "loyalty:delete" | "loyalty:status")[];
                        visibleModules: ("dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty")[];
                        /** Format: uuid */
                        zoneId: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    resetZonalAdminPassword: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    temporaryPassword: string;
                };
            };
        };
        responses: {
            /** @description Reset */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        sessionsRevoked: number;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    revokeZonalAdminSessions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        sessionsRevoked: number;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    listZones: {
        parameters: {
            query?: {
                after?: string;
                limit?: number;
                q?: string;
                state?: string;
                status?: "UPCOMING" | "ACTIVE" | "INACTIVE";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One page of zones */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            activatedAt: string | null;
                            city: string;
                            code: string;
                            colorHex: string;
                            counts: {
                                customers: number;
                                homemakers: number;
                                members: number;
                                partners: number;
                                restaurants: number;
                            };
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            deactivatedAt: string | null;
                            deactivationReason: string | null;
                            deliveryChargePaise: number;
                            description: string | null;
                            /** Format: uuid */
                            id: string;
                            name: string;
                            pincodeCount: number;
                            pincodeFrom: string | null;
                            pincodeTo: string | null;
                            services?: {
                                HOME_FOOD: boolean;
                                HOTEL_BOOKING: boolean;
                                RESTAURANTS: boolean;
                            };
                            state: string | null;
                            /** @enum {string} */
                            status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                            team: {
                                top: {
                                    name: string;
                                    /** Format: uuid */
                                    userId: string;
                                }[];
                                total: number;
                            };
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                        }[];
                        meta: {
                            limit: number;
                            nextCursor: string | null;
                        };
                        missingSources: ("restaurants" | "homemakers" | "delivery" | "customers" | "orders" | "access" | "registrations" | "refunds" | "payouts")[];
                        partial: boolean;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    createZone: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    city: string;
                    code: string;
                    /** @enum {string} */
                    colorHex: "#DC2626" | "#EA580C" | "#D97706" | "#65A30D" | "#16A34A" | "#059669" | "#0D9488" | "#0891B2" | "#2563EB" | "#4F46E5" | "#7C3AED" | "#DB2777";
                    deliveryChargePaise: number;
                    description?: string;
                    name: string;
                    pincodeFrom?: string;
                    pincodes?: string[];
                    pincodeTo?: string;
                    state: string;
                    /**
                     * @default UPCOMING
                     * @enum {string}
                     */
                    status?: "UPCOMING" | "ACTIVE" | "INACTIVE";
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: date-time */
                        activatedAt: string | null;
                        city: string;
                        code: string;
                        colorHex: string;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        deactivatedAt: string | null;
                        deactivationReason: string | null;
                        deliveryChargePaise: number;
                        description: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        pincodeCount: number;
                        pincodeFrom: string | null;
                        pincodeTo: string | null;
                        state: string | null;
                        /** @enum {string} */
                        status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                        /** Format: date-time */
                        updatedAt: string;
                        version: number;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description A pincode belongs to another zone (error.meta.conflicts); The zone code is taken (codes are never reused); Another zone has this name */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description A range may hold at most 2000 pincodes; Invalid input; The zone cannot go live yet (error.meta.missing) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getZone: {
        parameters: {
            query?: {
                pincodePage?: number;
                pincodePageSize?: number;
                pincodeQ?: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The zone */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: date-time */
                        activatedAt: string | null;
                        city: string;
                        code: string;
                        colorHex: string;
                        counts: {
                            customers: number;
                            homemakers: number;
                            members: number;
                            partners: number;
                            restaurants: number;
                        };
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        deactivatedAt: string | null;
                        deactivationReason: string | null;
                        deliveryChargePaise: number;
                        description: string | null;
                        /** Format: uuid */
                        id: string;
                        missingSources: ("restaurants" | "homemakers" | "delivery" | "customers" | "orders" | "access" | "registrations" | "refunds" | "payouts")[];
                        name: string;
                        partial: boolean;
                        pincodeCount: number;
                        pincodeFrom: string | null;
                        pincodes: {
                            data: {
                                /** Format: date-time */
                                createdAt: string;
                                pincode: string;
                                /** @enum {string} */
                                source: "RANGE" | "MANUAL" | "IMPORT";
                            }[];
                            meta: {
                                page: number;
                                pageSize: number;
                                total: number;
                            };
                        };
                        pincodeTo: string | null;
                        services?: {
                            HOME_FOOD: boolean;
                            HOTEL_BOOKING: boolean;
                            RESTAURANTS: boolean;
                        };
                        state: string | null;
                        /** @enum {string} */
                        status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                        team: {
                            top: {
                                name: string;
                                /** Format: uuid */
                                userId: string;
                            }[];
                            total: number;
                        };
                        /** Format: date-time */
                        updatedAt: string;
                        version: number;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    deleteZone: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state; The zone has history and cannot be deleted (error.meta.counts) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    updateZone: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    city?: string;
                    /** @enum {string} */
                    colorHex?: "#DC2626" | "#EA580C" | "#D97706" | "#65A30D" | "#16A34A" | "#059669" | "#0D9488" | "#0891B2" | "#2563EB" | "#4F46E5" | "#7C3AED" | "#DB2777";
                    deliveryChargePaise?: number;
                    description?: string | null;
                    name?: string;
                    state?: string;
                    version: number;
                };
            };
        };
        responses: {
            /** @description Updated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: date-time */
                        activatedAt: string | null;
                        city: string;
                        code: string;
                        colorHex: string;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        deactivatedAt: string | null;
                        deactivationReason: string | null;
                        deliveryChargePaise: number;
                        description: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        pincodeCount: number;
                        pincodeFrom: string | null;
                        pincodeTo: string | null;
                        state: string | null;
                        /** @enum {string} */
                        status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                        /** Format: date-time */
                        updatedAt: string;
                        version: number;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Changed by someone else since it was read (error.meta.current); Another zone has this name */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description The zone code cannot be changed; Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    activateZone: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                };
            };
        };
        responses: {
            /** @description Active */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: date-time */
                        activatedAt: string | null;
                        city: string;
                        code: string;
                        colorHex: string;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        deactivatedAt: string | null;
                        deactivationReason: string | null;
                        deliveryChargePaise: number;
                        description: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        pincodeCount: number;
                        pincodeFrom: string | null;
                        pincodeTo: string | null;
                        state: string | null;
                        /** @enum {string} */
                        status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                        /** Format: date-time */
                        updatedAt: string;
                        version: number;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed from the current state; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input; The zone cannot go live yet (error.meta.missing) */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    deactivateZone: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    impactVersion: string;
                    reason: string;
                    version: number;
                };
            };
        };
        responses: {
            /** @description Inactive */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: date-time */
                        activatedAt: string | null;
                        city: string;
                        code: string;
                        colorHex: string;
                        /** Format: date-time */
                        createdAt: string;
                        /** Format: date-time */
                        deactivatedAt: string | null;
                        deactivationReason: string | null;
                        deliveryChargePaise: number;
                        description: string | null;
                        /** Format: uuid */
                        id: string;
                        name: string;
                        pincodeCount: number;
                        pincodeFrom: string | null;
                        pincodeTo: string | null;
                        state: string | null;
                        /** @enum {string} */
                        status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                        /** Format: date-time */
                        updatedAt: string;
                        version: number;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description The impact changed since it was shown (error.meta.impact); Not allowed from the current state; Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description A reason is required; Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getZoneImpact: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Impact */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        counts: {
                            homemakers: number;
                            members: number;
                            openOrders: number;
                            openOrdersByStatus: {
                                [key: string]: number;
                            };
                            partners: number;
                            partnersOnline: number;
                            pendingPayouts: number;
                            pendingRefunds: number;
                            pendingRegistrations: number;
                            restaurants: number;
                            scheduledOrders: number;
                        };
                        impactVersion: string;
                        missingSources: ("restaurants" | "homemakers" | "delivery" | "customers" | "orders" | "access" | "registrations" | "refunds" | "payouts")[];
                        partial: boolean;
                        /** Format: uuid */
                        zoneId: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    updateZonePincodes: {
        parameters: {
            query?: {
                preview?: "true" | "false";
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    add?: string[];
                    range?: {
                        from: string;
                        to: string;
                    };
                    remove?: string[];
                };
            };
        };
        responses: {
            /** @description Applied (or previewed) */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        added: string[];
                        conflicts: {
                            pincode: string;
                            /** Format: uuid */
                            zoneId: string;
                            zoneName: string;
                        }[];
                        mismatches: {
                            /** @enum {string} */
                            entityType: "restaurant" | "homemaker" | "partner";
                            /** Format: uuid */
                            id: string;
                            name: string;
                            pincode: string;
                        }[];
                        missingSources: ("restaurants" | "homemakers" | "delivery" | "customers" | "orders" | "access" | "registrations" | "refunds" | "payouts")[];
                        partial: boolean;
                        preview: boolean;
                        removed: string[];
                        zone: {
                            /** Format: date-time */
                            activatedAt: string | null;
                            city: string;
                            code: string;
                            colorHex: string;
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            deactivatedAt: string | null;
                            deactivationReason: string | null;
                            deliveryChargePaise: number;
                            description: string | null;
                            /** Format: uuid */
                            id: string;
                            name: string;
                            pincodeCount: number;
                            pincodeFrom: string | null;
                            pincodeTo: string | null;
                            state: string | null;
                            /** @enum {string} */
                            status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                        };
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description A pincode belongs to another zone (error.meta.conflicts) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description A range may hold at most 2000 pincodes; Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getZoneServices: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Services */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        services: {
                            enabled: boolean;
                            isDefault: boolean;
                            label: string;
                            /** @enum {string} */
                            service: "RESTAURANTS" | "HOME_FOOD" | "HOTEL_BOOKING";
                            /** Format: date-time */
                            updatedAt: string | null;
                            updatedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        /** Format: uuid */
                        zoneId: string;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    putZoneServices: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    services: {
                        HOME_FOOD?: boolean;
                        HOTEL_BOOKING?: boolean;
                        RESTAURANTS?: boolean;
                    };
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        services: {
                            enabled: boolean;
                            isDefault: boolean;
                            label: string;
                            /** @enum {string} */
                            service: "RESTAURANTS" | "HOME_FOOD" | "HOTEL_BOOKING";
                            /** Format: date-time */
                            updatedAt: string | null;
                            updatedBy: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                            } | null;
                        }[];
                        /** Format: uuid */
                        zoneId: string;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    putZoneSettings: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                group: "refunds" | "onboarding" | "support" | "notifications" | "orders" | "sms" | "loyalty" | "security" | "payouts" | "zones" | "access" | "sessions";
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                    values: {
                        [key: string]: unknown;
                    };
                    versions?: {
                        [key: string]: number;
                    };
                };
            };
        };
        responses: {
            /** @description Saved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            default?: unknown;
                            description: string;
                            editable: boolean;
                            effect: {
                                module: string | null;
                                /** @enum {string} */
                                state: "ENFORCED" | "PENDING_MODULE" | "NOT_CONFIGURED";
                            };
                            effective?: unknown;
                            /** @enum {string} */
                            group: "refunds" | "onboarding" | "support" | "notifications" | "orders" | "sms" | "loyalty" | "security" | "payouts" | "zones" | "access" | "sessions";
                            key: string;
                            label: string;
                            platform: {
                                /** Format: date-time */
                                updatedAt: string;
                                updatedBy: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                                value?: unknown;
                                version: number;
                            } | null;
                            /** @enum {string} */
                            reauth: "PASSWORD" | "STRONG";
                            /** @enum {string} */
                            source: "DEFAULT" | "PLATFORM" | "ZONE";
                            zone: {
                                /** Format: date-time */
                                updatedAt: string;
                                updatedBy: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                                value?: unknown;
                                version: number;
                            } | null;
                            zoneOverride: boolean;
                        }[];
                        /** Format: uuid */
                        zoneId: string | null;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Changed by someone else since it was read (error.meta.current) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    resetZoneSetting: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                group: "refunds" | "onboarding" | "support" | "notifications" | "orders" | "sms" | "loyalty" | "security" | "payouts" | "zones" | "access" | "sessions";
                id: string;
                key: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Removed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            default?: unknown;
                            description: string;
                            editable: boolean;
                            effect: {
                                module: string | null;
                                /** @enum {string} */
                                state: "ENFORCED" | "PENDING_MODULE" | "NOT_CONFIGURED";
                            };
                            effective?: unknown;
                            /** @enum {string} */
                            group: "refunds" | "onboarding" | "support" | "notifications" | "orders" | "sms" | "loyalty" | "security" | "payouts" | "zones" | "access" | "sessions";
                            key: string;
                            label: string;
                            platform: {
                                /** Format: date-time */
                                updatedAt: string;
                                updatedBy: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                                value?: unknown;
                                version: number;
                            } | null;
                            /** @enum {string} */
                            reauth: "PASSWORD" | "STRONG";
                            /** @enum {string} */
                            source: "DEFAULT" | "PLATFORM" | "ZONE";
                            zone: {
                                /** Format: date-time */
                                updatedAt: string;
                                updatedBy: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                } | null;
                                value?: unknown;
                                version: number;
                            } | null;
                            zoneOverride: boolean;
                        }[];
                        /** Format: uuid */
                        zoneId: string | null;
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getZoneTeam: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Zone team */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        data: {
                            /** Format: date-time */
                            assignedAt: string;
                            /** Format: uuid */
                            assignmentId: string;
                            email: string;
                            limits: {
                                canExport: boolean;
                                canReveal: boolean;
                                dailyRefundPaise: number;
                                perRefundPaise: number;
                            };
                            name: string;
                            overridesCount: number;
                            /** Format: uuid */
                            profileId: string;
                            profileName: string;
                            /** @enum {string} */
                            status: "ACTIVE" | "SUSPENDED";
                            /** Format: uuid */
                            userId: string;
                        }[];
                        missingSources: ("restaurants" | "homemakers" | "delivery" | "customers" | "orders" | "access" | "registrations" | "refunds" | "payouts")[];
                        partial: boolean;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    addZoneTeamMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    limits?: {
                        canExport: boolean | null;
                        canReveal: boolean | null;
                        dailyRefund: number | null;
                        perRefund: number | null;
                    };
                    note?: string | null;
                    /** Format: uuid */
                    profileId: string;
                };
            };
        };
        responses: {
            /** @description Added */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: date-time */
                        assignedAt: string;
                        assignedBy: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                        /** Format: uuid */
                        assignmentId: string;
                        effectiveLimits: {
                            canExport: boolean;
                            canReveal: boolean;
                            dailyRefund: number;
                            perRefund: number;
                        };
                        limits: {
                            canExport: boolean | null;
                            canReveal: boolean | null;
                            dailyRefund: number | null;
                            perRefund: number | null;
                        };
                        note: string | null;
                        overrides: {
                            /** @enum {string} */
                            action: "view" | "add" | "edit" | "delete" | "status";
                            /** @enum {string} */
                            effect: "GRANT" | "DENY";
                            /** @enum {string} */
                            module: "dashboard" | "orders" | "restaurants" | "homemakers" | "menu" | "delivery" | "customers" | "payments" | "refunds" | "settlements" | "payouts" | "commission" | "zones" | "admins" | "access" | "offers" | "notifications" | "analytics" | "reviews" | "support" | "settings" | "integrations" | "audit" | "hotels" | "bookings" | "dining" | "loyalty";
                        }[];
                        permissions: ("dashboard:view" | "dashboard:add" | "dashboard:edit" | "dashboard:delete" | "dashboard:status" | "orders:view" | "orders:add" | "orders:edit" | "orders:delete" | "orders:status" | "restaurants:view" | "restaurants:add" | "restaurants:edit" | "restaurants:delete" | "restaurants:status" | "homemakers:view" | "homemakers:add" | "homemakers:edit" | "homemakers:delete" | "homemakers:status" | "menu:view" | "menu:add" | "menu:edit" | "menu:delete" | "menu:status" | "delivery:view" | "delivery:add" | "delivery:edit" | "delivery:delete" | "delivery:status" | "customers:view" | "customers:add" | "customers:edit" | "customers:delete" | "customers:status" | "payments:view" | "payments:add" | "payments:edit" | "payments:delete" | "payments:status" | "refunds:view" | "refunds:add" | "refunds:edit" | "refunds:delete" | "refunds:status" | "settlements:view" | "settlements:add" | "settlements:edit" | "settlements:delete" | "settlements:status" | "payouts:view" | "payouts:add" | "payouts:edit" | "payouts:delete" | "payouts:status" | "commission:view" | "commission:add" | "commission:edit" | "commission:delete" | "commission:status" | "zones:view" | "zones:add" | "zones:edit" | "zones:delete" | "zones:status" | "admins:view" | "admins:add" | "admins:edit" | "admins:delete" | "admins:status" | "access:view" | "access:add" | "access:edit" | "access:delete" | "access:status" | "offers:view" | "offers:add" | "offers:edit" | "offers:delete" | "offers:status" | "notifications:view" | "notifications:add" | "notifications:edit" | "notifications:delete" | "notifications:status" | "analytics:view" | "analytics:add" | "analytics:edit" | "analytics:delete" | "analytics:status" | "reviews:view" | "reviews:add" | "reviews:edit" | "reviews:delete" | "reviews:status" | "support:view" | "support:add" | "support:edit" | "support:delete" | "support:status" | "settings:view" | "settings:add" | "settings:edit" | "settings:delete" | "settings:status" | "integrations:view" | "integrations:add" | "integrations:edit" | "integrations:delete" | "integrations:status" | "audit:view" | "audit:add" | "audit:edit" | "audit:delete" | "audit:status" | "hotels:view" | "hotels:add" | "hotels:edit" | "hotels:delete" | "hotels:status" | "bookings:view" | "bookings:add" | "bookings:edit" | "bookings:delete" | "bookings:status" | "dining:view" | "dining:add" | "dining:edit" | "dining:delete" | "dining:status" | "loyalty:view" | "loyalty:add" | "loyalty:edit" | "loyalty:delete" | "loyalty:status")[];
                        profile: {
                            /** Format: uuid */
                            id: string;
                            name: string;
                        };
                        zone: {
                            code: string;
                            colorHex: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                            /** @enum {string} */
                            status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                        };
                    };
                };
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    removeZoneTeamMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Recent re-authentication required; Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    lookupZonePincode: {
        parameters: {
            query: {
                pincode: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Owning zone */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        pincode: string;
                        zone: {
                            code: string;
                            /** Format: uuid */
                            id: string;
                            name: string;
                            /** @enum {string} */
                            status: "UPCOMING" | "ACTIVE" | "INACTIVE";
                        } | null;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Invalid input */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
    getZoneSummary: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Zone counts */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        active: number;
                        inactive: number;
                        missingSources: ("restaurants" | "homemakers" | "delivery" | "customers" | "orders" | "access" | "registrations" | "refunds" | "payouts")[];
                        partial: boolean;
                        total: number;
                        upcoming: number;
                        withoutTeam: number;
                    };
                };
            };
            /** @description Not signed in, or the session ended */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not allowed (missing permission, bad CSRF token or Origin) */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not found (also used for objects in zones the caller cannot see) */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
        };
    };
}
