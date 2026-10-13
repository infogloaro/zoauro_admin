import type { ReactNode } from 'react';
import { ProtectedArea } from '../../components/shell/ProtectedArea';

// Pages every signed-in member reaches (Account security, Coming Soon), inside the shell of their own role.
export const dynamic = 'force-dynamic';

export default function Layout({ children }: { children: ReactNode }) {
  return <ProtectedArea area="shared">{children}</ProtectedArea>;
}
