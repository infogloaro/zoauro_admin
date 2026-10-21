import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { menuFor } from '../../lib/navigation';
import { areaGate, getMe, requestPath, type Area } from '../../lib/server-session';
import { AppShell } from './AppShell';
import { Forbidden } from './StatusPage';

// Server-side guard for a whole area (doc 18 section 7, doc 14): it decides on the server, for every request, from /me.
// Nothing here hides links instead of checking; the API refuses every request it should refuse anyway.

/** The remembered zone scope (M05): /me carries `zoneScope` ([] = all, [id] = one zone) once the API returns it. */
function savedZoneScope(me: object): string | null {
  const scope = 'zoneScope' in me ? me.zoneScope : undefined;
  return Array.isArray(scope) && typeof scope[0] === 'string' ? scope[0] : null;
}

export async function ProtectedArea({ area, children }: { area: Area; children: ReactNode }) {
  const path = await requestPath();
  const gate = areaGate(area, await getMe(), path);
  if (gate.kind === 'login' || gate.kind === 'redirect') redirect(gate.to);
  if (gate.kind === 'not-found') notFound();
  if (gate.kind === 'forbidden') return <Forbidden />;
  const { me, role, zones } = gate;
  return (
    <AppShell
      user={{ name: me.user.name, email: me.user.email, role }}
      menu={menuFor(role, zones, me.controlAreas)}
      zones={zones.map(({ zoneId, name, code, colorHex, status }) => ({
        zoneId,
        name,
        code,
        colorHex,
        status,
      }))}
      savedZoneId={savedZoneScope(me)}
      csrfToken={me.csrfToken}
    >
      {children}
    </AppShell>
  );
}
