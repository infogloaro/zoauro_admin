import type { ReactNode } from 'react';

// Sign-in screens (doc 52 section 9): no shell, one centred card, a main landmark.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className="flex min-h-screen items-start justify-center bg-bg px-4 py-12 sm:items-center"
    >
      {children}
    </main>
  );
}
