import { SEARCH_ENTITY_TYPES, SEARCH_GROUP_LIMIT, type PermissionKey } from '@zoauro/shared';
import { maskPhone } from '../../lib/audit';
import { zonesFor, type AuthContext, type ZoneScope } from '../../lib/authz';
import { escapeLike } from '../audit';
import type { SearchRepository } from './repository';
import type {
  SearchEntityType,
  SearchGroup,
  SearchPatterns,
  SearchQuery,
  SearchResponse,
  SearchResult,
  SearchRow,
} from './types';

// M18 Global Search (D32, doc 36 section 1, TC-MZ-15). Each group is gated by its own module's view permission and
// read with zonesFor(ctx, '<module>:view'), so search never shows a record that module's list would not show. A group
// the member cannot view in any in-scope zone is left out of the response entirely.

/** The module whose view permission decides each group (doc 04 module keys). */
export const SEARCH_PERMISSION: Readonly<Record<SearchEntityType, PermissionKey>> = {
  order: 'orders:view',
  customer: 'customers:view',
  restaurant: 'restaurants:view',
  homemaker: 'homemakers:view',
  deliveryPartner: 'delivery:view',
};

/** null = this member may not read the group anywhere in the requested scope. */
export function searchScope(ctx: AuthContext, type: SearchEntityType): ZoneScope | null {
  const scope = zonesFor(ctx, SEARCH_PERMISSION[type]);
  return scope.kind === 'ZONES' && scope.zoneIds.length === 0 ? null : scope;
}

/** The query text as LIKE patterns: lower-cased, LIKE wildcards made literal, and digits for phone-like input. */
export function patterns(q: string): SearchPatterns {
  const text = escapeLike(q.trim().toLowerCase());
  const digits = q.replace(/\D/g, '');
  const phoneLike = /^[\d\s+-]+$/.test(q.trim()) && digits.length >= 4;
  return {
    pattern: `%${text}%`,
    prefix: `${text}%`,
    phonePattern: phoneLike ? `%${digits}%` : null,
  };
}

function toResult(type: SearchEntityType, r: SearchRow): SearchResult {
  return {
    type,
    id: r.id,
    title: r.title,
    // D26: phones are masked in every list; an order's subtitle is the customer's name
    subtitle: r.subtitle === null ? null : type === 'order' ? r.subtitle : maskPhone(r.subtitle),
    status: r.status,
    zoneId: r.zoneId,
    zoneName: r.zoneName,
    amount: r.amount,
    createdAt: r.createdAt.toISOString(),
  };
}

export class SearchService {
  constructor(private readonly repo: SearchRepository) {}

  async search(ctx: AuthContext, query: SearchQuery): Promise<SearchResponse> {
    const p = patterns(query.q);
    const visible = SEARCH_ENTITY_TYPES.flatMap((type) => {
      const scope = searchScope(ctx, type);
      return scope === null ? [] : [{ type, scope }];
    });
    const groups = await Promise.all(
      visible.map(async ({ type, scope }): Promise<SearchGroup> => {
        // one extra row tells us whether there are more than we show
        const rows = await this.repo.search(ctx, {
          ...p,
          type,
          scope,
          limit: SEARCH_GROUP_LIMIT + 1,
        });
        return {
          type,
          items: rows.slice(0, SEARCH_GROUP_LIMIT).map((r) => toResult(type, r)),
          hasMore: rows.length > SEARCH_GROUP_LIMIT,
        };
      }),
    );
    return { q: query.q, groups };
  }
}
