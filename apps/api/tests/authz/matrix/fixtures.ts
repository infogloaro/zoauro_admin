import { isGrantable, parsePermissionKey, type PermissionKey } from '@zoauro/shared';
import type { AuthTestEnv, PersonaRole, TestUser } from '../../auth/support/auth-env';
import { PLACEHOLDER_ID } from './engine';

// Fixtures for the authorization matrix (doc 24 section 2, doc 36 section 6): zones A, B, C and the actors
//   SuperAdmin, Admin(A full), Admin(A+B: full in A, read-only in B), Admin(A, payments denied), Admin(none)
// plus Admin(first login) for routes that must refuse a session whose password change is still pending.
//
// Every actor carries an ORACLE: `holds(zone, key)` answers "may this actor do `key` in `zone`?" from the declared
// profile and denies only. It is written independently of the production resolver on purpose: if the resolver and the
// oracle disagree, the matrix fails.

export type ZoneLabel = 'A' | 'B' | 'C';
export const ZONE_LABELS: readonly ZoneLabel[] = ['A', 'B', 'C'];

type Grants = Record<string, string[]>;
const ALL = ['view', 'add', 'edit', 'delete', 'status'];

/** What a "full" zone member holds (doc 04 seed Zone Manager, restricted to what is grantable). */
export const FULL: Grants = {
  dashboard: ['view'],
  orders: ALL,
  restaurants: ALL,
  homemakers: ALL,
  menu: ALL,
  delivery: ALL,
  customers: ALL,
  payments: ['view'],
  refunds: ['view', 'add'],
  settlements: ['view', 'add', 'edit'],
  payouts: ['view'],
};
export const READ_ONLY: Grants = Object.fromEntries(Object.keys(FULL).map((m) => [m, ['view']]));

export interface MatrixActor {
  name: string;
  role: PersonaRole;
  user: TestUser;
  /** first-login password change still pending */
  mustChangePassword: boolean;
  profileByZone: Partial<Record<ZoneLabel, Grants>>;
  /** permission keys denied by an override in every assigned zone */
  denied: PermissionKey[];
  assigned(): ZoneLabel[];
  /** the oracle */
  holds(zone: ZoneLabel, key: PermissionKey): boolean;
  holdsAnywhere(key: PermissionKey): boolean;
}

export interface MatrixFixtures {
  zones: Record<ZoneLabel, string>;
  labelOf(zoneId: string): ZoneLabel;
  actors: MatrixActor[];
  byName(name: string): MatrixActor;
}

interface ActorSpec {
  name: string;
  role: PersonaRole;
  profileByZone: Partial<Record<ZoneLabel, Grants>>;
  denied?: PermissionKey[];
  mustChangePassword?: boolean;
}

export const ACTOR_SPECS: ActorSpec[] = [
  { name: 'SuperAdmin', role: 'SUPER_ADMIN', profileByZone: {} },
  { name: 'Admin(A full)', role: 'ZONAL_ADMIN', profileByZone: { A: FULL } },
  {
    name: 'Admin(A+B: full A, read-only B)',
    role: 'ZONAL_ADMIN',
    profileByZone: { A: FULL, B: READ_ONLY },
  },
  {
    name: 'Admin(A, payments denied)',
    role: 'ZONAL_ADMIN',
    profileByZone: { A: FULL },
    denied: ['payments:view'],
  },
  { name: 'Admin(none)', role: 'ZONAL_ADMIN', profileByZone: {} },
  {
    name: 'Admin(first login)',
    role: 'ZONAL_ADMIN',
    profileByZone: { A: FULL },
    mustChangePassword: true,
  },
];

