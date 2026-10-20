import type { AuthContext } from '../../lib/authz';
import type { EntitySearch, SearchRow } from './types';

/**
 * The search repository contract. The service depends on this interface only; prisma-repository.ts is the real
 * implementation, and tests may pass a fake. Every method takes the AuthContext (AGENTS.md: every repository method
 * does), and every implementation must apply `input.scope` to its query.
 */
export interface SearchRepository {
  /** Up to `input.limit` rows of one entity group matching the patterns, inside `input.scope`. */
  search(ctx: AuthContext, input: EntitySearch): Promise<SearchRow[]>;
}
