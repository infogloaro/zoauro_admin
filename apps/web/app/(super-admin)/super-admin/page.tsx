import { redirect } from 'next/navigation';

/** Doc 18 §2: Super Admin lands on the global dashboard (M16). */
export default function SuperAdminIndex() {
  redirect('/super-admin/dashboard');
}
