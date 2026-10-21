import {
  joinIntakeAddress,
  type IntakePartnerRef,
  type IntakePartnerRegister,
  type IntakeVendorRef,
  type IntakeVendorRegister,
} from '@zoauro/shared';
import { record, uuidv7 } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import type { IntakeClient } from './intake.middleware';
import type {
  PartnerState,
  RegistrationEntity,
  RegistrationsDatabase,
  RegistrationsRepository,
  SignupZone,
  VendorState,
} from './registrations.repository';

// Vendor and partner self-registration (IH-2; doc 42 sections 5.3, 5.4, 6.2 and 7; doc 45 section 1.2; doc 32 row of
// 2026-10-20, coordinator-approved):
//  - zone: the pincode's zone if it is ACTIVE or UPCOMING (201, ASSIGNED); INACTIVE or none -> no zone (202,
//    UNASSIGNED, Super Admin only until assigned). A service switched off in the zone does not block a sign-up.
//  - the app's id is claimed in external_refs first; sending the same id again (new Idempotency-Key) answers 200 with
//    the record already there, and nothing is created twice, even for two requests at the same moment.
//  - partners: a live partner with the same mobile is 409 (the admin rule); vendors have no such rule.
//  - documents arrive with IH-2b; until then a sign-up that carries any is refused, not silently half-done.
//  - one audit row per new record, by the app (APP_CLIENT), with the zone or an explicit null.

export type SignupStatus = 200 | 201 | 202;

export interface VendorSignup {
  httpStatus: SignupStatus;
  ref: IntakeVendorRef;
  entity: 'restaurant' | 'homemaker';
  zoneId: string | null;
}

export interface PartnerSignup {
  httpStatus: SignupStatus;
  ref: IntakePartnerRef;
  zoneId: string | null;
}

const DOCUMENTS_LATER = new AppError(
  'VALIDATION_ERROR',
  'Documents cannot be sent with the sign-up yet: register first, then attach them',
  [{ field: 'documents', issue: 'not_accepted_yet' }],
);

/** ACTIVE or UPCOMING: the zone's team can review it; INACTIVE: no zone, the Super Admin decides (D87). */
const assignable = (z: SignupZone | null): SignupZone | null =>
  z && z.status !== 'INACTIVE' ? z : null;

function vendorRef(externalId: string, s: VendorState): IntakeVendorRef {
  return {
    id: s.id,
    externalId,
    verificationStatus: s.verificationStatus,
    status: s.status,
    zoneStatus: s.zoneAssignmentStatus,
    isOpen: s.isOpen,
  };
}

function partnerRef(externalId: string, s: PartnerState): IntakePartnerRef {
  return {
    id: s.id,
    externalId,
    verificationStatus: s.verificationStatus,
    status: s.status,
    zoneStatus: s.zoneAssignmentStatus,
    isOnline: s.isOnline,
  };
}

async function mustExist<T>(p: Promise<T | null>): Promise<T> {
  const v = await p;
  if (v === null) throw new AppError('INTERNAL', 'registered record not found');
  return v;
}

export class RegistrationsService {
  constructor(private readonly db: RegistrationsDatabase) {}

