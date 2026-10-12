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
    "/auth/reauth": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Confirm the password again before a high-risk action (valid for 10 minutes) */
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
                code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "ZONE_NOT_FOUND" | "VALIDATION_ERROR" | "CONFLICT" | "RATE_LIMITED" | "INVALID_STATE_TRANSITION" | "REFUND_LIMIT_EXCEEDED" | "REAUTH_REQUIRED" | "PASSWORD_CHANGE_REQUIRED" | "INTERNAL";
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
                        redirectTo: string;
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
                    password: string;
                };
            };
        };
        responses: {
            /** @description Re-authenticated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: date-time */
                        reauthenticatedUntil: string;
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
                        mustChangePassword: boolean;
                        permissions: {
                            /** @enum {boolean} */
                            global: true;
                        } | {
                            /** @enum {boolean} */
                            global: false;
                            zones: ({
                                /** Format: uuid */
                                zoneId: string;
                            } & {
                                [key: string]: unknown;
                            })[];
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
