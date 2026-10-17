'use client';

import { notFound, useRouter, usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { Me } from '@zoauro/shared';
import { ErrorState, TableSkeleton } from '../../components/shared/states';
import { useMe } from '../../features/auth/api';
import { Sidebar } from '../../features/shell/sidebar';
import { Topbar } from '../../features/shell/topbar';
import { PREVIEW_USER, setVendorPreview } from '../../features/vendors/preview';
import { ApiError } from '../../lib/api';

function ShellSkeleton() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <div className="h-16 shrink-0 border-b border-border bg-surface" />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="w-[272px] shrink-0 bg-sidebar max-lg:w-[72px]" />
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-8">
          <TableSkeleton rows={4} />
        </div>
      </div>
    </div>
  );
}

function Shell({ user, children }: { user: Me; children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <Topbar user={user} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <main className="min-h-0 flex-1 overflow-y-auto p-8">{children}</main>
      </div>
    </div>
  );
}

/**
 * Super Admin shell (doc 18 §2): unauthenticated → /login?next=, Zonal Admin
 * → 404. Server-side authorization still guards every API route — this is UX,
 * not a security boundary.
 *
 * Dev-only preview (`?preview=1` under `next dev`) skips this UX gate so the
 * Restaurants screen can render with mock data (features/vendors/preview.ts).
 * Production builds inline NODE_ENV as "production", so the gate always runs
 * there; API authentication is never affected.
 */
export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  const { data: user, error, isPending, refetch } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    const enabled =
      process.env.NODE_ENV === 'development' &&
      new URLSearchParams(window.location.search).get('preview') === '1';
    setVendorPreview(enabled);
    setPreview(enabled);
  }, []);

  const unauthorized = error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (unauthorized && !preview) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [unauthorized, preview, router, pathname]);

  if (preview) {
    return <Shell user={PREVIEW_USER}>{children}</Shell>;
  }

  if (unauthorized || isPending) {
    return <ShellSkeleton />;
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <ErrorState
          message={error.message || 'Could not load your session.'}
          requestId={error.requestId}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (user && !user.isSuperAdmin) {
    notFound();
  }

  if (!user) {
    return <ShellSkeleton />;
  }

  return <Shell user={user}>{children}</Shell>;
}
