import { z } from 'zod';

// Integration API (inbound from the apps) request and response shapes, from docs/G-integration/contracts/
// intake.openapi.yaml (authoritative). Only the shapes the API has built so far live here.

/** The client types and their scopes (doc 42 section 2). */
export const INTAKE_SCOPES = {
  CUSTOMER_APP: [
    'customers:write',
    'orders:create',
    'orders:cancel',
    'payments:attempt',
    'zones:resolve',
    'config:read',
    'events:read',
  ],
  VENDOR_APP: [
    'vendors:register',
    'vendors:write',
    'menu:write',
    'orders:vendor',
    'uploads:presign',
    'config:read',
    'events:read',
  ],
  PARTNER_APP: [
    'partners:register',
    'partners:write',
    'partners:location',
    'orders:partner',
    'cash:handover',
    'uploads:presign',
    'config:read',
    'events:read',
  ],
} as const;

/** GET /ping (contract schema Ping) */
export const intakePingSchema = z.object({
  serverTime: z.iso.datetime(),
  client: z.string(),
  environment: z.enum(['SANDBOX', 'PRODUCTION']),
});
export type IntakePing = z.infer<typeof intakePingSchema>;

/** GET /zones/resolve query: pincode decides (D83); lat and lng are accepted and not used. */
export const intakeZoneResolveQuerySchema = z
  .object({
    pincode: z.string().trim().max(12).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .strict();
export type IntakeZoneResolveQuery = z.infer<typeof intakeZoneResolveQuerySchema>;
