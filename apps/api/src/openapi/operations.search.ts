import { searchQuerySchema, searchResponseSchema } from '@zoauro/shared';
import type { OperationDef } from './operations';

// M18 global header search (doc 09 GET /search, D143). Session only: each group is bounded by its own module's view
// zones and is null when the caller can view that module nowhere.

export const SEARCH_OPERATIONS: OperationDef[] = [
  {
    operationId: 'globalSearch',
    method: 'get',
    path: '/search',
    tags: ['search'],
    summary:
      'Header search (q ≥ 2 characters; types = orders,customers,restaurants,homemakers,partners, default all): up to 5 rows per group in the caller’s view zones, contacts masked; a typed mobile is matched exactly. 60 per minute',
    access: { kind: 'session' },
    query: searchQuerySchema,
    response: { status: 200, schema: searchResponseSchema, description: 'The groups' },
    errors: ['RATE_LIMITED'],
  },
];
