import { Prisma, PrismaClient, RoleKey } from '@prisma/client';
import { hashPassword } from '../src/lib/passwords';

/**
 * Seed (doc 08/F1.7): identity roles, first Super Admin from env, and demo
 * zones so the Zone Management screen has dev fixtures. Idempotent.
 * Extended (task: realistic data & global search F1.1): restaurant, homemaker,
 * hotel and menu-item records for Chennai & Tamil Nadu.
 *
 * Vendors carry the free-text `area` column from doc 08/20/22 — there is no
 * separate areas table in the shipped schema.
 */
const prisma = new PrismaClient();

const MIN_PASSWORD_LENGTH = 12; // doc 14 §2

// ---- Locality pools per demo zone (stored in the free-text `area` column) ----
const LOCALITIES: Record<string, string[]> = {
  Chennai: [
    'T Nagar',
    'Anna Nagar',
    'Velachery',
    'OMR',
    'Kotturpuram',
    'West Mambalam',
    'Sholinganallur',
    'Tambaram',
  ],
  Coimbatore: ['RS Puram', 'Gandhipuram', 'Saibaba Colony'],
  Madurai: ['Anna Nagar', 'West Perumal Street', 'K K Nagar', 'Thoppur'],
};

// All 38 official Tamil Nadu districts with their default zone configuration.
// `status` literals match ZoneStatus (doc 08).
const ALL_TAMIL_NADU_DISTRICTS: Prisma.ZoneCreateManyInput[] = [
  {
    name: 'Ariyalur',
    code: 'ARY',
    city: 'Ariyalur',
    state: 'Tamil Nadu',
    pincodeFrom: '621001',
    pincodeTo: '621201',
    deliveryCharge: 3500,
    status: 'ACTIVE',
    colorHex: '#6B46C1',
    description: 'District in central TN',
  },
  {
    name: 'Chengalpattu',
    code: 'CHG',
    city: 'Chengalpattu',
    state: 'Tamil Nadu',
    pincodeFrom: '603001',
    pincodeTo: '603306',
    deliveryCharge: 3000,
    status: 'ACTIVE',
    colorHex: '#805AD5',
    description: 'District south of Chennai',
  },
  {
    name: 'Chennai',
    code: 'MAA',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincodeFrom: '600001',
    pincodeTo: '600119',
    deliveryCharge: 4900,
    status: 'ACTIVE',
    colorHex: '#2F6BFF',
    description: 'Metro service zone',
  },
  {
    name: 'Coimbatore',
    code: 'CBE',
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    pincodeFrom: '641001',
    pincodeTo: '641109',
    deliveryCharge: 3500,
    status: 'ACTIVE',
    colorHex: '#16A34A',
    description: 'Industrial hub',
  },
  {
    name: 'Cuddalore',
    code: 'CDU',
    city: 'Cuddalore',
    state: 'Tamil Nadu',
    pincodeFrom: '607001',
    pincodeTo: '607402',
    deliveryCharge: 2600,
    status: 'ACTIVE',
    colorHex: '#0891B2',
    description: 'Coastal district',
  },
  {
    name: 'Dharmapuri',
    code: 'DPG',
    city: 'Dharmapuri',
    state: 'Tamil Nadu',
    pincodeFrom: '636701',
    pincodeTo: '636807',
    deliveryCharge: 2500,
    status: 'ACTIVE',
    colorHex: '#7C3AED',
    description: 'Northern district',
  },
  {
    name: 'Dindigul',
    code: 'DGL',
    city: 'Dindigul',
    state: 'Tamil Nadu',
    pincodeFrom: '624001',
    pincodeTo: '624621',
    deliveryCharge: 2700,
    status: 'ACTIVE',
    colorHex: '#DB2777',
    description: 'Lock city district',
  },
  {
    name: 'Erode',
    code: 'ERD',
    city: 'Erode',
    state: 'Tamil Nadu',
    pincodeFrom: '638001',
    pincodeTo: '638656',
    deliveryCharge: 2600,
    status: 'ACTIVE',
    colorHex: '#059669',
    description: 'Textile and turmeric hub',
  },
  {
    name: 'Kallakurichi',
    code: 'KUR',
    city: 'Kallakurichi',
    state: 'Tamil Nadu',
    pincodeFrom: '606202',
    pincodeTo: '606755',
    deliveryCharge: 2400,
    status: 'ACTIVE',
    colorHex: '#EA580C',
    description: 'Agricultural district',
  },
  {
    name: 'Kancheepuram',
    code: 'KPE',
    city: 'Kanchipuram',
    state: 'Tamil Nadu',
    pincodeFrom: '631502',
    pincodeTo: '632508',
    deliveryCharge: 2800,
    status: 'ACTIVE',
    colorHex: '#BE185D',
    description: 'Silk city district',
  },
  {
    name: 'Kanniyakumari',
    code: 'KKM',
    city: 'Nagercoil',
    state: 'Tamil Nadu',
    pincodeFrom: '629001',
    pincodeTo: '629704',
    deliveryCharge: 3200,
    status: 'ACTIVE',
    colorHex: '#0284C7',
    description: 'Southern tip district',
  },
  {
    name: 'Karur',
    code: 'KR',
    city: 'Karur',
    state: 'Tamil Nadu',
    pincodeFrom: '639001',
    pincodeTo: '639206',
    deliveryCharge: 2500,
    status: 'ACTIVE',
    colorHex: '#9333EA',
    description: 'Textile hub district',
  },
  {
    name: 'Krishnagiri',
    code: 'KGR',
    city: 'Krishnagiri',
    state: 'Tamil Nadu',
    pincodeFrom: '635001',
    pincodeTo: '635203',
    deliveryCharge: 2700,
    status: 'ACTIVE',
    colorHex: '#16A34A',
    description: 'Mango city district',
  },
  {
    name: 'Madurai',
    code: 'IXM',
    city: 'Madurai',
    state: 'Tamil Nadu',
    pincodeFrom: '625001',
    pincodeTo: '625016',
    deliveryCharge: 4200,
    status: 'ACTIVE',
    colorHex: '#F59E0B',
    description: 'Temple city zone',
  },
  {
    name: 'Mayiladuthurai',
    code: 'MLT',
    city: 'Mayiladuthurai',
    state: 'Tamil Nadu',
    pincodeFrom: '609001',
    pincodeTo: '609704',
    deliveryCharge: 2300,
    status: 'ACTIVE',
    colorHex: '#0D9488',
    description: 'Delta district',
  },
  {
    name: 'Nagapattinam',
    code: 'NP',
    city: 'Nagapattinam',
    state: 'Tamil Nadu',
    pincodeFrom: '611001',
    pincodeTo: '611806',
    deliveryCharge: 2300,
    status: 'ACTIVE',
    colorHex: '#2563EB',
    description: 'Coastal district',
  },
  {
    name: 'Namakkal',
    code: 'NKL',
    city: 'Namakkal',
    state: 'Tamil Nadu',
    pincodeFrom: '637001',
    pincodeTo: '637504',
    deliveryCharge: 2500,
    status: 'ACTIVE',
    colorHex: '#CA8A04',
    description: 'Egg city district',
  },
  {
    name: 'Nilgiris',
    code: 'NLR',
    city: 'Ooty',
    state: 'Tamil Nadu',
    pincodeFrom: '643001',
    pincodeTo: '643231',
    deliveryCharge: 3400,
    status: 'ACTIVE',
    colorHex: '#15803D',
    description: 'Hill district',
  },
  {
    name: 'Perambalur',
    code: 'PER',
    city: 'Perambalur',
    state: 'Tamil Nadu',
    pincodeFrom: '621212',
    pincodeTo: '621716',
    deliveryCharge: 2300,
    status: 'ACTIVE',
    colorHex: '#7E22CE',
    description: 'Central district',
  },
  {
    name: 'Pudukkottai',
    code: 'PKT',
    city: 'Pudukkottai',
    state: 'Tamil Nadu',
    pincodeFrom: '622001',
    pincodeTo: '622107',
    deliveryCharge: 2300,
    status: 'ACTIVE',
    colorHex: '#EC4899',
    description: 'Cultural district',
  },
  {
    name: 'Ramanathapuram',
    code: 'RMN',
    city: 'Ramanathapuram',
    state: 'Tamil Nadu',
    pincodeFrom: '623501',
    pincodeTo: '623510',
    deliveryCharge: 2100,
    status: 'ACTIVE',
    colorHex: '#6366F1',
    description: 'Coastal district',
  },
  {
    name: 'Ranipet',
    code: 'RP',
    city: 'Ranipet',
    state: 'Tamil Nadu',
    pincodeFrom: '632501',
    pincodeTo: '632512',
    deliveryCharge: 2400,
    status: 'ACTIVE',
    colorHex: '#8B5CF6',
    description: 'New district',
  },
  {
    name: 'Salem',
    code: 'SLM',
    city: 'Salem',
    state: 'Tamil Nadu',
    pincodeFrom: '636001',
    pincodeTo: '636108',
    deliveryCharge: 2800,
    status: 'ACTIVE',
    colorHex: '#F97316',
    description: 'Mango city',
  },
  {
    name: 'Sivaganga',
    code: 'SG',
    city: 'Sivaganga',
    state: 'Tamil Nadu',
    pincodeFrom: '630501',
    pincodeTo: '630510',
    deliveryCharge: 2400,
    status: 'ACTIVE',
    colorHex: '#A855F7',
    description: 'Interior district',
  },
  {
    name: 'Tenkasi',
    code: 'TNK',
    city: 'Tenkasi',
    state: 'Tamil Nadu',
    pincodeFrom: '625701',
    pincodeTo: '627806',
    deliveryCharge: 2200,
    status: 'ACTIVE',
    colorHex: '#EC4899',
    description: 'Western TN district',
  },
  {
    name: 'Thanjavur',
    code: 'TJ',
    city: 'Thanjavur',
    state: 'Tamil Nadu',
    pincodeFrom: '613001',
    pincodeTo: '613106',
    deliveryCharge: 2900,
    status: 'ACTIVE',
    colorHex: '#A3E4D7',
    description: 'Rice bowl of TN',
  },
  {
    name: 'Theni',
    code: 'TNI',
    city: 'Theni',
    state: 'Tamil Nadu',
    pincodeFrom: '625501',
    pincodeTo: '625510',
    deliveryCharge: 2300,
    status: 'ACTIVE',
    colorHex: '#F472B6',
    description: 'Mountain district',
  },
  {
    name: 'Thoothukudi',
    code: 'TKD',
    city: 'Thoothukudi',
    state: 'Tamil Nadu',
    pincodeFrom: '628001',
    pincodeTo: '628106',
    deliveryCharge: 2600,
    status: 'ACTIVE',
    colorHex: '#14B8A6',
    description: 'Pearl city',
  },
  {
    name: 'Tiruchirappalli',
    code: 'TRP',
    city: 'Tiruchirappalli',
    state: 'Tamil Nadu',
    pincodeFrom: '620001',
    pincodeTo: '620013',
    deliveryCharge: 2700,
    status: 'ACTIVE',
    colorHex: '#3B82F6',
    description: 'Educational hub',
  },
  {
    name: 'Tirunelveli',
    code: 'TNL',
    city: 'Tirunelveli',
    state: 'Tamil Nadu',
    pincodeFrom: '627001',
    pincodeTo: '627106',
    deliveryCharge: 2800,
    status: 'ACTIVE',
    colorHex: '#059669',
    description: 'Southern hub district',
  },
  {
    name: 'Tirupathur',
    code: 'TPT',
    city: 'Tirupathur',
    state: 'Tamil Nadu',
    pincodeFrom: '635601',
    pincodeTo: '635651',
    deliveryCharge: 2400,
    status: 'ACTIVE',
    colorHex: '#84CC16',
    description: 'New district',
  },
  {
    name: 'Tiruppur',
    code: 'TP',
    city: 'Tiruppur',
    state: 'Tamil Nadu',
    pincodeFrom: '641601',
    pincodeTo: '641606',
    deliveryCharge: 2500,
    status: 'ACTIVE',
    colorHex: '#14B8A6',
    description: 'Textile city',
  },
  {
    name: 'Tiruvallur',
    code: 'TVL',
    city: 'Tiruvallur',
    state: 'Tamil Nadu',
    pincodeFrom: '602001',
    pincodeTo: '602115',
    deliveryCharge: 3800,
    status: 'ACTIVE',
    colorHex: '#F472B6',
    description: 'North Chennai district',
  },
  {
    name: 'Tiruvannamalai',
    code: 'TVM',
    city: 'Tiruvannamalai',
    state: 'Tamil Nadu',
    pincodeFrom: '606601',
    pincodeTo: '606610',
    deliveryCharge: 2600,
    status: 'ACTIVE',
    colorHex: '#A855F7',
    description: 'Spiritual district',
  },
  {
    name: 'Tiruvarur',
    code: 'TVR',
    city: 'Tiruvarur',
    state: 'Tamil Nadu',
    pincodeFrom: '610001',
    pincodeTo: '610112',
    deliveryCharge: 2700,
    status: 'ACTIVE',
    colorHex: '#D97706',
    description: 'Coastal delta district',
  },
  {
    name: 'Vellore',
    code: 'VLR',
    city: 'Vellore',
    state: 'Tamil Nadu',
    pincodeFrom: '632001',
    pincodeTo: '632106',
    deliveryCharge: 3200,
    status: 'ACTIVE',
    colorHex: '#F87171',
    description: 'Fort district',
  },
  {
    name: 'Viluppuram',
    code: 'VPM',
    city: 'Viluppuram',
    state: 'Tamil Nadu',
    pincodeFrom: '605101',
    pincodeTo: '605152',
    deliveryCharge: 2800,
    status: 'ACTIVE',
    colorHex: '#6366F1',
    description: 'Large district',
  },
  {
    name: 'Virudhunagar',
    code: 'VR',
    city: 'Virudhunagar',
    state: 'Tamil Nadu',
    pincodeFrom: '626001',
    pincodeTo: '626006',
    deliveryCharge: 2400,
    status: 'ACTIVE',
    colorHex: '#84CC16',
    description: 'Agricultural district',
  },
];

