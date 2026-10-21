import * as repo from './notification.repository';

export async function list(
  ctx: { userId: string },
  params: { page: number; pageSize: number; read?: 'read' | 'unread' | 'all' },
) {
  return repo.listForUser(ctx.userId, params);
}

export async function countUnread(ctx: { userId: string }) {
  return repo.unreadCount(ctx.userId);
}

export async function markOneRead(ctx: { userId: string }, id: string) {
  const ok = await repo.markRead(ctx.userId, id);
  if (!ok) return false;
  return true;
}

export async function markAll(ctx: { userId: string }) {
  return repo.markAllRead(ctx.userId);
}
