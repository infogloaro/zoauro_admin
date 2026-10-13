/**
 * Shared vendor core for M06 Restaurants and M07 Homemakers (doc 07 module
 * list keeps them separate; the two tables share every flow, so the
 * implementation lives here and each module mounts its own thin router).
 */
export { createVendorRouter } from './vendor.router';
export {
  VENDOR_PERMISSIONS,
  MOVE_ZONE_PERMISSION,
  type VendorPermission,
} from './vendor.permissions';
export { assertStatusTransition, assertVerificationDecision } from './vendor.state';
export type { ZoneRef } from './vendor.types';
