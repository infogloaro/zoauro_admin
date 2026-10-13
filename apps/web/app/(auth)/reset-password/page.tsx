import type { Metadata } from 'next';
import { ResetPasswordForm } from '../../../features/auth/PasswordForms';

export const metadata: Metadata = {
  title: 'Reset password · ZOAURO Admin',
  // the token is in the URL: never send it to another site as a referrer
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = (await searchParams)['token'];
  return <ResetPasswordForm token={typeof token === 'string' && token ? token : null} />;
}
