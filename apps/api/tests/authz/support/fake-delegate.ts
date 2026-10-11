import type { ScopedDelegate } from '../../../src/lib/authz';
import { FIXTURE_ROWS, type ZoneRow } from './scope-harness';

// A tiny in-memory stand-in for a Prisma model delegate. It understands exactly the where-shapes the base repository
// produces: { id }, { zoneId: { in } } and { AND: [...] } (nested).

export interface FakeWhere {
  id?: string;
  zoneId?: { in: readonly string[] };
  AND?: FakeWhere[];
}

function matches(row: ZoneRow, where: FakeWhere): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.zoneId !== undefined && !where.zoneId.in.includes(row.zoneId)) return false;
  if (where.AND !== undefined && !where.AND.every((w) => matches(row, w))) return false;
  return true;
}

export function fakeDelegate(
  rows: ZoneRow[] = FIXTURE_ROWS,
): ScopedDelegate<FakeWhere, ZoneRow> & { calls: number } {
  const d = {
    calls: 0,
    async findMany({ where, skip = 0, take }: { where: FakeWhere; skip?: number; take?: number }) {
      d.calls += 1;
      const all = rows.filter((r) => matches(r, where)).slice(skip);
      return take === undefined ? all : all.slice(0, take);
    },
    async findFirst({ where }: { where: FakeWhere }) {
      d.calls += 1;
      return rows.find((r) => matches(r, where)) ?? null;
    },
    async count({ where }: { where: FakeWhere }) {
      d.calls += 1;
      return rows.filter((r) => matches(r, where)).length;
    },
  };
  return d;
}
