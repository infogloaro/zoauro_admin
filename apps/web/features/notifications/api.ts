import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';

export interface NotificationItem {
  id: string;
  eventType: string;
  title: string;
  message: string;
  relatedType?: string | null;
  relatedId?: string | null;
  navigationTarget?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export function useNotifications(
  params: { page?: number; pageSize?: number; read?: 'all' | 'read' | 'unread' } = {},
) {
  const { page = 1, pageSize = 20, read = 'all' } = params;
  return useQuery({
    queryKey: ['notifications', page, pageSize, read],
    queryFn: async () => {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), read });
      const res = await apiFetch(`/notifications?${qs.toString()}`);
      return res as {
        data: NotificationItem[];
        meta: { total: number; page: number; pageSize: number };
      };
    },
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const res = await apiFetch('/notifications/unread-count');
      return (res as { data: { count: number } }).data.count;
    },
    refetchInterval: 60000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiFetch('/notifications/read-all', { method: 'PATCH' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
