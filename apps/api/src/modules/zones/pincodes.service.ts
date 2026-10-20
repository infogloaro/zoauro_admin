import { expandRange, type PincodeSource, type ZonePincodesInput } from '@zoauro/shared';
import type { AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { ZonesRepository } from './zones.repository';

// Pincode coverage (doc 53 sections 2.2 item 4 and 3). Planning is pure; the overlap check runs inside the write
// transaction after ZonesRepository.lockPincodes (pg_advisory_xact_lock), so two Super Admins cannot both pass it.

export interface PincodeRow {
  pincode: string;
  source: PincodeSource;
}

function rangeOrThrow(from: string, to: string): string[] {
  const r = expandRange(from, to);
  if (r.ok) return r.pincodes;
  // the shared schemas refuse these first; kept so a direct call cannot write a bad range
  if (r.error === 'RANGE_TOO_LARGE')
    throw new AppError('RANGE_TOO_LARGE', 'A range may hold at most 2000 pincodes', [
      { field: 'pincodeTo', issue: 'RANGE_TOO_LARGE' },
    ]);
  throw new AppError('VALIDATION_ERROR', 'Invalid input', [{ field: 'pincodeTo', issue: r.error }]);
}

/** POST /zones: the range (source RANGE) plus the pasted list (MANUAL); a pincode in both stays RANGE. */
export function initialPincodes(input: {
  pincodeFrom?: string | undefined;
  pincodeTo?: string | undefined;
  pincodes?: string[] | undefined;
}): PincodeRow[] {
  const out = new Map<string, PincodeSource>();
  if (input.pincodeFrom && input.pincodeTo)
    for (const p of rangeOrThrow(input.pincodeFrom, input.pincodeTo)) out.set(p, 'RANGE');
  for (const p of input.pincodes ?? []) if (!out.has(p)) out.set(p, 'MANUAL');
  return [...out].map(([pincode, source]) => ({ pincode, source })).sort(byPincode);
}

const byPincode = (a: PincodeRow, b: PincodeRow) => a.pincode.localeCompare(b.pincode);

export interface PincodePlan {
  add: PincodeRow[];
  remove: string[];
}

/**
 * PUT /zones/{id}/pincodes. A new range recomputes only the zone's RANGE rows (MANUAL and IMPORT rows are never touched
 * by a range edit); `add` adds MANUAL rows; `remove` removes rows of any source and wins over the range. Pincodes the
 * zone already has, or does not have, are no-ops.
 */
export function planPincodeChange(
  current: readonly PincodeRow[],
  input: ZonePincodesInput,
): PincodePlan {
  const add = new Set(input.add ?? []);
  const remove = new Set(input.remove ?? []);
  const both = [...add].filter((p) => remove.has(p));
  if (both.length > 0)
    throw new AppError(
      'VALIDATION_ERROR',
      'A pincode cannot be added and removed in one change',
      both.slice(0, 20).map((p) => ({ field: `remove.${p}`, issue: 'also_in_add' })),
    );

  const have = new Map(current.map((r) => [r.pincode, r.source]));
  const toAdd = new Map<string, PincodeSource>();
  const toRemove = new Set<string>();

  if (input.range) {
    const inRange = new Set(rangeOrThrow(input.range.from, input.range.to));
    for (const r of current)
      if (r.source === 'RANGE' && !inRange.has(r.pincode) && !add.has(r.pincode))
        toRemove.add(r.pincode);
    for (const p of inRange) if (!have.has(p) && !remove.has(p)) toAdd.set(p, 'RANGE');
  }
  for (const p of add) if (!have.has(p) && !toAdd.has(p)) toAdd.set(p, 'MANUAL');
  for (const p of remove) if (have.has(p)) toRemove.add(p);

  return {
    add: [...toAdd].map(([pincode, source]) => ({ pincode, source })).sort(byPincode),
    remove: [...toRemove].sort(),
  };
}

/** Throws 409 PINCODE_OVERLAP naming the owning zones; call only after lockPincodes in the same transaction. */
export async function assertNoOverlap(
  repo: ZonesRepository,
  ctx: AuthContext,
  pincodes: readonly string[],
  exceptZoneId?: string,
): Promise<void> {
  const conflicts = await repo.findOwners(ctx, pincodes, exceptZoneId);
  if (conflicts.length === 0) return;
  const names = [...new Set(conflicts.map((c) => c.zoneName))].join(', ');
  throw new AppError(
    'PINCODE_OVERLAP',
    `${conflicts.length} pincode(s) already belong to another zone (${names})`,
    conflicts
      .slice(0, 200)
      .map((c) => ({ field: `pincodes.${c.pincode}`, issue: 'PINCODE_OVERLAP' })),
    undefined,
    { conflicts },
  );
}
