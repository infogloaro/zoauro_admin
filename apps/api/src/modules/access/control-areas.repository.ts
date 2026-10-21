import type { Prisma } from '@prisma/client';

// D178: a Super Admin's primary flag and active Control Panel area grants (users.is_primary, control_grants).

export class ControlAreasRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  async of(userId: string): Promise<{ isPrimary: boolean; areas: string[] } | null> {
    const u = await this.db.user.findFirst({
      where: { id: userId, deletedAt: null, role: { name: 'SUPER_ADMIN' } },
      select: {
        isPrimary: true,
        controlGrantsHeld: { where: { revokedAt: null }, select: { key: true } },
      },
    });
    if (!u) return null;
    return { isPrimary: u.isPrimary, areas: u.controlGrantsHeld.map((g) => g.key) };
  }
}
