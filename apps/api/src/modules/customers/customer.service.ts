import type {
  CustomerCreateInput,
  CustomerDetail,
  CustomerReveal,
  CustomerUpdateInput,
  CustomerRewardEntry,
  CustomerWalletEntry,
  ListRewardsQuery,
  ListRewardsResponse,
  ListWalletQuery,
  ListWalletResponse,
  RewardAdjustInput,
  RewardConvertInput,
  Customer as CustomerDto,
  ListCustomersQuery,
  ListCustomersResponse,
} from '@zoauro/shared';
import { requestedCustomerZoneIds } from '@zoauro/shared';
import { prisma } from '../../lib/db';
import type { AuthContext } from '../../lib/auth-context';
import { errors } from '../../lib/errors';
import { maskEmail, maskPhone } from '../../lib/contact-mask';
import { recordAudit } from '../audit/audit.service';
import * as repo from './customer.repository';

/**
 * M09 Customers service (doc 09 `/customers`, doc 20/22 profile and forms,
 * D25 scope visibility, D26 masked contact + audited reveal, D28 source=ADMIN).
 */

/** Actor of the write (doc 07 §6: every write carries its audit row). */
export interface ActorContext {
  auth: AuthContext;
  requestId: string | null;
}

type ZoneRef = { id: string; name: string; city: string };

/**
 * Doc 08 has no spend/order column on `customers` — the aggregates come from
 * the orders module (M11), whose table is not in the schema yet. Every
 * customer genuinely has 0 orders and 0 spend today; this is the honest value
 * until M11 lands a scope-filtered aggregate (D25). Never a mock: it is what
 * the database says.
 */
export const ORDER_AGGREGATES = { orderCount: 0, totalSpentPaise: 0 } as const;

/**
 * Serialization always masks contact (D26 / doc 15 §privacy): list, detail,
 * create and update responses all go through here, so an unmasked phone or
 * email can only leave the API through `revealCustomer`, which authorizes and
 * audits first. Audit payloads reuse this serializer for the same reason.
 */
interface CustomerRecord {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: CustomerDto['status'];
  source: CustomerDto['source'];
  userType: CustomerDto['userType'];
  walletBalance: number;
  createdAt: Date;
  updatedAt: Date;
}