  async registerVendor(
    client: IntakeClient,
    input: IntakeVendorRegister,
    receivedAt: Date,
  ): Promise<VendorSignup> {
    if (input.documents && input.documents.length > 0) throw DOCUMENTS_LATER;
    const entity = input.type === 'HOMEMAKER' ? 'homemaker' : 'restaurant';
    const other = entity === 'homemaker' ? 'restaurant' : 'homemaker';

    return this.db.transaction(async (tx) => {
      // the same app id once as a restaurant and once as a homemaker would be two records for one vendor
      if (await tx.repo.internalIdOf(client.id, other, input.vendorId)) {
        throw new AppError('CONFLICT', `This vendorId is already registered as a ${other}`, [
          { field: 'vendorId', issue: 'registered_as_other_type' },
        ]);
      }
      const id = uuidv7();
      const existing = await this.claimOrExisting(tx.repo, client.id, entity, input.vendorId, id);
      if (existing) {
        const s = await mustExist(tx.repo.vendorState(entity, existing));
        return {
          httpStatus: 200,
          ref: vendorRef(input.vendorId, s),
          entity,
          zoneId: null,
        } satisfies VendorSignup;
      }

      const zone = assignable(await tx.repo.zoneOfPincode(input.address.pincode));
      await tx.repo.insertVendor({
        id,
        kind: input.type === 'HOMEMAKER' ? null : input.type,
        zoneId: zone?.id ?? null,
        name: input.name,
        ownerName: input.ownerName,
        phone: input.phone,
        email: input.email ?? null,
        address: joinIntakeAddress(input.address),
        area: input.address.area ?? null,
        lat: input.address.lat,
        lng: input.address.lng,
        tags: input.cuisineTags ?? [],
        foodCategory: input.foodCategory ?? null,
        experienceYears: input.experienceYears ?? null,
        receivedAt,
      });
      await record(tx.audit, {
        module: entity === 'restaurant' ? 'restaurants' : 'homemakers',
        action: entity === 'restaurant' ? 'restaurant.created' : 'homemaker.created',
        entity: { type: entity, id, label: input.name, zoneId: zone?.id ?? null },
        after: {
          name: input.name,
          type: input.type,
          source: 'APP',
          zoneAssignmentStatus: zone ? 'ASSIGNED' : 'UNASSIGNED',
          area: input.address.area ?? null,
          externalId: input.vendorId,
        },
      });
      const s = await mustExist(tx.repo.vendorState(entity, id));
      return {
        httpStatus: zone ? 201 : 202,
        ref: vendorRef(input.vendorId, s),
        entity,
        zoneId: zone?.id ?? null,
      } satisfies VendorSignup;
    });
  }

  async registerPartner(
    client: IntakeClient,
    input: IntakePartnerRegister,
    receivedAt: Date,
  ): Promise<PartnerSignup> {
    if (input.documents && input.documents.length > 0) throw DOCUMENTS_LATER;
    return this.db.transaction(async (tx) => {
      const id = uuidv7();
      const existing = await this.claimOrExisting(
        tx.repo,
        client.id,
        'partner',
        input.partnerId,
        id,
      );
      if (existing) {
        const s = await mustExist(tx.repo.partnerState(existing));
        return {
          httpStatus: 200,
          ref: partnerRef(input.partnerId, s),
          zoneId: null,
        } satisfies PartnerSignup;
      }
      if (await tx.repo.partnerPhoneTaken(input.phone)) {
        throw new AppError(
          'CONFLICT',
          'A delivery partner with this mobile number already exists',
          [{ field: 'phone', issue: 'taken' }],
        );
      }
      const zone = assignable(await tx.repo.zoneOfPincode(input.pincode));
      await tx.repo.insertPartner({
        id,
        zoneId: zone?.id ?? null,
        name: input.name,
        phone: input.phone,
        vehicleType: input.vehicleType,
        vehicleNo: input.vehicleNo ?? null,
        area: input.area ?? null,
        receivedAt,
      });
      await record(tx.audit, {
        module: 'delivery',
        action: 'partner.created',
        entity: { type: 'partner', id, label: input.name, zoneId: zone?.id ?? null },
        after: {
          name: input.name,
          vehicleType: input.vehicleType,
          source: 'APP',
          zoneAssignmentStatus: zone ? 'ASSIGNED' : 'UNASSIGNED',
          area: input.area ?? null,
          externalId: input.partnerId,
        },
      });
      const s = await mustExist(tx.repo.partnerState(id));
      return {
        httpStatus: zone ? 201 : 202,
        ref: partnerRef(input.partnerId, s),
        zoneId: zone?.id ?? null,
      } satisfies PartnerSignup;
    });
  }

  /** null: the id was free and is now this new record's; otherwise the internal id it already belongs to. */
  private async claimOrExisting(
    repo: RegistrationsRepository,
    clientId: string,
    entity: RegistrationEntity,
    externalId: string,
    newId: string,
  ): Promise<string | null> {
    if (await repo.claimRef(clientId, entity, externalId, newId)) return null;
    const existing = await repo.internalIdOf(clientId, entity, externalId);
    if (!existing) throw new AppError('INTERNAL', 'external reference vanished');
    return existing;
  }
}
