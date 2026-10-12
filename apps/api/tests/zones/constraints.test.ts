import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, uuidv7, type TestDatabase } from '../audit/support/db';

// P5 (doc 56) / doc 53 section 3: the database itself enforces the zone rules, whatever the code does. Runs as the
// application role zoauro_app against a throwaway database built with `prisma migrate deploy` (never zoauro).

let db: TestDatabase;
let app: TestDatabase['app'];

beforeAll(async () => {
  db = await createTestDatabase();
  ({ app } = db);
}, 120_000);
afterAll(async () => {
  await db.close();
});

let n = 0;
async function insertZone(over: Record<string, unknown> = {}): Promise<string> {
  n += 1;
  const row: Record<string, unknown> = {
    id: uuidv7(),
    name: `Zone ${n} ${uuidv7().slice(-6)}`,
    code: `Z${String(n).padStart(3, '0')}`,
    city: 'Coimbatore',
    color_hex: '#2563EB',
    updated_at: new Date(),
    ...over,
  };
  const cols = Object.keys(row);
  await app.query(
    `INSERT INTO zones (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
    Object.values(row),
  );
  return row['id'] as string;
}
const insertPincode = (zoneId: string, pincode: string) =>
  app.query(
    `INSERT INTO serviceable_pincodes (id, zone_id, pincode, source, updated_at) VALUES ($1, $2, $3, 'MANUAL', now())`,
    [uuidv7(), zoneId, pincode],
  );

/** Rejects with the given SQLSTATE: 23505 unique violation, 23514 check violation, 23502 not null. */
async function rejectsWith(p: Promise<unknown>, sqlState: string, constraint?: string) {
  const err = await p.then(
    () => null,
    (e: { code?: string; constraint?: string }) => e,
  );
  expect(err, 'expected the database to refuse').not.toBeNull();
  expect(err?.code).toBe(sqlState);
  if (constraint) expect(err?.constraint).toBe(constraint);
}

describe('zones: database constraints as zoauro_app (doc 53 section 3)', () => {
  it('a valid zone is accepted; status defaults to UPCOMING and version to 1', async () => {
    const id = await insertZone();
    const r = await app.query(`SELECT status, version FROM zones WHERE id = $1`, [id]);
    expect(r.rows[0]).toEqual({ status: 'UPCOMING', version: 1 });
  });

  it('a bad code is refused (CHECK)', async () => {
    for (const code of ['ab', 'A', '1AB', 'ABCDEFG', 'AB-1']) {
      await rejectsWith(insertZone({ code }), '23514', 'zones_code_format_chk');
    }
  });

  it('a delivery charge of 100001 paise (or below 0) is refused (CHECK)', async () => {
    await rejectsWith(
      insertZone({ delivery_charge: 100001 }),
      '23514',
      'zones_delivery_charge_chk',
    );
    await rejectsWith(insertZone({ delivery_charge: -1 }), '23514', 'zones_delivery_charge_chk');
    await insertZone({ delivery_charge: 100000 });
  });

  it('a duplicate pincode is refused, even in another zone (R-ZONE-2)', async () => {
    const a = await insertZone();
    const b = await insertZone();
    await insertPincode(a, '641001');
    await rejectsWith(insertPincode(b, '641001'), '23505', 'serviceable_pincodes_pincode_key');
    await rejectsWith(insertPincode(a, '641001'), '23505', 'serviceable_pincodes_pincode_key');
  });

  it('a malformed pincode is refused (CHECK)', async () => {
    const z = await insertZone();
    for (const p of ['041001', '64100A']) {
      await rejectsWith(insertPincode(z, p), '23514', 'serviceable_pincodes_pincode_format_chk');
    }
  });

  it('the code stays reserved after a soft delete (R-ZONE-3)', async () => {
    const id = await insertZone({ code: 'RSV1' });
    await app.query(`UPDATE zones SET deleted_at = now() WHERE id = $1`, [id]);
    await rejectsWith(insertZone({ code: 'RSV1' }), '23505', 'zones_code_key');
  });

  it('the name is unique case-insensitively among live zones, free again after a soft delete (R-ZONE-4)', async () => {
    const id = await insertZone({ name: 'Gandhipuram' });
    await rejectsWith(insertZone({ name: 'GANDHIPURAM' }), '23505', 'zones_name_lower_active_key');
    await app.query(`UPDATE zones SET deleted_at = now() WHERE id = $1`, [id]);
    await insertZone({ name: 'gandhipuram' });
  });

  it('the entered range is both ends or neither, in order', async () => {
    await insertZone({ pincode_from: '641001', pincode_to: '641050' });
    await rejectsWith(insertZone({ pincode_from: '641001' }), '23514', 'zones_pincode_range_chk');
    await rejectsWith(insertZone({ pincode_to: '641001' }), '23514', 'zones_pincode_range_chk');
    await rejectsWith(
      insertZone({ pincode_from: '641050', pincode_to: '641001' }),
      '23514',
      'zones_pincode_range_chk',
    );
  });

  it('a colour is required', async () => {
    await rejectsWith(insertZone({ color_hex: null }), '23502');
  });
});
