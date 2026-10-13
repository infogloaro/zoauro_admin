import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="text-3xl font-extrabold tracking-tight text-nav-active">ZOAURO</span>
          <p className="mt-1 text-sm text-muted">Admin panel</p>
        </div>
        {children}
      </div>
    </main>
  );
}
