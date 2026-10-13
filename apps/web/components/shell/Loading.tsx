/** Loading state of a page inside the shell (doc 19 section 4). */
export function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[50vh] items-center justify-center text-sm text-muted"
    >
      <span
        aria-hidden
        className="mr-2 size-4 animate-spin rounded-full border-2 border-line border-t-primary"
      />
      Loading…
    </div>
  );
}
