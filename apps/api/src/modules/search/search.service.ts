import {
  SEARCH_GROUP_SIZE,
  searchTermOf,
  type PermissionKey,
  type SearchQuery,
  type SearchResponse,
  type SearchResult,
  type SearchType,
} from '@zoauro/shared';
import { maskPhone } from '../../lib/audit';
import type { AuthContext } from '../../lib/authz';
import { AppError } from '../../lib/errors';
import type { RateLimiter } from '../../lib/rate-limiter';
import type { SearchRepository, SearchScope } from './search.repository';

// Global header search (M18; D32 confirmed by D143). One group per type the member asked for: null when they can
// view that module in no zone (not 403, doc 04 section 4.3), otherwise at most five rows with masked contacts. No cache
// (cheap, per member). 60 searches a minute per member. The term is never written to a log or an audit row.

const SEARCHES_PER_MINUTE = 60;

const KEY: Record<SearchType, PermissionKey> = {
  orders: 'orders:view',
  customers: 'customers:view',
  restaurants: 'restaurants:view',
  homemakers: 'homemakers:view',
  partners: 'delivery:view',
};

/** Web routes per role (apps/web navigation): the Super Admin pages vs the zone pages. */
const PATH: Record<SearchType, string> = {
  orders: 'orders',
  customers: 'customers',
  restaurants: 'restaurants',
  homemakers: 'homemakers',
  partners: 'delivery-partners',
};

const dot = (...parts: (string | null | undefined)[]) =>
  parts.filter((p): p is string => !!p).join(' · ') || null;

export class SearchService {
  constructor(private readonly deps: { repo: SearchRepository; limiter: RateLimiter }) {}

  async search(ctx: AuthContext, q: SearchQuery): Promise<SearchResponse> {
    const hit = await this.deps.limiter.hit(`search:${ctx.userId}`, SEARCHES_PER_MINUTE, 60);
    if (!hit.allowed)
      throw new AppError('RATE_LIMITED', 'Too many searches. Try again in a moment.', undefined, {
        'Retry-After': String(Math.max(1, hit.retryAfterSec)),
      });
    const { text, phone } = searchTermOf(q.q);
    const base = ctx.isSuperAdmin ? '/super-admin' : '/zone';
    const href = (t: SearchType, id: string) => `${base}/${PATH[t]}/${id}`;
    const want = new Set(q.types);

    const run = async <T>(
      t: SearchType,
      load: (s: SearchScope) => Promise<T[]>,
      map: (row: T) => SearchResult,
    ): Promise<SearchResult[] | null> => {
      if (!want.has(t)) return null;
      const s = this.deps.repo.scope(ctx, KEY[t]);
      return s ? (await load(s)).map(map) : null;
    };

    const repo = this.deps.repo;
    const n = SEARCH_GROUP_SIZE;
    const [orders, customers, restaurants, homemakers, partners] = await Promise.all([
      run(
        'orders',
        (s) => repo.orders(s, text, phone, n),
        (o) => ({
          id: o.id,
          title: o.orderNo,
          subtitle: dot(o.restaurant?.name ?? o.homemaker?.name, o.status),
          zone: o.zone,
          href: href('orders', o.id),
        }),
      ),
      run(
        'customers',
        (s) => repo.customers(s, text, phone, n),
        (c) => ({
          id: c.id,
          title: c.name,
          subtitle: dot(maskPhone(c.phone), c.status === 'ACTIVE' ? null : c.status),
          zone: null,
          href: href('customers', c.id),
        }),
      ),
      run(
        'restaurants',
        (s) => repo.vendors('restaurants', s, text, phone, n),
        (v) => ({
          id: v.id,
          title: v.name,
          subtitle: dot(v.area, v.phone ? maskPhone(v.phone) : null),
          zone: v.zone,
          href: href('restaurants', v.id),
        }),
      ),
      run(
        'homemakers',
        (s) => repo.vendors('homemakers', s, text, phone, n),
        (v) => ({
          id: v.id,
          title: v.name,
          subtitle: dot(v.area, v.phone ? maskPhone(v.phone) : null),
          zone: v.zone,
          href: href('homemakers', v.id),
        }),
      ),
      run(
        'partners',
        (s) => repo.partners(s, text, phone, n),
        (p) => ({
          id: p.id,
          title: p.name,
          subtitle: dot(p.vehicleNo, p.phone ? maskPhone(p.phone) : null),
          zone: p.zone,
          href: href('partners', p.id),
        }),
      ),
    ]);
    return { q: text, groups: { orders, customers, restaurants, homemakers, partners } };
  }
}