// ---- Helpers ----
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randItem<T>(arr: readonly T[]): T {
  const value = arr[randomInt(0, arr.length - 1)];
  if (value === undefined) {
    throw new Error('randItem called with an empty array');
  }
  return value;
}

/** Generic TN business contact format — demo fixture data, never real PII. */
function makePhone(): string {
  return '+916' + Math.random().toString().substring(2, 10);
}

function makeGstin(): string {
  return '33AABFS' + Math.random().toString().substring(2, 13).toUpperCase() + '1Z5';
}

function makeFssai(): string {
  const suffix = Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(0, 5))).join(
    '',
  );
  return '1234567890ABCDE' + suffix;
}

function demoAddress(
  street: string,
  locality: string,
  city: string,
  pinFrom: string,
  pinTo: string,
): string {
  const pin = String(randomInt(Number(pinFrom), Number(pinTo))).padStart(6, '0');
  return `${randomInt(10, 99)}, ${street}, ${locality}, ${city} - ${pin}`;
}

async function main(): Promise<void> {
  // Roles
  for (const name of [RoleKey.SUPER_ADMIN, RoleKey.ZONAL_ADMIN]) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }
  console.log('[seed] roles ready');

  // Super admin
  const email = process.env.INITIAL_SUPERADMIN_EMAIL;
  const password = process.env.INITIAL_SUPERADMIN_PASSWORD;
  if (email && password) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `INITIAL_SUPERADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (doc 14)`,
      );
    }
    const superAdminRole = await prisma.role.findUniqueOrThrow({
      where: { name: RoleKey.SUPER_ADMIN },
    });
    const existing = await prisma.user.findFirst({ where: { email, deletedAt: null } });
    if (existing) {
      console.log(`[seed] super admin already present (${email})`);
    } else {
      await prisma.user.create({
        data: {
          name: 'Super Admin',
          email,
          passwordHash: await hashPassword(password),
          roleId: superAdminRole.id,
          status: 'ACTIVE',
        },
      });
      console.log(`[seed] super admin ready (${email})`);
    }
  } else {
    console.log('[seed] INITIAL_SUPERADMIN_EMAIL/PASSWORD not set — skipped admin account');
  }

  // Zones — idempotent: only districts whose name is missing are added, so an
  // already-configured dev database keeps its rows.
  const existingZoneNames = new Set(
    await prisma.zone.findMany({ select: { name: true } }).then((rows) => rows.map((z) => z.name)),
  );
  const zonesToAdd = ALL_TAMIL_NADU_DISTRICTS.filter((d) => !existingZoneNames.has(d.name));

  if (zonesToAdd.length > 0) {
    await prisma.zone.createMany({ data: zonesToAdd, skipDuplicates: true });
    console.log(`[seed] added ${zonesToAdd.length} district zones (out of 38 total)`);
  } else {
    console.log('[seed] all 38 Tamil Nadu districts already present — no new zones added');
  }

  const zoneChennai = await prisma.zone.findUniqueOrThrow({ where: { name: 'Chennai' } });
  const zoneCoimbatore = await prisma.zone.findUniqueOrThrow({ where: { name: 'Coimbatore' } });
  const zoneMadurai = await prisma.zone.findUniqueOrThrow({ where: { name: 'Madurai' } });

  // ---- Restaurants (doc 08: free-text `area`, zone-owned) ----
  const restaurantCount = await prisma.restaurant.count();
  if (restaurantCount === 0) {
    const chennai = LOCALITIES.Chennai ?? [];
    const coimbatore = LOCALITIES.Coimbatore ?? [];
    const madurai = LOCALITIES.Madurai ?? [];
    const restaurants: Prisma.RestaurantCreateManyInput[] = [
      {
        name: 'Sangeetha Vegetarian Restaurant',
        ownerName: 'Sangeetha Restaurants',
        zoneId: zoneChennai.id,
        area: randItem(chennai),
        address: demoAddress('Luz Church Road', randItem(chennai), 'Chennai', '600001', '600119'),
        phone: makePhone(),
        gstNo: makeGstin(),
        fssaiNo: makeFssai(),
        cuisineTags: ['South Indian'],
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Murugan Idli Shop',
        ownerName: 'Murugan Food',
        zoneId: zoneChennai.id,
        area: randItem(chennai),
        address: demoAddress('TTK Road', randItem(chennai), 'Chennai', '600001', '600119'),
        phone: makePhone(),
        gstNo: makeGstin(),
        fssaiNo: makeFssai(),
        cuisineTags: ['South Indian'],
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Buhari Restaurant',
        ownerName: 'Buhari Foods',
        zoneId: zoneChennai.id,
        area: randItem(chennai),
        address: demoAddress(
          'Mount Poonneri Road',
          randItem(chennai),
          'Chennai',
          '600001',
          '600119',
        ),
        phone: makePhone(),
        gstNo: makeGstin(),
        fssaiNo: makeFssai(),
        cuisineTags: ['Mughlai'],
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'A2B (Adyar Ananda Bhavan)',
        ownerName: 'A2B Restaurant',
        zoneId: zoneCoimbatore.id,
        area: randItem(coimbatore),
        address: demoAddress('RS Puram', randItem(coimbatore), 'Coimbatore', '641001', '641109'),
        phone: makePhone(),
        gstNo: makeGstin(),
        fssaiNo: makeFssai(),
        cuisineTags: ['South Indian'],
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Vittal Veg Restaurant',
        ownerName: 'Vittal Vegetarian',
        zoneId: zoneCoimbatore.id,
        area: randItem(coimbatore),
        address: demoAddress(
          'Avinashilingam Street',
          randItem(coimbatore),
          'Coimbatore',
          '641001',
          '641109',
        ),
        phone: makePhone(),
        gstNo: makeGstin(),
        fssaiNo: makeFssai(),
        cuisineTags: ['South Indian'],
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'The Star Restaurant',
        ownerName: 'Star Restaurant',
        zoneId: zoneMadurai.id,
        area: randItem(madurai),
        address: demoAddress(
          'West Perumal Street',
          randItem(madurai),
          'Madurai',
          '625001',
          '625016',
        ),
        phone: makePhone(),
        gstNo: makeGstin(),
        fssaiNo: makeFssai(),
        cuisineTags: ['North Indian'],
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Kimberly Restaurant',
        ownerName: 'Kimberly Foods',
        zoneId: zoneChennai.id,
        area: 'OMR',
        address: '244, Old OMR, Kandanchavadi, Chennai - 600116',
        phone: '+914426667788',
        gstNo: '33AABFS1234A1Z1',
        fssaiNo: '1234567890ABCDEFGN',
        cuisineTags: ['Chinese'],
        status: 'SUSPENDED',
        verificationStatus: 'PENDING',
      },
    ];
    await prisma.restaurant.createMany({ data: restaurants, skipDuplicates: true });
    console.log(`[seed] added ${restaurants.length} restaurant records`);
  } else {
    console.log(`[seed] ${restaurantCount} restaurant records already present — skipped`);
  }

  // ---- Homemakers (doc 08: `food_category` + `speciality_tags`) ----
  const homemakerCount = await prisma.homemaker.count();
  if (homemakerCount === 0) {
    const chennai = LOCALITIES.Chennai ?? [];
    const coimbatore = LOCALITIES.Coimbatore ?? [];
    const madurai = LOCALITIES.Madurai ?? [];
    const homemakers: Prisma.HomemakerCreateManyInput[] = [
      {
        name: 'Soundarya Home Kitchen',
        zoneId: zoneChennai.id,
        area: randItem(chennai),
        address: demoAddress('Second Main Road', randItem(chennai), 'Chennai', '600001', '600119'),
        phone: makePhone(),
        fssaiNo: makeFssai(),
        foodCategory: 'Tiffin',
        specialityTags: ['Tiffin'],
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Bhagyalakshmi Tiffin Centre',
        zoneId: zoneChennai.id,
        area: randItem(chennai),
        address: demoAddress('Gandhi Road', randItem(chennai), 'Chennai', '600001', '600119'),
        phone: makePhone(),
        fssaiNo: makeFssai(),
        foodCategory: 'Tiffin',
        specialityTags: ['Tiffin'],
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Gayathri Home Food',
        zoneId: zoneChennai.id,
        area: randItem(chennai),
        address: demoAddress('Fourth Street', randItem(chennai), 'Chennai', '600001', '600119'),
        phone: makePhone(),
        fssaiNo: makeFssai(),
        foodCategory: 'Sweets',
        specialityTags: ['Sweets'],
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Mythili Kitchen',
        zoneId: zoneCoimbatore.id,
        area: randItem(coimbatore),
        address: demoAddress('Sathy Road', randItem(coimbatore), 'Coimbatore', '641001', '641109'),
        phone: makePhone(),
        fssaiNo: makeFssai(),
        foodCategory: 'Filter Coffee',
        specialityTags: ['Beverages'],
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Jyothi Home Cooked Meals',
        zoneId: zoneCoimbatore.id,
        area: randItem(coimbatore),
        address: demoAddress(
          'Avinashi Road',
          randItem(coimbatore),
          'Coimbatore',
          '641001',
          '641109',
        ),
        phone: makePhone(),
        fssaiNo: makeFssai(),
        foodCategory: 'Daily Meals',
        specialityTags: ['Meals'],
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Prema Catering',
        zoneId: zoneMadurai.id,
        area: randItem(madurai),
        address: demoAddress('Veli Street', randItem(madurai), 'Madurai', '625001', '625016'),
        phone: makePhone(),
        fssaiNo: makeFssai(),
        foodCategory: 'Catering',
        specialityTags: ['Catering'],
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Selvi Home Catering',
        zoneId: zoneMadurai.id,
        area: randItem(madurai),
        address: demoAddress('College Road', randItem(madurai), 'Madurai', '625001', '625016'),
        phone: makePhone(),
        fssaiNo: makeFssai(),
        foodCategory: 'Party Food',
        specialityTags: ['Party'],
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Radha Home Food',
        zoneId: zoneChennai.id,
        area: 'Velachery',
        address: '42, Velachery Main Road, Velachery, Chennai - 600042',
        phone: '+914424509988',
        fssaiNo: '1234567890ABCDEFGH',
        foodCategory: 'Low-Carb',
        specialityTags: ['Healthy'],
        status: 'ACTIVE',
        verificationStatus: 'PENDING',
      },
    ];
    await prisma.homemaker.createMany({ data: homemakers, skipDuplicates: true });
    console.log(`[seed] added ${homemakers.length} homemaker records`);
  } else {
    console.log(`[seed] ${homemakerCount} homemaker records already present — skipped`);
  }

  // ---- Hotels (doc 08: zone-owned like restaurants; `phone`/`address` required) ----
  const hotelCount = await prisma.hotel.count();
  if (hotelCount === 0) {
    const hotels: Prisma.HotelCreateManyInput[] = [
      {
        name: 'aria Hotel',
        ownerName: 'aria Hotels',
        zoneId: zoneChennai.id,
        area: 'Chennai Central',
        address: '12, Anna Salai, Chennai - 600002',
        phone: makePhone(),
        gstNo: makeGstin(),
        totalRooms: 120,
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Uma Hotel',
        ownerName: 'Uma Hotels',
        zoneId: zoneChennai.id,
        area: 'T Nagar',
        address: '8, Usman Road, T Nagar, Chennai - 600017',
        phone: makePhone(),
        gstNo: makeGstin(),
        totalRooms: 80,
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'S Square Hotel',
        ownerName: 'S Square Hotels',
        zoneId: zoneChennai.id,
        area: 'Anna Nagar',
        address: '2nd Avenue, Anna Nagar, Chennai - 600040',
        phone: makePhone(),
        gstNo: makeGstin(),
        totalRooms: 100,
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'The Tree Hotel',
        ownerName: 'Tree Hotel',
        zoneId: zoneCoimbatore.id,
        area: 'OMR',
        address: '3, OMR Main Road, Coimbatore - 641032',
        phone: makePhone(),
        gstNo: makeGstin(),
        totalRooms: 60,
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Brooklyn Hotel',
        ownerName: 'Brooklyn Hotels',
        zoneId: zoneCoimbatore.id,
        area: 'Gandhipuram',
        address: '14, Cross Cut Road, Gandhipuram, Coimbatore - 641012',
        phone: makePhone(),
        gstNo: makeGstin(),
        totalRooms: 150,
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Trident Chennai',
        ownerName: 'Trident Hotels',
        zoneId: zoneMadurai.id,
        area: 'KK Nagar',
        address: '20, KK Nagar, Madurai - 625020',
        phone: makePhone(),
        gstNo: makeGstin(),
        totalRooms: 200,
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Symbiosis Hotel',
        ownerName: 'Symbiosis Hotels',
        zoneId: zoneMadurai.id,
        area: 'Thoppur',
        address: '5, Thoppur Main Road, Madurai - 625006',
        phone: makePhone(),
        gstNo: makeGstin(),
        totalRooms: 90,
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
      {
        name: 'Aqua Hotel',
        ownerName: 'Aqua Hotels',
        zoneId: zoneChennai.id,
        area: 'Tambaram',
        address: '9, GST Road, Tambaram, Chennai - 600045',
        phone: makePhone(),
        gstNo: makeGstin(),
        totalRooms: 50,
        status: 'SUSPENDED',
        verificationStatus: 'PENDING',
      },
    ];
    await prisma.hotel.createMany({ data: hotels, skipDuplicates: true });
    console.log(`[seed] added ${hotels.length} hotel records`);
  } else {
    console.log(`[seed] ${hotelCount} hotel records already present — skipped`);
  }

  // ---- Menu items (doc 08: exactly one owning provider, `vendor_id` NOT NULL) ----
  const menuCount = await prisma.menuItem.count();
  if (menuCount === 0) {
    const restaurantsRef = await prisma.restaurant.findMany({
      select: { id: true, name: true, zoneId: true },
    });
    const hotelsRef = await prisma.hotel.findMany({
      select: { id: true, name: true, zoneId: true },
    });

    const restaurantByName = new Map(restaurantsRef.map((r) => [r.name, r]));
    const hotelByName = new Map(hotelsRef.map((h) => [h.name, h]));

    const links: Array<{
      restaurant?: string;
      hotel?: string;
      item: Omit<Prisma.MenuItemCreateManyInput, 'zoneId' | 'vendorId'>;
    }> = [
      {
        restaurant: 'Sangeetha Vegetarian Restaurant',
        item: {
          name: 'Idli Vada',
          description: 'Steamed rice cake with lentil fritter',
          category: 'Breakfast',
          dietary: 'VEGETARIAN',
          price: 4500,
          vendorType: 'RESTAURANT',
          approvalStatus: 'APPROVED',
        },
      },
      {
        restaurant: 'Murugan Idli Shop',
        item: {
          name: 'Plain Dosa',
          description: 'Crisp fermented rice crepe',
          category: 'Breakfast',
          dietary: 'VEGETARIAN',
          price: 3500,
          vendorType: 'RESTAURANT',
          approvalStatus: 'APPROVED',
        },
      },
      {
        restaurant: 'Buhari Restaurant',
        item: {
          name: 'Mutton Biryani',
          description: 'Slow-cooked aromatic mutton biryani',
          category: 'Main',
          dietary: 'NON_VEG',
          price: 32000,
          vendorType: 'RESTAURANT',
          approvalStatus: 'APPROVED',
        },
      },
      {
        restaurant: 'A2B (Adyar Ananda Bhavan)',
        item: {
          name: 'Bisi Bele Bath',
          description: 'Hot spiced rice lentil vegetable dish',
          category: 'Main',
          dietary: 'VEGETARIAN',
          price: 4500,
          vendorType: 'RESTAURANT',
          approvalStatus: 'APPROVED',
        },
      },
      {
        restaurant: 'The Star Restaurant',
        item: {
          name: 'Lemon Rice',
          description: 'Rice with lemon and spices',
          category: 'Main',
          dietary: 'VEGETARIAN',
          price: 4000,
          vendorType: 'RESTAURANT',
          approvalStatus: 'APPROVED',
        },
      },
      {
        hotel: 'aria Hotel',
        item: {
          name: 'Filter Coffee',
          description: 'Freshly filtered coffee',
          category: 'Beverage',
          dietary: 'VEGETARIAN',
          price: 1500,
          vendorType: 'HOTEL',
          approvalStatus: 'APPROVED',
        },
      },
      {
        hotel: 'Uma Hotel',
        item: {
          name: 'Butter Naan',
          description: 'Tandoor-baked butter naan',
          category: 'Main',
          dietary: 'VEGETARIAN',
          price: 2500,
          vendorType: 'HOTEL',
          approvalStatus: 'APPROVED',
        },
      },
      {
        hotel: 'The Tree Hotel',
        item: {
          name: 'Idli Vada',
          description: 'Steamed rice cake with lentil fritter',
          category: 'Breakfast',
          dietary: 'VEGETARIAN',
          price: 4500,
          vendorType: 'HOTEL',
          approvalStatus: 'APPROVED',
        },
      },
      {
        hotel: 'Trident Chennai',
        item: {
          name: 'Sambar',
          description: 'Lentil-tamarind vegetable stew',
          category: 'Starter',
          dietary: 'VEGETARIAN',
          price: 3000,
          vendorType: 'HOTEL',
          approvalStatus: 'APPROVED',
        },
      },
    ];

    const menuItems: Prisma.MenuItemCreateManyInput[] = [];
    for (const link of links) {
      const owner = link.restaurant
        ? restaurantByName.get(link.restaurant)
        : link.hotel
          ? hotelByName.get(link.hotel)
          : undefined;
      if (!owner) {
        console.warn(`[seed] menu item owner missing — skipped "${link.item.name}"`);
        continue;
      }
      menuItems.push({ ...link.item, zoneId: owner.zoneId, vendorId: owner.id });
    }

    if (menuItems.length > 0) {
      await prisma.menuItem.createMany({ data: menuItems, skipDuplicates: true });
      console.log(`[seed] added ${menuItems.length} menu item records`);
    } else {
      console.log('[seed] no menu item owners found — skipped');
    }
  } else {
    console.log(`[seed] ${menuCount} menu item records already present — skipped`);
  }

  console.log('[seed] done — all records idempotent / upsert-safe');
}

main()
  .catch((error) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
