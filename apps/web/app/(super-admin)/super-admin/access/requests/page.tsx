import type { Metadata } from 'next';
import { AccessRequestQueuePage } from '../../../../../features/access/requests/AccessRequestQueuePage';

export const metadata: Metadata = { title: 'Access requests · ZOAURO Admin' };

/** The layout has already checked the session and the role; the API checks access:view / access:edit. */
export default function Page() {
  return <AccessRequestQueuePage />;
}
