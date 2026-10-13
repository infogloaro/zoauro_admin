import { redirect } from 'next/navigation';

/** SA-1.1: the Super Admin dashboard arrives in a later task (doc 20). */
export default function SuperAdminIndex() {
  redirect('/super-admin/zones');
}
