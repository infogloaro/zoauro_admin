import { prisma } from '../../lib/db';
import type { Prisma } from '@prisma/client';
import type { ListPaymentsQuery } from '@zoauro/shared';
import type { AuthContext } from '../../lib/auth-context';

/**
 * GET /payments (doc 09). Takes `AuthContext` per the repository rule
 * (AGENTS.md). `payments` carries no zone column yet (doc 08 foundation
 * table) and the route is Super-Admin-only (requireSuperAdmin), so there is
 * no scope predicate to apply — once M03/SA-1.7 zone scoping lands, filter on
 * `ctx.effectiveZoneIds` here.
 */
export async function listPayments(_ctx: AuthContext, query: ListPaymentsQuery) {
  const where: Prisma.PaymentWhereInput = {};

  if (query.q)
    where.OR = [
      { paymentRef: { contains: query.q, mode: 'insensitive' } },
      { orderRef: { contains: query.q, mode: 'insensitive' } },
    ];
  if (query.status) where.status = query.status;
  if (query.method) where.method = query.method;
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.payment.count({ where }),
  ]);
  return { items, total };
}
