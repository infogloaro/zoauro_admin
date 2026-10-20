import { StatusPage, linkButton } from '../components/shell/StatusPage';

export default function NotFound() {
  return (
    <main id="main" className="min-h-screen bg-bg p-4">
      <StatusPage
        code="404"
        title="Page not found"
        actions={
          <a href="/" className={linkButton}>
            Go to my dashboard
          </a>
        }
      >
        The page does not exist, or it is not available to your account.
      </StatusPage>
    </main>
  );
}
