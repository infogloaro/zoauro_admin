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
