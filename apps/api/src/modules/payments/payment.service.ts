import type { ListPaymentsQuery } from '@zoauro/shared';
import type { AuthContext } from '../../lib/auth-context';
import * as repo from './payment.repository';

/**
 * GET /payments (doc 09) — Super Admin only until M03/SA-1.7 access profiles
 * grant zonal admins a payments scope. `query` is already validated by the
 * controller's shared Zod schema (422 on invalid input).
 */
export async function list(ctx: AuthContext, query: ListPaymentsQuery) {
  return repo.listPayments(ctx, query);
}
