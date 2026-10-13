import type { ReactNode } from 'react';
import { ProtectedArea } from '../../../components/shell/ProtectedArea';

// every page below depends on the visitor's session: never cached
export const dynamic = 'force-dynamic';

export default function Layout({ children }: { children: ReactNode }) {
  return <ProtectedArea area="zone">{children}</ProtectedArea>;
}
