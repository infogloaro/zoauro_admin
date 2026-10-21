'use client';
import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from './api';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const recent = useNotifications({ page: 1, pageSize: 10 });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  useEffect(() => {
    const es = new EventSource('/api/v1/notifications/stream', { withCredentials: true });
    es.addEventListener('unread-count', () => {
      void unread.refetch();
      void recent.refetch();
    });
    es.onmessage = () => {
      void unread.refetch();
      void recent.refetch();
    };
    return () => es.close();
  }, [unread, recent]);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-text transition-colors hover:bg-bg"
      >
        <Bell className="size-5" />
        {(unread.data ?? 0) > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {(unread.data ?? 0) > 99 ? '99+' : unread.data}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              type="button"
              className="text-xs text-orange-500"
              onClick={() => void markAll.mutateAsync()}
            >
              Mark all read
            </button>
          </div>
          {recent.isPending ? (
            <div className="py-4 text-center text-sm text-muted">Loading…</div>
          ) : recent.isError ? (
            <div className="py-4 text-center text-sm text-muted">
              Failed to load.{' '}
              <button className="underline" onClick={() => void recent.refetch()}>
                Retry
              </button>
            </div>
          ) : (recent.data?.data?.length ?? 0) === 0 ? (
            <div className="py-4 text-center text-sm text-muted">No notifications yet.</div>
          ) : (
            <ul className="max-h-80 overflow-auto">
              {recent.data?.data?.map((n) => (
                <li key={n.id} className="border-b border-border py-2 last:border-0">
                  {n.readAt ? (
                    <div className="px-1">
                      <div className="text-sm">{n.title}</div>
                      <div className="text-xs text-muted">{n.message}</div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={markRead.isPending}
                      onClick={() => void markRead.mutateAsync(n.id)}
                      className="w-full cursor-pointer rounded-md px-1 text-left hover:bg-bg disabled:cursor-default"
                    >
                      <span className="text-sm font-medium">{n.title}</span>
                      <span className="block text-xs text-muted">{n.message}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
