-- D131 (owner-decided 2026-10-17): partner documents reuse vendor_documents
-- with vendor_type DELIVERY_PARTNER. Additive enum value only; no rows use
-- it in this migration (PostgreSQL allows ALTER TYPE ADD VALUE in a
-- transaction as long as the new value is not referenced before commit).

-- AlterEnum
ALTER TYPE "VendorType" ADD VALUE 'DELIVERY_PARTNER';
