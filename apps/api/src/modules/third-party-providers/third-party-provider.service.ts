import type {
  ListThirdPartyProvidersQuery,
  ListThirdPartyProvidersResponse,
  ThirdPartyProvider as ThirdPartyProviderDto,
  ThirdPartyProviderCreateInput,
  ThirdPartyProviderStatusInput,
  ThirdPartyProviderUpdateInput,
} from '@zoauro/shared';
import { requestedProviderZoneIds } from '@zoauro/shared';
import { prisma } from '../../lib/db';
import type { AuthContext } from '../../lib/auth-context';
import { errors } from '../../lib/errors';
import { maskEmail, maskPhone } from '../../lib/contact-mask';
import { recordAudit } from '../audit/audit.service';
import * as repo from './third-party-provider.repository';

/**
 * Third-Party Partners service (task: Third-Party Partners page).
 *
 * Providers are external delivery companies — separate from own delivery
 * partners (M10). Coverage is many-to-many with zones; every list, count and
 * facet runs through the same effective zone scope (doc 36). Contact phone
 * and email are masked (D26); there is no reveal endpoint, so the full values
 * never leave the API (the same gap M10 logged — see the handoff).
 *
 * `integrationStatus` is a configuration flag only. Nothing here opens a
 * network connection to a provider, so a CONFIGURED row must never be read as
 * a live integration (task constraint).
 */

/** Actor of the write (doc 07 §6: every write carries its audit row). */
export interface ActorContext {
  auth: AuthContext;
  requestId: string | null;
}

