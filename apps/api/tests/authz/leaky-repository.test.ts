import { describe, expect, it } from 'vitest';
import { BaseRepository } from '../../src/lib/authz';
import type { AuthContext } from '../../src/lib/authz';
import { fakeDelegate, type FakeWhere } from './support/fake-delegate';
import {
  FIXTURE_ROWS,
  runScopeHarness,
  type RepositoryUnderTest,
  type ZoneRow,
} from './support/scope-harness';

// Gate F1 exit: "harness runs in CI and fails on a deliberately leaky test repository" (doc 33).
// The leaky repository below ignores the AuthContext on purpose. The harness MUST report violations for it; if this
// test ever goes red, the harness has stopped noticing leaks and no authorization test can be trusted.

const VIEW = 'orders:view' as const;

/** Deliberately broken: never looks at ctx, so every actor sees every zone. */
class LeakyRepository implements RepositoryUnderTest {
  private readonly rows = FIXTURE_ROWS;
  async list(): Promise<ZoneRow[]> {
    return [...this.rows];
  }
  async findById(_ignoredCtx: unknown, id: string): Promise<ZoneRow | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async count(): Promise<number> {
    return this.rows.length;
  }
}

/** The correct shape: everything goes through BaseRepository, which applies zonesFor(ctx, view). */
class OrdersRepository extends BaseRepository<FakeWhere, ZoneRow> implements RepositoryUnderTest {
  constructor() {
    super(fakeDelegate(), VIEW);
  }
  protected zoneFilter(zoneIds: readonly string[]): FakeWhere {
    return { zoneId: { in: zoneIds } };
  }
  protected idFilter(id: string): FakeWhere {
    return { id };
  }
  list(ctx: AuthContext): Promise<ZoneRow[]> {
    return this.findScoped(ctx);
  }
  findById(ctx: AuthContext, id: string): Promise<ZoneRow | null> {
    return this.findOneScoped(ctx, id);
  }
  count(ctx: AuthContext): Promise<number> {
    return this.countScoped(ctx);
  }
}

describe('authorization harness: leaky repository detection', () => {
  it('flags a repository that ignores AuthContext (rows, counts and by-id lookups all leak)', async () => {
    const violations = await runScopeHarness(new LeakyRepository(), VIEW);
    expect(violations.length).toBeGreaterThan(0);

    const text = violations.join('\n');
    expect(text).toMatch(/Admin\(A\): list\(\) leaked row-b1/); // zone B rows shown to Admin(A)
    expect(text).toMatch(/Admin\(A\): list\(\) leaked row-c1/); // zone C rows shown to Admin(A)
    expect(text).toMatch(/Admin\(none\): list\(\) returned 6 rows, expected 0/);
    expect(text).toMatch(/Admin\(none\): count\(\) returned 6, expected 0/);
    expect(text).toMatch(/Admin\(A\): findById\(row-c1\) returned an out-of-scope row/);
    expect(text).toMatch(/Admin\(A view, B no view\): list\(\) leaked row-b1/);
    expect(text).toMatch(/Admin\(A\+B\) requesting B: list\(\) leaked row-a1/);
    // Super Admin legitimately sees everything: no violation for it
    expect(text).not.toMatch(/SuperAdmin/);
  });

  it('passes a repository built on BaseRepository, for all six actors', async () => {
    expect(await runScopeHarness(new OrdersRepository(), VIEW)).toEqual([]);
  });
});
