// Input and output schemas of GET /search. They live in packages/shared (AGENTS.md: Zod schemas are shared with the web
// client and the OpenAPI document), and are re-exported here so the module keeps everything it uses in one place.

export {
  SEARCH_ENTITY_TYPES,
  SEARCH_GROUP_LIMIT,
  SEARCH_MAX_QUERY,
  SEARCH_MIN_QUERY,
  searchGroupSchema,
  searchQuerySchema,
  searchResponseSchema,
  searchResultSchema,
} from '@zoauro/shared';