function serializeProvider(row: repo.ProviderRowWithZones): ThirdPartyProviderDto {
  return {
    id: row.id,
    name: row.name,
    providerType: row.providerType,
    contactPerson: row.contactPerson,
    contactEmail: maskEmail(row.contactEmail),
    contactPhone: maskPhone(row.contactPhone),
    status: row.status,
    integrationStatus: row.integrationStatus,
    zones: row.zones.map((link) => link.zone),
    deliveriesCount: row.deliveriesCount,
    successfulDeliveries: row.successfulDeliveries,
    failedDeliveries: row.failedDeliveries,
    avgDeliveryMinutes: row.avgDeliveryMinutes,
    providerCostPaise: row.providerCostPaise,
    settlementStatus: row.settlementStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Scope (doc 36)
 * ------------------------------------------------------------------ */

/**
 * Effective zone scope for a list request. Super Admin: any zone or none
 * (= all). Unknown `?zoneId` → 404 `ZONE_NOT_FOUND` (doc 09). Zonal Admin
 * never reaches here (third-party-provider.scope.ts 403s first) until SA-1.7
 * resolves assignments, then requested ∩ assigned per doc 36 §1.
 */
async function resolveZoneScope(requested: string[] | undefined): Promise<string[] | null> {
  if (requested === undefined || requested.length === 0) return null;
  const existing = await repo.existingZoneIds(requested);
  if (existing.length !== requested.length) throw errors.zoneNotFound();
  return requested;
}

/**
 * Validate a coverage write: every id must exist (unknown → 404) and
 * duplicates collapse so the unique (providerId, zoneId) row holds.
 *
 * Unlike an own-partner assignment (doc 36 §3 blocks a deactivated zone from
 * taking a NEW partner), provider coverage is a descriptive list of where a
 * company operates — not a live duty roster. A deactivated zone is therefore
 * allowed here so existing coverage keeps rendering honestly; the deactivated
 * state is surfaced on the zone chip, not hidden by a write error.
 */
async function requireWritableZoneIds(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  const found = await repo.findZonesForWrite(unique);
  if (found.length !== unique.length) throw errors.zoneNotFound();
  return unique;
}

/** One provider inside the zone scope — outside it the record is 404, not 403 (doc 36 §1). */
async function requireProvider(
  id: string,
  zoneIds: string[] | null,
): Promise<repo.ProviderRowWithZones> {
  const row = await repo.findProvider(id, zoneIds);
  if (!row) throw errors.notFound('Third-party provider not found');
  return row;
}

/** Company-name duplicate guard (one provider per name). */
async function assertNoDuplicateName(name: string, excludeId?: string): Promise<void> {
  const existing = await repo.findProviderByName(name, excludeId);
  if (existing) {
    throw errors.conflict(`A provider named "${existing.name}" already exists.`);
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

export async function listThirdPartyProviders(
  query: ListThirdPartyProvidersQuery,
): Promise<ListThirdPartyProvidersResponse> {
  const zoneIds = await resolveZoneScope(requestedProviderZoneIds(query));

  const [page, counts, facets] = await Promise.all([
    repo.listProviders({ zoneIds, query }),
    repo.providerKpis(zoneIds),
    repo.providerFacets(zoneIds),
  ]);
  const zones = await repo.findZones(facets.zoneIds);

  return {
    data: page.rows.map(serializeProvider),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
      counts,
      facets: { zones, providerTypes: facets.providerTypes },
    },
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
    module: 'third-party-providers',
    action: opts.action,
    entityType: 'third-party-provider',
    entityId: id,
    before: opts.before,
    after: opts.after,
    ip: ctx.auth.ip,
    requestId: ctx.requestId,
  };
}

/** POST /third-party-providers (`providers:add`). */
export async function createThirdPartyProvider(
  ctx: ActorContext,
  input: ThirdPartyProviderCreateInput,
): Promise<ThirdPartyProviderDto> {
  const zoneIds = await requireWritableZoneIds(input.zoneIds);
  await assertNoDuplicateName(input.name);

  return prisma.$transaction(async (tx) => {
    const provider = await repo.createProvider(tx, {
      name: input.name,
      providerType: input.providerType,
      contactPerson: input.contactPerson,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      zoneIds,
      status: input.status,
      integrationStatus: input.integrationStatus,
    });
    const zones = await repo.findZones(zoneIds);
    const dto = serializeProvider({ ...provider, zones: zones.map((zone) => ({ zone })) });
    await recordAudit(
      tx,
      auditEntry(ctx, provider.id, null, {
        action: 'third-party-providers.create',
        after: dto,
      }),
    );
    return dto;
  });
}

/** PATCH /third-party-providers/{id} (`providers:edit`) — profile, coverage, integration flag. */
export async function updateThirdPartyProvider(
  ctx: ActorContext,
  id: string,
  input: ThirdPartyProviderUpdateInput,
): Promise<ThirdPartyProviderDto> {
  const before = await requireProvider(id, null);
  const beforeDto = serializeProvider(before);

  let zoneIds: string[] | undefined;
  if (input.zoneIds !== undefined) {
    zoneIds = await requireWritableZoneIds(input.zoneIds);
  }
  if (input.name !== undefined) {
    await assertNoDuplicateName(input.name, id);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await repo.updateProvider(tx, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.providerType !== undefined ? { providerType: input.providerType } : {}),
      ...(input.contactPerson !== undefined ? { contactPerson: input.contactPerson } : {}),
      ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
      ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
      ...(input.integrationStatus !== undefined
        ? { integrationStatus: input.integrationStatus }
        : {}),
    });
    if (zoneIds !== undefined) {
      await repo.replaceProviderZones(tx, id, zoneIds);
    }
    // Serialize the write's own result, not a re-read: the transaction client and
    // `prisma` share a connection, so re-reading inside the transaction races the
    // uncommitted write and returns pre-update state (M10 serializes `update` for
    // the same reason). Zones come from the requested set when coverage changed,
    // otherwise from the pre-write row.
    const zones =
      zoneIds !== undefined
        ? (await repo.findZones(zoneIds)).map((zone) => ({ zone }))
        : before.zones;
    const after = serializeProvider({ ...updated, zones });
    await recordAudit(
      tx,
      auditEntry(ctx, id, null, {
        action: 'third-party-providers.update',
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}

/**
 * POST /third-party-providers/{id}/status (`providers:status`) — the
 * enable/disable lever (ACTIVE ⇄ INACTIVE) plus SUSPENDED, mirroring the
 * vendor status style (doc 10 §4 targets).
 */
export async function setThirdPartyProviderStatus(
  ctx: ActorContext,
  id: string,
  input: ThirdPartyProviderStatusInput,
): Promise<ThirdPartyProviderDto> {
  const before = await requireProvider(id, null);
  const beforeDto = serializeProvider(before);

  return prisma.$transaction(async (tx) => {
    const updated = await repo.updateProvider(tx, id, { status: input.status });
    // Serialize the write's own result: the transaction client and `prisma`
    // share a connection, so an in-transaction re-read would race the uncommitted
    // write and fall back to pre-update state (M10 serializes `update` for the
    // same reason). Coverage is unchanged, so `before.zones` still holds.
    const after = serializeProvider({ ...updated, zones: before.zones });
    await recordAudit(
      tx,
      auditEntry(ctx, id, null, {
        action: 'third-party-providers.status',
        before: beforeDto,
        after,
      }),
    );
    return after;
  });
}