function serializeCustomer(row: CustomerRecord, zones: ZoneRef[]): CustomerDto {
  return {
    id: row.id,
    name: row.name,
    phone: maskPhone(row.phone),
    email: row.email === null ? null : maskEmail(row.email),
    status: row.status,
    source: row.source,
    userType: row.userType,
    walletBalance: row.walletBalance,
    ...ORDER_AGGREGATES,
    zones,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Scope (doc 09 §zone scope, D25, doc 36)
 * ------------------------------------------------------------------ */

/**
 * Effective zone scope for a list request. Super Admin: any zone or none
 * (= all). A requested zone that does not exist answers 404 `ZONE_NOT_FOUND`
 * (doc 09). Zonal Admin requests never reach here (customer.scope.ts 403s
 * first) until SA-1.7 resolves assignments — then this becomes
 * requested ∩ assigned per doc 36 §1.
 */
async function resolveZoneScope(requested: string[] | undefined): Promise<string[] | null> {
  if (requested === undefined || requested.length === 0) return null;
  const existing = await repo.existingZoneIds(requested);
  if (existing.length !== requested.length) throw errors.zoneNotFound();
  return requested;
}

/**
 * Zone target for a create write. Deactivated zones accept no new records
 * (doc 36 §3), so create answers 409 instead of silently associating one.
 */
async function requireWritableZoneRef(zoneId: string): Promise<ZoneRef> {
  const zone = await repo.findZoneForWrite(zoneId);
  if (!zone) throw errors.zoneNotFound();
  if (zone.status === 'INACTIVE') {
    throw errors.conflict('This zone is deactivated — customers cannot be added to it');
  }
  return { id: zone.id, name: zone.name, city: zone.city };
}

/**
 * One customer under D25: outside the member's zone visibility the record is
 * 404, not 403 (doc 09 / doc 36 §1). `zoneIds` is `null` (every zone) while
 * only Super Admins can call these routes; SA-1.7 passes the member's
 * effective zones instead.
 */
async function requireRow(id: string, zoneIds: string[] | null): Promise<repo.CustomerRow> {
  const row = await repo.findCustomer(id, zoneIds);
  if (!row) throw errors.notFound('Customer not found');
  return row;
}

/** Digits-compare duplicate guard (doc 08 "phone (unique)", doc 22 form row). */
async function assertNoDuplicatePhone(phone: string, excludeId: string | null): Promise<void> {
  const existing = await repo.findCustomerByPhone(phone, excludeId ?? undefined);
  if (existing) {
    throw errors.conflict(`A customer with this phone number already exists (${existing.name}).`);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

async function zoneRefsFor(
  rows: repo.CustomerRow[],
  zoneIds: string[] | null,
): Promise<Map<string, ZoneRef[]>> {
  const wanted = new Set<string>();
  for (const row of rows) {
    for (const address of row.addresses) {
      if (!zoneIds || zoneIds.includes(address.zoneId)) wanted.add(address.zoneId);
    }
  }
  const refs = await repo.findZones([...wanted]);
  const refById = new Map(refs.map((z) => [z.id, z]));
  const out = new Map<string, ZoneRef[]>();
  for (const row of rows) {
    const seen = new Set<string>();
    const zones: ZoneRef[] = [];
    for (const address of row.addresses) {
      if (zoneIds && !zoneIds.includes(address.zoneId)) continue;
      if (seen.has(address.zoneId)) continue;
      const ref = refById.get(address.zoneId);
      if (!ref) continue;
      seen.add(address.zoneId);
      zones.push(ref);
    }
    out.set(row.id, zones);
  }
  return out;
}

export async function listCustomers(query: ListCustomersQuery): Promise<ListCustomersResponse> {
  const zoneIds = await resolveZoneScope(requestedCustomerZoneIds(query));

  const [page, counts, facets] = await Promise.all([
    repo.listCustomers({ zoneIds, query }),
    repo.countCustomers(zoneIds),
    repo.customerFacets(zoneIds),
  ]);
  const zones = await repo.findZones(facets.zoneIds);
  const zonesByCustomer = await zoneRefsFor(page.rows, zoneIds);

  return {
    data: page.rows.map((row) => serializeCustomer(row, zonesByCustomer.get(row.id) ?? [])),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
      counts,
      facets: { areas: facets.areas, sources: facets.sources, zones },
    },
  };
}

/** Detail view (doc 20/22): the masked profile plus its addresses (D25). */
export async function getCustomerDetail(
  id: string,
  zoneIds: string[] | null = null,
): Promise<CustomerDetail> {
  const row = await requireRow(id, zoneIds);
  const [addresses] = await Promise.all([repo.listAddresses(id, zoneIds)]);
  const zonesByCustomer = await zoneRefsFor([row], zoneIds);

  return {
    ...serializeCustomer(row, zonesByCustomer.get(row.id) ?? []),
    addresses: addresses.map((address) => ({
      id: address.id,
      label: address.label,
      address: address.address,
      area: address.area,
      lat: address.lat,
      lng: address.lng,
      pincode: address.pincode,
      zoneId: address.zoneId,
      zone: address.zone,
      isDefault: address.isDefault,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Writes (transaction + audit row, doc 07 §6)
 * ------------------------------------------------------------------ */

function auditEntry(
  ctx: ActorContext,
  id: string,
  zoneId: string | null,
  opts: { action: string; before?: unknown; after: unknown },
) {
  return {
    actorId: ctx.auth.userId,
    zoneId,
    module: 'customers',
    action: opts.action,
    entityType: 'customer',
    entityId: id,
    before: opts.before,
    after: opts.after,
    ip: ctx.auth.ip,
    requestId: ctx.requestId,
  };
}

/** Audit zone = the customer's first in-scope address zone (nullable column). */
function auditZoneId(row: repo.CustomerRow, zoneIds: string[] | null): string | null {
  const address = row.addresses.find((a) => !zoneIds || zoneIds.includes(a.zoneId));
  return address?.zoneId ?? null;
}

/** POST /customers (doc 09, `customers:add`) — source is forced to ADMIN (D28). */
export async function createCustomer(
  ctx: ActorContext,
  input: CustomerCreateInput,
): Promise<CustomerDto> {
  const zone = await requireWritableZoneRef(input.zoneId);
  await assertNoDuplicatePhone(input.phone, null);

  try {
    return await prisma.$transaction(async (tx) => {
      const customer = await repo.createCustomer(tx, {
        name: input.name,
        phone: input.phone,
        email: input.email,
        status: input.status,
        source: 'ADMIN',
        address: { zoneId: input.zoneId, address: input.address, area: input.area },
      });
      const dto = serializeCustomer(customer, [zone]);
      await recordAudit(
        tx,
        auditEntry(ctx, customer.id, zone.id, { action: 'customers.create', after: dto }),
      );
      return dto;
    });
  } catch (error) {
    // Concurrent duplicate: the unique index on `customers.phone` fires first.
    if (isUniqueViolation(error)) {
      throw errors.conflict('A customer with this phone number already exists.');
    }
    throw error;
  }
}

/** PATCH /customers/{id} (doc 09, `customers:edit`) — profile fields only (D26). */
export async function updateCustomer(
  ctx: ActorContext,
  id: string,
  input: CustomerUpdateInput,
): Promise<CustomerDto> {
  const before = await requireRow(id, null);
  const zones = (await zoneRefsFor([before], null)).get(id) ?? [];
  const beforeDto = serializeCustomer(before, zones);

  return prisma.$transaction(async (tx) => {
    const customer = await repo.updateCustomer(tx, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    const after = serializeCustomer(customer, zones);
    await recordAudit(
      tx,
      auditEntry(ctx, id, auditZoneId(before, null), {
        action: 'customers.update',
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

/**
 * POST /customers/{id}/block|unblock (doc 09, `customers:status`) — no body;
 * the server flips the status and writes the audit row (doc 44: the blocked
 * flag is admin-owned).
 */
export async function setCustomerBlocked(
  ctx: ActorContext,
  id: string,
  blocked: boolean,
): Promise<CustomerDto> {
  const before = await requireRow(id, null);
  if (blocked && before.status === 'BLOCKED') {
    throw errors.conflict('Customer is already blocked');
  }
  if (!blocked && before.status !== 'BLOCKED') {
    throw errors.conflict('Customer is not blocked');
  }

  const zones = (await zoneRefsFor([before], null)).get(id) ?? [];
  const status = blocked ? ('BLOCKED' as const) : ('ACTIVE' as const);
  return prisma.$transaction(async (tx) => {
    const customer = await repo.updateCustomer(tx, id, { status });
    const dto = serializeCustomer(customer, zones);
    await recordAudit(
      tx,
      auditEntry(ctx, id, auditZoneId(before, null), {
        action: blocked ? 'customers.block' : 'customers.unblock',
        before: { status: before.status },
        after: { status: customer.status },
      }),
    );
    return dto;
  });
}

/**
 * GET /customers/{id}/reveal (doc 09, D26) — the only unmask path. The route
 * is gated by `customers:reveal` first (customer.scope.ts); this writes the
 * audit row (actor, target customer, timestamp, action) before returning the
 * real contact. The payload itself stays out of the audit log (D26: no PII
 * spread beyond the authorized response).
 */
export async function revealCustomer(
  ctx: ActorContext,
  id: string,
  zoneIds: string[] | null = null,
): Promise<CustomerReveal> {
  const row = await requireRow(id, zoneIds);
  await recordAudit(prisma, {
    ...auditEntry(ctx, id, auditZoneId(row, zoneIds), {
      action: 'customers.reveal',
      after: { revealed: ['phone', 'email'] },
    }),
  });
  return { phone: row.phone, email: row.email };
}

/* ------------------------------------------------------------------ *
 * Rewards (D169, doc 09 `/customers/{id}/rewards`)
 * ------------------------------------------------------------------ */

function serializeRewardEntry(row: repo.RewardEntryRow): CustomerRewardEntry {
  return {
    id: row.id,
    type: row.type,
    points: row.points,
    orderId: row.orderId,
    reason: row.reason,
    actorId: row.actorId,
    zoneId: row.zoneId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * GET /customers/{id}/rewards — the customer's current balance plus its
 * append-only ledger (newest first, paginated, optional type filter).
 * Contact never rides along (D26 masking covers the list; this payload is
 * ledger-shaped and carries no phone/email at all).
 */
export async function getCustomerRewards(
  id: string,
  query: ListRewardsQuery,
  zoneIds: string[] | null = null, // zonal scoping activates at SA-1.7
): Promise<ListRewardsResponse> {
  const row = await requireRow(id, zoneIds);
  const page = await repo.listRewardEntries(id, query);
  return {
    data: {
      rewardPoints: row.rewardPoints,
      entries: page.rows.map(serializeRewardEntry),
    },
    meta: { total: page.total, page: query.page, pageSize: query.pageSize },
  };
}

/**
 * POST /customers/{id}/rewards/adjust (`customers:edit`) — one transaction:
 * guarded balance flip + append-only ledger row + audit (before/after
 * rewardPoints). A deduct that would go below 0 answers 409 and changes
 * nothing; the `rewardPoints >= points` guard also closes the concurrent
 * over-deduct race (doc 07 §6).
 */
export async function adjustRewards(
  ctx: ActorContext,
  id: string,
  input: RewardAdjustInput,
  zoneIds: string[] | null = null, // zonal scoping activates at SA-1.7
): Promise<{ rewardPoints: number; entry: CustomerRewardEntry }> {
  const before = await requireRow(id, zoneIds);
  const grant = input.action === 'grant';
  const signedPoints = grant ? input.points : -input.points;
  const zoneId = auditZoneId(before, zoneIds);

  return prisma.$transaction(async (tx) => {
    if (grant) {
      await repo.grantRewardPoints(tx, id, input.points);
    } else if (!(await repo.deductRewardPoints(tx, id, input.points))) {
      throw errors.conflict(
        `Deducting ${input.points} points would take the balance below zero (current balance: ${before.rewardPoints})`,
      );
    }
    const balanceAfter = await tx.customer
      .findUniqueOrThrow({ where: { id }, select: { rewardPoints: true } })
      .then((c) => c.rewardPoints);
    const entry = await repo.createRewardEntry(tx, id, {
      type: grant ? 'MANUAL_GRANT' : 'MANUAL_DEDUCT',
      points: signedPoints,
      balanceAfter,
      // Credits carry their unspent magnitude (doc 08); spend-down of the
      // remaining pool belongs to the orders checkout flow (M11+).
      remaining: grant ? input.points : null,
      reason: input.reason,
      actorId: ctx.auth.userId,
      zoneId,
    });
    await recordAudit(
      tx,
      auditEntry(ctx, id, zoneId, {
        action: 'customers.reward.adjust',
        before: { rewardPoints: before.rewardPoints },
        after: { rewardPoints: balanceAfter, action: input.action, points: input.points },
      }),
    );
    return { rewardPoints: balanceAfter, entry: serializeRewardEntry(entry) };
  });
}

/**
 * POST /customers/{id}/rewards/convert — gated off by D101: loyalty is off
 * until Super Admin configures settings, and the settings module is an empty
 * placeholder locally, so no settings row can exist. Every well-formed
 * attempt therefore answers 409 (insufficient balance first when applicable)
 * with an audit row for the attempt; nothing is written to any ledger.
 */
export async function convertRewards(
  ctx: ActorContext,
  id: string,
  input: RewardConvertInput,
  zoneIds: string[] | null = null, // zonal scoping activates at SA-1.7
): Promise<never> {
  const row = await requireRow(id, zoneIds);
  const zoneId = auditZoneId(row, zoneIds);
  const insufficient = input.points > row.rewardPoints;
  await recordAudit(prisma, {
    ...auditEntry(ctx, id, zoneId, {
      action: 'customers.reward.convert',
      after: {
        attemptedPoints: input.points,
        rewardPoints: row.rewardPoints,
        result: insufficient ? 'INSUFFICIENT_POINTS' : 'LOYALTY_NOT_CONFIGURED',
      },
    }),
  });
  if (insufficient) throw errors.conflict('Insufficient reward points');
  // D101: gate opens when settings module lands (doc 32 dependency)
  throw errors.conflict('Loyalty settings are not configured');
}

/* ------------------------------------------------------------------ *
 * Wallet (D24/D169, doc 09 `/customers/{id}/wallet`)
 * ------------------------------------------------------------------ */

function serializeWalletEntry(row: repo.WalletEntryRow): CustomerWalletEntry {
  return {
    id: row.id,
    type: row.type,
    amountPaise: row.amountPaise,
    balanceAfterPaise: row.balanceAfterPaise,
    refType: row.refType,
    refId: row.refId,
    reason: row.reason,
    actorId: row.actorId,
    zoneId: row.zoneId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * GET /customers/{id}/wallet — newest-first ledger page plus the computed
 * balance (sum of the signed `amount_paise` entries, per the doc 08 ledger
 * convention). No contact fields ride along (D26).
 */
export async function getCustomerWallet(
  id: string,
  query: ListWalletQuery,
  zoneIds: string[] | null = null, // zonal scoping activates at SA-1.7
): Promise<ListWalletResponse> {
  await requireRow(id, zoneIds);
  const [page, balancePaise] = await Promise.all([
    repo.listWalletEntries(id, query),
    repo.walletBalancePaise(id),
  ]);
  return {
    data: {
      balancePaise,
      entries: page.rows.map(serializeWalletEntry),
    },
    meta: { total: page.total, page: query.page, pageSize: query.pageSize },
  };
}
