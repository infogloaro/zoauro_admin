// GENERATED from apps/api/openapi/openapi.json by `pnpm openapi:generate`. Do not edit by hand.
export interface paths {
  '/auth/forgot-password': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Request a password reset link. Always answers the same way. */
    post: operations['forgotPassword'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Sign in. The tab (SUPER_ADMIN or ZONAL_ADMIN) must match the account; a mismatch gets the generic error. */
    post: operations['login'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/logout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Sign out and revoke the session */
    post: operations['logout'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/reauth': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Confirm the password again before a high-risk action (valid for 10 minutes) */
    post: operations['reauth'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/auth/reset-password': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Set a new password with a single-use reset token; revokes all sessions */
    post: operations['resetPassword'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/me': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** The signed-in user, CSRF token and (stub) permissions */
    get: operations['getMe'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/openapi.json': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    /** This OpenAPI document */
    get: operations['getOpenApiDocument'];
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
        code:
          | 'UNAUTHENTICATED'
          | 'FORBIDDEN'
          | 'NOT_FOUND'
          | 'ZONE_NOT_FOUND'
          | 'VALIDATION_ERROR'
          | 'CONFLICT'
          | 'RATE_LIMITED'
          | 'INVALID_STATE_TRANSITION'
          | 'REFUND_LIMIT_EXCEEDED'
          | 'REAUTH_REQUIRED'
          | 'PASSWORD_CHANGE_REQUIRED'
          | 'INTERNAL';
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
  forgotPassword: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': {
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
          'application/json': {
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
          'application/json': components['schemas']['ErrorBody'];
        };
      };
      /** @description Invalid input */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorBody'];
        };
      };
      /** @description Too many requests */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorBody'];
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
        'application/json': {
          email: string;
          password: string;
          /** @enum {string} */
          tab: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
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
          'application/json': {
            csrfToken: string;
            mustChangePassword: boolean;
            redirectTo: string;
            user: {
              email: string;
              /** Format: uuid */
              id: string;
              name: string;
              /** @enum {string} */
              role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
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
          'application/json': components['schemas']['ErrorBody'];
        };
      };
      /** @description Not allowed (missing permission, bad CSRF token or Origin) */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorBody'];
        };
      };
      /** @description Invalid input */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorBody'];
        };
      };
      /** @description Too many requests */
      429: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorBody'];
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
          'application/json': components['schemas']['ErrorBody'];
        };
      };
      /** @description Not allowed (missing permission, bad CSRF token or Origin) */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorBody'];
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
        'application/json': {
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
          'application/json': {
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
          'application/json': components['schemas']['ErrorBody'];
        };
      };
      /** @description Not allowed (missing permission, bad CSRF token or Origin); The first-login password change is still pending */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorBody'];
        };
      };
      /** @description Invalid input */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorBody'];
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
        'application/json': {
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
          'application/json': {
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
          'application/json': components['schemas']['ErrorBody'];
        };
      };
      /** @description Invalid input */
      422: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorBody'];
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
          'application/json': {
            csrfToken: string;
            mustChangePassword: boolean;
            permissions:
              | {
                  /** @enum {boolean} */
                  global: true;
                }
              | {
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
              role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
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
          'application/json': components['schemas']['ErrorBody'];
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
          'application/json': {
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
