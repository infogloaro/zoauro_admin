import type { PrismaClient } from './db';
import { runAsSystem, runWithAuditContext } from '../../src/lib/audit';
import type { SecretBox } from '../../src/modules/auth/mfa/secret-box';
import { createMenuModule } from '../../src/modules/menu';
import { createApiClient } from '../../src/modules/intake/clients.service';
import { IntakeDatabase } from '../../src/modules/intake/intake.repository';
import type { DemoClient } from './client';
import type { SeededVendor } from './vendors';

// Step 3: categories, menu items (some admin-disabled, out of stock or featured) and food item requests from the
// vendor app (pending, approved, rejected).

const CATEGORIES = [
  'Tiffin',
  'Meals',
  'Biryani',
  'Starters',
  'Main Course',
  'Breads',
  'Sweets',
  'Snacks',
  'Beverages',
];

type Diet = 'VEGETARIAN' | 'NON_VEG' | 'EGG';
type Item = [name: string, rupees: number, diet: Diet, category: string, description: string];

const MENUS: Record<string, Item[]> = {
  'Annapoorna Gowrishankar': [
    [
      'Ghee Roast Dosa',
      120,
      'VEGETARIAN',
      'Tiffin',
      'Crisp dosa roasted in pure ghee, with three chutneys and sambar.',
    ],
    ['Mini Tiffin', 150, 'VEGETARIAN', 'Tiffin', 'Mini idli, mini dosa, pongal, vada and kesari.'],
    [
      'South Indian Meals',
      180,
      'VEGETARIAN',
      'Meals',
      'Rice, sambar, rasam, kootu, poriyal, curd and payasam.',
    ],
    ['Medu Vada (2)', 60, 'VEGETARIAN', 'Snacks', 'Soft lentil vada with coconut chutney.'],
    ['Filter Coffee', 40, 'VEGETARIAN', 'Beverages', 'Kumbakonam degree coffee.'],
    ['Rava Kesari', 55, 'VEGETARIAN', 'Sweets', 'Semolina, ghee, cashew and saffron.'],
  ],
  Haribhavanam: [
    [
      'Chicken Biryani',
      260,
      'NON_VEG',
      'Biryani',
      'Seeraga samba biryani, Kongu style, with raita and brinjal curry.',
    ],
    ['Mutton Biryani', 340, 'NON_VEG', 'Biryani', 'Tender mutton, seeraga samba rice.'],
    ['Pepper Chicken', 240, 'NON_VEG', 'Starters', 'Dry pepper roast, Chettinad spices.'],
    ['Egg Kothu Parotta', 160, 'EGG', 'Main Course', 'Minced parotta with egg and salna.'],
    ['Nattu Kozhi Kuzhambu', 290, 'NON_VEG', 'Main Course', 'Country chicken curry.'],
    ['Parotta (2)', 50, 'VEGETARIAN', 'Breads', 'Layered Malabar parotta.'],
    ['Fish Fry', 220, 'NON_VEG', 'Starters', 'Seer fish, masala fried.'],
  ],
  'Sree Krishna Sweets': [
    ['Mysore Pak (250 g)', 260, 'VEGETARIAN', 'Sweets', 'Melt-in-the-mouth ghee Mysore pak.'],
    ['Kaju Katli (250 g)', 320, 'VEGETARIAN', 'Sweets', 'Cashew fudge with silver leaf.'],
    ['Mixture (200 g)', 90, 'VEGETARIAN', 'Snacks', 'Kara mixture.'],
    ['Badam Milk', 70, 'VEGETARIAN', 'Beverages', 'Almond milk with saffron.'],
  ],
  'Rajam Mess': [
    ['Full Meals', 140, 'VEGETARIAN', 'Meals', 'Unlimited rice, three curries, rasam and curd.'],
    ['Curd Rice', 70, 'VEGETARIAN', 'Meals', 'With pickle.'],
  ],
  "Lakshmi's Home Kitchen": [
    ['Kongu Veg Meals', 150, 'VEGETARIAN', 'Meals', 'Arisi paruppu sadam, poriyal, rasam, curd.'],
    ['Ragi Kali with Keerai', 120, 'VEGETARIAN', 'Meals', 'Finger millet balls with greens curry.'],
    ['Thengai Paal Sadam', 110, 'VEGETARIAN', 'Meals', 'Coconut milk rice.'],
    ['Paruppu Payasam', 60, 'VEGETARIAN', 'Sweets', 'Lentil and jaggery kheer.'],
  ],
  'Saravanampatti Tiffin Centre': [
    ['Idli (3)', 45, 'VEGETARIAN', 'Tiffin', 'With sambar and two chutneys.'],
    ['Masala Dosa', 85, 'VEGETARIAN', 'Tiffin', 'Potato masala, crisp dosa.'],
    ['Pongal', 70, 'VEGETARIAN', 'Tiffin', 'Ven pongal with gotsu.'],
    ['Poori Masala', 80, 'VEGETARIAN', 'Tiffin', 'Two pooris with potato masala.'],
    ['Tea', 20, 'VEGETARIAN', 'Beverages', 'Masala tea.'],
  ],
  'The Brew Room Cafe': [
    ['Cold Coffee', 140, 'VEGETARIAN', 'Beverages', 'With vanilla ice cream.'],
    ['Paneer Sandwich', 160, 'VEGETARIAN', 'Snacks', 'Grilled, with mint mayo.'],
  ],
  'Selvi Veg Lunch Box': [
    [
      'Office Lunch Box',
      130,
      'VEGETARIAN',
      'Meals',
      'Variety rice, poriyal, curd rice and pickle.',
    ],
    ['Sambar Sadam', 90, 'VEGETARIAN', 'Meals', 'With appalam.'],
    ['Lemon Rice', 80, 'VEGETARIAN', 'Meals', 'With potato fry.'],
  ],
  'Tiruppur Kongu Kitchen': [
    [
      'Kongu Chicken Curry Meals',
      230,
      'NON_VEG',
      'Meals',
      'Rice with Kongu chicken curry and rasam.',
    ],
    ['Mutton Chukka', 320, 'NON_VEG', 'Starters', 'Dry roasted mutton.'],
    ['Egg Dosa', 90, 'EGG', 'Tiffin', 'Dosa with egg and pepper.'],
    ['Veg Biryani', 170, 'VEGETARIAN', 'Biryani', 'Seeraga samba vegetable biryani.'],
    ['Nannari Sarbath', 45, 'VEGETARIAN', 'Beverages', 'Sarsaparilla and lemon.'],
  ],
};

