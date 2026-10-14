import type { Metadata } from 'next';
import { MemberAccessPage } from '../../../../../../features/access/member/MemberAccessPage';

export const metadata: Metadata = { title: 'Member access · ZOAURO Admin' };

/** The layout has already checked the session and the role; the API answers 404 for an unknown member. */
export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return <MemberAccessPage userId={userId} />;
}
