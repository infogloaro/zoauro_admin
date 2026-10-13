export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
      <h1 className="text-2xl font-semibold text-text">404</h1>
      <p className="text-sm text-muted">This page is not available for your account.</p>
      <a href="/login" className="text-sm font-medium text-nav-active hover:underline">
        Go to sign in
      </a>
    </main>
  );
}
