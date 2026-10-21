import type { RequestHandler } from 'express';
import { CONTROL_AREA_KEYS, type ControlAreas } from '@zoauro/shared';
import { getAuth } from '../../lib/auth/middleware';
import { AppError } from '../../lib/errors';
import { ControlAreasRepository } from './control-areas.repository';

// D178 (owner's final design): a primary Super Admin holds every Control Panel area; a non-primary Super Admin holds
// only the areas a primary granted (control_grants); Zonal Admins are outside this panel (their per-zone access model
// is unchanged, so this guard lets them through to their own permission checks). Fail closed: unreadable = no areas.

/** How long a member's areas may be cached in this process; every change clears the member's entry. */
const TTL_MS = 30_000;

export class ControlAreasService {
  private cache = new Map<string, { at: number; value: ControlAreas | null }>();

  constructor(
    private readonly deps: { repo: Pick<ControlAreasRepository, 'of'>; now: () => number },
  ) {}

  /** null for anyone who is not a Super Admin. A primary holds every area. */
  async of(userId: string): Promise<ControlAreas | null> {
    const hit = this.cache.get(userId);
    if (hit && this.deps.now() - hit.at < TTL_MS) return hit.value;
    let value: ControlAreas | null;
    try {
      const row = await this.deps.repo.of(userId);
      value = row
        ? {
            isPrimary: row.isPrimary,
            areas: row.isPrimary
              ? [...CONTROL_AREA_KEYS]
              : CONTROL_AREA_KEYS.filter((k) => row.areas.includes(k)),
          }
        : null;
    } catch {
      value = { isPrimary: false, areas: [] }; // fail closed
    }
    this.cache.set(userId, { at: this.deps.now(), value });
    return value;
  }

  clear(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }

  /**
   * Route guard: a Super Admin must hold the area (a primary always does). Zonal Admins pass to their own per-zone checks.
   * `area` may depend on the request (settings: the group in the path; null = no area check); a key ending in `*` means
   * any area with that prefix (e.g. `settings.*`).
   */
  require(area: string | ((req: Parameters<RequestHandler>[0]) => string | null)): RequestHandler {
    return async (req, res, next) => {
      const auth = getAuth(res);
      if (!auth || auth.role !== 'SUPER_ADMIN') {
        next();
        return;
      }
      const key = typeof area === 'string' ? area : area(req);
      if (key === null) {
        next();
        return;
      }
      const mine = await this.of(auth.userId);
      const held = key.endsWith('*')
        ? (mine?.areas.some((a) => a.startsWith(key.slice(0, -1))) ?? false)
        : (mine?.areas.includes(key) ?? false);
      if (mine?.isPrimary || held) {
        next();
        return;
      }
      throw new AppError('FORBIDDEN', 'This Control Panel area is not granted to you', [
        { field: 'area', issue: 'AREA_NOT_GRANTED' },
      ]);
    };
  }
}

export function createControlAreas(
  prisma: ConstructorParameters<typeof ControlAreasRepository>[0],
  now: () => number = Date.now,
) {
  return new ControlAreasService({ repo: new ControlAreasRepository(prisma), now });
}
