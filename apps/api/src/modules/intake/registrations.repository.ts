import type { Prisma, PrismaClient } from '@prisma/client';
import type { AuditTx } from '../../lib/audit';
import { auditTx } from '../../lib/db';

// Self-registration from the vendor and partner apps (IH-2; doc 42 sections 5.3 and 5.4, doc 44 section 3, doc 45
// section 1.2). Intake owns these inserts (coordinator-approved, doc 32): source APP, no staff creator, and a zone only
// when the sign-up's pincode belongs to one. The admin modules' own inserts stay as they are.

export type RegistrationEntity = 'restaurant' | 'homemaker' | 'partner';

export interface SignupZone {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE' | 'UPCOMING';
}

export interface VendorSignupRow {
  id: string;
  kind: 'RESTAURANT' | 'SHOP' | null; // null: homemaker
  zoneId: string | null;
  name: string;
  ownerName: string;
  phone: string;
  email: string | null;
  address: string;
  area: string | null;
  lat: number;
  lng: number;
  tags: string[];
  foodCategory: string | null;
  experienceYears: number | null;
  receivedAt: Date;
}

export interface PartnerSignupRow {
  id: string;
  zoneId: string | null;
  name: string;
  phone: string;
  vehicleType: string;
  vehicleNo: string | null;
  area: string | null;
  receivedAt: Date;
}

export interface VendorState {
  id: string;
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  zoneAssignmentStatus: 'ASSIGNED' | 'UNASSIGNED';
  isOpen: boolean;
}

export interface PartnerState {
  id: string;
  status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
  zoneAssignmentStatus: 'ASSIGNED' | 'UNASSIGNED';
  isOnline: boolean;
}

const VENDOR_STATE = {
  id: true,
  status: true,
  verificationStatus: true,
  zoneAssignmentStatus: true,
  isOpen: true,
} as const;

export class RegistrationsRepository {
  constructor(private readonly db: Prisma.TransactionClient) {}

  /** The zone that owns a pincode, whatever its status (the service decides); a deleted pincode or zone is none. */
  async zoneOfPincode(pincode: string): Promise<SignupZone | null> {
    const row = await this.db.serviceablePincode.findFirst({
      where: { pincode, deletedAt: null, zone: { deletedAt: null } },
      select: { zone: { select: { id: true, name: true, status: true } } },
    });
    return row?.zone ?? null;
  }

  async internalIdOf(
    clientId: string,
    entityType: RegistrationEntity,
    externalId: string,
  ): Promise<string | null> {
    const ref = await this.db.externalRef.findUnique({
      where: { clientId_entityType_externalId: { clientId, entityType, externalId } },
      select: { internalId: true },
    });
    return ref?.internalId ?? null;
  }

  /**
   * Claims the app's id for a new record. False when it is already taken: a concurrent sign-up with the same id waits
   * on the primary key until the first transaction ends, then gets false and answers with the first record.
   */
  async claimRef(
    clientId: string,
    entityType: RegistrationEntity,
    externalId: string,
    internalId: string,
  ): Promise<boolean> {
    const r = await this.db.externalRef.createMany({
      data: [{ clientId, entityType, externalId, internalId }],
      skipDuplicates: true,
    });
    return r.count === 1;
  }

  async insertVendor(row: VendorSignupRow): Promise<void> {
    const shared = {
      id: row.id,
      zoneId: row.zoneId,
      zoneAssignmentStatus: row.zoneId ? ('ASSIGNED' as const) : ('UNASSIGNED' as const),
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      area: row.area,
      lat: row.lat,
      lng: row.lng,
      source: 'APP' as const,
      sourceUpdatedAt: row.receivedAt,
    };
    if (row.kind) {
      await this.db.restaurant.create({
        data: { ...shared, kind: row.kind, ownerName: row.ownerName, cuisineTags: row.tags },
      });
      return;
    }
    await this.db.homemaker.create({
      data: {
        ...shared,
        specialityTags: row.tags,
        foodCategory: row.foodCategory,
        experienceYears: row.experienceYears,
      },
    });
  }

  async vendorState(entity: 'restaurant' | 'homemaker', id: string): Promise<VendorState | null> {
    return entity === 'restaurant'
      ? this.db.restaurant.findFirst({ where: { id, deletedAt: null }, select: VENDOR_STATE })
      : this.db.homemaker.findFirst({ where: { id, deletedAt: null }, select: VENDOR_STATE });
  }

  /** A live partner already has this mobile (the admin rule, PartnersRepository.phoneTaken). */
  async partnerPhoneTaken(phone: string): Promise<boolean> {
    return (await this.db.deliveryPartner.count({ where: { phone, deletedAt: null } })) > 0;
  }

  async insertPartner(row: PartnerSignupRow): Promise<void> {
    await this.db.deliveryPartner.create({
      data: {
        id: row.id,
        zoneId: row.zoneId,
        zoneAssignmentStatus: row.zoneId ? 'ASSIGNED' : 'UNASSIGNED',
        name: row.name,
        phone: row.phone,
        vehicleType: row.vehicleType,
        vehicleNo: row.vehicleNo,
        area: row.area,
        source: 'APP',
        sourceUpdatedAt: row.receivedAt,
      },
    });
  }

  async partnerState(id: string): Promise<PartnerState | null> {
    return this.db.deliveryPartner.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        status: true,
        verificationStatus: true,
        zoneAssignmentStatus: true,
        isOnline: true,
      },
    });
  }
}

export interface RegistrationsTx {
  repo: RegistrationsRepository;
  audit: AuditTx;
}

export class RegistrationsDatabase {
  constructor(private readonly prisma: PrismaClient) {}

  transaction<T>(fn: (tx: RegistrationsTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      (tx) => fn({ repo: new RegistrationsRepository(tx), audit: auditTx(tx) }),
      { maxWait: 5_000, timeout: 10_000 },
    );
  }
}
