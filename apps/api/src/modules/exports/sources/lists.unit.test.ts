import type { TicketListItem } from '@zoauro/shared';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AuthContext } from '../../../lib/authz';
import { EXPORT_PAGE_SIZE, type ExportSource } from '../../../lib/exports';
import type { CustomersService } from '../../customers';
import type { OffersService } from '../../offers';
import type { PartnersService } from '../../delivery-partners';
import type { BookingsService, HotelsService } from '../../hotels';
import type { MenuService } from '../../menu';
import type { NotificationsService } from '../../notifications';
import type { SupportService } from '../../support';
import type { VendorsService } from '../../vendors';
import { listExportSources, type ListServices } from './lists.source';

// D149 sources: one per list service on HEAD; each reads through the list service (scope and masking stay the list's),
// counts with one row, then pages with the list maximum. The real services must fit ListServices (checked at compile time).

const ctx = { userId: 'u', isSuperAdmin: true } as unknown as AuthContext;

async function csv(source: ExportSource, raw = {}) {
  let out = source.header();
  for await (const c of source.chunks(ctx, raw, { zoneName: (z) => `Zone ${z}` })) out += c.csv;
  return out;
}

const ticket = (n: number): TicketListItem => ({
  id: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  ticketNo: `TCK-${n}`,
  zoneId: 'zA',
  status: 'OPEN',
  priority: 'HIGH',
  category: 'ORDER',
  subject: n === 1 ? '=HYPERLINK("x")' : 'Late',
  customerId: 'c',
  customerName: 'Asha',
  customerPhoneMasked: '+91******3210',
  orderId: null,
  refundId: null,
  assignee: { id: 'a', name: 'Desk One' },
  firstResponseDueAt: '2026-10-20T10:00:00.000Z',
  resolutionDueAt: '2026-10-21T08:00:00.000Z',
  escalatedAt: null,
  breached: false,
  createdAt: '2026-10-20T08:00:00.000Z',
  version: 1,
});

describe('list export sources (D149)', () => {
  it('real services fit (compile-time) and only the given services get a source', () => {
    expectTypeOf<{
      vendors: VendorsService;
      menu: MenuService;
      partners: PartnersService;
      hotels: HotelsService;
      bookings: BookingsService;
      notifications: NotificationsService;
      support: SupportService;
      customers: CustomersService;
      offers: OffersService;
    }>().toMatchTypeOf<Required<ListServices>>();
    expect(listExportSources({}).map((s) => s.module)).toEqual([]);
    const all = listExportSources({
      vendors: { list: async () => ({ data: [], meta: { total: 0 } }) },
      menu: { list: async () => ({ data: [], meta: { total: 0 } }) },
      partners: { list: async () => ({ data: [], meta: { total: 0 } }) },
      hotels: { list: async () => ({ data: [], meta: { total: 0 } }) },
      bookings: {
        listBookings: async () => ({ data: [], meta: { total: 0 } }),
        listDining: async () => ({ data: [], meta: { total: 0 } }),
      },
      notifications: { list: async () => ({ data: [], meta: { total: 0 } }) },
      support: { list: async () => ({ data: [], meta: { total: 0 } }) },
    });
    expect(all.map((s) => [s.module, s.viewKey])).toEqual([
      ['restaurants', 'restaurants:view'],
      ['homemakers', 'homemakers:view'],
      ['menu', 'menu:view'],
      ['delivery', 'delivery:view'],
      ['hotels', 'hotels:view'],
      ['bookings', 'bookings:view'],
      ['dining', 'dining:view'],
      ['notifications', 'notifications:view'],
      ['support', 'support:view'],
    ]);
    expect(all.every((s) => s.audit.action.endsWith('.exported'))).toBe(true);
  });

  it('pages through the list service with its own query, the list maximum, and the list masking', async () => {
    const calls: { page: number; pageSize: number; status?: unknown }[] = [];
    const rows = Array.from({ length: EXPORT_PAGE_SIZE + 1 }, (_, i) => ticket(i + 1));
    const [source] = listExportSources({
      support: {
        list: async (_c, q) => {
          calls.push({ page: q.page, pageSize: q.pageSize, status: q.status });
          const start = (q.page - 1) * q.pageSize;
          return { data: rows.slice(start, start + q.pageSize), meta: { total: rows.length } };
        },
      },
    });
    if (!source) throw new Error('no source');
    expect(await source.count(ctx, { status: 'OPEN' })).toBe(101);
    const text = await csv(source, { status: 'OPEN' });
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Ticket no,Zone,Status,Priority,Category,Subject,Customer,Customer phone,Assignee,Resolution due (UTC),Breached,Created at (UTC),Order id,Id',
    );
    expect(lines).toHaveLength(102);
    expect(text).toContain(`"'=HYPERLINK(""x"")"`); // formula guard
    expect(text).toContain('+91******3210'); // the list's masking, untouched
    expect(text).toContain('Zone zA');
    expect(calls.slice(1).map((c) => [c.page, c.pageSize])).toEqual([
      [1, EXPORT_PAGE_SIZE],
      [2, EXPORT_PAGE_SIZE],
      [3, EXPORT_PAGE_SIZE],
    ]);
    expect(calls.every((c) => JSON.stringify(c.status) === JSON.stringify(['OPEN']))).toBe(true);
  });

  it('a bad filter is the list validation error', async () => {
    const [source] = listExportSources({
      support: { list: async () => ({ data: [], meta: { total: 0 } }) },
    });
    expect(() => source?.validate({ status: 'NOPE' })).toThrow('Invalid input');
  });
});
