import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleKey } from '@prisma/client';
import { prisma } from '../../lib/db';
import {
  call,
  cleanupUsers,
  cleanupZones,
  createUser,
  ensureRoles,
  login,
  testApp,
  uniqueEmail,
  type Session,
} from '../../test-support/helpers';

const app = testApp();
const zoneIds: string[] = [];
const ownerIds: string[] = [];
const emails: string[] = [];
let session: Session;
let zoneAId: string;
let restaurantId: string;

beforeAll(async () => {
  await ensureRoles();
  const email = uniqueEmail('dbgmenu2');
  emails.push(email);
  await createUser({ email, role: RoleKey.SUPER_ADMIN });
  session = await login(app, { email, role: 'SUPER_ADMIN' });
  const z = await call(app, 'post', '/api/v1/zones', {
    session,
    body: {
      name: `DbgM2 ${Date.now()}`,
      city: 'Chennai',
      state: 'TN',
      deliveryCharge: 100,
      status: 'ACTIVE',
    },
  });
  zoneAId = z.body.data.id;
  zoneIds.push(zoneAId);
  const r = await call(app, 'post', '/api/v1/restaurants', {
    session,
    body: {
      zoneId: zoneAId,
      name: `DbgM2 Resto ${Date.now()}`,
      ownerName: 'Owner',
      phone: '9876543210',
      address: '1 Road',
      cuisineTags: ['Chinese'],
    },
  });
  restaurantId = r.body.data.id;
  ownerIds.push(restaurantId);
}, 60_000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ownerIds } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: ownerIds } } });
  await cleanupZones(zoneIds);
  await cleanupUsers(emails);
});

describe('debug menu', () => {
  it('creates a menu item and prints the stack', async () => {
    try {
      const { createMenuItem } = await import('./menu.service');
      const result = await createMenuItem(
        { auth: { userId: 'x', isSuperAdmin: true, ip: null } as never, requestId: null },
        {
          zoneId: zoneAId,
          vendorType: 'restaurant',
          vendorId: restaurantId,
          name: 'Paneer Tikka',
          category: 'Starters',
          price: 25000,
          dietary: 'VEGETARIAN',
        },
      );
      console.log('OK', JSON.stringify(result));
    } catch (err) {
      console.log('STACK', (err as Error).stack);
    }
    expect(true).toBe(true);
  });
});
