-- M02 (doc 53 section 3): zones and serviceable_pincodes enforced by the database. zones and serviceable_pincodes had
-- 0 rows when this was written (NOT NULL columns without a default are safe). Generated with prisma migrate diff
-- (schema to schema, no database), plus the hand-written part at the end.

-- CreateEnum
CREATE TYPE "PincodeSource" AS ENUM ('RANGE', 'MANUAL', 'IMPORT');

-- DropIndex
DROP INDEX "zones_name_key";

-- DropIndex
DROP INDEX "serviceable_pincodes_pincode_idx";

-- AlterTable
ALTER TABLE "zones" ADD COLUMN     "activated_at" TIMESTAMPTZ,
ADD COLUMN     "deactivated_at" TIMESTAMPTZ,
ADD COLUMN     "deactivation_reason" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "pincode_from" SET DATA TYPE CHAR(6),
ALTER COLUMN "pincode_to" SET DATA TYPE CHAR(6),
ALTER COLUMN "status" SET DEFAULT 'UPCOMING',
ALTER COLUMN "color_hex" SET NOT NULL,
ALTER COLUMN "color_hex" SET DATA TYPE CHAR(7);

-- AlterTable
ALTER TABLE "serviceable_pincodes" ADD COLUMN     "source" "PincodeSource" NOT NULL,
ALTER COLUMN "pincode" SET DATA TYPE CHAR(6);

-- CreateIndex
CREATE UNIQUE INDEX "zones_code_key" ON "zones"("code");

-- CreateIndex
CREATE UNIQUE INDEX "serviceable_pincodes_pincode_key" ON "serviceable_pincodes"("pincode");

-- Hand-written (Prisma cannot express these) -------------------------------------------------------------------------

-- R-ZONE-3: code unique INCLUDING soft-deleted zones. zones_code_key above replaces the partial index of the
-- constraints migration, which let a soft-deleted zone's code be reused.
DROP INDEX "zones_code_active_key";

-- R-ZONE-4: name unique case-insensitively among non-deleted zones (replaces the case-sensitive zones_name_key).
CREATE UNIQUE INDEX "zones_name_lower_active_key" ON "zones" (lower("name")) WHERE "deleted_at" IS NULL;

ALTER TABLE "zones" ADD CONSTRAINT "zones_code_format_chk" CHECK ("code" ~ '^[A-Z][A-Z0-9]{1,5}$');
-- R-ZONE-5: integer paise, ₹1 000 sanity ceiling
ALTER TABLE "zones" ADD CONSTRAINT "zones_delivery_charge_chk" CHECK ("delivery_charge" BETWEEN 0 AND 100000);
-- doc 53: pincode_from <= pincode_to; also both or neither (a half range means nothing)
ALTER TABLE "zones" ADD CONSTRAINT "zones_pincode_range_chk"
  CHECK (
    ("pincode_from" IS NULL AND "pincode_to" IS NULL)
    OR ("pincode_from" IS NOT NULL AND "pincode_to" IS NOT NULL AND "pincode_from" <= "pincode_to")
  );
ALTER TABLE "serviceable_pincodes" ADD CONSTRAINT "serviceable_pincodes_pincode_format_chk"
  CHECK ("pincode" ~ '^[1-9][0-9]{5}$');
