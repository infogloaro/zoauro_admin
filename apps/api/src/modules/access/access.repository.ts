import type { Prisma } from '@prisma/client';
import { isOverrideAction, type AccessAssignment, type AccessDataSource } from '../../lib/authz';

// Reads the access tables (doc 08: admin_zone_assignments, access_profiles, profile_permissions, assignment_overrides).
// Writes arrive with the Access Control module. These queries are about the caller's own access, so there is no zone
// filter: this is where the zone filter for everything else comes from.

export class AccessRepository implements AccessDataSource {
  constructor(private readonly db: Prisma.TransactionClient) {}

  async loadAssignments(userId: string): Promise<AccessAssignment[]> {
    const rows = await this.db.adminZoneAssignment.findMany({
      // a deleted zone grants nothing
      where: { userId, revokedAt: null, zone: { deletedAt: null } },
      select: {
        zoneId: true,
        perRefundLimit: true,
        dailyRefundLimit: true,
        canReveal: true,
        canExport: true,
        profile: {
          select: {
            deletedAt: true,
            defaultPerRefundLimit: true,
            defaultDailyRefundLimit: true,
            defaultCanReveal: true,
            defaultCanExport: true,
            permissions: {
              select: {
                module: true,
                canView: true,
                canAdd: true,
                canEdit: true,
                canDelete: true,
                canStatus: true,
                canExport: true,
              },
            },
          },
        },
        overrides: { select: { module: true, action: true, effect: true } },
      },
    });

    return rows.map((r) => ({
      zoneId: r.zoneId,
      perRefundLimit: r.perRefundLimit,
      dailyRefundLimit: r.dailyRefundLimit,
      canReveal: r.canReveal,
      canExport: r.canExport,
      profile: {
        deleted: r.profile.deletedAt !== null,
        defaultPerRefundLimit: r.profile.defaultPerRefundLimit,
        defaultDailyRefundLimit: r.profile.defaultDailyRefundLimit,
        defaultCanReveal: r.profile.defaultCanReveal,
        defaultCanExport: r.profile.defaultCanExport,
        permissions: r.profile.permissions,
      },
      overrides: r.overrides.flatMap((o) =>
        isOverrideAction(o.action) ? [{ ...o, action: o.action }] : [],
      ),
    }));
  }

  async findUserIdsByProfile(profileId: string): Promise<string[]> {
    const rows = await this.db.adminZoneAssignment.findMany({
      where: { profileId, revokedAt: null },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((r) => r.userId);
  }

  async findUserIdsByZone(zoneId: string): Promise<string[]> {
    const rows = await this.db.adminZoneAssignment.findMany({
      where: { zoneId, revokedAt: null },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((r) => r.userId);
  }
}
