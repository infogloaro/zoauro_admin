// GENERATED from apps/api/openapi/openapi.json by `pnpm openapi:generate`. Do not edit by hand.
export interface paths {
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
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ErrorBody: {
            error: {
                /** @enum {string} */
                code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "ZONE_NOT_FOUND" | "VALIDATION_ERROR" | "CONFLICT" | "RATE_LIMITED" | "INVALID_STATE_TRANSITION" | "REFUND_LIMIT_EXCEEDED" | "REAUTH_REQUIRED" | "PASSWORD_CHANGE_REQUIRED" | "SMS_NOT_AVAILABLE" | "PHONE_MISSING" | "LAST_METHOD_REQUIRED" | "INTERNAL";
                details?: {
                    field: string;
                    issue: string;
                }[];
                message: string;
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
                module?: "auth" | "zones" | "admins" | "access" | "restaurants" | "homemakers" | "menu" | "customers" | "delivery" | "orders" | "payments" | "refunds" | "settlements" | "payouts" | "settings" | "integrations" | "notifications" | "audit" | "system";
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
                            module: "auth" | "zones" | "admins" | "access" | "restaurants" | "homemakers" | "menu" | "customers" | "delivery" | "orders" | "payments" | "refunds" | "settlements" | "payouts" | "settings" | "integrations" | "notifications" | "audit" | "system";
                        }[];
                        modules: ("auth" | "zones" | "admins" | "access" | "restaurants" | "homemakers" | "menu" | "customers" | "delivery" | "orders" | "payments" | "refunds" | "settlements" | "payouts" | "settings" | "integrations" | "notifications" | "audit" | "system")[];
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
                                permissions: ("dashboard:view" | "dashboard:add" | "dashboard:edit" | "dashboard:delete" | "dashboard:status" | "orders:view" | "orders:add" | "orders:edit" | "orders:delete" | "orders:status" | "restaurants:view" | "restaurants:add" | "restaurants:edit" | "restaurants:delete" | "restaurants:status" | "homemakers:view" | "homemakers:add" | "homemakers:edit" | "homemakers:delete" | "homemakers:status" | "menu:view" | "menu:add" | "menu:edit" | "menu:delete" | "menu:status" | "delivery:view" | "delivery:add" | "delivery:edit" | "delivery:delete" | "delivery:status" | "customers:view" | "customers:add" | "customers:edit" | "customers:delete" | "customers:status" | "payments:view" | "payments:add" | "payments:edit" | "payments:delete" | "payments:status" | "refunds:view" | "refunds:add" | "refunds:edit" | "refunds:delete" | "refunds:status" | "settlements:view" | "settlements:add" | "settlements:edit" | "settlements:delete" | "settlements:status" | "payouts:view" | "payouts:add" | "payouts:edit" | "payouts:delete" | "payouts:status" | "commission:view" | "commission:add" | "commission:edit" | "commission:delete" | "commission:status" | "zones:view" | "zones:add" | "zones:edit" | "zones:delete" | "zones:status" | "admins:view" | "admins:add" | "admins:edit" | "admins:delete" | "admins:status" | "access:view" | "access:add" | "access:edit" | "access:delete" | "access:status" | "offers:view" | "offers:add" | "offers:edit" | "offers:delete" | "offers:status" | "notifications:view" | "notifications:add" | "notifications:edit" | "notifications:delete" | "notifications:status" | "analytics:view" | "analytics:add" | "analytics:edit" | "analytics:delete" | "analytics:status" | "reviews:view" | "reviews:add" | "reviews:edit" | "reviews:delete" | "reviews:status" | "support:view" | "support:add" | "support:edit" | "support:delete" | "support:status" | "settings:view" | "settings:add" | "settings:edit" | "settings:delete" | "settings:status" | "integrations:view" | "integrations:add" | "integrations:edit" | "integrations:delete" | "integrations:status" | "audit:view" | "audit:add" | "audit:edit" | "audit:delete" | "audit:status")[];
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
}