export async function createMatrixFixtures(env: AuthTestEnv): Promise<MatrixFixtures> {
  const zones: Record<ZoneLabel, string> = {
    A: await env.createZone(),
    B: await env.createZone(),
    C: await env.createZone(),
  };
  const admin = await env.createUser('SUPER_ADMIN', { emailPrefix: 'matrix-grantor' });
  const profileIds = new Map<Grants, string>();
  const profileFor = async (grants: Grants): Promise<string> => {
    let id = profileIds.get(grants);
    if (!id) {
      id = await env.createProfile(grants);
      profileIds.set(grants, id);
    }
    return id;
  };

  const actors: MatrixActor[] = [];
  for (const spec of ACTOR_SPECS) {
    const user = await env.createUser(spec.role, {
      emailPrefix: 'matrix',
      ...(spec.mustChangePassword ? { mustChangePassword: true } : {}),
    });
    const denied = spec.denied ?? [];
    for (const label of ZONE_LABELS) {
      const grants = spec.profileByZone[label];
      if (!grants) continue;
      const assignment = await env.assignZone(user.id, zones[label], admin.id, {
        profileId: await profileFor(grants),
      });
      for (const key of denied) {
        const parsed = parsePermissionKey(key);
        if (parsed) await env.addOverride(assignment, parsed.module, parsed.action, 'DENY');
      }
    }
    const assigned = (): ZoneLabel[] =>
      ZONE_LABELS.filter((l) => spec.profileByZone[l] !== undefined);
    const holds = (zone: ZoneLabel, key: PermissionKey): boolean => {
      if (spec.role === 'SUPER_ADMIN') return true;
      const parsed = parsePermissionKey(key);
      const grants = spec.profileByZone[zone];
      if (!parsed || !grants) return false;
      return (
        (grants[parsed.module] ?? []).includes(parsed.action) &&
        isGrantable(parsed.module, parsed.action) &&
        !denied.includes(key)
      );
    };
    actors.push({
      name: spec.name,
      role: spec.role,
      user,
      mustChangePassword: spec.mustChangePassword ?? false,
      profileByZone: spec.profileByZone,
      denied,
      assigned,
      holds,
      holdsAnywhere: (key) =>
        spec.role === 'SUPER_ADMIN' ? true : assigned().some((z) => holds(z, key)),
    });
  }

  // GET /audit-logs/{id} with the placeholder id: a zone-less row, so Super Admin reads it and no Zonal Admin ever does
  await env.db.owner.query(
    `INSERT INTO audit_logs (id, actor_type, actor_name, module, action, entity_type, entity_id, entity_label)
     VALUES ($1, 'SYSTEM', 'System: matrix fixture', 'zones', 'zone.updated', 'zone', $2, 'Zone A')`,
    [PLACEHOLDER_ID, zones.A],
  );

  // /zones/{id} routes with the placeholder id: a zone the Super Admin can read (never an assigned zone of anyone)
  await env.db.owner.query(
    `INSERT INTO zones (id, name, code, city, color_hex, updated_at)
     VALUES ($1, 'Matrix placeholder zone', 'MXPH', 'Chennai', '#2563EB', now())`,
    [PLACEHOLDER_ID],
  );

  // M03 routes with the placeholder id: a Zonal Admin account no actor signs in as (/zonal-admins/{id}) and an access
  // profile (/access-profiles/{id}), so a Super Admin's read answers 200 and nobody else's
  await env.db.owner.query(
    `INSERT INTO users (id, name, email, password_hash, role_id, status, updated_at)
     SELECT $1, 'Matrix placeholder member', 'matrix-placeholder@example.test', 'not-a-login', id, 'ACTIVE', now()
     FROM roles WHERE name = 'ZONAL_ADMIN'`,
    [PLACEHOLDER_ID],
  );
  await env.db.owner.query(
    `INSERT INTO access_profiles (id, name, updated_at) VALUES ($1, 'Matrix placeholder profile', now())`,
    [PLACEHOLDER_ID],
  );
  // /access-requests/{id}: a pending request of the placeholder member for the placeholder zone
  await env.db.owner.query(
    `INSERT INTO access_requests (id, requester_id, kind, zone_id, reason, updated_at)
     VALUES ($1, $1, 'ZONE', $1, 'Matrix placeholder request', now())`,
    [PLACEHOLDER_ID],
  );

  // M11 orders: one order in each of zones A, B and C (C is nobody's), so GET /orders shows which zones an actor
  // reached; the zone A one has the placeholder id for /orders/{id} (scope rules: tests/orders/orders-api.test.ts)
  for (const [i, z] of (['A', 'B', 'C'] as const).entries()) {
    const id = i === 0 ? PLACEHOLDER_ID : `0192f1d2-0000-7000-8000-00000000f0${i}0`;
    await env.db.owner.query(
      `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
       VALUES ($1, $2, 'Matrix kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
      [id, zones[z]],
    );
    await env.db.owner.query(
      `INSERT INTO customers (id, name, phone, updated_at) VALUES ($1, 'Matrix customer', $2, now())`,
      [id, `+91980000000${i}`],
    );
    await env.db.owner.query(
      `INSERT INTO orders (id, order_no, zone_id, customer_id, restaurant_id, status, subtotal, total, commission_pct,
         commission_amount, payment_method, address_snapshot_json, placed_at, updated_at)
       VALUES ($1, $2, $3, $1, $1, 'PLACED', 100, 100, 10, 10, 'ONLINE', '{}', now(), now())`,
      [id, `MX-${z}`, zones[z]],
    );
  }

  // M06/M07 vendors: the orders block above made one restaurant per zone (the zone A one has the placeholder id); one
  // homemaker per zone likewise, so GET /homemakers shows which zones an actor reached and /homemakers/{id} is in zone A.
  // Zone A members may reveal contacts (D123), so POST /{module}/{id}/reveal answers 200 to whoever may view zone A;
  // the reveal flag itself is tested in tests/vendors/vendors-api.test.ts.
  for (const [i, z] of (['A', 'B', 'C'] as const).entries()) {
    const id = i === 0 ? PLACEHOLDER_ID : `0192f1d2-0000-7000-8000-00000000e0${i}0`;
    await env.db.owner.query(
      `INSERT INTO homemakers (id, zone_id, name, status, verification_status, source, updated_at)
       VALUES ($1, $2, 'Matrix home kitchen', 'ACTIVE', 'VERIFIED', 'ADMIN', now())`,
      [id, zones[z]],
    );
  }
  // M10 delivery partners (D130–D133): one per zone A, B, C (C is nobody's), the zone A one with the placeholder id
  for (const [i, z] of (['A', 'B', 'C'] as const).entries()) {
    const id = i === 0 ? PLACEHOLDER_ID : `0192f1d2-0000-7000-8000-00000000d0${i}0`;
    await env.db.owner.query(
      `INSERT INTO delivery_partners (id, zone_id, name, phone, status, verification_status, source, updated_at)
       VALUES ($1, $2, 'Matrix rider', $3, 'VERIFIED', 'VERIFIED', 'ADMIN', now())`,
      [id, zones[z], `+91970000000${i}`],
    );
  }
  // M17 notifications (D134–D137): one MESSAGE per zone A, B, C (C is nobody's), the zone A one with the placeholder id
  for (const [i, z] of (['A', 'B', 'C'] as const).entries()) {
    const id = i === 0 ? PLACEHOLDER_ID : `0192f1d2-0000-7000-8000-00000000c0${i}0`;
    await env.db.owner.query(
      `INSERT INTO notifications (id, kind, audience, zone_ids, title, body, channels, status, updated_at)
       VALUES ($1, 'MESSAGE', 'CUSTOMERS', ARRAY[$2]::uuid[], 'Matrix notice', 'Body', '{IN_APP}', 'SCHEDULED', now())`,
      [id, zones[z]],
    );
  }
  await env.db.owner.query(
    `UPDATE admin_zone_assignments SET can_reveal = true WHERE zone_id = $1`,
    [zones.A],
  );

  // SA-2.4 menu: per zone A, B, C a zone category, an item of that zone's restaurant (made above) and a pending change
  // request, so the menu lists show which zones an actor reached; the zone A ones carry the placeholder id
  for (const [i, z] of (['A', 'B', 'C'] as const).entries()) {
    const id = i === 0 ? PLACEHOLDER_ID : `0192f1d2-0000-7000-8000-00000000d0${i}0`;
    const restaurantId = i === 0 ? PLACEHOLDER_ID : `0192f1d2-0000-7000-8000-00000000f0${i}0`;
    await env.db.owner.query(
      `INSERT INTO categories (id, zone_id, name, updated_at) VALUES ($1, $2, 'Matrix starters', now())`,
      [id, zones[z]],
    );
    await env.db.owner.query(
      `INSERT INTO menu_items (id, zone_id, restaurant_id, category_id, name, price, stock, updated_at)
       VALUES ($1, $2, $3, $1, 'Matrix idli', 4000, 5, now())`,
      [id, zones[z], restaurantId],
    );
    await env.db.owner.query(
      `INSERT INTO menu_item_change_requests (id, zone_id, menu_item_id, restaurant_id, kind, proposed_json, source, updated_at)
       VALUES ($1, $2, $1, $3, 'UPDATE', '{"price": 4500}', 'APP', now())`,
      [id, zones[z], restaurantId],
    );
  }

  // D118 hotels: per zone A, B, C a hotel, a room booking and a dining reservation (zone A ones: placeholder id). Zone
  // members need the hotels, bookings and dining permissions to reach them; FULL does not grant them, so Zonal Admins
  // see none (the scope rules per actor: tests/hotels/hotels-api.test.ts)
  for (const [i, z] of (['A', 'B', 'C'] as const).entries()) {
    const id = i === 0 ? PLACEHOLDER_ID : `0192f1d2-0000-7000-8000-00000000c0${i}0`;
    await env.db.owner.query(
      `INSERT INTO hotels (id, zone_id, name, owner_name, phone, address, total_rooms, updated_at)
       VALUES ($1, $2, 'Matrix inn', 'Owner', '+919800000100', '1 Road', 3, now())`,
      [id, zones[z]],
    );
    await env.db.owner.query(
      `INSERT INTO room_bookings (id, zone_id, hotel_id, customer_name, customer_phone, room_type, check_in, check_out,
         guests, amount, updated_at)
       VALUES ($1, $2, $1, 'Matrix guest', '+919800000101', 'Deluxe', '2027-01-01', '2027-01-02', 1, 0, now())`,
      [id, zones[z]],
    );
    await env.db.owner.query(
      `INSERT INTO dining_reservations (id, zone_id, hotel_id, customer_name, customer_phone, reserved_date,
         reserved_time, guests, updated_at)
       VALUES ($1, $2, $1, 'Matrix diner', '+919800000102', '2027-01-01', '19:30', 2, now())`,
      [id, zones[z]],
    );
  }

  // D139 support desk: one ticket per zone A, B, C (C is nobody's) for the orders block's customers, so GET
  // /support/tickets shows which zones an actor reached; the zone A one has the placeholder id
  for (const [i, z] of (['A', 'B', 'C'] as const).entries()) {
    const id = i === 0 ? PLACEHOLDER_ID : `0192f1d2-0000-7000-8000-00000000b0${i}0`;
    const customer = i === 0 ? PLACEHOLDER_ID : `0192f1d2-0000-7000-8000-00000000f0${i}0`;
    await env.db.owner.query(
      `INSERT INTO support_tickets (id, ticket_no, zone_id, customer_id, category, subject, first_response_due_at,
         resolution_due_at, escalation_due_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ORDER', 'Matrix ticket', now() + interval '2 hours', now() + interval '1 day',
         now() + interval '12 hours', now())`,
      [id, `TCK-MATRIX${i}`, zones[z], customer],
    );
  }

  // D159 payments and D180/D187 refunds: per zone A, B, C a PAID payment of that zone's order and a refund the customer
  // reported (REQUESTED), so GET /payments and /refunds show which zones an actor reached. Neither has the placeholder
  // id, so the object routes answer 404 to whoever passes the guard (scope per actor: tests/refunds/)
  for (const [i, z] of (['A', 'B', 'C'] as const).entries()) {
    const id = `0192f1d2-0000-7000-8000-00000000a0${i}0`;
    const orderId = i === 0 ? PLACEHOLDER_ID : `0192f1d2-0000-7000-8000-00000000f0${i}0`;
    await env.db.owner.query(
      `INSERT INTO payments (id, order_id, provider, amount, status, idempotency_key, updated_at)
       VALUES ($1::uuid, $2, 'razorpay', 100, 'PAID', $1::text, now())`,
      [id, orderId],
    );
    await env.db.owner.query(
      `INSERT INTO refunds (id, order_id, payment_id, zone_id, amount, type, reason_code, status, target, source,
         idempotency_key, updated_at)
       VALUES ($1::uuid, $2, $1::uuid, $3, 50, 'PARTIAL', 'MISSING_ITEM', 'REQUESTED', 'WALLET', 'APP', $1::text, now())`,
      [id, orderId, zones[z]],
    );
  }

  // D173 COD settlement and D152 payouts: per zone A, B, C a settlement of that zone's partner (made above) and a payout
  // of that zone's restaurant, so the lists show which zones an actor reached
  for (const [i, z] of (['A', 'B', 'C'] as const).entries()) {
    const id = `0192f1d2-0000-7000-8000-00000000a1${i}0`;
    const own = i === 0 ? PLACEHOLDER_ID : null;
    await env.db.owner.query(
      `INSERT INTO cash_settlements (id, delivery_partner_id, zone_id, expected_amount, handed_in_amount, variance,
         settled_by, settled_at)
       VALUES ($1, $2, $3, 1000, 900, -100, $4, now())`,
      [id, own ?? `0192f1d2-0000-7000-8000-00000000d0${i}0`, zones[z], PLACEHOLDER_ID],
    );
    await env.db.owner.query(
      `INSERT INTO payouts (id, payee_type, payee_id, zone_id, period_from, period_to, gross, commission, net, status,
         updated_at)
       VALUES ($1, 'RESTAURANT', $2, $3, '2026-10-12', '2026-10-18', 1000, 100, 900, 'PENDING', now())`,
      [id, own ?? `0192f1d2-0000-7000-8000-00000000f0${i}0`, zones[z]],
    );
  }

  // D170 onboarding queue: the fixture vendors above are VERIFIED (DECIDED), so one PENDING restaurant per zone A, B, C
  // keeps the open queue showing which zones an actor reached
  for (const [i, z] of (['A', 'B', 'C'] as const).entries()) {
    await env.db.owner.query(
      `INSERT INTO restaurants (id, zone_id, name, status, verification_status, source, updated_at)
       VALUES ($1, $2, 'Matrix sign-up', 'PENDING', 'PENDING', 'APP', now())`,
      [`0192f1d2-0000-7000-8000-00000000b0${i}0`, zones[z]],
    );
  }

  // D182 offers: one ZONE offer per zone A, B, C (the zone A one has the placeholder id), so GET /offers shows which
  // zones an actor reached. FULL does not grant offers, so Zonal Admins see none (scope per actor: tests/offers/)
  for (const [i, z] of (['A', 'B', 'C'] as const).entries()) {
    const id = i === 0 ? PLACEHOLDER_ID : `0192f1d2-0000-7000-8000-00000000e1${i}0`;
    await env.db.owner.query(
      `INSERT INTO offers (id, scope, zone_ids, title, type, value, funded_by, valid_from, valid_to, source, updated_at)
       VALUES ($1, 'ZONE', ARRAY[$2]::uuid[], 'Matrix offer', 'PERCENT', 10, 'PLATFORM', now(),
         now() + interval '7 days', 'ADMIN', now())`,
      [id, zones[z]],
    );
  }

  const byId = new Map(Object.entries(zones).map(([label, id]) => [id, label as ZoneLabel]));
  return {
    zones,
    labelOf: (id) => byId.get(id) ?? 'C',
    actors,
    byName: (name) => {
      const a = actors.find((x) => x.name === name);
      if (!a) throw new Error(`no actor ${name}`);
      return a;
    },
  };
}
