import { prisma } from '../../lib/db';
import { PaymentTransactionStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

const TRANSACTION_STATUSES: readonly string[] = Object.values(PaymentTransactionStatus);

function isTransactionStatus(value: string): value is PaymentTransactionStatus {
  return TRANSACTION_STATUSES.includes(value);
}

export async function listPayments(params: {
  page: number;
  pageSize: number;
  q?: string;
  status?: string;
  method?: string;
}) {
  const where: Prisma.PaymentWhereInput = {};

  if (params.q)
    where.OR = [
      { paymentRef: { contains: params.q, mode: 'insensitive' } },
      { orderRef: { contains: params.q, mode: 'insensitive' } },
    ];
  if (params.status && isTransactionStatus(params.status)) where.status = params.status;
  if (params.method) where.method = params.method;
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.payment.count({ where }),
  ]);
  return { items, total };
}
