'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Root entry: unauthenticated visitors go to /login (doc 18 §2); after login
 * the target is chosen from ?next= or the role landing route.
 */
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/login');
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg">
      <p className="text-lg font-semibold text-text">ZOAURO Admin</p>
    </main>
  );
}
