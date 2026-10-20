import type { Metadata } from 'next';
import { AccountSecurity } from '../../../../features/account/AccountSecurity';

export const metadata: Metadata = { title: 'Account security · ZOAURO Admin' };

/** Both roles (doc 52 section 9.4); the (member) layout checks the session on the server. */
export default function Page() {
  return <AccountSecurity />;
}
