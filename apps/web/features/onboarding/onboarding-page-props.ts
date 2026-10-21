import type { MeResponse } from '@zoauro/shared';
import type { ScopeZone } from '../../lib/zone-scope';

// What the onboarding queue shows a member, from /me (server side). A convenience only: the API scopes the queue to the
// zones where the member may view each module (restaurants, homemakers, hotels) and checks <module>:edit on a review.

const MODULES = ['restaurants', 'homemakers', 'hotels'] as const;

export interface OnboardingPageProps {
  role: 'SUPER_ADMIN' | 'ZONAL_ADMIN';
  myZones: ScopeZone[];
  /** may start a review or ask for more information somewhere */
  canAct: boolean;
}

export function onboardingPageProps(me: MeResponse): OnboardingPageProps {
  if (me.permissions.global) return { role: 'SUPER_ADMIN', myZones: [], canAct: true };
  const zones = me.permissions.zones;
  return {
    role: 'ZONAL_ADMIN',
    myZones: zones
      .filter((z) => MODULES.some((m) => z.permissions.includes(`${m}:view`)))
      .map((z) => ({ id: z.zoneId, name: z.name, code: z.code, colorHex: z.colorHex })),
    canAct: zones.some((z) => MODULES.some((m) => z.permissions.includes(`${m}:edit`))),
  };
}