export interface SeededItem {
  id: string;
  vendorId: string;
  name: string;
  pricePaise: number;
}

type Log = (m: string) => void;

/** The demo's app clients (doc 45 Hub: one per app), created once; returns the vendor app's id. */
export async function ensureAppClients(
  db: PrismaClient,
  secretBox: SecretBox,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const intakeDb = new IntakeDatabase(db);
  for (const [type, name] of [
    ['CUSTOMER_APP', 'Customer app (demo sandbox)'],
    ['VENDOR_APP', 'Vendor app (demo sandbox)'],
    ['PARTNER_APP', 'Partner app (demo sandbox)'],
  ] as const) {
    const found = await db.apiClient.findFirst({
      where: { name, deletedAt: null },
      select: { id: true },
    });
    out[type] = found
      ? found.id
      : (
          await runAsSystem('demo seed', () =>
            createApiClient(
              { db: intakeDb, secretBox, createdBy: null },
              { name, type, environment: 'SANDBOX' },
            ),
          )
        ).id;
  }
  return out;
}

export async function seedMenu(
  db: PrismaClient,
  sa: DemoClient,
  vendors: SeededVendor[],
  vendorAppClientId: string,
  log: Log,
): Promise<SeededItem[]> {
  // categories (platform-wide)
  const cats = await db.category.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  const catId: Record<string, string> = Object.fromEntries(cats.map((c) => [c.name, c.id]));
  for (const [i, name] of CATEGORIES.entries()) {
    if (catId[name]) continue;
    const c = await sa.post<{ id: string }>('/categories', {
      zoneId: null,
      name,
      sortOrder: (i + 1) * 10,
    });
    catId[name] = c.id;
  }

  const items: SeededItem[] = [];
  for (const v of vendors) {
    const menu = MENUS[v.name];
    if (!menu) continue;
    const vendorKind = v.module === 'restaurants' ? 'RESTAURANT' : 'HOMEMAKER';
    const have = await db.menuItem.findMany({
      where: {
        deletedAt: null,
        ...(vendorKind === 'RESTAURANT' ? { restaurantId: v.id } : { homemakerId: v.id }),
      },
      select: { id: true, name: true, price: true },
    });
    const byName = new Map(have.map((h) => [h.name, h]));
    for (const [n, [name, rupees, dietary, category, description]] of menu.entries()) {
      const found = byName.get(name);
      if (found) {
        items.push({ id: found.id, vendorId: v.id, name, pricePaise: found.price });
        continue;
      }
      const created = await sa.post<{ id: string }>('/menu-items', {
        vendorKind,
        vendorId: v.id,
        categoryId: catId[category],
        name,
        description,
        price: rupees * 100,
        dietary,
        isFeatured: n === 0,
        // the last item of a few menus is sold out today
        ...(n === menu.length - 1 && n % 2 === 0 ? { stock: 0 } : {}),
      });
      items.push({ id: created.id, vendorId: v.id, name, pricePaise: rupees * 100 });
    }
    log(`menu of ${v.name}: ${menu.length} items`);
  }

  // an item the zone team switched off (admin_disabled wins over the vendor's own toggle, doc 44)
  const fish = items.find((i) => i.name === 'Fish Fry');
  if (fish) {
    const row = await db.menuItem.findUnique({
      where: { id: fish.id },
      select: { adminDisabled: true },
    });
    if (!row?.adminDisabled)
      await sa.patch(`/menu-items/${fish.id}`, {
        adminDisabled: true,
        reason: 'Customer complaints about freshness; off until the kitchen inspection.',
      });
  }

  // food item requests from the vendor app (R09): pending, then one approved and one rejected by the Super Admin
  const pendingCount = await db.menuItemChangeRequest.count();
  if (pendingCount === 0) {
    const menu = createMenuModule({
      prisma: db,
      appOrigin: 'http://127.0.0.1:3100',
      // the vendor app's changes carry no image here, so the upload gate is never asked
      uploads: { assertUploaded: async () => undefined },
    });
    const asVendorApp = <T>(fn: () => Promise<T>) =>
      runWithAuditContext(
        {
          actor: {
            type: 'APP_CLIENT',
            id: vendorAppClientId,
            name: 'Vendor app (demo sandbox)',
            role: null,
          },
        },
        fn,
      );
    const byVendor = (name: string) => vendors.find((v) => v.name === name);
    const hari = byVendor('Haribhavanam');
    const anna = byVendor('Annapoorna Gowrishankar');
    const kongu = byVendor('Tiruppur Kongu Kitchen');
    const submissions = [
      hari && {
        zoneId: hari.zoneId,
        vendor: { kind: 'RESTAURANT' as const, id: hari.id },
        kind: 'CREATE' as const,
        externalItemId: 'app-item-hari-901',
        clientId: vendorAppClientId,
        proposal: {
          name: 'Prawn Thokku',
          price: 31000,
          categoryId: catId['Main Course'],
          dietary: 'NON_VEG' as const,
          description: 'Spicy prawn masala, Chettinad style.',
        },
      },
      hari && {
        zoneId: hari.zoneId,
        vendor: { kind: 'RESTAURANT' as const, id: hari.id },
        kind: 'UPDATE' as const,
        menuItemId: items.find((i) => i.name === 'Chicken Biryani')?.id,
        clientId: vendorAppClientId,
        proposal: { price: 28000 },
      },
      anna && {
        zoneId: anna.zoneId,
        vendor: { kind: 'RESTAURANT' as const, id: anna.id },
        kind: 'CREATE' as const,
        externalItemId: 'app-item-anna-311',
        clientId: vendorAppClientId,
        proposal: {
          name: 'Onion Uthappam',
          price: 9500,
          categoryId: catId['Tiffin'],
          dietary: 'VEGETARIAN' as const,
        },
      },
      anna && {
        zoneId: anna.zoneId,
        vendor: { kind: 'RESTAURANT' as const, id: anna.id },
        kind: 'DELETE' as const,
        menuItemId: items.find((i) => i.name === 'Rava Kesari')?.id,
        clientId: vendorAppClientId,
        proposal: {},
      },
      kongu && {
        zoneId: kongu.zoneId,
        vendor: { kind: 'RESTAURANT' as const, id: kongu.id },
        kind: 'CREATE' as const,
        externalItemId: 'app-item-kongu-77',
        clientId: vendorAppClientId,
        proposal: {
          name: 'Pallipalayam Chicken',
          price: 26000,
          categoryId: catId['Starters'],
          dietary: 'NON_VEG' as const,
        },
      },
      kongu && {
        zoneId: kongu.zoneId,
        vendor: { kind: 'RESTAURANT' as const, id: kongu.id },
        kind: 'UPDATE' as const,
        menuItemId: items.find((i) => i.name === 'Mutton Chukka')?.id,
        clientId: vendorAppClientId,
        proposal: { price: 39900, description: 'Dry roasted mutton, now a bigger portion.' },
      },
    ].filter((s): s is NonNullable<typeof s> => Boolean(s));
    const ids: string[] = [];
    for (const s of submissions) {
      const r = await asVendorApp(() => menu.changes.submit(s));
      if (r.requestId) ids.push(r.requestId);
    }
    // the Super Admin decides two: Onion Uthappam approved, the Mutton Chukka price rise rejected
    const decide = async (index: number, approve: boolean) => {
      const id = ids[index];
      if (!id) return;
      const cr = await sa.get<{ version: number }>(`/menu-items/change-requests/${id}`);
      await sa.post(
        `/menu-items/change-requests/${id}/${approve ? 'approve' : 'reject'}`,
        approve
          ? { version: cr.version }
          : {
              version: cr.version,
              reason: 'A 33% price rise needs a call with the zone team first.',
            },
      );
    };
    await decide(2, true);
    await decide(5, false);
    log(`food item requests: ${ids.length} from the vendor app (2 decided, the rest pending)`);
  }
  return items;
}
