'use client';

import { useEffect, useState } from 'react';
import { signOut } from '../../components/shell/UserMenu';
import { hardNavigate } from '../../lib/navigate';
import { setCsrfToken } from '../../lib/csrf';
import { AuthCard, linkClass } from './AuthCard';
import { ChangePasswordForm } from './PasswordForms';

// First sign-in with a temporary password (doc 52 section 2.1 [3]): change it before anything else. Afterwards the
// server sends the member to their dashboard.

export function ForcedPasswordChange({ csrfToken, name }: { csrfToken: string; name: string }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => setCsrfToken(csrfToken), [csrfToken]);
  return (
    <AuthCard
      title="Change your password"
      subtitle={`Welcome, ${name}. Your account was created with a temporary password; choose your own before you continue.`}
      footer={
        <button
          type="button"
          className={linkClass}
          disabled={leaving}
          onClick={async () => {
            setLeaving(true);
            await signOut(csrfToken);
            hardNavigate('/login');
          }}
        >
          Sign out
        </button>
      }
    >
      <ChangePasswordForm submitLabel="Save and continue" onChanged={() => hardNavigate('/')} />
    </AuthCard>
  );
}
