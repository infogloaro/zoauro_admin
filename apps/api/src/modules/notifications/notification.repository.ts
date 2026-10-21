import { prisma } from '../../lib/db';
import type { Prisma } from '@prisma/client';
export interface ListNotificationsParams {
  page: number;
  pageSize: number;
  read?: 'read' | 'unread' | 'all';
}

export async function listForUser(userId: string, params: ListNotificationsParams) {
  const where: Prisma.NotificationWhereInput = { recipientId: userId };
  if (params.read === 'read') where.readAt = { not: null };
  if (params.read === 'unread') where.readAt = null;
  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.notification.count({ where }),
  ]);
  return { items, total };
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { recipientId: userId, readAt: null } });
}

export async function markRead(userId: string, id: string) {
  const updated = await prisma.notification.updateMany({
    where: { id, recipientId: userId, readAt: null },
    data: { readAt: new Date() },
  });
  return updated.count > 0;
}

export async function markAllRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: { recipientId: userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function createNotification(input: {
  recipientId: string;
  eventType: string;
  title: string;
  message: string;
  relatedType?: string;
  relatedId?: string;
  navigationTarget?: string;
  idempotencyKey?: string;
}) {
  try {
    return await prisma.notification.create({ data: input });
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'P2002') return null;
    throw e;
  }
}
