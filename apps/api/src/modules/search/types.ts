import type { SearchEntityType } from '@zoauro/shared';
import type { ZoneScope } from '../../lib/authz';

// Types internal to the search module. The request and response shapes are the shared Zod contract
// (packages/shared/src/search), re-exported by schemas.ts.

export type {
  SearchEntityType,
  SearchGroup,
  SearchQuery,
  SearchResponse,
  SearchResult,
} from '@zoauro/shared';

/** One database row, as every query in prisma-repository.ts selects it (column aliases match). */
export interface SearchRow {
  id: string;
  title: string;
  /** raw phone (masked by the service) or, for orders, the customer's name */
  subtitle: string | null;
  status: string;
  zoneId: string | null;
  zoneName: string | null;
  /** orders only: total in integer paise */
  amount: number | null;
  createdAt: Date;
}

/** The query text turned into LIKE patterns (see patterns() in service.ts). */
export interface SearchPatterns {
  /** lower-cased, escaped `%q%` */
  pattern: string;
  /** lower-cased, escaped `q%`: prefix matches rank first */
  prefix: string;
  /** `%digits%` when the query looks like a phone number (4+ digits; only digits, spaces, + and -) */
  phonePattern: string | null;
}

/** What the repository needs to search one entity group. */
export interface EntitySearch extends SearchPatterns {
  type: SearchEntityType;
  /** zones this group may read; never an empty zone list (the service skips such groups) */
  scope: ZoneScope;
  /** rows to fetch (the service asks for one more than it shows, to know whether there are more) */
  limit: number;
}
