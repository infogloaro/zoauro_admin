// Local development only (the API's SMTP_URL points at Mailpit by default, doc 12): emailed codes land in the Mailpit
// inbox, not in the real mailbox. Never rendered in a production build.

export function DevMailHint() {
  if (process.env.NODE_ENV !== 'development') return null;
  return (
    <p className="rounded-input border border-line bg-bg px-3 py-2 text-xs text-muted">
      Local development: if the email does not arrive, it is in the Mailpit test inbox at{' '}
      <a
        href="http://localhost:8025"
        target="_blank"
        rel="noreferrer"
        className="font-medium text-primary underline"
      >
        localhost:8025
      </a>
      .
    </p>
  );
}
